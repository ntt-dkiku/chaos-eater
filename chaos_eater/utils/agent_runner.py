"""
AgentRunner: A utility for running agents sequentially with checkpoint-based resume support.

This module provides:
- AgentStep: Defines a single agent execution step
- CheckpointManager: Handles saving/loading checkpoints for resume
- AgentRunner: Orchestrates agent execution with resume capability
"""

import json
import os
import time
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Callable

logger = logging.getLogger(__name__)


@dataclass
class AgentStep:
    """Defines a single agent execution step."""
    name: str                                    # Agent name (e.g., "k8s_summary_agent")
    run_fn: Callable[..., Any]                   # Function to execute
    output_key: str                              # Key to store result in results dict
    depends_on: List[str] = field(default_factory=list)  # Keys this step depends on
    checkpoint_after: bool = True                # Save checkpoint after this step


class CheckpointManager:
    """Manages saving and loading checkpoints for agent-level resume.

    Uses a single checkpoint file (agent_checkpoint.json) with phase-based sections:
    {
        "global": {
            "current_phase": "hypothesis",
            "last_completed_agent": "inspection_agent_0",
            "saved_at": 1702659123
        },
        "phases": {
            "preprocess": {
                "completed_agents": [...],
                "next_agent": null,
                "data": {...}
            },
            ...
        }
    }
    """

    def __init__(self, checkpoint_dir: str, phase: str):
        self.checkpoint_dir = checkpoint_dir
        self.phase = phase
        # Single checkpoint file for all phases
        self.checkpoint_path = f"{checkpoint_dir}/agent_checkpoint.json"
        os.makedirs(checkpoint_dir, exist_ok=True)

    def save(
        self,
        completed_agents: List[str],
        next_agent: Optional[str],
        data: Dict[str, Any]
    ) -> None:
        """Save checkpoint after agent completion. Merges with existing data."""
        # Load existing checkpoint or create new structure
        full_checkpoint = self._load_full_checkpoint() or {
            "global": {},
            "phases": {}
        }

        # Update phase-specific data
        full_checkpoint["phases"][self.phase] = {
            "completed_agents": completed_agents,
            "next_agent": next_agent,
            "data": self._serialize_data(data),
        }

        # Update global state
        last_agent = completed_agents[-1] if completed_agents else None
        full_checkpoint["global"] = {
            "current_phase": self.phase,
            "last_completed_agent": last_agent,
            "saved_at": time.time(),
        }

        try:
            with open(self.checkpoint_path, 'w') as f:
                json.dump(full_checkpoint, f, indent=2, default=str)
            logger.debug(f"Saved checkpoint: phase={self.phase}, completed={completed_agents}")
        except Exception as e:
            logger.warning(f"Failed to save checkpoint: {e}")

    def load(self) -> Optional[Dict[str, Any]]:
        """Load checkpoint for this phase if exists."""
        full_checkpoint = self._load_full_checkpoint()
        if not full_checkpoint:
            return None

        phase_data = full_checkpoint.get("phases", {}).get(self.phase)
        if phase_data:
            logger.debug(f"Loaded checkpoint for phase {self.phase}: {phase_data.get('completed_agents', [])}")
            return phase_data
        return None

    def _load_full_checkpoint(self) -> Optional[Dict[str, Any]]:
        """Load the full checkpoint file."""
        if not os.path.exists(self.checkpoint_path):
            return None
        try:
            with open(self.checkpoint_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load checkpoint: {e}")
            return None

    def _serialize_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Serialize data for JSON storage."""
        serialized = {}
        for key, value in data.items():
            if hasattr(value, 'dict'):
                # Pydantic model
                serialized[key] = value.dict()
            elif hasattr(value, '__dict__'):
                serialized[key] = value.__dict__
            else:
                serialized[key] = value
        return serialized


class AgentRunner:
    """
    Orchestrates sequential agent execution with checkpoint-based resume.

    Usage:
        runner = AgentRunner(
            phase="preprocess",
            checkpoint_dir=f"{work_dir}/checkpoints",
            on_agent_start=lambda name: print(f"Starting {name}"),
            on_agent_end=lambda name, result: print(f"Completed {name}"),
        )

        runner.add_step(AgentStep(
            name="agent1",
            run_fn=lambda: agent1.run(),
            output_key="result1",
        ))

        runner.add_step(AgentStep(
            name="agent2",
            run_fn=lambda result1: agent2.run(result1),
            output_key="result2",
            depends_on=["result1"],
        ))

        results = runner.run(resume_from_agent="agent2")
    """

    def __init__(
        self,
        phase: str,
        checkpoint_dir: str,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
        on_checkpoint_save: Optional[Callable[[str, List[str]], None]] = None,
    ):
        self.phase = phase
        self.checkpoint_mgr = CheckpointManager(checkpoint_dir, phase)
        self.on_agent_start = on_agent_start
        self.on_agent_end = on_agent_end
        self.on_checkpoint_save = on_checkpoint_save
        self.steps: List[AgentStep] = []
        self.results: Dict[str, Any] = {}
        self._completed_agents: List[str] = []

    def add_step(self, step: AgentStep) -> 'AgentRunner':
        """Add an agent step. Returns self for chaining."""
        self.steps.append(step)
        return self

    def get_agent_names(self) -> List[str]:
        """Get list of all agent names in order."""
        return [step.name for step in self.steps]

    def run(
        self,
        resume_from_agent: Optional[str] = None,
        initial_data: Optional[Dict[str, Any]] = None,
        restore_from_checkpoint: bool = True,
    ) -> Dict[str, Any]:
        """
        Run all agent steps sequentially.

        Args:
            resume_from_agent: Agent name to resume from (skips prior agents)
            initial_data: Initial data to seed results with
            restore_from_checkpoint: Whether to restore data from checkpoint file

        Returns:
            Dict containing all agent outputs keyed by output_key
        """
        # Initialize results with initial data
        if initial_data:
            self.results.update(initial_data)

        # Determine start index
        start_idx = 0
        if resume_from_agent:
            for i, step in enumerate(self.steps):
                if step.name == resume_from_agent:
                    start_idx = i
                    break

            # Restore previous results from checkpoint
            if restore_from_checkpoint:
                checkpoint = self.checkpoint_mgr.load()
                if checkpoint and checkpoint.get("data"):
                    # Merge checkpoint data (don't overwrite initial_data)
                    for key, value in checkpoint["data"].items():
                        if key not in self.results:
                            self.results[key] = value
                    self._completed_agents = checkpoint.get("completed_agents", [])
                    logger.info(f"Restored checkpoint data for phase {self.phase}")

        # Log what we're doing
        if start_idx > 0:
            skipped = [s.name for s in self.steps[:start_idx]]
            logger.info(f"Resuming from {resume_from_agent}, skipping: {skipped}")

        # Execute steps from start_idx
        for i, step in enumerate(self.steps[start_idx:], start=start_idx):
            # Collect dependencies (outside retry loop as they don't change)
            kwargs = {}
            if step.depends_on:
                for dep_key in step.depends_on:
                    if dep_key in self.results:
                        kwargs[dep_key] = self.results[dep_key]
                    else:
                        logger.warning(f"Dependency {dep_key} not found for {step.name}")

            # Retry loop for interactive mode (post-approval)
            while True:
                # Callback: agent starting (notification only)
                if self.on_agent_start:
                    self.on_agent_start(step.name)

                # Execute agent
                try:
                    if kwargs:
                        result = step.run_fn(**kwargs)
                    else:
                        result = step.run_fn()
                except Exception as e:
                    logger.error(f"Agent {step.name} failed: {e}")
                    raise

                # Store result
                self.results[step.output_key] = result

                # Callback: agent completed (may return 'approve', 'retry', or raise)
                action = 'approve'
                if self.on_agent_end:
                    action = self.on_agent_end(step.name, result) or 'approve'

                if action == 'retry':
                    logger.info(f"Retrying agent: {step.name}")
                    # Continue loop to re-execute
                    continue

                # approve - exit retry loop and continue to next agent
                break

            self._completed_agents.append(step.name)

            # Save checkpoint
            if step.checkpoint_after:
                next_agent = self.steps[i + 1].name if i + 1 < len(self.steps) else None
                self.checkpoint_mgr.save(
                    completed_agents=self._completed_agents.copy(),
                    next_agent=next_agent,
                    data=self.results,
                )
                if self.on_checkpoint_save:
                    self.on_checkpoint_save(step.name, self._completed_agents.copy())

        return self.results

    @property
    def completed_agents(self) -> List[str]:
        """Get list of completed agent names."""
        return self._completed_agents.copy()

    @property
    def current_agent(self) -> Optional[str]:
        """Get the next agent to run (or None if all complete)."""
        completed_set = set(self._completed_agents)
        for step in self.steps:
            if step.name not in completed_set:
                return step.name
        return None
