import os
import requests
from typing import List, Tuple, Dict, Callable, Iterator, Optional

import tiktoken
import openai
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_anthropic import ChatAnthropic
from langchain_ollama import ChatOllama
from langchain.prompts import ChatPromptTemplate
from langchain_core.runnables.base import Runnable
from langchain_core.output_parsers import JsonOutputParser
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult

from .exceptions import ModelNotFoundError
from .wrappers import LLM, LLMBaseModel, BaseModel


def verify_model_name(model_name: str, base_url: Optional[str] = None) -> bool:
    if base_url:
        resp = requests.get(f"{base_url}/api/tags")
    else:
        resp = requests.get(f"http://localhost:11434/api/tags")
    resp.raise_for_status()
    data = resp.json()
    return any(model.get("name") == model_name for model in data.get("models", []))


def load_llm(
    model_name: str,
    temperature: float = 0.0,
    port: int = 8000,
    seed: int = 42,
) -> LLM:
    if model_name.startswith("openai/"):
        return ChatOpenAI(
            model=model_name.split("openai/", 1)[1],
            temperature=temperature,
            seed=seed,
            request_timeout=30.0,
            model_kwargs={"response_format": {"type": "json_object"}}
        )
    elif model_name.startswith("google/"):
        return ChatGoogleGenerativeAI(
            model=model_name.split("google/", 1)[1],
            temperature=temperature,
            model_kwargs={"generation_config": {"response_mime_type": "application/json"}}
        )
    elif model_name.startswith("anthropic/"):
        return ChatAnthropic(
            model=model_name.split("anthropic/", 1)[1],
            temperature=temperature,
            max_tokens=8192
            # model_kwargs=model_kwargs
        )
    elif model_name.startswith("ollama/"):
        base_url = os.getenv("OLLAMA_BASE")
        model_exists = verify_model_name(
            model_name=model_name.split("ollama/", 1)[1],
            base_url=base_url
        )
        if model_exists:
            kwargs = {
                "model": model_name.split("ollama/", 1)[1],
                "temperature": temperature,
                "seed": seed,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return ChatOllama(**kwargs)
        else:
            raise ModelNotFoundError(f"{model_name} was not found in the available list.")
    else:
        # Note: VLLMOpenAI is for base models
        #       ref: https://python.langchain.com/v0.2/docs/integrations/chat/vllm/
        return ChatOpenAI(
            model=model_name,
            openai_api_key="EMPTY",
            openai_api_base=f"http://localhost:{port}/v1",
            temperature=temperature,
            max_tokens=2048,
            model_kwargs={"seed": seed}
        )


def build_json_agent(
    llm: LLM,
    chat_messages: List[Tuple[str, str]],
    pydantic_object: LLMBaseModel,
    is_async: bool = False,
    enables_prefill: bool = False,
    streaming_func: Callable = None
) -> Runnable:
    if enables_prefill:
        first_key = str(list(pydantic_object.__fields__.keys())[0])
        prefill_str = '```json\n{{\"{key}\":'.replace("{key}", first_key)
        # chat_messages.append(("human", 'The keys and values in the output JSON dictionary must always be enclosed in single double quotes. Triple quotes (""" or ```) must not be used.'))
        chat_messages.append(("ai", prefill_str)) # add json prefill
        # chat_messages.append(("human", "Please continue the output from where it left off."))
        # chat_messages.append(("human", "Please continue the subsequent output from the middle."))
    parser = JsonOutputParser(pydantic_object=pydantic_object)
    prompt = ChatPromptTemplate.from_messages(chat_messages)
    prompt = prompt.partial(format_instructions=parser.get_format_instructions())
    if streaming_func is None:
        if is_async:
            async def extract_json_items_streaming(input_stream):
                async for input in input_stream:
                    if not isinstance(input, dict):
                        continue
                    yield {key: input.get(key) for key in pydantic_object.__fields__.keys()}
        else:
            def extract_json_items_streaming(input_stream):
                for input in input_stream:
                    if not isinstance(input, dict):
                        continue
                    yield {key: input.get(key) for key in pydantic_object.__fields__.keys()}
    else:
        extract_json_items_streaming = streaming_func
    if enables_prefill:
        if is_async:
            async def add_prefill(input):
                buffer = ""
                prefix_added = False
                prefill_len = len(prefill_str) + 5 # margin
                async for chunk in input:
                    if not prefix_added:
                        buffer += chunk.content
                        buffer_len = len(buffer)
                        if buffer_len >= prefill_len:
                            if "```json" in buffer:
                                yield buffer
                                prefix_added = True
                            else:
                                prefill_str_ = prefill_str.replace("{{", "{")
                                if prefill_str_.replace("```json\n", "") in buffer.replace("\n", ""):
                                    yield "```json\n" + buffer
                                else:
                                    yield prefill_str_ + buffer
                                prefix_added = True
                    else:
                        yield chunk.content
        else:
            def add_prefill(input: Iterator[str]) -> Iterator[str]:
                buffer = ""
                prefix_added = False
                prefill_len = len(prefill_str) + 5 # margin
                for chunk in input:
                    if not prefix_added:
                        buffer += chunk.content
                        buffer_len = len(buffer)
                        if buffer_len >= prefill_len:
                            if "```json" in buffer:
                                yield buffer
                                prefix_added = True
                            else:
                                prefill_str_ = prefill_str.replace("{{", "{")
                                if prefill_str_.replace("```json\n", "") in buffer.replace("\n", ""):
                                    yield "```json\n" + buffer
                                else:
                                    yield prefill_str_ + buffer
                                prefix_added = True
                    else:
                        yield chunk.content
        agent = prompt | llm | add_prefill | parser | extract_json_items_streaming
    else:
        agent = prompt | llm | parser | extract_json_items_streaming
    return agent


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int

class LLMLog(BaseModel):
    agent_name: str
    token_usage: TokenUsage
    message_history: List[List[str] | str]

class LoggingCallback(BaseCallbackHandler):
    def __init__(
        self,
        agent_name: str,
        llm: LLM,
        streaming: bool = True
    ) -> None:
        if "model" in list(llm.__fields__.keys()):
            self.model_name = llm.model
            if "gemini" in self.model_name:
                self.model_provider = "google"
            elif "claude" in self.model_name:
                self.model_provider = "anthropic"
            else:
                # raise TypeError(f"Invalid model name: {self.model_name}") # TODO: Implement more appropriate error handling.
                self.model_provider = "ollama"
        elif "model_name" in list(llm.__fields__.keys()):
            self.model_name = llm.model_name
            if "gpt" in self.model_name:
                self.model_provider = "openai"
            else:
                # raise TypeError(f"Invalid model name: {self.model_name}") # TODO: Implement more appropriate error handling.
                self.model_provider = "ollama"
        else:
            raise TypeError(f"Invalid llm: {llm}")
        self.streaming = streaming
        if self.model_provider == "openai" and self.streaming:
            try:
                self.enc = tiktoken.encoding_for_model(self.model_name)
            except KeyError:
                # Fallback for newer models not yet in tiktoken
                self.enc = tiktoken.get_encoding("o200k_base")
        self.token_usage = TokenUsage(
            input_tokens=0,
            output_tokens=0,
            total_tokens=0
        )
        self.message_history = []
        self.agent_name = agent_name
        self.log = LLMLog(
            agent_name=self.agent_name,
            token_usage=self.token_usage,
            message_history=self.message_history
        )

    def on_llm_start(self, serialized, prompts, **kwargs):
        self.message_history.append(prompts)
        if self.model_provider == "openai" and self.streaming:
            for prompt in prompts:
                self.token_usage.input_tokens += len(self.enc.encode(prompt))

    def on_llm_end(self, response: LLMResult, **kwargs):
        for generations in response.generations:
            for generation in generations:
                if self.model_provider == "openai" and self.streaming:
                    self.token_usage.output_tokens += len(self.enc.encode(generation.text))
                    self.token_usage.total_tokens = self.token_usage.input_tokens + self.token_usage.output_tokens
                else:
                    if self.model_provider == "openai":
                        tokens = generation.message.response_metadata.get("token_usage")
                        self.token_usage.input_tokens += tokens.get("prompt_tokens", -1)
                        self.token_usage.output_tokens += tokens.get("completion_tokens", -1)
                        self.token_usage.total_tokens += tokens.get("total_tokens", -1)
                    elif self.model_provider in ["google", "anthropic"]:
                        tokens = generation.message.usage_metadata
                        self.token_usage.input_tokens += tokens.get("input_tokens", -1)
                        self.token_usage.output_tokens += tokens.get("output_tokens", -1)
                        self.token_usage.total_tokens += tokens.get("total_tokens", -1)
                self.message_history.append(generation.text)
        self.log = LLMLog(
            agent_name=self.agent_name,
            token_usage=self.token_usage,
            message_history=self.message_history
        )

import json
import time
from threading import Lock
from typing import Dict, List

class LogBundle(BaseModel):
    logs: Dict[str, List[LLMLog]] = {}
    updated_at: float = 0.0

    def dict(self) -> dict:
        d = self.dict()
        return d

class AgentLogger:
    def __init__(
        self,
        llm: LLM,
        log_path: str = "./logs/agent_log.jsonl"
    ):
        self.llm = llm
        self.bundle = LogBundle(logs={}, updated_at=time.time())
        self.log_path = log_path
        self._lock = Lock()
        os.makedirs(os.path.dirname(log_path), exist_ok=True)

    def add_log(
        self,
        phase: str,
        log: LLMLog
    ) -> None:
        with self._lock:
            self.bundle.logs.setdefault(phase, []).append(log)
            self.bundle.updated_at = time.time()
            self._append_jsonl_event("add_log", phase, log)

    def add_logs(
        self,
        phase: str,
        logs: List[LLMLog]
    ) -> None:
        with self._lock:
            self.bundle.logs.setdefault(phase, []).extend(logs)
            self.bundle.updated_at = time.time()
            for lg in logs:
                self._append_jsonl_event("add_log", phase, lg)

    def _append_jsonl_event(
        self,
        event_type: str,
        phase: str,
        log: LLMLog
    ) -> None:
        if not self.log_path:
            return
        event = {
            "type": event_type,
            "ts": time.time(),
            "phase": phase,
            "log": log.dict(),
        }
        line = json.dumps(event, ensure_ascii=False)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def get_callback(
        self,
        phase: str,
        agent_name: str,
        streaming: bool = True
    ) -> BaseCallbackHandler:
        inner = LoggingCallback(
            agent_name=agent_name,
            llm=self.llm,
            streaming=streaming
        )
        return AggregatingCallback(
            inner=inner,
            aggregator=self,
            phase=phase
        )
    
    def get_bundle(self) -> LogBundle:
        with self._lock:
            return self.bundle

    def get_phase(self, phase: str) -> List[LLMLog]:
        with self._lock:
            return list(self.bundle.logs.get(phase, []))

class AggregatingCallback(BaseCallbackHandler):
    """A wrapper around LoggingCallback that automatically registers logs with the Aggregator when on_llm_end is called."""
    def __init__(
        self,
        inner: LoggingCallback,
        aggregator: AgentLogger,
        phase: str
    ):
        self.inner = inner
        self.aggregator = aggregator
        self.phase = phase

    def on_llm_start(self, serialized, prompts, **kwargs):
        return self.inner.on_llm_start(serialized, prompts, **kwargs)

    def on_llm_end(self, response, **kwargs):
        self.inner.on_llm_end(response, **kwargs)
        # save log
        self.aggregator.add_log(self.phase, self.inner.log)


UNIT = 1e+6
PRICING_PER_TOKEN = {
    "openai/gpt-4o-2024-08-06": {
        "input": 2.50 / UNIT,
        "output": 10. / UNIT
    },
    "openai/gpt-4o-2024-05-13": {
        "input": 5.00 / UNIT,
        "output": 15.00 / UNIT
    },
    "openai/gpt-4o-mini-2024-07-18": {
        "input": 0.15 / UNIT,
        "output": 0.6 / UNIT
    },
    "google/gemini-1.5-pro-latest": {
        "input": 3.50 / UNIT,
        "output": 10.50 / UNIT
    },
    "google/gemini-1.5-pro": {
        "input": 3.50 / UNIT,
        "output": 10.50 / UNIT
    },
    "anthropic/claude-3-5-sonnet-20241022": {
        "input": 3.75 / UNIT,
        "output": 15. / UNIT
    },
    "anthropic/claude-3-5-sonnet-20240620": {
        "input": 3.75 / UNIT,
        "output": 15. / UNIT
    },
}

def verify_api_key(provider: str, api_key: str) -> bool:
    if not api_key:
        return False
    try:
        if provider == "openai":
            client = openai.OpenAI(api_key=api_key)
            try:
                client.models.list()
            except openai.AuthenticationError:
                return False
            else:
                return True
        elif provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            }
            response = requests.get(
                "https://api.anthropic.com/v1/models",
                headers=headers,
                timeout=5
            )
            return response.status_code == 200
        elif provider == "google":
            response = requests.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
                timeout=5
            )
            return response.status_code == 200
    except Exception:
        return False
    return False

def get_env_key_name(provider: str) -> str:
    env_keys = {
        "openai": "OPENAI_API_KEY",
        "google": "GOOGLE_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY"
    }
    return env_keys.get(provider, "API_KEY")

def check_existing_key(provider: str) -> bool:
    env_key_name = get_env_key_name(provider)
    existing_key = os.environ.get(env_key_name)
    if existing_key:
        if verify_api_key(provider, existing_key):
            return True
    return False