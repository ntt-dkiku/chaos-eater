from typing import List, Optional

from ...utils.wrappers import LLM, LLMBaseModel, LLMField
from ...utils.llms import build_json_agent, AgentLogger
from ...utils.schemas import File
from ...utils.functions import MessageLogger


SYS_ASSUME_K8S_APP = """\
You are a professional kubernetes (K8s) engineer.
Given K8s manifests for a system, please assume a real-world application (service) of the system according to the following rules:
- If the application is explicitly specified in the instructions, assume it. 
- You can leverage any given information, including file name and manifests to guess the purpose of the manifests.
- {format_instructions}"""

USER_ASSUME_K8S_APP = """\
{user_input}

Please assume a real-world application of the manifests."""

INPUT_TEMPLATE = """\
# K8s manifest:
```{k8s_yaml_name}
{k8s_yaml}
```

# Summary of {k8s_yaml_name}:
{k8s_summary}"""


class K8sAppAssumption(LLMBaseModel):
    thought: str = LLMField(description="Before assuming an application, reason logically why you assume it for the given manifests. e.g., from file name, instructions, or other elements?")
    k8s_application: str = LLMField(description="Specify what the service (application) offers to users.")


class K8sAppAssumptionAgent:
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
                ("system", SYS_ASSUME_K8S_APP),
                ("human", USER_ASSUME_K8S_APP)
            ],
            pydantic_object=K8sAppAssumption,
            is_async=False
        )

    def assume_app(
        self,
        k8s_yamls: List[File],
        k8s_summaries: List[str],
        agent_logger: Optional[AgentLogger] = None
    ) -> K8sAppAssumption:
        cb = agent_logger and agent_logger.get_callback(
            phase="preprocessing",
            agent_name="k8s_app"
        )

        user_input = self.get_user_input(
            k8s_yamls=k8s_yamls,
            k8s_summaries=k8s_summaries
        )

        for output in self.agent.stream(
            {"user_input": user_input},
            {"callbacks": [cb]} if cb else {}
        ):
            text = ""
            if (thought := output.get("thought")) is not None:
                text += f"`Thoughts`:\n{thought}\n\n"
            if (app := output.get("k8s_application")) is not None:
                text += f"`Assumed application`:\n{app}\n"
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return K8sAppAssumption(
            thought=thought,
            k8s_application=app
        )

    def get_user_input(
        self,
        k8s_yamls: List[File],
        k8s_summaries: List[str]
    ) -> str:
        user_input = ""
        # add k8s yamls and their summaries
        for k8s_yaml, k8s_summary in zip(k8s_yamls, k8s_summaries):
            user_input += INPUT_TEMPLATE.format(
                k8s_yaml=k8s_yaml.content,
                k8s_yaml_name=k8s_yaml.fname,
                k8s_summary=k8s_summary
            )
            user_input += "\n\n"
        return user_input