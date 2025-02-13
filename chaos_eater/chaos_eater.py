import os
import time
import subprocess
from typing import List, Dict

import streamlit as st

from .preprocessing.preprocessor import PreProcessor, ChaosEaterInput
from .hypothesis.hypothesizer import Hypothesizer
from .experiment.experimenter import Experimenter
from .analysis.analyzer import Analyzer
from .improvement.improver import Improver
from .postprocessing.postprocessor import PostProcessor, ChaosCycle
from .ce_tools.ce_tool_base import CEToolBase
from .utils.constants import SKAFFOLD_YAML_TEMPLATE_PATH
from .utils.functions import (
    write_file,
    delete_file,
    copy_dir,
    get_timestamp,
    save_json,
    run_command,
    render_jinja_template,
    list_to_bullet_points,
)
from .utils.wrappers import BaseModel, LLM
from .utils.llms import LLMLog, PRICING_PER_TOKEN
from .utils.streamlit import StreamlitDisplayHandler, Spinner
from .utils.k8s import remove_all_resources_by_labels, remove_all_resources_by_namespace
from .utils.schemas import File


class ChaosEaterOutput(BaseModel):
    output_dir: str = ""
    work_dir: str = ""
    logs: Dict[str, List[LLMLog] | List[List[LLMLog]]] = {}
    run_time: Dict[str, float | List[float]] = {}
    ce_cycle: ChaosCycle = ChaosCycle()

def display_usage(logs: List[LLMLog]) -> None:
    if "input_tokens" not in st.session_state:
        st.session_state.input_tokens = 0
    if "output_tokens" not in st.session_state:
        st.session_state.output_tokens = 0
    if "total_tokens" not in st.session_state:
        st.session_state.total_tokens = 0
    UNIT = 1000
    for log in logs:
        usage = log.token_usage
        st.session_state.input_tokens += usage.input_tokens
        st.session_state.output_tokens += usage.output_tokens
        st.session_state.total_tokens += usage.total_tokens
    if "model_name" in st.session_state:
        billing = st.session_state.input_tokens * PRICING_PER_TOKEN[st.session_state.model_name]["input"] + \
                st.session_state.output_tokens * PRICING_PER_TOKEN[st.session_state.model_name]["output"]
        st.session_state.usage.write(f"Total billing: ${billing:.2f}  \nTotal tokens: {st.session_state.total_tokens/UNIT}k  \nInput tokens: {st.session_state.input_tokens/UNIT}k  \nOuput tokens: {st.session_state.output_tokens/UNIT}k")


