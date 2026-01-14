import os
import logging
from typing import List, Dict, Optional, Callable, Any

from .llm_agents.draft_agent import SteadyStateDraftAgent
from .llm_agents.inspection_agent import InspectionAgent
from .llm_agents.threshold_agent import ThresholdAgent
from .llm_agents.unittest_agent import UnittestAgent
from .llm_agents.completion_check_agent import SteadyStateCompletionCheckAgent
from .llm_agents.utils import Inspection
from ...preprocessing.preprocessor import ProcessedData
from ...utils.wrappers  import LLM, BaseModel
from ...utils.schemas import File
from ...utils.llms import AgentLogger
from ...utils.functions import int_to_ordinal, MessageLogger
from ...utils.agent_runner import AgentRunner, AgentStep

logger = logging.getLogger(__name__)


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
        checkpoint_dir: str,
        max_num_steady_states: int = 2,
        max_retries: int = 3,
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> SteadyStates:
        #-------------------
        # 0. initialization
        #-------------------
        # Only show phase header on fresh start (not on resume)
        if not resume_from_agent:
            self.message_logger.write("#### Steady-state definition")
        # directory settings
        steady_state_dir = f"{work_dir}/steady_states"
        os.makedirs(steady_state_dir, exist_ok=True)
        os.makedirs(checkpoint_dir, exist_ok=True)

        # Initialize state
        steady_states = SteadyStates()
        prev_check_thought = ""

        # Parse resume_from_agent to get starting index
        start_ss_idx = 0
        if resume_from_agent:
            start_ss_idx, _ = self._parse_agent_name(resume_from_agent)
            logger.info(f"Resuming from ss_idx={start_ss_idx}, agent={resume_from_agent}")

        #-----------------------------------
        # sequentially define steady states
        #-----------------------------------
        num_retries = 0
        ss_idx = 0

        while steady_states.count < max_num_steady_states:
            # error handling
            assert num_retries < max_retries + max_num_steady_states, f"MAX_RETRIES_EXCEEDED: failed to define steady states within {max_retries+max_num_steady_states} tries."
            num_retries += 1

            # Create AgentRunner for this iteration
            iteration_runner = AgentRunner(
                phase=f"steady_state_{ss_idx}",
                checkpoint_dir=checkpoint_dir,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
            )

            # Add steps to the runner
            iteration_runner.add_step(AgentStep(
                name=f"draft_agent_{ss_idx}",
                run_fn=lambda retry_context=None, input_data=input_data, steady_states=steady_states, prev_check_thought=prev_check_thought, agent_logger=agent_logger: self._run_draft(
                    input_data, steady_states, prev_check_thought, agent_logger, retry_context
                ),
                output_key="draft",
            ))

            iteration_runner.add_step(AgentStep(
                name=f"inspection_agent_{ss_idx}",
                run_fn=lambda draft, retry_context=None, input_data=input_data, steady_states=steady_states, kube_context=kube_context, work_dir=work_dir, max_retries=max_retries, agent_logger=agent_logger: self._run_inspection(
                    input_data, draft, steady_states, kube_context, work_dir, max_retries, agent_logger, retry_context
                ),
                output_key="inspection",
                depends_on=["draft"],
            ))

            iteration_runner.add_step(AgentStep(
                name=f"threshold_agent_{ss_idx}",
                run_fn=lambda draft, inspection, retry_context=None, input_data=input_data, steady_states=steady_states, agent_logger=agent_logger: self._run_threshold(
                    input_data, draft, inspection, steady_states, agent_logger, retry_context
                ),
                output_key="threshold",
                depends_on=["draft", "inspection"],
            ))

            iteration_runner.add_step(AgentStep(
                name=f"unittest_agent_{ss_idx}",
                run_fn=lambda draft, inspection, threshold, retry_context=None, input_data=input_data, steady_states=steady_states, kube_context=kube_context, work_dir=work_dir, max_retries=max_retries, agent_logger=agent_logger: self._run_unittest(
                    input_data, draft, inspection, threshold, steady_states, kube_context, work_dir, max_retries, agent_logger, retry_context
                ),
                output_key="unittest",
                depends_on=["draft", "inspection", "threshold"],
            ))

            # Determine if we should resume on this iteration
            iteration_resume_agent = None
            if resume_from_agent and ss_idx == start_ss_idx:
                iteration_resume_agent = resume_from_agent
                # Clear resume_from_agent so subsequent iterations run fresh
                resume_from_agent = None

            # Run the iteration
            results = iteration_runner.run(resume_from_agent=iteration_resume_agent)

            # Deserialize results if they are dicts (from checkpoint)
            inspection_result = results["inspection"]
            if isinstance(inspection_result, dict):
                inspection_result = Inspection(**inspection_result)
            unittest_result = results["unittest"]
            if isinstance(unittest_result, dict):
                unittest_result = File(**unittest_result)

            # Build steady state from results
            steady_states.append(SteadyState(
                id=steady_states.count,
                name=results["draft"]["name"],
                description=results["draft"]["thought"],
                inspection=inspection_result,
                threshold=results["threshold"],
                unittest=unittest_result
            ))

            #-------------------------------
            # Check steady-state completion
            #-------------------------------
            if steady_states.count >= max_num_steady_states:
                self.message_logger.write(f"#### The number of steady states has reached the maximum limit ({max_num_steady_states}).")
                break

            # Create a separate runner for completion check
            check_runner = AgentRunner(
                phase=f"steady_state_check_{ss_idx}",
                checkpoint_dir=checkpoint_dir,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
            )

            check_runner.add_step(AgentStep(
                name=f"completion_check_agent_{ss_idx}",
                run_fn=lambda retry_context=None, input_data=input_data, steady_states=steady_states, agent_logger=agent_logger: self._run_completion_check(
                    input_data, steady_states, agent_logger, retry_context
                ),
                output_key="check",
            ))

            check_results = check_runner.run()
            check = check_results["check"]

            prev_check_thought = check["thought"]
            if not check["requires_addition"]:
                break

            ss_idx += 1

        return steady_states

    def _run_draft(
        self,
        input_data: ProcessedData,
        predefined_steady_states: SteadyStates,
        prev_check_thought: str,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> Dict[str, str]:
        """Run draft agent to propose a steady state."""
        return self.draft_agent.draft_steady_state(
            input_data=input_data,
            predefined_steady_states=predefined_steady_states,
            prev_check_thought=prev_check_thought,
            agent_logger=agent_logger,
            retry_context=retry_context
        )

    def _run_inspection(
        self,
        input_data: ProcessedData,
        draft: Dict[str, str],
        predefined_steady_states: SteadyStates,
        kube_context: str,
        work_dir: str,
        max_retries: int,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> Inspection:
        """Run inspection agent to inspect current state."""
        return self.inspection_agent.inspect_current_state(
            input_data=input_data,
            steady_state_draft=draft,
            predefined_steady_states=predefined_steady_states,
            kube_context=kube_context,
            work_dir=work_dir,
            max_retries=max_retries,
            agent_logger=agent_logger,
            retry_context=retry_context
        )

    def _run_threshold(
        self,
        input_data: ProcessedData,
        draft: Dict[str, str],
        inspection: Inspection,
        predefined_steady_states: SteadyStates,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> Dict[str, str]:
        """Run threshold agent to define threshold."""
        # Deserialize inspection if it's a dict (from checkpoint)
        if isinstance(inspection, dict):
            inspection = Inspection(**inspection)
        return self.threshold_agent.define_threshold(
            input_data=input_data,
            steady_state_draft=draft,
            inspection=inspection,
            predefined_steady_states=predefined_steady_states,
            agent_logger=agent_logger,
            retry_context=retry_context
        )

    def _run_unittest(
        self,
        input_data: ProcessedData,
        draft: Dict[str, str],
        inspection: Inspection,
        threshold: Dict[str, str],
        predefined_steady_states: SteadyStates,
        kube_context: str,
        work_dir: str,
        max_retries: int,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> File:
        """Run unittest agent to write unit test."""
        # Deserialize inspection if it's a dict (from checkpoint)
        if isinstance(inspection, dict):
            inspection = Inspection(**inspection)
        return self.unittest_agent.write_unittest(
            input_data=input_data,
            steady_state_draft=draft,
            inspection=inspection,
            threshold=threshold,
            predefined_steady_states=predefined_steady_states,
            kube_context=kube_context,
            work_dir=work_dir,
            max_retries=max_retries,
            agent_logger=agent_logger,
            retry_context=retry_context
        )

    def _run_completion_check(
        self,
        input_data: ProcessedData,
        predefined_steady_states: SteadyStates,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> Dict[str, Any]:
        """Run completion check agent."""
        return self.completion_check_agent.check_steady_state_completion(
            input_data=input_data,
            predefined_steady_states=predefined_steady_states,
            agent_logger=agent_logger,
            retry_context=retry_context
        )

    def _parse_agent_name(self, agent_name: str) -> tuple:
        """Parse agent name to get ss_idx and step type"""
        # Format: {step_type}_agent_{ss_idx} or {step_type}_{ss_idx}
        parts = agent_name.rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            ss_idx = int(parts[1])
            return ss_idx, agent_name
        return 0, None
