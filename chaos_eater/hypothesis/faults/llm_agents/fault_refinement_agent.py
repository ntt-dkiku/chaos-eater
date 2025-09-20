import yaml
import json
from typing import List, Dict, Any, Tuple, Optional, Iterable

from ...steady_states.steady_state_definer import SteadyStates
from ....ce_tools.ce_tool_base import CEToolBase
from ....utils.wrappers import LLM, BaseModel
from ....utils.llms import build_json_agent, AgentLogger
from ....utils.functions import (
    render_jinja_template,
    write_file,
    type_cmd3,
    limit_string_length,
    MessageLogger
)


SYS_REFINE_FAULT = """\
You are a helpful AI assistant for Chaos Engineering.
Given k8s manifests for a system, its steady states, and a fault type that may affect the steady states in the system, please detail the parameters of the fault.
Always keep the following rules:
- Pay attention to namespace specification. If the namespace is specified in the manifest, it is deployed with the namespace. If not, it is deployed with the 'default' namespace.
- The parameters follow the format of {ce_tool_name}."""

USER_REFINE_FAULT = """\
Here is the overview of my system:
{user_input}

Steady states of my system:
{steady_states}

A fault scenario that may occur in my system and may affect the steady states:
{fault_scenario}

Please follow the instructions below regarding Chaos Engineering as necessary:
{ce_instructions}

Now, please detail the parameters of the fault "{refined_fault_type}".
{format_instructions}"""

USER_REWRITE_FAULT = """\
Your current fault parameters cause errors when conducted.
The error message is as follows:
{error_message}

Please analyze the reason why the errors occur, then fix the errors.
Always keep the following rules:
- NEVER repeat the same fixes that have been made in the past.
- Fix only the parts related to the errors without changing the original intent."""


FAULT_SCENARIO_TEMPLATE = """
An assumed fault scenario is as follows:
- Event: {event}
- Used Chaos Engineering tool: Chaos Mesh
- Faults to simulate the event: {faults}
- Description: {description}"""


class Fault(BaseModel):
    name: str
    name_id: int
    params: dict

class FaultScenario(BaseModel):
    event: str
    faults: List[List[Fault]]
    description: str

    def to_overview_str(self) -> str:
        return FAULT_SCENARIO_TEMPLATE.format(
            event=self.event,
            faults=self.faults,
            description=self.description
        )

    def to_str(self) -> str:
        return self.to_overview_str()

class IndentedDumper(yaml.Dumper):
    def increase_indent(self, flow=False, indentless=False):
        return super(IndentedDumper, self).increase_indent(flow, False)