class ChaosEater:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        work_dir: str = "sandbox",
        namespace: str = "chaos-eater"
    ) -> None:
        # working directories
        self.root_dir = work_dir
        os.makedirs(self.root_dir,  exist_ok=True)
        # working namespace
        self.namespace = namespace
        # llm
        self.llm = llm
        # CE tool
        self.ce_tool = ce_tool
        # agents
        self.preprocessor  = PreProcessor(llm)
        self.hypothesizer  = Hypothesizer(llm, ce_tool)
        self.experimenter  = Experimenter(llm, ce_tool, namespace=namespace)
        self.analyzer      = Analyzer(llm, namespace)
        self.improver      = Improver(llm, ce_tool)
        self.postprocessor = PostProcessor(llm)

    def run_ce_cycle(
        self,
        input: ChaosEaterInput,
        kube_context: str,
        work_dir: str = None,
        project_name: str = "chaos-eater",
        clean_cluster_before_run: bool = True,
        clean_cluster_after_run: bool = True,
        is_new_deployment: bool = True,
        max_num_steadystates: int = 2,
        max_retries: int = 3
    ) -> ChaosEaterOutput:
        st.subheader("Phase 0: Preprocessing", divider="gray")
        # clean the cluster
        spinner = Spinner(f"##### Cleaning the cluster ```{kube_context}```...")
        remove_all_resources_by_namespace(
            kube_context,
            self.namespace,
            display_handler=StreamlitDisplayHandler()
        )
        if clean_cluster_before_run:
            remove_all_resources_by_labels(
                kube_context,
                f"project={project_name}",
                display_handler=StreamlitDisplayHandler()
            )
        spinner.end(f"##### Cleaning the cluster ```{kube_context}```... Done")
        # prepare a working directory
        if work_dir is None:
            work_dir = f"{self.root_dir}/cycle_{get_timestamp()}"
        os.makedirs(work_dir, exist_ok=True)
        # initialization
        output_dir = f"{work_dir}/outputs"
        os.makedirs(output_dir, exist_ok=True)
        ce_output = ChaosEaterOutput(work_dir=work_dir)
        entire_start_time = time.time()

        #-----------------------------------------------------------------
        # 0. preprocessing (input deployment & validation and reflection)
        #-----------------------------------------------------------------
        start_time = time.time()
        preprcess_logs, data = self.preprocessor.process(
            input=input,
            kube_context=kube_context,
            work_dir=work_dir,
            project_name=project_name,
            is_new_deployment=is_new_deployment
        )
        ce_output.run_time["preprocess"] = time.time() - start_time
        ce_output.logs["preprocess"] = preprcess_logs
        ce_output.ce_cycle.processed_data = data
        save_json(f"{output_dir}/output.json", ce_output.dict()) # save intermediate results
        display_usage(preprcess_logs)

        #---------------
        # 1. hypothesis
        #---------------
        st.subheader("Phase 1: Hypothesis", divider="gray")
        start_time = time.time()
        hypothesis_logs, hypothesis = self.hypothesizer.hypothesize(
            data=data,
            kube_context=kube_context,
            work_dir=work_dir,
            max_num_steady_states=max_num_steadystates,
            max_retries=max_retries
        )
        ce_output.run_time["hypothesis"] = time.time() - start_time
        ce_output.logs["hypothesis"] = hypothesis_logs
        ce_output.ce_cycle.hypothesis = hypothesis
        save_json(f"{output_dir}/output.json", ce_output.dict()) # save intermediate results
        display_usage(hypothesis_logs)

        #---------------------
        # 2. Chaos Experiment
        #---------------------
        st.subheader("Phase 2: Chaos Experiment", divider="gray")
        # 2.1. plan a chaos experiment
        start_time = time.time()
        experiment_logs, experiment = self.experimenter.plan_experiment(
            data=data,
            hypothesis=hypothesis,
            work_dir=work_dir
        )
        ce_output.run_time["experiment_plan"] = time.time() - start_time
        ce_output.logs["experiment_plan"] = experiment_logs
        ce_output.ce_cycle.experiment=experiment
        save_json(f"{output_dir}/output.json", ce_output.dict())
        display_usage(experiment_logs)

        #------------------
        # improvement loop
        #------------------
        ce_output.run_time["analysis"] = []
        ce_output.run_time["improvement"] = []
        ce_output.run_time["experiment_execution"] = []
        ce_output.logs["analysis"] = []
        ce_output.logs["improvement"] = []
        mod_k8s_count = 0
        mod_dir = data.work_dir
        k8s_yamls = data.k8s_yamls
        k8s_yamls_history = [k8s_yamls]
        mod_dir_history = [mod_dir]
        while (1):
            # 2.2. conduct the chaos experiment
            start_time = time.time()
            experiment_result = self.experimenter.run(experiment, kube_context=kube_context)
            ce_output.run_time["experiment_execution"].append(time.time() - start_time)
            ce_output.ce_cycle.result_history.append(experiment_result)
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # 
            if experiment_result.all_tests_passed:
                st.write("##### Your k8s yaml already has good resilience!!!")
                break
            
            # set flag
            ce_output.ce_cycle.conducts_reconfig = True
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # mod count checking 
            assert mod_k8s_count < max_retries, f"MAX_MOD_COUNT_EXCEEDED: improvement exceeds the max_retries {max_retries}"

            #-------------
            # 3. analysis
            #-------------
            st.subheader("Phase 3: Analysis", divider="gray")
            start_time = time.time()
            analysis_logs, analysis = self.analyzer.analyze(
                mod_count=mod_k8s_count,
                input_data=data,
                hypothesis=hypothesis,
                experiment=experiment,
                reconfig_history=ce_output.ce_cycle.reconfig_history,
                experiment_result=experiment_result,
                work_dir=work_dir
            )
            ce_output.run_time["analysis"].append(time.time() - start_time)
            ce_output.logs["analysis"].append(analysis_logs)
            ce_output.ce_cycle.analysis_history.append(analysis)
            save_json(f"{output_dir}/output.json", ce_output.dict())
            display_usage(analysis_logs)

            #----------------
            # 4. improvement
            #----------------
            st.subheader("Phase 4: Improvement", divider="gray")
            start_time = time.time()
            reconfig_logs, reconfig = self.improver.reconfigure(
                input_data=data,
                hypothesis=hypothesis,
                experiment=experiment,
                k8s_yamls_history=k8s_yamls_history,
                mod_dir_history=mod_dir_history,
                result_history=ce_output.ce_cycle.result_history,
                analysis_history=ce_output.ce_cycle.analysis_history,
                reconfig_history=ce_output.ce_cycle.reconfig_history,
                kube_context=kube_context,
                work_dir=work_dir,
                max_retries=max_retries
            )
            ce_output.run_time["improvement"].append(time.time() - start_time)
            ce_output.logs["improvement"].append(reconfig_logs)
            ce_output.ce_cycle.reconfig_history.append(reconfig)
            save_json(f"{output_dir}/output.json", ce_output.dict())
            display_usage(reconfig_logs)

            #-------------------------------
            # preparation for the next loop
            # TODO: preprocess again
            #-------------------------------
            # increment counter
            mod_k8s_count += 1

            # clean cluster
            remove_all_resources_by_namespace(kube_context, self.namespace)

            # copy the previous project to the current project dir
            mod_dir_ = f"{output_dir}/mod_{mod_k8s_count}"
            copy_dir(mod_dir, mod_dir_) # duplicate the input project
            mod_dir = mod_dir_
            mod_dir_history.append(mod_dir)

            # modify k8s yamls
            reconfig_yamls = reconfig.mod_k8s_yamls["modified_k8s_yamls"]
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
            k8s_yamls_tmp = []
            # existing yamls
            for k8s_yaml in k8s_yamls:
                is_found = False
                for reconfig_yaml in reconfig_yamls:
                    if reconfig_yaml["fname"] == k8s_yaml.fname:
                        mod_type = reconfig_yaml["mod_type"]
                        if mod_type == "replace":
                            k8s_yamls_tmp.append(File(
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
                    k8s_yamls_tmp.append(File(
                        path=f"{mod_dir}/{k8s_yaml.fname}",
                        content=k8s_yaml.content,
                        work_dir=mod_dir,
                        fname=k8s_yaml.fname
                    ))
            # new_yamls
            for reconfig_yaml in reconfig_yamls:
                print(reconfig_yaml)
                if reconfig_yaml["mod_type"] == "create":
                    k8s_yamls_tmp.append(File(
                        path=f"{mod_dir}/{reconfig_yaml['fname']}",
                        content=reconfig_yaml["code"],
                        work_dir=mod_dir,
                        fname=reconfig_yaml["fname"]
                    ))
            # replace the previous yamls with new yamls
            prev_k8s_yamls = k8s_yamls
            k8s_yamls = k8s_yamls_tmp
            k8s_yamls_history.append(k8s_yamls)

            # modify skaffold
            new_skaffold_path = f"{mod_dir}/{data.input.skaffold_yaml.fname}"
            new_skaffold_str = render_jinja_template(
                SKAFFOLD_YAML_TEMPLATE_PATH,
                name=f"mod-{mod_k8s_count}",
                yaml_paths=list_to_bullet_points([os.sep.join(k8s_yaml_.fname.split("/")[1:]) for k8s_yaml_ in k8s_yamls])
            )
            write_file(new_skaffold_path, new_skaffold_str)

            #-----------------------------------
            # deploy the reconfigured k8s yamls
            #-----------------------------------
            spinner = Spinner(f"##### Deploying reconfigured resources...")
            try:
                run_command(
                    cmd=f"skaffold run --kube-context {kube_context} -l project={project_name}",
                    cwd=os.path.dirname(new_skaffold_path),
                    display_handler=StreamlitDisplayHandler()
                )
            except subprocess.CalledProcessError as e:
                raise RuntimeError("K8s resource deployment failed.")
            spinner.end(f"##### Deploying reconfigured resources... Done")
            st.write("##### Resource statuses")
            run_command(
                cmd=f"kubectl get all --all-namespaces --context {kube_context} --selector=project={project_name}",
                display_handler=StreamlitDisplayHandler()
            )

            #------------------------------------------------------
            # replan the experiment (modify only fault selectorss)
            #------------------------------------------------------
            start_time = time.time()
            experiment_logs, experiment = self.experimenter.replan_experiment(
                prev_k8s_yamls=prev_k8s_yamls,
                prev_experiment=experiment,
                curr_k8s_yamls=k8s_yamls,
                kube_context=kube_context,
                work_dir=work_dir,
                max_retries=max_retries
            )
            ce_output.run_time["experiment_replan"] = time.time() - start_time
            ce_output.logs["experiment_replan"] = experiment_logs
            ce_output.ce_cycle.experiment = experiment
            save_json(f"{output_dir}/output.json", ce_output.dict())
            display_usage(experiment_logs)

        #------------------------------
        # 5. post-processing (summary)
        #------------------------------
        st.subheader("Phase EX: Postprocessing", divider="gray")
        ce_output.ce_cycle.completes_reconfig = True
        save_json(f"{output_dir}/output.json", ce_output.dict())
        # summary
        start_time = time.time()
        summary_logs, summary = self.postprocessor.process(ce_cycle=ce_output.ce_cycle, work_dir=output_dir)
        ce_output.run_time["summary"] = time.time() - start_time
        ce_output.logs["summary"] = summary_logs
        ce_output.ce_cycle.summary = summary
        save_json(f"{output_dir}/output.json", ce_output.dict())
        display_usage(summary_logs)

        #----------
        # epilogue
        #----------
        ce_output.run_time["cycle"] = time.time() - entire_start_time
        ce_output.output_dir = mod_dir
        save_json(f"{output_dir}/output.json", ce_output.dict())
        if clean_cluster_after_run:
            remove_all_resources_by_labels(
                kube_context,
                f"project={project_name}",
                display_handler=StreamlitDisplayHandler()
            )
        return ce_output