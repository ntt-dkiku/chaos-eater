from typing import List, Optional, Tuple

from ...analysis.analyzer import Analysis
from ...experiment.experimenter import ChaosExperiment, ChaosExperimentResult
from ...hypothesis.hypothesizer import Hypothesis
from ...improvement.improver import ReconfigurationResult
from ...preprocessing.preprocessor import ProcessedData
from ...utils.wrappers import LLM, LLMBaseModel, LLMField, BaseModel
from ...utils.llms import build_json_agent, AgentLogger
from ...utils.functions import int_to_ordinal, MessageLogger


CHAOS_CYCLE_OVERVIEW = """\
# Here is a Chaos Engineering cycle
## Step 0. User-input understanding
### Here is the overview of user inputs:
{system_overview}

## Step 1. Hypothesis definition
### Here is the overview of the hypothesis for the system:
{hypothesis_overview}

## Step 2.1. Chaos-Engineering experiment
### Here is the overview of my Chaos-Engineering experiment to verify the hypothesis:
{experiment_plan_overview}

## Step 2.2, 3, 4. Experiment execution, analysis and improvement (reconfiguring the system to satisfy the hypothesis)
### Here is the improvement history:
{improvement_history}"""

# ## Overall result
# {overall_result}"""

RESULT_TEMPLATE = """\
### Experiment result ({ordinal_number} try)
{result_summary}"""

ANALYSIS_TEMPLATE = """
### Analysis report ({ordinal_number} try)
{analysis_report}"""

IMPROVEMENT_TEMPLATE = """\
### Improvement result ({ordinal_number} try)
{improvement_summary}"""


class ChaosCycle(BaseModel):
    processed_data: Optional[ProcessedData] = None
    hypothesis: Optional[Hypothesis] = None
    experiment: Optional[ChaosExperiment] = None
    result_history: List[ChaosExperimentResult] = []
    analysis_history: List[Analysis] = []
    reconfig_history: List[ReconfigurationResult] = []
    conducts_reconfig: bool = False
    completes_reconfig: bool = False
    summary: str = ""

    def to_str(self):
        return CHAOS_CYCLE_OVERVIEW.format(
            system_overview=self.processed_data.to_str(),
            hypothesis_overview=self.hypothesis.to_str(),
            experiment_plan_overview=self.experiment.to_str(),
            improvement_history=self.get_improvement_history_str(),
            # overall_result=self.get_overall_result_str()
        )

    def get_improvement_history_str(self) -> str:
        history_str = ""
        for i in range(len(self.analysis_history)):
            history_str += RESULT_TEMPLATE.format(
                ordinal_number=int_to_ordinal(i+1),
                result_summary=self.result_history[i].to_str()
            ) + "\n\n"
            history_str += ANALYSIS_TEMPLATE.format(
                ordinal_number=int_to_ordinal(i+1),
                analysis_report=self.analysis_history[i].report
            ) + "\n\n"
            history_str += IMPROVEMENT_TEMPLATE.format(
                ordinal_number=int_to_ordinal(i+1),
                improvement_summary=self.reconfig_history[i].to_str()
            ) + "\n\n"
        history_str += RESULT_TEMPLATE.format(
            ordinal_number=int_to_ordinal(len(self.result_history)),
            result_summary=self.result_history[-1].to_str()
        )
        return history_str


SYS_SUMMARY_CYCLE = """\
You are a helpful AI assistant for Chaos Engineering.
Given a summary of a Chaos Engineering cycle, please elaborate the summary.
{format_instructions}"""

USER_SUMMARY_CYCLE = """\
Here is the overview of a Chaos Engineering Cycle:
{ce_cycle_overview}

Please elaborate the above summary of a Chaos Engineering Cycle."""


class CECycleSummary(LLMBaseModel):
    summary: str = LLMField(description="")


class SummaryAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        # Store base messages for retry support
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_SUMMARY_CYCLE),
            ("human", USER_SUMMARY_CYCLE)
        ]

    def _escape_braces(self, text: str) -> str:
        """Escape curly braces for LangChain template."""
        return text.replace("{", "{{").replace("}", "}}")

    def _build_messages(self, retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        messages = self.base_messages.copy()

        if retry_context and retry_context.get("history"):
            for i, entry in enumerate(retry_context["history"], 1):
                escaped_output = self._escape_braces(str(entry["output"]))
                messages.append(("ai", escaped_output))
                if entry.get("feedback"):
                    escaped_feedback = self._escape_braces(entry['feedback'])
                    messages.append(("human", f"Feedback #{i}: {escaped_feedback}"))
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def summarize(
        self,
        ce_cycle: ChaosCycle,
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> str:
        cb = agent_logger and agent_logger.get_callback(
            phase="postprocessing",
            agent_name="overall_summary"
        )

        # Build messages with retry context
        messages = self._build_messages(retry_context)

        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=CECycleSummary,
            is_async=False
        )

        self.message_logger.write("#### Summary of your k8s yaml")
        for summary in agent.stream(
            {"ce_cycle_overview": ce_cycle.to_str()},
            {"callbacks": [cb]} if cb else {}
        ):
            if (summary_str := summary.get("summary")) is not None:
                self.message_logger.stream(summary_str)
        self.message_logger.stream(summary_str, final=True)
        return summary_str