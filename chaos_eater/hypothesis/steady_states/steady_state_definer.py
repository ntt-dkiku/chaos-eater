import os
import json
import logging
import time
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

logger = logging.getLogger(__name__)

# Phase name for checkpoint storage
CHECKPOINT_PHASE = "steady_state_definer"


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
        # gui settings
        self.message_logger.write("#### Steady-state definition")
        # directory settings
        steady_state_dir = f"{work_dir}/steady_states"
        checkpoint_path = f"{checkpoint_dir}/agent_checkpoint.json"  # Shared checkpoint file
        os.makedirs(steady_state_dir, exist_ok=True)
        os.makedirs(checkpoint_dir, exist_ok=True)

        # Initialize state
        steady_states = SteadyStates()
        prev_check_thought = ""
        current_step_data = {}  # Data for current iteration (draft, inspection, etc.)

        # Restore from checkpoint if resuming
        start_ss_idx = 0
        start_step = None
        if resume_from_agent:
            checkpoint = self._load_checkpoint(checkpoint_path)
            if checkpoint:
                # Restore completed steady states
                if "steady_states" in checkpoint:
                    steady_states = SteadyStates(**checkpoint["steady_states"])
                    logger.info(f"Restored {steady_states.count} completed steady states")
                # Restore current step data
                if "current_step_data" in checkpoint:
                    current_step_data = checkpoint["current_step_data"]
                # Parse resume agent name to get ss_idx and step
                start_ss_idx, start_step = self._parse_agent_name(resume_from_agent)
                prev_check_thought = checkpoint.get("prev_check_thought", "")
                logger.info(f"Resuming from ss_idx={start_ss_idx}, step={start_step}")

        # Define step order for each iteration
        STEP_ORDER = ["draft", "inspection", "threshold", "unittest", "completion_check"]

        def should_skip_step(ss_idx: int, step: str) -> bool:
            """Check if step should be skipped based on resume point"""
            if not resume_from_agent:
                return False
            if ss_idx < start_ss_idx:
                return True
            if ss_idx == start_ss_idx and start_step:
                step_idx = STEP_ORDER.index(step) if step in STEP_ORDER else -1
                start_step_idx = STEP_ORDER.index(start_step) if start_step in STEP_ORDER else 0
                return step_idx < start_step_idx
            return False

        def run_agent(agent_name: str, run_fn, step_key: str = None):
            """Run agent with callbacks and checkpoint saving"""
            if on_agent_start:
                on_agent_start(agent_name)
            result = run_fn()
            if on_agent_end:
                on_agent_end(agent_name, result)
            # Save to current step data
            if step_key:
                current_step_data[step_key] = self._serialize_result(result)
            return result

        def save_checkpoint(next_agent: str = None):
            """Save checkpoint after each step to shared checkpoint file"""
            # Load existing checkpoint or create new structure
            full_checkpoint = self._load_full_checkpoint(checkpoint_path) or {
                "global": {},
                "phases": {}
            }

            # Update phase-specific data
            full_checkpoint["phases"][CHECKPOINT_PHASE] = {
                "completed_agents": [],  # Will be set below
                "next_agent": next_agent,
                "steady_states": steady_states.dict(),
                "current_step_data": current_step_data,
                "prev_check_thought": prev_check_thought,
            }

            # Update global state
            full_checkpoint["global"] = {
                "current_phase": CHECKPOINT_PHASE,
                "last_completed_agent": next_agent,  # The one we just completed before next
                "saved_at": time.time(),
            }

            try:
                with open(checkpoint_path, 'w') as f:
                    json.dump(full_checkpoint, f, indent=2, default=str)
            except Exception as e:
                logger.warning(f"Failed to save checkpoint: {e}")

        #-----------------------------------
        # sequentially define steady states
        #-----------------------------------
        num_retries = 0
        ss_idx = start_ss_idx if resume_from_agent else 0

        while steady_states.count < max_num_steady_states:
            # error handling
            assert num_retries < max_retries + max_num_steady_states, f"MAX_RETRIES_EXCEEDED: failed to define steady states within {max_retries+max_num_steady_states} tries."
            num_retries += 1

            # Reset current step data for new iteration (unless resuming mid-iteration)
            if not (resume_from_agent and ss_idx == start_ss_idx and start_step):
                current_step_data = {}

            #-------------------------
            # 1. draft a steady state
            #-------------------------
            if should_skip_step(ss_idx, "draft"):
                steady_state_draft = current_step_data.get("draft")
                logger.info(f"Skipping draft_agent_{ss_idx} (restored from checkpoint)")
            else:
                steady_state_draft = run_agent(
                    f"draft_agent_{ss_idx}",
                    lambda: self.draft_agent.draft_steady_state(
                        input_data=input_data,
                        predefined_steady_states=steady_states,
                        prev_check_thought=prev_check_thought,
                        agent_logger=agent_logger
                    ),
                    step_key="draft"
                )
                save_checkpoint(f"inspection_agent_{ss_idx}")

            #--------------------------------------------------
            # 2. inspect the current value of the steady state
            #--------------------------------------------------
            if should_skip_step(ss_idx, "inspection"):
                inspection = self._deserialize_inspection(current_step_data.get("inspection"))
                logger.info(f"Skipping inspection_agent_{ss_idx} (restored from checkpoint)")
            else:
                inspection = run_agent(
                    f"inspection_agent_{ss_idx}",
                    lambda: self.inspection_agent.inspect_current_state(
                        input_data=input_data,
                        steady_state_draft=steady_state_draft,
                        predefined_steady_states=steady_states,
                        kube_context=kube_context,
                        work_dir=work_dir,
                        max_retries=max_retries,
                        agent_logger=agent_logger
                    ),
                    step_key="inspection"
                )
                save_checkpoint(f"threshold_agent_{ss_idx}")

            #---------------------------------------------
            # 3. define a threshold for the steady state
            #---------------------------------------------
            if should_skip_step(ss_idx, "threshold"):
                threshold = current_step_data.get("threshold")
                logger.info(f"Skipping threshold_agent_{ss_idx} (restored from checkpoint)")
            else:
                threshold = run_agent(
                    f"threshold_agent_{ss_idx}",
                    lambda: self.threshold_agent.define_threshold(
                        input_data=input_data,
                        steady_state_draft=steady_state_draft,
                        inspection=inspection,
                        predefined_steady_states=steady_states,
                        agent_logger=agent_logger
                    ),
                    step_key="threshold"
                )
                save_checkpoint(f"unittest_agent_{ss_idx}")

            #-------------------------------------------
            # 4. write a unit test for the steady state
            #-------------------------------------------
            if should_skip_step(ss_idx, "unittest"):
                unittest = self._deserialize_file(current_step_data.get("unittest"))
                logger.info(f"Skipping unittest_agent_{ss_idx} (restored from checkpoint)")
            else:
                unittest = run_agent(
                    f"unittest_agent_{ss_idx}",
                    lambda: self.unittest_agent.write_unittest(
                        input_data=input_data,
                        steady_state_draft=steady_state_draft,
                        inspection=inspection,
                        threshold=threshold,
                        predefined_steady_states=steady_states,
                        kube_context=kube_context,
                        work_dir=work_dir,
                        max_retries=max_retries,
                        agent_logger=agent_logger
                    ),
                    step_key="unittest"
                )

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
            # Clear current step data after completing a steady state
            current_step_data = {}
            save_checkpoint(f"completion_check_agent_{ss_idx}" if steady_states.count < max_num_steady_states else None)

            #-------------------------------
            # Check steady-state completion
            #-------------------------------
            if steady_states.count >= max_num_steady_states:
                self.message_logger.write(f"#### The number of steady states has reached the maximum limit ({max_num_steady_states}).")
                break

            if should_skip_step(ss_idx, "completion_check"):
                check = current_step_data.get("completion_check", {"requires_addition": True, "thought": ""})
                logger.info(f"Skipping completion_check_agent_{ss_idx} (restored from checkpoint)")
            else:
                check = run_agent(
                    f"completion_check_agent_{ss_idx}",
                    lambda: self.completion_check_agent.check_steady_state_completion(
                        input_data=input_data,
                        predefined_steady_states=steady_states,
                        agent_logger=agent_logger
                    ),
                    step_key="completion_check"
                )

            prev_check_thought = check["thought"]
            if not check["requires_addition"]:
                break

            ss_idx += 1

        # Final checkpoint
        save_checkpoint(None)
        return steady_states

    def _load_checkpoint(self, checkpoint_path: str) -> Optional[Dict]:
        """Load checkpoint for this phase from shared checkpoint file"""
        full_checkpoint = self._load_full_checkpoint(checkpoint_path)
        if not full_checkpoint:
            return None
        phase_data = full_checkpoint.get("phases", {}).get(CHECKPOINT_PHASE)
        if phase_data:
            logger.debug(f"Loaded checkpoint for phase {CHECKPOINT_PHASE}")
            return phase_data
        return None

    def _load_full_checkpoint(self, checkpoint_path: str) -> Optional[Dict]:
        """Load the full checkpoint file"""
        if not os.path.exists(checkpoint_path):
            return None
        try:
            with open(checkpoint_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load checkpoint: {e}")
            return None

    def _parse_agent_name(self, agent_name: str) -> tuple:
        """Parse agent name to get ss_idx and step type"""
        # Format: {step_type}_agent_{ss_idx} or {step_type}_{ss_idx}
        parts = agent_name.rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            ss_idx = int(parts[1])
            step_part = parts[0]
            # Extract step type
            step_mapping = {
                "draft_agent": "draft",
                "inspection_agent": "inspection",
                "threshold_agent": "threshold",
                "unittest_agent": "unittest",
                "completion_check_agent": "completion_check",
            }
            for key, step in step_mapping.items():
                if step_part == key:
                    return ss_idx, step
        return 0, None

    def _serialize_result(self, result: Any) -> Any:
        """Serialize result for JSON storage"""
        if hasattr(result, 'dict'):
            return result.dict()
        elif hasattr(result, '__dict__'):
            return result.__dict__
        return result

    def _deserialize_inspection(self, data: Optional[Dict]) -> Optional[Inspection]:
        """Deserialize Inspection from checkpoint data"""
        if data is None:
            return None
        return Inspection(**data)

    def _deserialize_file(self, data: Optional[Dict]) -> Optional[File]:
        """Deserialize File from checkpoint data"""
        if data is None:
            return None
        return File(**data)