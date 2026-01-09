from typing import List

from .generate_seed_k8s_manifests import K8sApplication
from chaos_eater.utils.wrappers import LLM, LLMBaseModel, LLMField
from chaos_eater.utils.llms import build_json_agent


SYS_WEAKEN_K8S_MANIFESTS = """\
You are a professional kubernetes (k8s) engineer.
Given K8s manifests, you will intentionally reduce the redundancy and resilience of the K8s manifests to test whether other engineers can later identify the issue.
Always keep the following:
- Ensure that the core functionalities of each manifest remain the same as the original. Change only the redundancy, resiliency, and resource-allocation settings.
- The resource type change is allowed as long as the functionality remains unchanged / mostly the same (e.g., Deployment resource could be replaceed with Pod resource).
- NEVER add or delete any manifests.
- {format_instructions}"""

USER_WEAKEN_K8S_MANIFESTS = """\
# Here are K8s manifests that constitute a practical service:
## {title}
{description}
{manifest_list}

Please reduce the redundancy and resilience of the K8s manifests to test whether other engineers can later identify the issue.."""

MANIFEST_LIST_TEMPLATE = """\
```{fname}
{content}
```"""


class WeakK8sManifest(LLMBaseModel):
    id: int = LLMField(description="Identifier for the manifest file. Assign numbers sequentially starting from 0.")
    file_name: str = LLMField(description="The file name of the manifest yaml. The file extension must be '.yaml'.") 
    content: str = LLMField(description="The content of the manifest yaml. If there are no changes, simply copy the original content.")

class WeakK8sApplication(LLMBaseModel):
    title: str = LLMField(description="Title of your service.")
    description: str = LLMField(description="Before outputing the K8s manifests, describe the summary of the service and K8s manifests breifly. Clarify how you plan to reduce the system's redundancy and resiliency.")
    k8s_manifests: List[WeakK8sManifest] = LLMField(description="K8s manifest yamls that you intententionally weaken.")


class K8sAppVulnerabilityAgent:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm
        self.agent = build_json_agent(
            llm=llm,
            chat_messages=[("system", SYS_WEAKEN_K8S_MANIFESTS), ("human", USER_WEAKEN_K8S_MANIFESTS)],
            pydantic_object=WeakK8sApplication,
            is_async=False
        )

    def weaken_k8s_manifests(
        self,
        k8s_manifests: K8sApplication,
    ) -> WeakK8sApplication:
        manifest_list_str = ""
        for k8s_manifest in k8s_manifests.k8s_manifests:
            manifest_list_str += MANIFEST_LIST_TEMPLATE.format(fname=k8s_manifest.file_name, content=k8s_manifest.content) + "\n"
        weak_k8s_manifests = self.agent.invoke({
            "title": k8s_manifests.title,
            "description": k8s_manifests.description,
            "manifest_list": manifest_list_str
        })
        return WeakK8sApplication(**weak_k8s_manifests)