import os
from typing import Optional

from .llm_agents.summary_agent import SummaryAgent, ChaosCycle
from ..utils.wrappers import LLM
from ..utils.llms import AgentLogger
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
        agent_logger: Optional[AgentLogger] = None
    ) -> str:
        summary = self.summary_agent.summarize(
            ce_cycle,
            agent_logger=agent_logger
        )
        os.makedirs(work_dir, exist_ok=True)
        with open(f"{work_dir}/summary.dat", "w") as f:
            f.write(summary)
        return summary
    
    def generate_intermediate_summary(self):
        pass