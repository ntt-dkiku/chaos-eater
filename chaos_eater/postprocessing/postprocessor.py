import os
from typing import Optional, Callable, Any

from .llm_agents.summary_agent import SummaryAgent, ChaosCycle
from ..utils.wrappers import LLM
from ..utils.llms import AgentLogger
from ..utils.agent_runner import AgentRunner, AgentStep
from ..utils.functions import MessageLogger


class PostProcessor:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        self.summary_agent = SummaryAgent(llm, message_logger)

    def process(
        self,
        ce_cycle: ChaosCycle,
        work_dir: str,
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> str:
        checkpoint_dir = f"{work_dir}/checkpoints"
        os.makedirs(work_dir, exist_ok=True)

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="postprocess",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Summarize the chaos cycle
        runner.add_step(AgentStep(
            name="summary_agent",
            run_fn=lambda: self._run_summary(ce_cycle, agent_logger),
            output_key="summary",
        ))

        # Run all agents (with resume support)
        results = runner.run(resume_from_agent=resume_from_agent)

        summary = results["summary"]
        with open(f"{work_dir}/summary.dat", "w") as f:
            f.write(summary)
        return summary

    def _run_summary(
        self,
        ce_cycle: ChaosCycle,
        agent_logger: Optional[AgentLogger]
    ) -> str:
        """Run summary agent."""
        return self.summary_agent.summarize(
            ce_cycle,
            agent_logger=agent_logger
        )

    def generate_intermediate_summary(self):
        pass