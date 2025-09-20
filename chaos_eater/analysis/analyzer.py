import os
from typing import Optional

from .llm_agents.analysis_agent import AnalysisAgent
from ..preprocessing.preprocessor import ProcessedData
from ..hypothesis.hypothesizer import Hypothesis
from ..experiment.experimenter import ChaosExperiment, ChaosExperimentResult
from ..utils.wrappers import BaseModel, LLM
from ..utils.llms import AgentLogger
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
        agent_logger: Optional[AgentLogger] = None
    ) -> Analysis:
        analysis_dir = f"{work_dir}/analysis"
        os.makedirs(analysis_dir, exist_ok=True)
        report = self.analysis_agent.analyze(
            input_data=input_data,
            hypothesis=hypothesis,
            experiment=experiment,
            reconfig_history=reconfig_history,
            experiment_result=experiment_result,
            agent_logger=agent_logger
        )
        analysis = Analysis(report=report)
        save_json(f"{analysis_dir}/analysis{mod_count}.json", analysis.dict())
        return Analysis(report=report)