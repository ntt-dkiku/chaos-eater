import os
from typing import Optional, Callable, Any

from .llm_agents.analysis_agent import AnalysisAgent
from ..preprocessing.preprocessor import ProcessedData
from ..hypothesis.hypothesizer import Hypothesis
from ..experiment.experimenter import ChaosExperiment, ChaosExperimentResult
from ..utils.wrappers import BaseModel, LLM
from ..utils.llms import AgentLogger
from ..utils.agent_runner import AgentRunner, AgentStep
from ..utils.functions import save_json, MessageLogger


class Analysis(BaseModel):
    report: str 


class Analyzer:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger,
        namespace: str = "chaos-eater"
    ) -> None:
        # llm
        self.llm = llm
        # message logger
        self.message_logger = message_logger
        # general
        self.namespace = namespace
        # analysis
        self.analysis_agent = AnalysisAgent(llm, message_logger)

    def analyze(
        self,
        mod_count: int,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        reconfig_history,
        experiment_result: ChaosExperimentResult,
        work_dir: str,
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
    ) -> Analysis:
        analysis_dir = f"{work_dir}/analysis"
        checkpoint_dir = f"{work_dir}/checkpoints"
        os.makedirs(analysis_dir, exist_ok=True)

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="analysis",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Analyze the experiment result
        runner.add_step(AgentStep(
            name=f"analysis_{mod_count}",
            run_fn=lambda retry_context=None: self._run_analysis(
                input_data, hypothesis, experiment,
                reconfig_history, experiment_result, agent_logger, retry_context
            ),
            output_key="report",
        ))

        # Run all agents (with resume support)
        results = runner.run(resume_from_agent=resume_from_agent)

        analysis = Analysis(report=results["report"])
        save_json(f"{analysis_dir}/analysis{mod_count}.json", analysis.dict())
        return analysis

    def _run_analysis(
        self,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        reconfig_history,
        experiment_result: ChaosExperimentResult,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> str:
        """Run analysis agent."""
        return self.analysis_agent.analyze(
            input_data=input_data,
            hypothesis=hypothesis,
            experiment=experiment,
            reconfig_history=reconfig_history,
            experiment_result=experiment_result,
            agent_logger=agent_logger,
            retry_context=retry_context
        )