import os
from typing import Optional

from .steady_states.steady_state_definer import SteadyStateDefiner, SteadyStates
from .faults.fault_definer import FaultDefiner, FaultScenario
from ..utils.wrappers import LLM, BaseModel
from ..utils.functions import save_json, MessageLogger
from ..utils.llms import AgentLogger
from ..ce_tools.ce_tool_base import CEToolBase
from ..preprocessing.preprocessor import ProcessedData


HYPOTHESIS_OVERVIEW_TEMPLATE = """\
The hypothesis is "The steady states of the sytem are maintained even when the fault scenario occurs (i.e., when the faults are injected)".
The steady states here are as follows:
{steady_state_overview}

The fault scenario here is as follows:
{fault_scenario_overview}"""


class Hypothesis(BaseModel):
    steady_states: SteadyStates
    fault: FaultScenario

    def to_str(self) -> str:
        return HYPOTHESIS_OVERVIEW_TEMPLATE.format(
            steady_state_overview=self.steady_states.to_str(),
            fault_scenario_overview=self.fault.to_str()
        )


class Hypothesizer:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        message_logger: MessageLogger,
        test_dir: str = "sandbox/unit_test",
        namespace: str = "chaos-eater",
        max_mod_loop: int = 3
    ) -> None:
        self.llm = llm
        self.ce_tool = ce_tool
        self.message_logger = message_logger
        # params
        self.test_dir = test_dir
        self.namespace = namespace
        self.max_mod_loop = max_mod_loop
        # agents
        self.steady_state_definer = SteadyStateDefiner(
            llm=llm,
            message_logger=message_logger,
            test_dir=test_dir,
            namespace=namespace,
            max_mod_loop=max_mod_loop
        )
        self.fault_definer = FaultDefiner(
            llm=llm,
            ce_tool=ce_tool,
            message_logger=message_logger,
            test_dir=test_dir,
            namespace=namespace
        )

    def hypothesize(
        self,
        data: ProcessedData,
        kube_context: str,
        work_dir: str,
        max_num_steady_states: int = 2,
        max_retries: int = 3,
        agent_logger: Optional[AgentLogger] = None
    ) -> Hypothesis:
        #----------------
        # initialization
        #----------------
        hypothesis_dir = f"{work_dir}/hypothesis"
        os.makedirs(hypothesis_dir, exist_ok=True)

        #-------------------------
        # 1. define steady states
        #-------------------------
        steady_states = self.steady_state_definer.define_steady_states(
            input_data=data, 
            kube_context=kube_context,
            work_dir=hypothesis_dir,
            max_num_steady_states=max_num_steady_states,
            max_retries=max_retries,
            agent_logger=agent_logger
        )
        save_json(f"{hypothesis_dir}/steady_states.json", steady_states.dict())

        #------------------
        # 2. define faults
        #------------------
        fault = self.fault_definer.define_faults(
            data=data,
            steady_states=steady_states,
            work_dir=hypothesis_dir,
            max_retries=max_retries,
            agent_logger=agent_logger
        )
        save_json(f"{hypothesis_dir}/faults.json", fault.dict())

        #-------------------
        # make a hypothesis
        #-------------------
        hypothesis = Hypothesis(steady_states=steady_states, fault=fault)
        save_json(f"{hypothesis_dir}/hypothesis.json", hypothesis.dict())
        return hypothesis