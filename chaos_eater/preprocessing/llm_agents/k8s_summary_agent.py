from typing import List, Optional

from ...utils.wrappers import LLM, BaseModel, Field
from ...utils.llms import build_json_agent, AgentLogger
from ...utils.schemas import File
from ...utils.functions import file_to_str, MessageLogger


#---------
# prompts
#---------
SYS_SUMMARIZE_K8S = """\
You are a professional kubernetes (K8s) engineer.
Given a K8s manifest, please summarize it according to the following rules:
- Summary must be written in bullet points.
- Summarize the functions of the K8s manifest in a way that is understandable to even beginners.
- {format_instructions}"""

USER_SUMMARIZE_K8S = """\
# K8s manifest
{k8s_yaml}

Please summarize the above K8s manifest."""


#--------------------
# JSON output format
#--------------------
class K8sSummary(BaseModel):
    k8s_summary: str = Field(description="Summary of the K8s manifest. Summarize it in bullet points like '- the 1st line\n- the second line...'")


#------------------
# agent definition
#------------------
class K8sSummaryAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        self.llm = llm
        self.message_logger = message_logger
        self.agent = build_json_agent(
            llm=llm,
            chat_messages=[
                ("system", SYS_SUMMARIZE_K8S),
                ("human", USER_SUMMARIZE_K8S)
            ],
            pydantic_object=K8sSummary,
            is_async=False
        )

    def summarize_manifests(
        self,
        k8s_yamls: List[File],
        agent_logger: Optional[AgentLogger] = None
    ) -> List[str]:
        self.message_logger.write("#### Summary of each manifest:")
        cb = agent_logger and agent_logger.get_callback(
            phase="preprocessing",
            agent_name="k8s_summary"
        )

        summaries = []
        for k8s_yaml in k8s_yamls:
            self.message_logger.write(f"`{k8s_yaml.fname}`")
            for summary in self.agent.stream(
                {"k8s_yaml": file_to_str(k8s_yaml)}, 
                {"callbacks": [cb]} if cb else {}
            ):
                if (summary_str := summary.get("k8s_summary")) is not None:
                    self.message_logger.stream(summary_str)
            self.message_logger.stream(summary_str, final=True)
            summaries.append(summary_str)
        return summaries