from typing import List, Optional, Tuple

from ...utils.wrappers import LLM, LLMBaseModel, LLMField
from ...utils.llms import build_json_agent, AgentLogger
from ...utils.schemas import File
from ...utils.functions import MessageLogger


SYS_ASSUME_K8S_APP = """\
You are a professional kubernetes (K8s) engineer.
Given K8s manifests for a system, please assume a real-world application (service) of the system according to the following rules:
- If the application is explicitly specified in the instructions, assume it. 
- You can leverage any given information, including file name and manifests to guess the purpose of the manifests.
- {format_instructions}"""

USER_ASSUME_K8S_APP = """\
{user_input}

Please assume a real-world application of the manifests."""

INPUT_TEMPLATE = """\
# K8s manifest:
```{k8s_yaml_name}
{k8s_yaml}
```

# Summary of {k8s_yaml_name}:
{k8s_summary}"""


class K8sAppAssumption(LLMBaseModel):
    thought: str = LLMField(description="Before assuming an application, reason logically why you assume it for the given manifests. e.g., from file name, instructions, or other elements?")
    k8s_application: str = LLMField(description="Specify what the service (application) offers to users.")


class K8sAppAssumptionAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        # Store base messages instead of building agent (for retry support)
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_ASSUME_K8S_APP),
            ("human", USER_ASSUME_K8S_APP)
        ]

    def _escape_braces(self, text: str) -> str:
        """Escape curly braces for LangChain template."""
        return text.replace("{", "{{").replace("}", "}}")

    def _build_messages(self, retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        messages = self.base_messages.copy()

        if retry_context and retry_context.get("history"):
            for i, entry in enumerate(retry_context["history"], 1):
                escaped_output = self._escape_braces(str(entry["output"]))
                messages.append(("ai", escaped_output))
                if entry.get("feedback"):
                    escaped_feedback = self._escape_braces(entry['feedback'])
                    messages.append(("human", f"Feedback #{i}: {escaped_feedback}"))
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def assume_app(
        self,
        k8s_yamls: List[File],
        k8s_summaries: List[str],
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> K8sAppAssumption:
        self.message_logger.write("#### Application of the manifests:")
        cb = agent_logger and agent_logger.get_callback(
            phase="preprocessing",
            agent_name="k8s_app"
        )

        user_input = self.get_user_input(
            k8s_yamls=k8s_yamls,
            k8s_summaries=k8s_summaries
        )

        # Build messages (with retry history if present)
        messages = self._build_messages(retry_context)

        # Build agent dynamically
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=K8sAppAssumption,
            is_async=False
        )

        for output in agent.stream(
            {"user_input": user_input},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (thought := output.get("thought")) is not None:
                text += f"`Thoughts`:\n{thought}\n\n"
            if (app := output.get("k8s_application")) is not None:
                text += f"`Assumed application`:\n{app}\n"
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return K8sAppAssumption(
            thought=thought,
            k8s_application=app
        )

    def get_user_input(
        self,
        k8s_yamls: List[File],
        k8s_summaries: List[str]
    ) -> str:
        user_input = ""
        # add k8s yamls and their summaries
        for k8s_yaml, k8s_summary in zip(k8s_yamls, k8s_summaries):
            user_input += INPUT_TEMPLATE.format(
                k8s_yaml=k8s_yaml.content,
                k8s_yaml_name=k8s_yaml.fname,
                k8s_summary=k8s_summary
            )
            user_input += "\n\n"
        return user_input