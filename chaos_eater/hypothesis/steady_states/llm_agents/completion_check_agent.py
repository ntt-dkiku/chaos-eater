from typing import Dict, List, Optional, Tuple

from ....preprocessing.preprocessor import ProcessedData
from ....utils.wrappers import LLM, BaseModel, Field
from ....utils.llms import build_json_agent, AgentLogger
from ....utils.functions import MessageLogger


#---------
# prompts
#---------
SYS_CHECK_STEADY_STATE_COMPLETION = """\
You are a helpful AI assistant for Chaos Engineering.
Given K8s manifests for a system, user's instructions, and steady states already defined, you will determine whether an additional steady state needs to be defined.
Always keep the following rules:
- Clearly describe the reason for determining whether an additional steady state is needed.
- You may also cite the user's instructions as the reason.
- {format_instructions}"""

USER_CHECK_STEADY_STATE_COMPLETION = """\
# Here is the overview of my system:
{user_input}

# Please follow the instructions below regarding Chaos Engineering:
{ce_instructions}

# Steady states already defined are as follows:
{predefined_steady_states}

Now, determine whether an additional steady state needs to be defined."""

#--------------------
# json output format
#--------------------
class SteadyStateCompletionCheck(BaseModel):
    thought: str = Field(description="Describe your thought process of determing whether an additional steady states is needed.")
    requires_addition: bool = Field(description="The necessity of an additional steady state. If it is needed, select 'True'; otherwise select 'False'.")

#------------------
# agent definition
#------------------
class SteadyStateCompletionCheckAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        # Store base messages instead of building agent (for retry support)
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_CHECK_STEADY_STATE_COMPLETION),
            ("human", USER_CHECK_STEADY_STATE_COMPLETION)
        ]

    def _escape_braces(self, text: str) -> str:
        """Escape curly braces for LangChain template."""
        return text.replace("{", "{{").replace("}", "}}")

    def _build_messages(self, retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        messages = self.base_messages.copy()

        if retry_context and retry_context.get("history"):
            for i, entry in enumerate(retry_context["history"], 1):
                # Only add AI message if output exists (skip for null output from cancel)
                if entry.get("output"):
                    # Escape curly braces to prevent LangChain template interpretation
                    escaped_output = self._escape_braces(str(entry["output"]))
                    messages.append(("ai", escaped_output))
                if entry.get("feedback"):
                    escaped_feedback = self._escape_braces(entry['feedback'])
                    messages.append(("human", f"Feedback #{i}: {escaped_feedback}"))
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def check_steady_state_completion(
        self,
        input_data: ProcessedData,
        predefined_steady_states: list,
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> Dict[str, str]:
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name="steady_state_completion_check"
        )

        # Build messages (with retry history if present)
        messages = self._build_messages(retry_context)

        # Build agent dynamically
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=SteadyStateCompletionCheck,
            is_async=False
        )

        self.message_logger.write("#### Steady state completion check")
        for completion_check in agent.stream({
            "user_input": input_data.to_k8s_overview_str(),
            "ce_instructions": input_data.ce_instructions,
            "predefined_steady_states": predefined_steady_states.to_str()},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (thought := completion_check["thought"]) is not None:
                text += f"{thought}\n"
            if (check := completion_check["requires_addition"]) is not None:
                text += f"An additional steady state is needed?: `{check}`"
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return completion_check