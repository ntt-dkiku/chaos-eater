import os
from typing import Optional, Callable, Any

from .steady_states.steady_state_definer import SteadyStateDefiner, SteadyStates
from .faults.fault_definer import FaultDefiner, FaultScenario
from ..utils.wrappers import LLM, BaseModel
from ..utils.functions import save_json, MessageLogger
from ..utils.llms import AgentLogger
from ..utils.agent_runner import AgentRunner, AgentStep
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
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> Hypothesis:
        #----------------
        # initialization
        #----------------
        hypothesis_dir = f"{work_dir}/hypothesis"
        checkpoint_dir = f"{work_dir}/checkpoints"
        os.makedirs(hypothesis_dir, exist_ok=True)

        # Parse resume_from_agent to determine which sub-agent to resume from
        runner_resume_agent = None
        ss_resume_agent = None
        fault_resume_agent = None

        if resume_from_agent:
            # Check if it's a steady_state_definer internal agent
            ss_agents = ["draft_agent", "inspection_agent", "threshold_agent", "unittest_agent", "completion_check_agent"]
            fault_agents = ["fault_scenario_agent", "fault_refiner"]

            if any(resume_from_agent.startswith(prefix) for prefix in ss_agents):
                runner_resume_agent = "steady_state_definer"
                ss_resume_agent = resume_from_agent
            elif any(resume_from_agent.startswith(prefix) for prefix in fault_agents):
                runner_resume_agent = "fault_definer"
                fault_resume_agent = resume_from_agent
            else:
                # It's a top-level agent name
                runner_resume_agent = resume_from_agent

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="hypothesis",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Define steady states
        runner.add_step(AgentStep(
            name="steady_state_definer",
            run_fn=lambda: self._run_steady_state_definer(
                data, kube_context, hypothesis_dir, checkpoint_dir,
                max_num_steady_states, max_retries, agent_logger,
                ss_resume_agent, on_agent_start, on_agent_end
            ),
            output_key="steady_states",
        ))

        # Step 2: Define faults
        runner.add_step(AgentStep(
            name="fault_definer",
            run_fn=lambda steady_states: self._run_fault_definer(
                data, steady_states, hypothesis_dir, checkpoint_dir, max_retries, agent_logger,
                fault_resume_agent, on_agent_start, on_agent_end
            ),
            output_key="fault",
            depends_on=["steady_states"],
        ))

        # Run all agents (with resume support)
        results = runner.run(resume_from_agent=runner_resume_agent)

        #-------------------
        # make a hypothesis
        #-------------------
        hypothesis = Hypothesis(
            steady_states=results["steady_states"],
            fault=results["fault"]
        )
        save_json(f"{hypothesis_dir}/hypothesis.json", hypothesis.dict())
        return hypothesis

    def _run_steady_state_definer(
        self,
        data: ProcessedData,
        kube_context: str,
        hypothesis_dir: str,
        checkpoint_dir: str,
        max_num_steady_states: int,
        max_retries: int,
        agent_logger: Optional[AgentLogger],
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> SteadyStates:
        """Run steady state definer agent."""
        steady_states = self.steady_state_definer.define_steady_states(
            input_data=data,
            kube_context=kube_context,
            work_dir=hypothesis_dir,
            checkpoint_dir=checkpoint_dir,
            max_num_steady_states=max_num_steady_states,
            max_retries=max_retries,
            agent_logger=agent_logger,
            resume_from_agent=resume_from_agent,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )
        save_json(f"{hypothesis_dir}/steady_states.json", steady_states.dict())
        return steady_states

    def _run_fault_definer(
        self,
        data: ProcessedData,
        steady_states: SteadyStates,
        hypothesis_dir: str,
        checkpoint_dir: str,
        max_retries: int,
        agent_logger: Optional[AgentLogger],
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> FaultScenario:
        """Run fault definer agent."""
        # If steady_states is a dict (from checkpoint), reconstruct it
        if isinstance(steady_states, dict):
            steady_states = SteadyStates(**steady_states)
        fault = self.fault_definer.define_faults(
            data=data,
            steady_states=steady_states,
            work_dir=hypothesis_dir,
            checkpoint_dir=checkpoint_dir,
            max_retries=max_retries,
            agent_logger=agent_logger,
            resume_from_agent=resume_from_agent,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )
        save_json(f"{hypothesis_dir}/faults.json", fault.dict())
        return fault