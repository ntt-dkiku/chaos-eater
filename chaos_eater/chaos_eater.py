import os
import time
import json
import subprocess
from typing import List, Dict, Optional

from .preprocessing.preprocessor import PreProcessor, ChaosEaterInput
from .hypothesis.hypothesizer import Hypothesizer
from .experiment.experimenter import Experimenter
from .analysis.analyzer import Analyzer
from .improvement.improver import Improver
from .postprocessing.postprocessor import PostProcessor, ChaosCycle
from .ce_tools.ce_tool_base import CEToolBase
from .utils.constants import SKAFFOLD_YAML_TEMPLATE_PATH
from .utils.wrappers import BaseModel, LLM
from .utils.llms import AgentLogger
from .backend.streaming import FrontEndDisplayHandler
from .utils.k8s import remove_all_resources_by_labels, remove_all_resources_by_namespace
from .utils.schemas import File
from .utils.callbacks import ChaosEaterCallback
from .utils.functions import (
    write_file,
    delete_file,
    copy_dir,
    get_timestamp,
    save_json,
    run_command,
    render_jinja_template,
    list_to_bullet_points,
    MessageLogger
)


class ChaosEaterOutput(BaseModel):
    output_dir: str = ""
    work_dir: str = ""
    run_time: Dict[str, float | List[float]] = {}
    ce_cycle: ChaosCycle = ChaosCycle()


