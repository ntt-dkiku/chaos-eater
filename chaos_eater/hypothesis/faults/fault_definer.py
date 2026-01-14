import os
from typing import List, Dict, Optional, Callable, Any

from .llm_agents.fault_scenario_agent import FaultScenarioAgent
from .llm_agents.fault_refinement_agent import FaultRefiner, FaultScenario
from ..steady_states.steady_state_definer import SteadyStates
from ...ce_tools.ce_tool_base import CEToolBase
from ...preprocessing.preprocessor import ProcessedData
from ...utils.llms import LLM, AgentLogger
from ...utils.agent_runner import AgentRunner, AgentStep
from ...utils.functions import MessageLogger, save_json


class FaultDefiner:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        message_logger: MessageLogger,
        test_dir: str = "sandbox/unit_test",
        namespace: str = "chaos-eater"
    ) -> None:
        self.llm = llm
        self.ce_tool = ce_tool
        self.message_logger = message_logger
        self.test_dir = test_dir
        self.namespace = namespace
        # agents
        self.fault_scenario_agent = FaultScenarioAgent(llm, ce_tool, message_logger)
        self.refiner = FaultRefiner(llm, ce_tool, message_logger)

    def convert_steady_state_to_str(self, steady_states: List[Dict[str, str]]) -> str:
        steady_state_str = ""
        for i, steady_state in enumerate(steady_states):
            steady_state_str += f"Steady state #{i}: {steady_state.name}\nDescription: {steady_state.description}\nThreshold: {steady_state.threshold['threshold']}; {steady_state.threshold['reason']}"
        return steady_state_str

    def define_faults(
        self,
        data: ProcessedData,
        steady_states: SteadyStates,
        work_dir: str,
        checkpoint_dir: str,
        max_retries: int = 3,
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> FaultScenario:
        #-------------------
        # 0. initialization
        #-------------------
        # Only show phase header on fresh start (not on resume)
        if not resume_from_agent:
            self.message_logger.write("#### Failure definition")
        fault_dir = f"{work_dir}/faults"
        os.makedirs(fault_dir, exist_ok=True)

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="fault_definer",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Assume fault scenario
        runner.add_step(AgentStep(
            name="fault_scenario_agent",
            run_fn=lambda retry_context=None: self._run_fault_scenario(
                data, steady_states, agent_logger, retry_context
            ),
            output_key="fault_scenario",
        ))

        # Step 2: Refine faults
        runner.add_step(AgentStep(
            name="fault_refiner",
            run_fn=lambda fault_scenario, retry_context=None: self._run_fault_refiner(
                data, steady_states, fault_scenario, fault_dir, max_retries, agent_logger, retry_context
            ),
            output_key="faults",
            depends_on=["fault_scenario"],
        ))

        # Run all agents (with resume support)
        results = runner.run(resume_from_agent=resume_from_agent)

        return results["faults"]

    def _run_fault_scenario(
        self,
        data: ProcessedData,
        steady_states: SteadyStates,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> dict:
        """Run fault scenario agent."""
        fault_scenario = self.fault_scenario_agent.assume_scenario(
            user_input=data.to_k8s_overview_str(),
            ce_instructions=data.ce_instructions,
            steady_states=steady_states,
            agent_logger=agent_logger,
            retry_context=retry_context
        )
        return fault_scenario

    def _run_fault_refiner(
        self,
        data: ProcessedData,
        steady_states: SteadyStates,
        fault_scenario,
        fault_dir: str,
        max_retries: int,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> FaultScenario:
        """Run fault refiner agent."""
        faults = self.refiner.refine_faults(
            user_input=data.to_k8s_overview_str(),
            ce_instructions=data.ce_instructions,
            steady_states=steady_states,
            fault_scenario=fault_scenario,
            work_dir=fault_dir,
            max_retries=max_retries,
            agent_logger=agent_logger,
            retry_context=retry_context
        )
        return faults