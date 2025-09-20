from typing import Dict, Optional

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
        self.agent = build_json_agent(
            llm=llm,
            chat_messages=[("system", SYS_CHECK_STEADY_STATE_COMPLETION), ("human", USER_CHECK_STEADY_STATE_COMPLETION)],
            pydantic_object=SteadyStateCompletionCheck,
            is_async=False
        )
        self.message_logger = message_logger

    def check_steady_state_completion(
        self,
        input_data: ProcessedData,
        predefined_steady_states: list,
        agent_logger: Optional[AgentLogger] = None
    ) -> Dict[str, str]:
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name="steady_state_completion_check"
        )

        self.message_logger.write("#### Steady state completion check")
        for completion_check in self.agent.stream({
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