from typing import Dict, Optional

from .inspection_agent import Inspection
from ....preprocessing.preprocessor import ProcessedData
from ....utils.wrappers import LLM, LLMBaseModel, LLMField
from ....utils.llms import build_json_agent, AgentLogger
from ....utils.functions import MessageLogger


#---------
# prompts
#---------
SYS_DEFINE_THRESHOLD = """\
You are a helpful AI assistant for Chaos Engineering. 
Given k8s manifests for a system, its steady state, and the current value of the steady state, you will define the threshold for the steady state.
Always keep the following rules:
- The threshold must include reasonable tolerance that makes the threshold being more easiliy satisfied to account for some fluctuations.
- The current value of the steady state must satisfy the threshold (including tolerance) as the currrent value is the normal state and the threshold represents whether the system remains normal.
- If redundancy already exists in the resource, define at least the minimum required value as the threshold.
- Explicitly specify all values related to the threshold, such as the number of resources that must be satisfied, the percentage of time it must be satisfied within the monitoring period, etc.
- {format_instructions}"""

USER_DEFINE_THRESHOLD = """\
# Here is the overview of my system:
{user_input}

# You will determine a reasonable threshold for the following steady state of my system:
{steady_state_name}: {steady_state_thought}

{inspection_summary}

# Please follow the instructions below regarding Chaos Engineering:
{ce_instructions}

Now, please define a reasonable threshold for the steady state according to the above information."""


#--------------------
# json output format
#--------------------
class Threshold(LLMBaseModel):
    thought: str = LLMField(description="Write your thought process to determine the threshold of the steady state.")
    threshold: str = LLMField(description="the threshold of the steady state, which should be satisfied satisfied in the current state.")


#------------------
# agent definition
#------------------
class ThresholdAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.agent = build_json_agent(
            llm=llm,
            chat_messages=[("system", SYS_DEFINE_THRESHOLD), ("human", USER_DEFINE_THRESHOLD)],
            pydantic_object=Threshold,
            is_async=False
        )
        self.message_logger = message_logger

    def define_threshold(
        self,
        input_data: ProcessedData,
        steady_state_draft: Dict[str, str],
        inspection: Inspection,
        predefined_steady_states: list,
        agent_logger: Optional[AgentLogger] = None
    ) -> Dict[str, str]:
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name="threshold_definition"
        )
        
        self.message_logger.write("#### 🚩 Threshold\n")
        for responce in self.agent.stream({
            "user_input": input_data.to_k8s_overview_str(),
            "ce_instructions": input_data.ce_instructions,
            "steady_state_name": steady_state_draft["name"],
            "steady_state_thought": steady_state_draft["thought"],
            "inspection_summary": inspection.to_str()},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (thought := responce.get("thought")) is not None:
                text += f"`Thoughts`:\n{thought}\n"
                steady_state_draft["threshold_reason"] = thought
            if (threshold := responce.get("threshold")) is not None:
                text += f"`Threshold`:\n{threshold}"
                steady_state_draft["threshold"] = threshold
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return {"threshold": threshold, "reason": thought}