from typing import Dict, List, Optional, Tuple

from ....preprocessing.preprocessor import ProcessedData
from ....utils.wrappers import LLM, BaseModel, Field
from ....utils.llms import build_json_agent, AgentLogger
from ....utils.functions import MessageLogger


#---------
# prompts
#---------
SYS_DRAFT_STEADY_STATE = """\
You are a helpful AI assistant for Chaos Engineering.
Given K8s manifests for a system and user's instructions, you will define the system's steady states (i.e., normal behaviors) that are related to potential issues of the system.
Always keep the following rules:
- Define steady states one by one, starting with the steady state related to the K8s resource that is easiest to encounter issues when certain failures occur.
- Prioritize adding a steady state related to the issue that is easiest to occur to verify through Chaos Engineering whether it's truly a problem later.
- An added steady state must be a measurable output, such as the number of pods, throughput, error rates, latency percentiles, etc.
- An added steady state must be specific to a SINGLE K8s resource (i.e., manifest) having potential issues for resilency and redundancy.
- An added steady state must be different from the already defined ones.
- {format_instructions}"""

USER_DRAFT_STEADY_STATE = """\
# Here is the overview of my system:
{user_input}

# Please follow the instructions below regarding Chaos Engineering:
{ce_instructions}

# Steady states already defined are as follows:
{predefined_steady_states}

# The plan for defining the next state is as follows:
{prev_check_thought}

Now, define a steady state that are different from the already defined steady states."""

#--------------------
# json output format
#--------------------
class SteadyStateDraft(BaseModel):
    thought: str = Field(description="Describe your thought process of determing the steady state of a SINGLE K8s resource (i.e., manifest) that is easiest to encounter the issues. Describe also the details of the steady state itself.")
    manifest: str = Field(description="The targeted K8s-manifest name. Specify a SINGLE manifest.")
    name: str = Field(description="Steady state name including the target K8s resource (manifest) name. Please write it using a-z, A-Z, and 0-9.")


#------------------
# agent definition
#------------------
class SteadyStateDraftAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        # Store base messages instead of building agent (for retry support)
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_DRAFT_STEADY_STATE),
            ("human", USER_DRAFT_STEADY_STATE)
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

    def draft_steady_state(
        self,
        input_data: ProcessedData,
        predefined_steady_states: list,
        prev_check_thought: str,
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> Dict[str, str]:
        # initialization
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name="steady_state_draft"
        )

        # Build messages (with retry history if present)
        messages = self._build_messages(retry_context)

        # Build agent dynamically
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=SteadyStateDraft,
            is_async=False
        )

        # stream the response
        for steady_state in agent.stream({
            "user_input": input_data.to_k8s_overview_str(),
            "ce_instructions": input_data.ce_instructions,
            "predefined_steady_states": predefined_steady_states.to_str(),
            "prev_check_thought": prev_check_thought},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (name := steady_state.get("name")) is not None:
                text += f"#### Steady state #{predefined_steady_states.count+1}: {name}\n"
            if (thought := steady_state.get("thought")) is not None:
                text += thought
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return steady_state