import os
import subprocess
from typing import List, Tuple, Literal, Optional

from ...analysis.analyzer import Analysis
from ...experiment.experimenter import ChaosExperiment, ChaosExperimentResult
from ...hypothesis.hypothesizer import Hypothesis
from ...preprocessing.preprocessor import ProcessedData
from ...utils.constants import SKAFFOLD_YAML_TEMPLATE_PATH
from ...utils.wrappers import LLM, LLMBaseModel, LLMField, BaseModel
from ...utils.llms import build_json_agent, LLMLog, LoggingCallback
from ...utils.functions import (
    dict_to_str,
    file_list_to_str,
    copy_dir,
    render_jinja_template,
    write_file,
    delete_file,
    list_to_bullet_points,
    limit_string_length,
    remove_curly_braces,
    MessageLogger,
)
from ...utils.schemas import File
from ...utils.k8s import remove_all_resources_by_labels


SYS_RECONFIGURE_K8S_YAML = """\
You are a helpful AI assistant for Chaos Engineering.
Given K8s manifests that defines a network system, its hypothesis, the overview of a Chaos-Engineeering experiment, and the experiment's results, you will reconfigure the sytem based on analsis of the experiment's results.
Alwasy keep the following fules:
- NEVER change the original intention (its description) of the original version of the system.
- NEVER do the same reconfiguration as in the hisotry.
- Start with simple reconfiguration, and if the hypothesis is still not satisfied, gradually try more complex reconfigurations.
- {format_instructions}
"""

USER_RECONFIGURE_K8S_YAML1 = """\
# Here is the overview of my system (original version):
{system_overview}

# Here is the hypothesis for my system:
{hypothesis_overview}

# Here is the overview of my Chaos-Engineering experiment to verify the hypothesis:
{experiment_plan_summary}

# The experiment's results of the original system are as follows:
{experiment_result}

First, please analyze the results and provide an analysis report rich in insights."""

AI_ANALYZE_RESULT = """\
# Here is my analysis report:
{analysis_report}"""

USER_RECONFIGURE_K8S_YAML2 = """\
Then, please reconfigure the system to avoid the fails (improve resiliency)."""

AI_RECONFIGURE_K8S_YAML = """\
```json
{output}
```"""

SYS_REPORT_RESULTS = """\
# Here is the K8s menifests of the modified system (version={mod_version}):
{mod_k8s_yamls}

# The experiment's results of the modified system were as follows:
{mod_experiment_result}

Please analyze the results and provide an analysis report rich in insights again."""

USER_DEBUG_RECONFIGURATEION = """\
Your current reconfiguration cause errors when the manifests are deployed.
The error message is as follows:
{error_message}

Please analyze the reason why the errors occur, then fix the errors.
Always keep the following rules:
- NEVER repeat the same fixes that have been made in the past.
- Fix only the parts related to the errors without changing the original goal of the reconfiguration.
- {format_instructions}"""


#-----------
# templates
#-----------
MOD_K8S_YAML_OVERVIEW_TEMPLATE = """\
{num_mod_k8s_yamls} K8s manifests are modified:
{mod_k8s_yaml_list}"""

CREATE_REPLACE_K8S_YAML_TEMPLATE = """\
- The K8s manifest '{fname}' was {mod_type}d.
{explanation}
```yaml
{mod_k8s_yaml}
```"""

DELETE_K8S_YAML_TEMPLAET = """\
- The K8s manifest '{fname}' has been deleted.
{explanation}"""


class ModK8sYAML(LLMBaseModel):
    mod_type: Literal["replace", "create", "delete"] = LLMField(description="Modification type. Select from ['replace', 'create', 'delete']. The 'replace' replaces/overwites the content of an exisiting yaml. The 'create' creates a new yaml. The 'delete' deletes an existing yaml.")
    fname: str = LLMField(description="The file name of the modified yaml. If mod_type is 'replace' or 'delete', the name must match an existing yaml's name. If mod_type='create', name the file appropriately to avoid overlapping with existing yamls' names.")
    explanation: str = LLMField(description="If mod_type is 'delete', explain why you need to delete the yaml. If mod_type is 'replace', explain which part you should modify from the original conde and why. If mod_type is 'create', explain whether it is a completely new resource or a replacement resouce for an existing resource. If it is a replacement, also explain the differences and the reasons for them, just like with 'replace'.")
    code: Optional[str] = LLMField(description="If mod_type is 'delete', this field is not required. Otherwise, write the content of a K8s YAML manifest modified to pass all the unit tests. Write only the content of the code, and for dictionary values, enclose them within a pair of single double quotes (\").")

