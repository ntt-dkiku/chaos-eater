from typing import List, Dict, Literal, Optional, Tuple

from ...steady_states.steady_state_definer import SteadyStates
from ....ce_tools.ce_tool_base import CEToolBase
from ....utils.wrappers import LLM, LLMBaseModel, LLMField
from ....utils.llms import build_json_agent, AgentLogger
from ....utils.functions import MessageLogger


SYS_ASSUME_FAULT_SCENARIOS = """\
You are a helpful AI assistant for Chaos Engineering. 
Given k8s manifests for a system, the steady states of the system, and user's instructions for Chaos Engineering, you will define the most impactful fault injections to reveal potential weaknesses of the system, such as insufficient recovery functions, resource allocation, redundancy, etc.
Always keep the following rules:
- First, assume a real-world event that may be most impactful in the the system, such as promotion campaign, cyber attacks, disasters, etc.
- Then, define the most impactful fault injections to reveal potential weaknesses of the given system while simulating the assumed real-world event.
- Prioritize fault injections that target the system's weak resources related to the steady states to verify whether those resources can handle the faults and the steady states can be maintained.
- The injected faults should be selected from the following fault types of {ce_tool_name}:
{ce_tool_fault_types}
- {format_instructions}"""

USER_ASSUME_FAULT_SCENARIOS = """\
Here is the overview of my system:
{user_input}

Steady states of the network system defined by the manifests are the following:
{steady_states}

Please follow the instructions below regarding Chaos Engineering as necessary:
{ce_instructions}

Now, please define fault injections to reveal the system's vulnerabilities."""


class Fault(LLMBaseModel):
    # TODO: support other CE tools
    name: Literal["PodChaos", "NetworkChaos", "DNSChaos", "HTTPChaos", "StressChaos", "IOChaos", "TimeChaos"] = LLMField(description='Select a fault type from ["PodChaos", "NetworkChaos", "DNSChaos", "HTTPChaos", "StressChaos", "IOChaos", "TimeChaos"]')
    name_id: int = LLMField(description="An identifier to prevent name conflicts when the same Fault appears. Assign numbers starting from 0 in sequential order to prevent name conflicts.")
    scope: Dict[str, str] = LLMField(description="Specify only the fault injection scope (i.e., the target resource where the fault is injected) in advance here.")

class FaultScenario(LLMBaseModel):
    event: str = LLMField(description="Consider a real-world fault event that may be most impactful of the system, such as promotion campaign, cyber attacks, disasters, etc.")
    thought: str = LLMField(description="Write down your thought process to define a sequence of fault injections that exploit the system's weaknesses of while simulating the fault event: 1) how the system's weaknesses affect the steady state; 2) how each fault injection exploit the system's weaknesses; 3) how the sequence simulates the phenamena in the fault event (consider carefully the sequence order). Prioritize fault injections that directly attack the weaknessses of the system, such as insufficient recovery functions, resource allocation, redundancy, etc.")
    faults: List[List[Fault]] = LLMField(description="Define a sequence of fault injections that exploit the system's vulnerabilities to the fullest according to the above thoughts. In the inner list, a set of simultaneously injected faults are listed, while in the outer list, the sets are listed in the injection order. For example, [[fault_a], [fault_b, fault_c]] indicates that fault_a is injected, then fault_b and fault_c are injected simultaneously.")


class FaultScenarioAgent:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        output_emitter: MessageLogger
    ) -> None:
        self.llm = llm
        self.ce_tool = ce_tool
        self.output_emitter = output_emitter
        # Store base messages instead of building agent (for retry support)
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_ASSUME_FAULT_SCENARIOS),
            ("human", USER_ASSUME_FAULT_SCENARIOS)
        ]

    def _build_messages(self, retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        messages = self.base_messages.copy()

        if retry_context and retry_context.get("history"):
            for i, entry in enumerate(retry_context["history"], 1):
                messages.append(("ai", str(entry["output"])))
                if entry.get("feedback"):
                    messages.append(("human", f"Feedback #{i}: {entry['feedback']}"))
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def assume_scenario(
        self,
        user_input: str,
        ce_instructions: str,
        steady_states: SteadyStates,
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> Dict[str, str]:
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name="fault_scenario_assumption"
        )

        # Build messages (with retry history if present)
        messages = self._build_messages(retry_context)

        # Build agent dynamically
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=FaultScenario,
            is_async=False
        )

        for response in agent.stream({
            "user_input": user_input,
            "ce_instructions": ce_instructions,
            "steady_states": steady_states.to_overview_str(),
            "ce_tool_name": self.ce_tool.name,
            "ce_tool_fault_types": self.ce_tool.get_chaos_var_candidates()},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (event := response.get("event")) is not None:
                text += f"#### 🎬 Scenario: {event}\n"
            if (description := response.get("thought")) is not None:
                text += f"{description}\n"
            if (faults := response.get("faults"))is not None:
                text += f"#### 🐞 Fault-injection sequence\n"
                text += f"{self.convert_fault_list_to_str(faults)}"
            self.output_emitter.stream(text)
        self.output_emitter.stream(text, final=True)
        return response
    
    def convert_fault_list_to_str(self, faults: List[List[Fault]]) -> str:
        fault_list = ""
        for j, para_faults in enumerate(faults):
            para_fault_str = ""
            for i, fault in enumerate(para_faults):
                if i != 0:
                    para_fault_str += ", "
                if "name" in fault.keys():
                    para_fault_str += f"```{fault['name']}``` "
                    if "scope" in fault.keys():
                        para_fault_str += f"({fault['scope']})"
            if j != 0:
                fault_list += "  ➡  "
            fault_list += para_fault_str
        return fault_list