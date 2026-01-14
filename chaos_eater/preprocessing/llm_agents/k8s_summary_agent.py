from typing import List, Optional, Tuple

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
        # Store base messages instead of building agent (for retry support)
        self.base_messages: List[Tuple[str, str]] = [
            ("system", SYS_SUMMARIZE_K8S),
            ("human", USER_SUMMARIZE_K8S)
        ]

    def _build_messages(self, retry_context: Optional[dict] = None) -> List[Tuple[str, str]]:
        """Build message list, including retry history if present."""
        messages = self.base_messages.copy()

        if retry_context and retry_context.get("history"):
            # Add each history entry as ai output + human feedback
            for i, entry in enumerate(retry_context["history"], 1):
                messages.append(("ai", str(entry["output"])))
                if entry.get("feedback"):
                    messages.append(("human", f"Feedback #{i}: {entry['feedback']}"))
            # Add final instruction to revise
            messages.append(("human", "Please revise the output based on all the feedback above."))

        return messages

    def summarize_manifests(
        self,
        k8s_yamls: List[File],
        agent_logger: Optional[AgentLogger] = None,
        retry_context: Optional[dict] = None
    ) -> List[str]:
        self.message_logger.write("#### Summary of each manifest:")
        cb = agent_logger and agent_logger.get_callback(
            phase="preprocessing",
            agent_name="k8s_summary"
        )

        # Build messages (with retry history if present)
        messages = self._build_messages(retry_context)

        # Build agent dynamically
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=messages,
            pydantic_object=K8sSummary,
            is_async=False
        )

        summaries = []
        for k8s_yaml in k8s_yamls:
            self.message_logger.write(f"`{k8s_yaml.fname}`")
            for summary in agent.stream(
                {"k8s_yaml": file_to_str(k8s_yaml)},
                {"callbacks": [cb]} if cb else {}
            ):
                if (summary_str := summary.get("k8s_summary")) is not None:
                    self.message_logger.stream(summary_str)
            self.message_logger.stream(summary_str, final=True)
            summaries.append(summary_str)
        return summaries