class ModK8sYAMLs(LLMBaseModel):
    thought: str = LLMField(description="Describe your plan to modify the K8s manifests.")
    modified_k8s_yamls: List[ModK8sYAML] = LLMField(description="The list of modified K8s manifests (yamls). If you create a new manifest to modify resources in an existing manifest, make sure to delete the existing manifest before creating the new one.")

class ReconfigurationResult(BaseModel):
    mod_k8s_yamls: dict

    def to_str(self) -> str:
        mod_k8s_list_str = ""
        mod_k8s_yamls = self.mod_k8s_yamls["modified_k8s_yamls"]
        for mod_k8s_yaml in mod_k8s_yamls:
            if mod_k8s_yaml["mod_type"] == "delete":
                mod_k8s_list_str += DELETE_K8S_YAML_TEMPLAET.format(
                    fname=mod_k8s_yaml["fname"],
                    explanation=mod_k8s_yaml["explanation"]
                ) + "\n\n"
            else:
                mod_k8s_list_str += CREATE_REPLACE_K8S_YAML_TEMPLATE.format(
                    fname=mod_k8s_yaml["fname"],
                    mod_type=mod_k8s_yaml["mod_type"],
                    explanation=mod_k8s_yaml["explanation"],
                    mod_k8s_yaml=mod_k8s_yaml["code"]
                ) + "\n\n"
        return remove_curly_braces(MOD_K8S_YAML_OVERVIEW_TEMPLATE.format(
            num_mod_k8s_yamls=len(mod_k8s_yamls),
            mod_k8s_yaml_list=mod_k8s_list_str
        ))


