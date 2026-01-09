from typing import List

from chaos_eater.utils.wrappers import LLM, LLMBaseModel, LLMField
from chaos_eater.utils.llms import build_json_agent


SYS_GENERATE_K8S_MANIFESTS = """\
You are a professional kubernetes (K8s) engineer.
You will generate K8s manifests that constitute a practical service.
Always keep the following:
- Include one resource per manifest.
- Care about the diversity of the generated data: When given a previously generated services (K8s manifests), generate K8s manifests with a different application or theme.
- The number of your generated K8s manifests must match the number specified by the user.
- {format_instructions}"""

USER_GENERATE_FIRST_K8S_MANIFESTS = """\
This is your first try to generate K8s manifest(s) that constitute a practical service.
Please generate "{num_k8s_manifests}" manifest(s) for a service with their description."""

USER_GENERATE_K8S_MANIFESTS = """\
# Here are the previously generated services (K8s manifests):
{generation_history}
Please generate "{num_k8s_manifests}" manifest(s) that is different from what has been generated so far."""

GENERATION_SUMMARY_TEMPLATE = """\
## Sample {sample_id}: {title}
{description}
{manifest_list}"""

MANIFEST_LIST_TEMPLATE = """\
```{fname}
{content}
```"""

class K8sManifest(LLMBaseModel):
    id: int = LLMField(description="Identifier for the manifest file. Assign numbers sequentially starting from 0.")
    file_name: str = LLMField(description="The file name of the manifest yaml. The file extension must be '.yaml'.") 
    content: str = LLMField(description="The content of the manifest yaml.")

class K8sApplication(LLMBaseModel):
    title: str = LLMField(description="Title of your service.")
    description: str = LLMField(description="Before outputing the K8s manifests, describe the summary of the service and K8s manifests breifly. The format must be markdown.")
    k8s_manifests: List[K8sManifest] = LLMField(description="K8s manifest yamls that constitute your service.")


class K8sAppGenerationAgent:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm

    def generate_k8s_manifests(
        self,
        num_k8s_manifests: int,
        generation_history: List[K8sApplication]
    ) -> K8sApplication:
        is_first_try = len(generation_history) == 0
        if is_first_try:
            chat_messages = [("system", SYS_GENERATE_K8S_MANIFESTS), ("human", USER_GENERATE_FIRST_K8S_MANIFESTS)]
        else:
            chat_messages = [("system", SYS_GENERATE_K8S_MANIFESTS), ("human", USER_GENERATE_K8S_MANIFESTS)]
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=chat_messages,
            pydantic_object=K8sApplication,
            is_async=False
        )
        if is_first_try:
            k8s_manifests = agent.invoke({"num_k8s_manifests": num_k8s_manifests})
        else:
            k8s_manifests = agent.invoke({
                "num_k8s_manifests": num_k8s_manifests, 
                "generation_history": self.generation_hisotry_to_str(generation_history)
            })
        return K8sApplication(**k8s_manifests)

    def generation_hisotry_to_str(self, generation_history: List[K8sApplication]) -> str:
        generation_history_str = ""
        for id, generation in enumerate(generation_history):
            manifest_list_str = ""
            for k8s_manifest in generation.k8s_manifests:
                manifest_list_str += MANIFEST_LIST_TEMPLATE.format(fname=k8s_manifest.file_name, content=k8s_manifest.content) + "\n"
            generation_history_str += GENERATION_SUMMARY_TEMPLATE.format(
                sample_id=id+1,
                title=generation.title,
                description=generation.description,
                manifest_list=manifest_list_str
            ) + "\n\n"
        return generation_history_str