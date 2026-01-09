from typing import Literal

from chaos_eater.chaos_eater import ChaosCycle
from chaos_eater.utils.wrappers import LLM, LLMBaseModel, LLMField
from chaos_eater.utils.llms import build_json_agent
from chaos_eater.utils.common_prompts import CHAOS_ENGINEERING_DESCRIIPTION


#--------------------
# review description
#--------------------
OVERALL_SCORE_SCALE = """\
Here is the rating scale (descending order). You must choose the score from [1, 5]. 
The higher the score, the better the CE cycle. The scores 1, 2 are negative, The score 3 is accetable, the score 4 is positive, the score 5 is very positive.
Score: criteria
5: The cycle fixes critical issues in the system and offers meaningful insights for the next cycle according to the experiments conducted
4: The cycle fixes critical issues in the system
3: The cycle fixes minor issues in the system or offers meaningful insights for the next cycle according to the experiments conducted
2: The cycle neither changes the system nor offers meaningful insights for the next cycle according to the experiments conducted
1: The cycle worsens the system's resiliency or adds meaningless resiliency.
"""

HYPOTHESIS_SCORE_SCALE = """\
Here is the rating scale (descending order). You must choose the score from [1, 5].
The higher the score, the better the hypothesis. The scores 1, 2 are negative, The score 3 is accetable, the score 4 is positive, the score 5 is very positive.
Score: criteria
5: The hypothesis is relevant to the system and meaningful. Additioanlly, the hypothesis leads to system improvement and offers meaningful insights for the next cycle. 
4: The hypothesis is relevant to the system and meaningful. Additionally, the hypothesis leads to system improvement or offers meaningful insights for the next cycle.
3: The hypothesis is relevant to the system and meaningful. However, the hypothesis neither leads to system improvement nor offers meaningful insights for the next cycle.
2: The hypothesis is relevant to the system, but is trivial and meaningless (e.g., hypothesis that is to be obviously satisfied).
1: The hypothesis is irrelevant to the system.
"""

EXPERIMENT_SCORE_SCALE = """\
Here is the rating scale (descending order). You must choose the score from [1, 5].
The higher the score, the better the experiment plan.
5: The experiment plan correctly serves to validate the hypothesis. Additionally, it is set up considering an complex, actual failure scenario.
4: The experiment plan correctly serves to validate the hypothesis. Additionally, it is set up considering an actual failure scenario.
3: The experiment plan correctly serves to validate the hypothesis.
2: The experiment plan mostly serves to validate the hypothesis. However, there are some missed components.
1: The experiment plan does serve to validate the hypothesis at all.
"""

ANALYSIS_SCORE_SCALE = """\
Here is the rating scale (descending order). You must choose the score from [1, 5].
The higher the score, the better the analysis.
5: The analysis reports correct and meaningful information. Additioanlly, it provides some meaningful insights for the improvement.
4: The analysis reports correct and meaningful information. Additioanlly, it provides some insights for the improvement.
3: The analysis reports correct and meaningful information.
2: The analysis reports meaningless information.
1: The analysis reports information that is not factual.
"""

IMPROVEMENT_SCORE_SCALE = """\
Here is the rating scale (descending order). You must choose the score from [1, 5].
The higher the score, the better the improvement. 
5: The improvement succesully changes the system to satisfy the hypothesis in the first attempt.
4: The improvement succesully changes the system to satisfy the hypothesis over two or more iterations.
3: The improvement does not change the system.
2: The improvement exceeded the number of attempts and stopped midway.
1: The improvement worsens the system's resiliency or adds meaningless resiliency.
"""


#----------------------------
# structured output settings
#----------------------------
class OverallReview(LLMBaseModel):
    summary: str = LLMField(description="Summarize the overall of the Chaos Engineering cycle.")
    strengths: str = LLMField(description="List the strengths of the Chaos Engineering cycle. Write them in bullet points (3 - 5 items).")
    weaknesses: str = LLMField(description="List the weaknesses of the Chaos Engineering cycle. Write them in bullet points (3 - 5 items).")
    score_reason: str = LLMField(description="Before write the score, please describe why you choose the score according to the rating scale table.")
    score: Literal[1, 2, 3, 4, 5] = LLMField(description=OVERALL_SCORE_SCALE)

