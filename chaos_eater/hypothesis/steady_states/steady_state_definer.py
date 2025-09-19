import os
from typing import List, Dict, Tuple

from .llm_agents.draft_agent import SteadyStateDraftAgent
from .llm_agents.inspection_agent import InspectionAgent
from .llm_agents.threshold_agent import ThresholdAgent
from .llm_agents.unittest_agent import UnittestAgent
from .llm_agents.completion_check_agent import SteadyStateCompletionCheckAgent
from .llm_agents.utils import Inspection
from ...preprocessing.preprocessor import ProcessedData
from ...utils.wrappers  import LLM, BaseModel
from ...utils.schemas import File
from ...utils.llms import LLMLog
from ...utils.functions import int_to_ordinal, MessageLogger


STEADY_STATE_OVERVIEW_TEMPLATE = """\
{number} steady states are defined.
{steady_state_list}"""

STEADY_STATE_LIST_TEMPLATE = """\
{ordinal_number} steady states:
- Name: {name}
- Description: {description}
- Threshold for the steady state: {threshold}; {threshold_description}
- Whether the steady state meets the threshold is determined by the following {script_type}:
```
{script}
```"""

class SteadyState(BaseModel):
    id: int
    name: str
    description: str
    inspection: Inspection
    threshold: Dict[str, str]
    unittest: File

class SteadyStates(BaseModel):
    elems: List[SteadyState] = []

    @property
    def count(self):
        return len(self.elems)

    def to_overview_str(self) -> str:
        if len(self.elems) > 0:
            steady_state_list_str = ""
            for steady_state in self.elems:
                steady_state_list_str += STEADY_STATE_LIST_TEMPLATE.format(
                    ordinal_number=int_to_ordinal(steady_state.id+1),
                    name=steady_state.name,
                    description=steady_state.description,
                    threshold=steady_state.threshold['threshold'],
                    threshold_description=steady_state.threshold['reason'],
                    script_type="K6 Javascript" if steady_state.inspection.tool_type == "k6" else "Python script with K8s API",
                    script=steady_state.unittest.content
                )
            return STEADY_STATE_OVERVIEW_TEMPLATE.format(
                number=len(self.elems),
                steady_state_list=steady_state_list_str
            )
        else:
            return "No steady states are defined for now."

    def to_str(self) -> str:
        return self.to_overview_str()

    def append(self, steady_state: SteadyState):
        self.elems.append(steady_state)


#--------------------------
# agent-manager definition
#--------------------------
class SteadyStateDefiner:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger,
        test_dir: str = "sandbox/unit_test",
        namespace: str = "chaos-eater",
        max_mod_loop: int = 5
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        self.test_dir = test_dir
        self.namespace = namespace
        self.max_mod_loop = max_mod_loop
        # agents
        self.draft_agent      = SteadyStateDraftAgent(llm, message_logger)
        self.inspection_agent = InspectionAgent(llm, message_logger, namespace)
        self.threshold_agent  = ThresholdAgent(llm, message_logger)
        self.unittest_agent   = UnittestAgent(llm, message_logger)
        self.completion_check_agent = SteadyStateCompletionCheckAgent(llm, message_logger)

    def define_steady_states(
        self,
        input_data: ProcessedData,
        kube_context: str,
        work_dir: str,
        max_num_steady_states: int = 2,
        max_retries: int = 3
    ) -> Tuple[List[LLMLog], SteadyStates]:
        #-------------------
        # 0. initialization
        #-------------------
        # gui settings
        self.message_logger.write("#### Steady-state definition")
        # directory settings
        steady_state_dir = f"{work_dir}/steady_states"
        os.makedirs(steady_state_dir, exist_ok=True)
        # list initialization
        logs = []
        steady_states = SteadyStates()
        prev_check_thought = ""

        #-----------------------------------
        # sequentially define steady states
        #-----------------------------------
        num_retries = 0
        while steady_states.count < max_num_steady_states:
            # error handling
            assert num_retries < max_retries + max_num_steady_states, f"MAX_RETRIES_EXCEEDED: failed to define steady states within {max_retries+max_num_steady_states} tries."
            num_retries += 1

            #-------------------------
            # 1. draft a steady state
            #-------------------------
            draft_log, steady_state_draft = self.draft_agent.draft_steady_state(
                input_data=input_data,
                predefined_steady_states=steady_states,
                prev_check_thought=prev_check_thought,
            )
            logs.append(draft_log)

            #--------------------------------------------------
            # 2. inspect the current value of the steady state
            #--------------------------------------------------
            cmd_log, inspection = self.inspection_agent.inspect_current_state(
                input_data=input_data,
                steady_state_draft=steady_state_draft,
                predefined_steady_states=steady_states,
                kube_context=kube_context,
                work_dir=work_dir,
                max_retries=max_retries
            )
            logs.append(cmd_log)

            #---------------------------------------------
            # 3. define a threshold for the steady steate
            #---------------------------------------------
            threshold_log, threshold = self.threshold_agent.define_threshold(
                input_data=input_data,
                steady_state_draft=steady_state_draft,
                inspection=inspection,
                predefined_steady_states=steady_states
            )
            logs.append(threshold_log)

            #-------------------------------------------
            # 4. write a unit test for the steady state
            #-------------------------------------------
            unittest_log, unittest = self.unittest_agent.write_unittest(
                input_data=input_data,
                steady_state_draft=steady_state_draft,
                inspection=inspection,
                threshold=threshold,
                predefined_steady_states=steady_states,
                kube_context=kube_context,
                work_dir=work_dir,
                max_retries=max_retries
            )
            logs.append(unittest_log)

            #-------------------------------
            # epilogue for the steady state
            #-------------------------------
            steady_states.append(SteadyState(
                id=steady_states.count,
                name=steady_state_draft["name"],
                description=steady_state_draft["thought"],
                inspection=inspection,
                threshold=threshold,
                unittest=unittest
            ))

            #-------------------------------
            # Check steady-state completion
            #-------------------------------
            if steady_states.count >= max_num_steady_states:
                container = self.message_logger.container(border=True)
                container.write(f"#### The number of steady states has reached the maximum limit ({max_num_steady_states}).")
                break
            check_log, check = self.completion_check_agent.check_steady_state_completion(
                input_data=input_data,
                predefined_steady_states=steady_states
            )
            logs.append(check_log)
            prev_check_thought = check["thought"]
            if not check["requires_addition"]: 
                break
        return logs, steady_states