class ChaosEater:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        message_logger: MessageLogger,
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
        # message logger
        self.message_logger = message_logger
        # CE tool
        self.ce_tool = ce_tool
        # agent managers
        self.preprocessor  = PreProcessor(llm, self.message_logger)
        self.hypothesizer  = Hypothesizer(llm, ce_tool, self.message_logger)
        self.experimenter  = Experimenter(llm, ce_tool, message_logger=self.message_logger, namespace=namespace)
        self.analyzer      = Analyzer(llm, self.message_logger, namespace)
        self.improver      = Improver(llm, ce_tool, self.message_logger)
        self.postprocessor = PostProcessor(llm, self.message_logger)

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
        max_retries: int = 3,
        callbacks: List[ChaosEaterCallback] = [],
        resume_from: str = None,
        resume_from_agent: str = None,  # Agent-level resume
        checkpoint: 'ChaosEaterOutput' = None,
        initial_retry_context: Optional[dict] = None,  # For resume with feedback
    ) -> ChaosEaterOutput:
        # Define phase order for resume logic
        PHASE_ORDER = ["preprocess", "hypothesis", "experiment_plan", "experiment", "analysis", "improvement", "postprocess"]

        def should_skip_phase(phase: str) -> bool:
            """Check if a phase should be skipped based on resume_from"""
            if not resume_from:
                return False
            try:
                resume_idx = PHASE_ORDER.index(resume_from)
                phase_idx = PHASE_ORDER.index(phase)
                return phase_idx < resume_idx
            except ValueError:
                return False

        def get_agent_callbacks():
            """Get agent start/end callbacks from ChaosEaterCallbacks"""
            def on_agent_start(agent_name: str):
                for cb in callbacks:
                    if hasattr(cb, 'on_agent_start'):
                        cb.on_agent_start(agent_name)

            def on_agent_end(agent_name: str, result=None) -> dict:
                response = {"action": "approve", "message": None}
                for cb in callbacks:
                    if hasattr(cb, 'on_agent_end'):
                        cb_response = cb.on_agent_end(agent_name, result)
                        # Handle both dict and legacy string returns
                        if isinstance(cb_response, dict):
                            cb_action = cb_response.get("action", "approve")
                            cb_message = cb_response.get("message")
                        else:
                            cb_action = cb_response
                            cb_message = None
                        # 'retry' or 'cancel' takes precedence over 'approve'
                        if cb_action in ('retry', 'cancel'):
                            response = {"action": cb_action, "message": cb_message}
                        elif cb_action == 'approve' and cb_message:
                            # Capture approve + message for feedback accumulation
                            response["message"] = cb_message
                return response

            return on_agent_start, on_agent_end

        #----------------
        # initialization
        #----------------
        # prepare a working directory
        if work_dir is None:
            work_dir = f"{self.root_dir}/cycle_{get_timestamp()}"
        os.makedirs(work_dir, exist_ok=True)
        output_dir = f"{work_dir}/outputs"
        os.makedirs(output_dir, exist_ok=True)

        # Initialize or restore from checkpoint
        if checkpoint:
            ce_output = checkpoint
        else:
            ce_output = ChaosEaterOutput(work_dir=work_dir)

        agent_logger = AgentLogger(
            llm=self.llm,
            log_path=f"{work_dir}/logs/agent_log.jsonl",
        )
        entire_start_time = time.time()

        # Restore intermediate data from checkpoint if available
        data = ce_output.ce_cycle.processed_data if checkpoint else None
        hypothesis = ce_output.ce_cycle.hypothesis if checkpoint else None
        experiment = ce_output.ce_cycle.experiment if checkpoint else None

        # Get agent callbacks for all phases
        on_agent_start, on_agent_end = get_agent_callbacks()

        #-----------------------------------------------------------------
        # 0. preprocessing (input deployment & validation and reflection)
        #-----------------------------------------------------------------
        if not should_skip_phase("preprocess"):
            # Determine if we're resuming within this phase
            preprocess_resume_agent = resume_from_agent if resume_from == "preprocess" else None

            if not preprocess_resume_agent:
                # Normal start - show phase header (skip on resume to avoid duplicate display)
                self.message_logger.subheader("Phase 0: Preprocessing", divider="gray")

            # Trigger callback
            for cb in callbacks:
                if hasattr(cb, 'on_preprocess_start'):
                    cb.on_preprocess_start()

            # Only clean cluster if not resuming within this phase
            if not preprocess_resume_agent:
                # clean the cluster
                self.message_logger.write(f"##### Cleaning the cluster: `{kube_context}`")
                remove_all_resources_by_namespace(
                    kube_context,
                    self.namespace,
                    display_handler=FrontEndDisplayHandler(self.message_logger)
                )
                if clean_cluster_before_run:
                    remove_all_resources_by_labels(
                        kube_context,
                        f"project={project_name}",
                        display_handler=FrontEndDisplayHandler(self.message_logger)
                    )

            start_time = time.time()
            # Pass initial_retry_context only when resuming in this phase
            phase_retry_context = initial_retry_context if resume_from == "preprocess" else None
            data = self.preprocessor.process(
                input=input,
                kube_context=kube_context,
                work_dir=work_dir,
                project_name=project_name,
                is_new_deployment=is_new_deployment if not preprocess_resume_agent else False,
                agent_logger=agent_logger,
                resume_from_agent=preprocess_resume_agent,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
                initial_retry_context=phase_retry_context,
            )
            ce_output.run_time["preprocess"] = time.time() - start_time
            ce_output.ce_cycle.processed_data = data
            save_json(f"{output_dir}/output.json", ce_output.dict())

            for cb in callbacks:
                if hasattr(cb, 'on_preprocess_end'):
                    cb.on_preprocess_end(data)

        #---------------
        # 1. hypothesis
        #---------------
        if not should_skip_phase("hypothesis"):
            # Determine if we're resuming within this phase
            hypothesis_resume_agent = resume_from_agent if resume_from == "hypothesis" else None

            if not hypothesis_resume_agent:
                # Normal start - show phase header (skip on resume to avoid duplicate display)
                self.message_logger.subheader("Phase 1: Hypothesis", divider="gray")

            for cb in callbacks:
                if hasattr(cb, 'on_hypothesis_start'):
                    cb.on_hypothesis_start()

            start_time = time.time()
            phase_retry_context = initial_retry_context if resume_from == "hypothesis" else None
            hypothesis = self.hypothesizer.hypothesize(
                data=data,
                kube_context=kube_context,
                work_dir=work_dir,
                max_num_steady_states=max_num_steadystates,
                max_retries=max_retries,
                agent_logger=agent_logger,
                resume_from_agent=hypothesis_resume_agent,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
                initial_retry_context=phase_retry_context,
            )
            ce_output.run_time["hypothesis"] = time.time() - start_time
            ce_output.ce_cycle.hypothesis = hypothesis
            save_json(f"{output_dir}/output.json", ce_output.dict())

            for cb in callbacks:
                if hasattr(cb, 'on_hypothesis_end'):
                    cb.on_hypothesis_end(hypothesis)

        #---------------------
        # 2. Chaos Experiment
        #---------------------
        if not should_skip_phase("experiment_plan"):
            # Determine if we're resuming within this phase
            experiment_resume_agent = resume_from_agent if resume_from == "experiment_plan" else None

            if not experiment_resume_agent:
                # Normal start - show phase header (skip on resume to avoid duplicate display)
                self.message_logger.subheader("Phase 2: Chaos Experiment", divider="gray")

            for cb in callbacks:
                if hasattr(cb, 'on_experiment_plan_start'):
                    cb.on_experiment_plan_start()

            start_time = time.time()
            phase_retry_context = initial_retry_context if resume_from == "experiment_plan" else None
            experiment = self.experimenter.plan_experiment(
                data=data,
                hypothesis=hypothesis,
                work_dir=work_dir,
                agent_logger=agent_logger,
                resume_from_agent=experiment_resume_agent,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
                initial_retry_context=phase_retry_context,
            )
            ce_output.run_time["experiment_plan"] = time.time() - start_time
            ce_output.ce_cycle.experiment = experiment
            save_json(f"{output_dir}/output.json", ce_output.dict())

            for cb in callbacks:
                if hasattr(cb, 'on_experiment_plan_end'):
                    cb.on_experiment_plan_end(experiment)

        #------------------
        # improvement loop
        #------------------
        # Initialize or restore loop state
        if not ce_output.run_time.get("analysis"):
            ce_output.run_time["analysis"] = []
        if not ce_output.run_time.get("improvement"):
            ce_output.run_time["improvement"] = []
        if not ce_output.run_time.get("experiment_execution"):
            ce_output.run_time["experiment_execution"] = []

        # Determine if we're resuming within the experiment phase
        experiment_resume_agent = resume_from_agent if resume_from == "experiment" else None

        mod_k8s_count = len(ce_output.ce_cycle.reconfig_history) if checkpoint else 0
        mod_dir = data.work_dir
        k8s_yamls = data.k8s_yamls
        k8s_yamls_history = [k8s_yamls]
        mod_dir_history = [mod_dir]
        while (1):
            # 2.2. conduct the chaos experiment
            # Trigger experiment start callback
            for cb in callbacks:
                if hasattr(cb, 'on_experiment_start'):
                    cb.on_experiment_start()

            start_time = time.time()
            phase_retry_context = initial_retry_context if resume_from == "experiment" else None
            experiment_result = self.experimenter.run(
                experiment=experiment,
                kube_context=kube_context,
                work_dir=work_dir,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
                resume_from_agent=experiment_resume_agent,
                initial_retry_context=phase_retry_context,
            )
            # Clear resume_from_agent and retry_context after first iteration
            experiment_resume_agent = None
            initial_retry_context = None  # Prevent reuse in loop
            ce_output.run_time["experiment_execution"].append(time.time() - start_time)
            ce_output.ce_cycle.result_history.append(experiment_result)
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # Trigger experiment end callback
            for cb in callbacks:
                if hasattr(cb, 'on_experiment_end'):
                    cb.on_experiment_end()

            # check if the hypothesis is satisfied
            if experiment_result.all_tests_passed:
                self.message_logger.write("### Your k8s yaml already has good resilience!!!")
                break

            # set flag
            ce_output.ce_cycle.conducts_reconfig = True
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # mod count checking
            assert mod_k8s_count < max_retries, f"MAX_MOD_COUNT_EXCEEDED: improvement exceeds the max_retries {max_retries}"

            #-------------
            # 3. analysis
            #-------------
            # Trigger analysis start callback
            for cb in callbacks:
                if hasattr(cb, 'on_analysis_start'):
                    cb.on_analysis_start()

            self.message_logger.subheader("Phase 3: Analysis", divider="gray")
            start_time = time.time()
            analysis = self.analyzer.analyze(
                mod_count=mod_k8s_count,
                input_data=data,
                hypothesis=hypothesis,
                experiment=experiment,
                reconfig_history=ce_output.ce_cycle.reconfig_history,
                experiment_result=experiment_result,
                work_dir=work_dir,
                agent_logger=agent_logger,
                on_agent_start=on_agent_start,
                on_agent_end=on_agent_end,
            )
            ce_output.run_time["analysis"].append(time.time() - start_time)
            ce_output.ce_cycle.analysis_history.append(analysis)
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # Trigger analysis end callback
            for cb in callbacks:
                if hasattr(cb, 'on_analysis_end'):
                    cb.on_analysis_end(analysis)

            #----------------
            # 4. improvement
            #----------------
            # Trigger improvement start callback
            for cb in callbacks:
                if hasattr(cb, 'on_improvement_start'):
                    cb.on_improvement_start()

            self.message_logger.subheader("Phase 4: Improvement", divider="gray")
            start_time = time.time()
            reconfig = self.improver.reconfigure(
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
                max_retries=max_retries,
                agent_logger=agent_logger
            )
            ce_output.run_time["improvement"].append(time.time() - start_time)
            ce_output.ce_cycle.reconfig_history.append(reconfig)
            save_json(f"{output_dir}/output.json", ce_output.dict())

            # Trigger improvement end callback
            for cb in callbacks:
                if hasattr(cb, 'on_improvement_end'):
                    cb.on_improvement_end(reconfig)

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
            self.message_logger.write(f"##### Deploying reconfigured resources")
            try:
                run_command(
                    cmd=f"skaffold run --kube-context {kube_context} -l project={project_name}",
                    cwd=os.path.dirname(new_skaffold_path),
                    display_handler=FrontEndDisplayHandler(self.message_logger)
                )
            except subprocess.CalledProcessError as e:
                raise RuntimeError("K8s resource deployment failed.")
            self.message_logger.write("##### Resource statuses")
            run_command(
                cmd=f"kubectl get all --all-namespaces --context {kube_context} --selector=project={project_name}",
                display_handler=FrontEndDisplayHandler(self.message_logger)
            )

            #------------------------------------------------------
            # replan the experiment (modify only fault selectorss)
            #------------------------------------------------------
            start_time = time.time()
            experiment = self.experimenter.replan_experiment(
                prev_k8s_yamls=prev_k8s_yamls,
                prev_experiment=experiment,
                curr_k8s_yamls=k8s_yamls,
                kube_context=kube_context,
                work_dir=work_dir,
                max_retries=max_retries,
                agent_logger=agent_logger
            )
            ce_output.run_time["experiment_replan"] = time.time() - start_time
            ce_output.ce_cycle.experiment = experiment
            save_json(f"{output_dir}/output.json", ce_output.dict())

        #------------------------------
        # 5. post-processing (summary)
        #------------------------------
        self.message_logger.subheader("Phase EX: Postprocessing", divider="gray")
        ce_output.ce_cycle.completes_reconfig = True
        save_json(f"{output_dir}/output.json", ce_output.dict())
        # summary
        start_time = time.time()
        summary = self.postprocessor.process(
            ce_cycle=ce_output.ce_cycle,
            work_dir=output_dir,
            agent_logger=agent_logger,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )
        ce_output.run_time["summary"] = time.time() - start_time
        ce_output.ce_cycle.summary = summary
        save_json(f"{output_dir}/output.json", ce_output.dict())

        #----------
        # epilogue
        #----------
        ce_output.run_time["cycle"] = time.time() - entire_start_time
        ce_output.output_dir = mod_dir
        save_json(f"{output_dir}/output.json", ce_output.dict())
        self.message_logger.save(f"{output_dir}/message_log.pkl")
        if clean_cluster_after_run:
            remove_all_resources_by_labels(
                kube_context,
                f"project={project_name}",
                display_handler=FrontEndDisplayHandler(self.message_logger)
            )
        return ce_output