class ReconfigurationAgent:
    def __init__(
        self,
        llm: LLM,
        message_logger: MessageLogger
    ) -> None:
        # llm
        self.llm = llm
        # message logger
        self.message_logger = message_logger

    def reconfigure(
        self,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        k8s_yamls_history: List[List[File]],
        mod_dir_history: List[str],
        result_history: List[ChaosExperimentResult],
        analysis_history: List[Analysis],
        reconfig_history: List[ReconfigurationResult],
        kube_context: str,
        work_dir: str,
        max_retries: int = 3,
    ) -> Tuple[LLMLog, dict]:
        #----------------
        # initialization
        #----------------
        logger = LoggingCallback(name="reconfiguration", llm=self.llm)
        output_history = []
        error_history = []

        #---------------
        # first attempt
        #---------------
        mod_k8s_yamls = self.generate_reconfig_yamls(
            input_data=input_data,
            hypothesis=hypothesis,
            experiment=experiment,
            k8s_yamls_history=k8s_yamls_history,
            result_history=result_history,
            analysis_history=analysis_history,
            reconfig_history=reconfig_history,
            logger=logger
        )

        #--------------------------------
        # validate the reconfigured yaml
        #--------------------------------
        mod_count = 0
        while(1):
            assert mod_count < max_retries, f"MAX_MOD_COUNTS_EXCEEDED: {max_retries}"

            #----------------------
            # create a new project
            #----------------------
            # add the result to output history
            output_history.append(mod_k8s_yamls)
            # copy the previous project to the current project dir
            mod_dir = f"{work_dir}/mod_{mod_count}"
            copy_dir(mod_dir_history[-1], mod_dir) # duplicate the input project
            # modify k8s yamls
            reconfig_yamls = mod_k8s_yamls["modified_k8s_yamls"]
            for mod_k8s_yaml in reconfig_yamls:
                mod_type = mod_k8s_yaml["mod_type"]
                fpath = f"{mod_dir}/{mod_k8s_yaml['fname']}"
                if mod_type in ["create", "replace"]:
                    write_file(fpath, mod_k8s_yaml['code'])
                elif mod_type == "delete":
                    delete_file(fpath)
                else:
                    raise TypeError(f"Invalid modification type: {mod_type}")
            # create new yamls
            k8s_yamls = []
            # existing yamls
            for k8s_yaml in k8s_yamls_history[-1]:
                is_found = False
                for reconfig_yaml in reconfig_yamls:
                    if reconfig_yaml["fname"] == k8s_yaml.fname:
                        mod_type = reconfig_yaml["mod_type"]
                        if mod_type == "replace":
                            k8s_yamls.append(File(
                                path=f"{mod_dir}/{reconfig_yaml['fname']}",
                                content=reconfig_yaml["code"],
                                work_dir=mod_dir,
                                fname=k8s_yaml.fname
                            ))
                            is_found = True
                            break
                        elif mod_type == "delete":
                            is_found = True
                            break
                if not is_found:
                    # copy it changing only work_dir
                    k8s_yamls.append(File(
                        path=f"{mod_dir}/{k8s_yaml.fname}",
                        content=k8s_yaml.content,
                        work_dir=mod_dir,
                        fname=k8s_yaml.fname
                    ))
            # new_yamls
            for reconfig_yaml in reconfig_yamls:
                print(reconfig_yaml)
                if reconfig_yaml["mod_type"] == "create":
                    k8s_yamls.append(File(
                        path=f"{mod_dir}/{reconfig_yaml['fname']}",
                        content=reconfig_yaml["code"],
                        work_dir=mod_dir,
                        fname=reconfig_yaml["fname"]
                    ))
            # modify skaffold
            new_skaffold_path = f"{mod_dir}/{input_data.input.skaffold_yaml.fname}"
            new_skaffold_str = render_jinja_template(
                SKAFFOLD_YAML_TEMPLATE_PATH,
                name=f"mod-{mod_count}",
                yaml_paths=list_to_bullet_points([os.sep.join(k8s_yaml_.fname.split("/")[1:]) for k8s_yaml_ in k8s_yamls])
            )
            write_file(new_skaffold_path, new_skaffold_str)

            #----------------------------------------
            # deploy the new project and validate it
            #----------------------------------------
            project_name = "chaos-eater"
            # clean the resouce
            remove_all_resources_by_labels(kube_context, label_selector=f"project={project_name}")
            # deploy the project
            process = subprocess.Popen(
                f"skaffold run --kube-context {kube_context} -l project={project_name}",
                shell=True,
                cwd=os.path.dirname(new_skaffold_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = process.communicate()
            returncode = process.returncode
            error_msg = limit_string_length(stderr.decode('utf-8'))

            # validation
            if returncode == 0:
                break
            error_history.append(error_msg)
            print(error_msg)

            #----------------------------
            # rewrite reconfigured yamls
            #----------------------------
            mod_k8s_yamls = self.debug_reconfig_yamls(
                input_data=input_data,
                hypothesis=hypothesis,
                experiment=experiment,
                k8s_yamls_history=k8s_yamls_history,
                result_history=result_history,
                analysis_history=analysis_history,
                reconfig_history=reconfig_history,
                output_history=output_history,
                error_history=error_history,
                logger=logger
            )

            #-----------------
            # increment count
            #-----------------
            mod_count += 1

        return logger.log, mod_k8s_yamls
    
    def generate_reconfig_yamls(
        self,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        k8s_yamls_history: List[List[File]],
        result_history: List[ChaosExperimentResult],
        analysis_history: List[Analysis],
        reconfig_history: List[ReconfigurationResult],
        logger: LoggingCallback
    ) -> dict:
        #----------------------
        # prompt configuration
        #----------------------
        result_history0 = result_history[0]
        chat_messages = [("system", SYS_RECONFIGURE_K8S_YAML), ("human", USER_RECONFIGURE_K8S_YAML1)]
        for i in range(len(analysis_history)-1):
            if i > 0:
                chat_messages.append(
                    (
                        "human",
                        SYS_REPORT_RESULTS.replace("{mod_experiment_result}", remove_curly_braces(result_history[i].to_str())).replace("{mod_version}", str(i+1)).replace("{mod_k8s_yamls}", file_list_to_str(k8s_yamls_history[i]))
                    )
                )
            chat_messages.append(("ai", AI_ANALYZE_RESULT.replace("{analysis_report}", analysis_history[i].report)))
            chat_messages.append(("human", USER_RECONFIGURE_K8S_YAML2))
            chat_messages.append(("ai", AI_RECONFIGURE_K8S_YAML.replace("{output}", dict_to_str(reconfig_history[i].mod_k8s_yamls))))
        if len(result_history) > 1:
            chat_messages.append(
                (
                    "human", 
                    SYS_REPORT_RESULTS.replace("{mod_experiment_result}", remove_curly_braces(result_history[-1].to_str())).replace("{mod_version}", str(len(result_history))).replace("{mod_k8s_yamls}", file_list_to_str(k8s_yamls_history[-1]))
                )
            )
        chat_messages.append(("ai", remove_curly_braces(AI_ANALYZE_RESULT.replace("{analysis_report}", analysis_history[-1].report))))
        chat_messages.append(("human", USER_RECONFIGURE_K8S_YAML2))
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=chat_messages,
            pydantic_object=ModK8sYAMLs,
            is_async=False
        )

        #--------
        # output
        #--------
        self.message_logger.write("#### Reconfiguration") 
        for response in agent.stream({
            "system_overview": input_data.to_k8s_overview_str(),
            "hypothesis_overview": hypothesis.to_str(),
            "experiment_plan_summary": experiment.plan["summary"],
            "experiment_result": result_history0.to_str()},
            {"callbacks": [logger]}
        ):
            text = ""
            if (thought := response.get("thought")) is not None:
                text += f"{thought}\n"
            if (modified_k8s_yamls := response.get("modified_k8s_yamls")) is not None:
                for i, mod_k8s_yaml in enumerate(modified_k8s_yamls):
                    if (mod_type := mod_k8s_yaml.get("mod_type")) is not None:
                        text += f"Modification_type: `{mod_type}`\n"
                    if (explanation := mod_k8s_yaml.get("explanation")) is not None:
                        text += f"{explanation}\n"
                    if (fname := mod_k8s_yaml.get("fname")) is not None:
                        if (code := mod_k8s_yaml.get("code")) is not None:
                            text += f"```yaml {fname}\n{code}\n```"
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return response
    
    def debug_reconfig_yamls(
        self,
        input_data: ProcessedData,
        hypothesis: Hypothesis,
        experiment: ChaosExperiment,
        k8s_yamls_history: List[List[File]],
        result_history: List[ChaosExperimentResult],
        analysis_history: List[Analysis],
        reconfig_history: List[ReconfigurationResult],
        logger: LoggingCallback,
        output_history: List[dict] = [],
        error_history: List[str] = [],
    ) -> dict:
        #----------------------
        # prompt configuration
        #----------------------
        result_history0 = result_history[0]
        chat_messages = [
            ("system", SYS_RECONFIGURE_K8S_YAML),
            ("human", USER_RECONFIGURE_K8S_YAML1)
        ]
        for i in range(len(analysis_history)-1):
            if i > 0:
                chat_messages.append(
                    (
                        "human",
                        SYS_REPORT_RESULTS.replace("{mod_experiment_result}", result_history[i].to_str()).replace("{mod_version}", str(i+1)).replace("{mod_k8s_yamls}", file_list_to_str(k8s_yamls_history[i]))
                    )
                )
            chat_messages.append(
                (
                    "ai",
                    AI_ANALYZE_RESULT.replace("{analysis_report}", analysis_history[i].report)
                )
            )
            chat_messages.append(("human",USER_RECONFIGURE_K8S_YAML2)
            )
            chat_messages.append(
                (
                    "ai",
                    AI_RECONFIGURE_K8S_YAML.replace("{output}", dict_to_str(reconfig_history[i].mod_k8s_yamls))
                )
            )
        if len(result_history) > 1:
            chat_messages.append(
                (
                    "human", 
                    SYS_REPORT_RESULTS.replace("{mod_experiment_result}", result_history[-1].to_str()).replace("{mod_version}", str(len(result_history))).replace("{mod_k8s_yamls}", file_list_to_str(k8s_yamls_history[-1]))
                )
            )
        chat_messages.append(
            (
                "ai",
                AI_ANALYZE_RESULT.replace("{analysis_report}", analysis_history[-1].report)
            )
        )
        chat_messages.append(("human", USER_RECONFIGURE_K8S_YAML2))
        for output, error in zip(output_history, error_history):
            chat_messages.append(("ai", dict_to_str(output)))
            chat_messages.append(
                (
                    "human",
                    USER_DEBUG_RECONFIGURATEION.replace("{error_message}", error.replace('{', '{{').replace('}', '}}'))
                )
            )
        
        #------------------
        # agent definition
        #------------------
        agent = build_json_agent(
            llm=self.llm,
            chat_messages=chat_messages,
            pydantic_object=ModK8sYAMLs,
            is_async=False
        )

        #--------
        # output
        #--------
        self.message_logger.write("#### Reconfiguration")
        for response in agent.stream({
            "system_overview": input_data.to_k8s_overview_str(),
            "hypothesis_overview": hypothesis.to_str(),
            "experiment_plan_summary": experiment.plan["summary"],
            "experiment_result": result_history0.to_str()},
            {"callbacks": [logger]}
        ):
            text = ""
            if (thought := response.get("thought")) is not None:
                text += f"{thought}\n"
            if (modified_k8s_yamls := response.get("modified_k8s_yamls")) is not None:
                for i, mod_k8s_yaml in enumerate(modified_k8s_yamls):
                    if (mod_type := mod_k8s_yaml.get("mod_type")) is not None:
                        text += f"Modification_type: `{mod_type}`\n"
                    if (explanation := mod_k8s_yaml.get("explanation")) is not None:
                        text += f"{explanation}\n"
                    if (fname := mod_k8s_yaml.get("fname")) is not None:
                        if (code := mod_k8s_yaml.get("code")) is not None:
                            text += f"```yaml {fname}\n{code}\n```"
            self.message_logger.stream(text)
        self.message_logger.stream(text, final=True)
        return response