class HypothesisReview(LLMBaseModel):
    summary: str = LLMField(description="Summarize the overall of the hypothesis.")
    strengths: str = LLMField(description="List the strengths of the hypothesis. Write them in bullet points (3 - 5 items).")
    weaknesses: str = LLMField(description="List the weaknesses of the hypothesis. Write them in bullet points (3 - 5 items).")
    score_reason: str = LLMField(description="Before write the score, please describe why you choose the score according to the rating scale table.")
    score: Literal[1, 2, 3, 4, 5] = LLMField(description=HYPOTHESIS_SCORE_SCALE)

class ExperimentReview(LLMBaseModel):
    summary: str = LLMField(description="Summarize the overall of the experiment plan.")
    strengths: str = LLMField(description="List the strengths of the experiment plan. Write them in bullet points (3 - 5 items).")
    weaknesses: str = LLMField(description="List the weaknesses of the experiment plan. Write them in bullet points (3 - 5 items).")
    score_reason: str = LLMField(description="Before write the score, please describe why you choose the score according to the rating scale table.")
    score: Literal[1, 2, 3, 4, 5] = LLMField(description=EXPERIMENT_SCORE_SCALE)

class AnalysisReview(LLMBaseModel):
    summary: str = LLMField(description="Summarize the overall of the analysis.")
    strengths: str = LLMField(description="List the strengths of the analysis. Write them in bullet points (3 - 5 items).")
    weaknesses: str = LLMField(description="List the weaknesses of the analysis. Write them in bullet points (3 - 5 items).")
    score_reason: str = LLMField(description="Before write the score, please describe why you choose the score according to the rating scale table.")
    score: Literal[1, 2, 3, 4, 5] = LLMField(description=ANALYSIS_SCORE_SCALE)

class ImprovementReview(LLMBaseModel):
    summary: str = LLMField(description="Summarize the overall of the improvement.")
    strengths: str = LLMField(description="List the strengths of the improvement. Write them in bullet points (3 - 5 items).")
    weaknesses: str = LLMField(description="List the weaknesses of the improvement. Write them in bullet points (3 - 5 items).")
    score_reason: str = LLMField(description="Before write the score, please describe why you choose the score according to the rating scale table.")
    score: Literal[1, 2, 3, 4, 5] = LLMField(description=IMPROVEMENT_SCORE_SCALE)

class Review(LLMBaseModel):
    hypothesis: HypothesisReview = LLMField(description="The review of the hypothesis phase.")
    experiment: ExperimentReview = LLMField(description="The review of the experiment (planning) phase.")
    analysis: AnalysisReview = LLMField(description="The review of the analysis phase.")
    improvement: ImprovementReview = LLMField(description="The review of the improvement phase.")
    overall: OverallReview = LLMField(description="The review of the entire Chaos Engineering cycle.")


#---------
# prompts
#---------
SYS_REVIEW_CE_CYCLE = """\
You are a professional reviwer for Chaos Engineering.
{ce_description}
Given a Chaos Engineering cycle, you will carefully review it according to the following rules:
- The review must be specific, constructive, and insightful.
- {format_instructions}"""

USER_REVIEW_CE_CYCLE = """\
Here is the overview of a Chaos Engineering cycle to be reviewed:
{ce_cycle_overview}

Please review the above Chaos Engineering cycle."""


#-------
# agent
#-------
class CEReviewAgent:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm

    def reveiew(self, ce_cycle: ChaosCycle) -> Review:
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=[("system", SYS_REVIEW_CE_CYCLE), ("human", USER_REVIEW_CE_CYCLE)],
            pydantic_object=Review,
            is_async=False
        )
        review = agent.invoke({
            "ce_cycle_overview": ce_cycle.to_str(),
            "ce_description": CHAOS_ENGINEERING_DESCRIIPTION
        })
        return Review(**review)