from typing import List, Optional, Tuple

from ...preprocessing.preprocessor import ProcessedData
from ...hypothesis.hypothesizer import Hypothesis
from ...experiment.experimenter import ChaosExperiment, ChaosExperimentResult
from ...utils.wrappers import LLM, LLMBaseModel, LLMField
from ...utils.llms import build_json_agent, AgentLogger
from ...utils.functions import dict_to_str, MessageLogger


SYS_ANALYZE_RESULT = """\
You are a helpful AI assistant for Chaos Engineering.
Given K8s manifests for a network system, its hypothesis, the overview of a Chaos-Engineeering experiment, and the experimental results, you will analyze the experimental results.
Always keep the following rules:
- Analyze step by step why the test(s) failed, based on the system configuraions (manifests) and the flow of the experiment.
- Specify the cause while mentioning the corresponding system configurations and the corresponding phenamena in the Chaos-Engineering experiment.
- The anaysis report here will be used for reconfiguring the system later to avoid the failures and improve resiliency. Therefore, make carefully the report rich in insights so that it will be helpful at that time.
- When providing insights and reconfiguration recommendations, limit them to areas related to the failed test.
- {format_instructions}"""

USER_ANALYZE_RESULT = """\
# Here is the overview of my system:
{system_overview}

# Here is the hypothesis for my system:
{hypothesis_overview}

# Here is the overview of my Chaos-Engineering experiment to verify the hypothesis:
{experiment_plan_summary}

# The experiment's results are as follows:
{experiment_result}

Now, please analyze the results and provide an analysis report rich in insights."""

USER_REANALYZE_RESULT = """\
# Here is the overview of my system:
{system_overview}

# Here is the hypothesis for my system:
{hypothesis_overview}

# Here is the overview of my Chaos-Engineering experiment to verify the hypothesis:
{experiment_plan_summary}

# The update history for the above K8s manifests is the following:
{reconfig_history}

# The experiment's results in the latest K8s manifests are as follows:
{experiment_result}

Now, please analyze the results and provide an analysis report rich in insights."""


class AnalysisReport(LLMBaseModel):
    report: str = LLMField(description="Analysis of the experiment result.")


class AnalysisAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        # Store base messages for retry support
        self.base_messages_initial: List[Tuple[str, str]] = [
            ("system", SYS_ANALYZE_RESULT),
            ("human", USER_ANALYZE_RESULT)
        ]
        # Note: reanalyze message has {reconfig_history} placeholder that needs runtime substitution

    def _build_messages(self, is_reanalysis: bool, reconfig_history_str: str = "", retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        if is_reanalysis:
            messages = [
                ("system", SYS_ANALYZE_RESULT),
                ("human", USER_REANALYZE_RESULT.replace("{reconfig_history}", reconfig_history_str))
            ]
        else:
            messages = self.base_messages_initial.copy()

        if retry_context and retry_context.get("history"):
            for i, entry in enumerate(retry_context["history"], 1):
                messages.append(("ai", str(entry["output"])))
                if entry.get("feedback"):
                    messages.append(("human", f"Feedback #{i}: {entry['feedback']}"))
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def analyze(
        self,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        reconfig_history,
        experiment_result: ChaosExperimentResult,
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> str: # NOTE: not Analysis, but str
        cb = agent_logger and agent_logger.get_callback(
            phase="analysis",
            agent_name=f"analysis_{len(reconfig_history)}"
        )

        # Build reconfig history string if needed
        history_str = ""
        if len(reconfig_history) > 0:
            for i, reconfig in enumerate(reconfig_history):
                history_str += f"Reconfiguration #{i}:\n{dict_to_str(reconfig.mod_k8s_yamls)}\n\n"

        # Build messages with retry context
        messages = self._build_messages(
            is_reanalysis=(len(reconfig_history) > 0),
            reconfig_history_str=history_str,
            retry_context=retry_context
        )

        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=AnalysisReport,
            is_async=False
        )

        for token in agent.stream({
            "system_overview": input_data.to_k8s_overview_str(),
            "hypothesis_overview": hypothesis.to_str(),
            "experiment_plan_summary": experiment.plan["summary"],
            "experiment_result": experiment_result.to_str()},
            {"callbacks": [cb]} if cb else {}
        ):
            if (analysis := token.get("report")) is not None:
                self.message_logger.stream(analysis)
        self.message_logger.stream(analysis, final=True)
        return analysis