class FaultRefiner:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        output_emitter: MessageLogger
    ) -> None:
        self.llm = llm
        self.ce_tool = ce_tool
        self.output_emitter = output_emitter

    def refine_faults(
        self,
        user_input: str,
        ce_instructions: str,
        steady_states: SteadyStates,
        fault_scenario: Dict[str, str],
        work_dir: str,
        max_retries: int = 3,
        agent_logger: Optional[AgentLogger] = None
    ) -> FaultScenario:
        self.output_emitter.write("##### ⚙ Detailed fault parameters")
        faults_ = []
        for para_faults in fault_scenario["faults"]:
            para_faults_ = []
            faults_.append(para_faults_)
            for fault in para_faults:
                #-----------------------
                # generate fault params
                #-----------------------
                refined_prams = self.refine_fault(
                    user_input=user_input,
                    ce_instructions=ce_instructions,
                    steady_states=steady_states.to_overview_str(),
                    fault_scenario=self.convert_fault_senario_to_str(fault_scenario),
                    fault=fault,
                    agent_logger=agent_logger
                )
                #-----------------------
                # validate fault params
                #-----------------------
                is_valid = False
                mod_count = 0
                output_history = [refined_prams]
                error_history = []
                while (not is_valid):
                    assert mod_count < max_retries, f"mod_count_loop ({max_retries}) exceeded."
                    mod_count += 1
                    is_valid, msg = self.verify_fault_params(fault, refined_prams, work_dir)
                    if is_valid:
                        break
                    error_history.append(limit_string_length(msg))
                    refined_prams = self.refine_fault(
                        user_input=user_input,
                        ce_instructions=ce_instructions,
                        steady_states=steady_states.to_overview_str(),
                        fault_scenario=self.convert_fault_senario_to_str(fault_scenario),
                        fault=fault,
                        output_history=output_history,
                        error_history=error_history,
                        agent_logger=agent_logger
                    )
                    output_history.append(refined_prams)
                #---------------------- 
                # add the valid params
                #----------------------
                para_faults_.append(Fault(
                    name=fault["name"],
                    name_id=fault["name_id"],
                    params=refined_prams
                ))
        return FaultScenario(
            event=fault_scenario["event"],
            faults=faults_,
            description=fault_scenario["thought"]
        )

    def refine_fault(
        self,
        user_input: str,
        ce_instructions: str,
        steady_states: str,
        fault_scenario: str,
        fault: Dict[str, str],
        output_history: List[dict] = [],
        error_history: List[str] = [],
        agent_logger: Optional[AgentLogger] = None
    ) -> Dict[str, Any]:
        #----------------
        # initialization
        #----------------
        cb = agent_logger and agent_logger.get_callback(
            phase="hypothesis",
            agent_name=f"refine_fault_params_{len(output_history)}"
        )

        #----------------------
        # prompt configuration
        #----------------------
        # generate chat history
        chat_messages=[("system", SYS_REFINE_FAULT), ("human", USER_REFINE_FAULT)]
        for output, error in zip(output_history, error_history):
            chat_messages.append(("ai", json.dumps(output).replace('{', '{{').replace('}', '}}')))
            chat_messages.append(("human", USER_REWRITE_FAULT.replace("{error_message}", error.replace('{', '{{').replace('}', '}}'))))
        # build an agent
        fault_params = self.ce_tool.get_fault_params(fault["name"])
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=chat_messages,
            pydantic_object=fault_params,
            is_async=False
        )

        #--------
        # output
        #--------
        result = {}
        self.output_emitter.write(f"Detailed parameters of `{fault['name']}` ({fault['scope']})")
        for response in agent.stream({
            "user_input": user_input,
            "ce_instructions": ce_instructions,
            "steady_states": steady_states,
            "fault_scenario": fault_scenario,
            "refined_fault_type": fault["name"] + f"({fault['scope']})" if len(fault['scope']) > 0 else fault["name"],
            "ce_tool_name": self.ce_tool.name},
            {"callbacks": [cb]} if cb else {}
        ):
            for key in fault_params.__fields__.keys():
                key_item = response.get(key)
                if key_item is not None and isinstance(key_item, Iterable) and len(key_item) > 0:
                    result[key] = key_item
            result_str = f"```json \n{result}\n```" # json.dumps(result, indent=2, ensure_ascii=False)
            self.output_emitter.stream(result_str)
        self.output_emitter.stream(result_str, final=True)
        return result
    
    def convert_fault_senario_to_str(self, fault_scenario: Dict[str, str]) -> str:
        return FAULT_SCENARIO_TEMPLATE.format(
            event=fault_scenario["event"],
            faults=fault_scenario["faults"],
            description=fault_scenario["thought"]
        )
    
    def verify_fault_params(
        self,
        fault: Dict[str, str],
        params: dict,
        work_dir: str
    ) -> Tuple[bool, str]:
        fault_template_path = self.ce_tool.get_template_path(fault["name"])
        specs_str = yaml.dump(params, Dumper=IndentedDumper, default_flow_style=False)
        fault_yaml_str = render_jinja_template(
            fault_template_path,
            fault_type=fault["name"],
            specs=specs_str
        )
        fault_yaml_path = f"{work_dir}/{fault['name']}.yaml"
        write_file(fault_yaml_path, fault_yaml_str)
        result = type_cmd3(f"kubectl apply --dry-run=server -f {fault_yaml_path}")
        is_valid = (result.returncode == 0)
        if is_valid:
            msg = result.stdout
        else:
            msg = result.stderr
        return is_valid, msg