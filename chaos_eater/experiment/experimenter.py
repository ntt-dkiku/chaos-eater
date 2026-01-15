import os
import yaml
import json
import time
from typing import Dict, List, Optional, Callable, Any

from .llm_agents.experiment_plan_agent import ExperimentPlanAgent
from .llm_agents.experiment_replan_agent import ExperimentRePlanAgent
from .algorithms.plan2workflow_converter import Plan2WorkflowConverter
from ..preprocessing.preprocessor import ProcessedData
from ..hypothesis.hypothesizer import Hypothesis
from ..ce_tools.ce_tool_base import CEToolBase
from ..utils.schemas import File
from ..utils.wrappers import LLM, BaseModel
from ..utils.llms import AgentLogger
from ..utils.agent_runner import AgentRunner, AgentStep
from ..utils.functions import (
    type_cmd,
    save_json,
    limit_string_length,
    MessageLogger
)


CHAOS_EXPERIMENT_PLAN_TEMPALTE = """\
The entire time schedule of the Chaos-Engineering experiment is as follows (The experiment is divided into three phases: pre-validation, fault-injection, and post-validation phases):
{time_schedule_description}
- Total experiment phase: {total_time}
- Pre-validation phase: {pre_validation_time}
- Fault-injection phase: {fault_injection_time}
- Post-validation phase: {post_validation_time}

The details of the three phases are as follows:
Pre-validation Phase ({pre_validation_time}):
{pre_validation_description}

Fault-injection Phase ({fault_injection_time}):
{fault_injection_description}

Post-validation Phase ({post_validation_time}):
{post_validation_description}

The summary of the above experiment plan:
{summary}

To automatically conduct the above experiment plan with {ce_tool_name}, the following {ce_tool_workflow_file} was created (by applying it to the cluster, the experiment plan will be automatically executed according to the {ce_tool_workflow_file}):
```yaml
{workflow_file}
```"""


class ChaosExperiment(BaseModel):
    plan: dict
    workflow_name: str
    workflow: File

    def to_str(self):
        time_schedule = self.plan["time_schedule"]
        pre_validation = self.plan["pre_validation"]
        fault_injection = self.plan["fault_injection"]
        post_validation = self.plan["post_validation"]
        return CHAOS_EXPERIMENT_PLAN_TEMPALTE.format(
            total_time=time_schedule["total_time"],
            pre_validation_time=time_schedule["pre_validation_time"],
            fault_injection_time=time_schedule["fault_injection_time"],
            post_validation_time=time_schedule["post_validation_time"],
            time_schedule_description=time_schedule["thought"],
            pre_validation_description=pre_validation["thought"],
            fault_injection_description=fault_injection["thought"],
            post_validation_description=post_validation["thought"],
            ce_tool_name="Chaos Mesh",
            ce_tool_workflow_file="Chaos-Mesh-Worfklow file",
            workflow_file=self.workflow.content,
            summary=self.plan["summary"]
        )


class Status(BaseModel):
    exitcode: int
    logs: str

class ChaosExperimentResult(BaseModel):
    pod_statuses: Dict[str, Status]

    @property
    def all_tests_passed(self) -> bool:
        return sum([pod_status.exitcode for pod_status in self.pod_statuses.values()]) == 0

    def to_str(self) -> str:
        passed_tests = [workflow_name for workflow_name, pod_status in self.pod_statuses.items() if pod_status.exitcode == 0]
        failed_tests = [(workflow_name, pod_status.logs) for workflow_name, pod_status in self.pod_statuses.items() if pod_status.exitcode != 0]
        passed_tests_str = "\n".join([f"- {item}" for item in passed_tests]) 
        failed_tests_str = "\n".join([f"- {item[0]}\n```log\n{limit_string_length(item[1], max_length=1000)}\n```\n" for item in failed_tests])
        return f"Passed unittests:\n{passed_tests_str}\nFailed unittests:\n{failed_tests_str}"


class Experimenter:
    def __init__(
        self,
        llm: LLM,
        ce_tool: CEToolBase,
        message_logger: MessageLogger,
        test_dir: str = "sandbox/unit_test",
        chaos_dir: str = "sandbox/",
        namespace: str = "chaos-eater",
    ) -> None:
        # llm
        self.llm = llm
        # CE tool
        self.ce_tool = ce_tool
        # message logger
        self.message_logger = message_logger
        # params
        self.test_dir = test_dir
        self.chaos_dir = chaos_dir
        self.namespace = namespace
        self.experiment_plan = None
        self.workflow = None
        # agents
        self.experiment_plan_agent = ExperimentPlanAgent(
            llm=llm,
            ce_tool=ce_tool,
            message_logger=message_logger,
            test_dir=test_dir,
            namespace=namespace)
        self.experiment_replan_agent = ExperimentRePlanAgent(
            llm=llm,
            ce_tool=ce_tool,
            message_logger=message_logger,
            test_dir=test_dir,
            namespace=namespace
        )
        # algortihms
        self.plan2workflow_converter = Plan2WorkflowConverter()

    def plan_experiment(
        self,
        data: ProcessedData,
        hypothesis: Hypothesis,
        work_dir: str,
        agent_logger: Optional[AgentLogger] = None,
        resume_from_agent: Optional[str] = None,
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
        initial_retry_context: Optional[dict] = None,
    ) -> ChaosExperiment:
        # prepare a working directory
        experiment_dir = f"{work_dir}/experiment"
        checkpoint_dir = f"{work_dir}/checkpoints"
        os.makedirs(experiment_dir, exist_ok=True)

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="experiment_plan",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Plan the experiment
        runner.add_step(AgentStep(
            name="experiment_plan_agent",
            run_fn=lambda retry_context=None: self._run_experiment_plan(data, hypothesis, experiment_dir, agent_logger, retry_context),
            output_key="experiment_plan",
        ))

        # Step 2: Convert to workflow (no retry_context needed for algorithmic conversion)
        runner.add_step(AgentStep(
            name="plan2workflow_converter",
            run_fn=lambda experiment_plan, retry_context=None: self._run_plan2workflow(experiment_plan, experiment_dir),
            output_key="workflow_result",
            depends_on=["experiment_plan"],
        ))

        # Run all agents (with resume support)
        results = runner.run(
            resume_from_agent=resume_from_agent,
            initial_retry_context=initial_retry_context,
        )

        # Build chaos experiment from results
        chaos_experiment = ChaosExperiment(
            plan=results["experiment_plan"],
            workflow_name=results["workflow_result"]["workflow_name"],
            workflow=results["workflow_result"]["workflow"]
        )
        save_json(f"{experiment_dir}/experiment.json", chaos_experiment.dict())
        return chaos_experiment

    def _run_experiment_plan(
        self,
        data: ProcessedData,
        hypothesis: Hypothesis,
        experiment_dir: str,
        agent_logger: Optional[AgentLogger],
        retry_context: Optional[dict] = None
    ) -> dict:
        """Run experiment plan agent."""
        experiment_plan = self.experiment_plan_agent.plan(
            data=data,
            hypothesis=hypothesis,
            agent_logger=agent_logger,
            retry_context=retry_context
        )
        save_json(f"{experiment_dir}/experiment_plan.json", experiment_plan.dict())
        return experiment_plan.dict()

    def _run_plan2workflow(
        self,
        experiment_plan: dict,
        experiment_dir: str
    ) -> dict:
        """Convert plan to workflow."""
        workflow_name, workflow = self.plan2workflow_converter.convert(
            experiment_plan,
            experiment_dir
        )
        return {"workflow_name": workflow_name, "workflow": workflow}

    def replan_experiment(
        self,
        prev_k8s_yamls: List[File],
        prev_experiment: ChaosExperiment,
        curr_k8s_yamls: List[File],
        kube_context: str,
        work_dir: str,
        max_retries: int = 3,
        agent_logger: Optional[AgentLogger] = None
    ) -> ChaosExperiment:
        # prepare a working directory
        experiment_dir = f"{work_dir}/experiment"
        os.makedirs(experiment_dir, exist_ok=True)

        #----------------------------------------------------------
        # 1. replan a CE experiment with the steady state and faults
        #----------------------------------------------------------
        experiment_replan = self.experiment_replan_agent.replan(
            prev_k8s_yamls,
            prev_experiment,
            curr_k8s_yamls,
            kube_context,
            work_dir=work_dir,
            max_retries=max_retries,
            agent_logger=agent_logger
        )

        #-----------------------------------------------------------
        # 2. convert the plan into the format of a specific CE tool 
        #-----------------------------------------------------------
        workflow_name, workflow = self.plan2workflow_converter.convert(
            experiment_replan.dict(),
            experiment_dir
        )

        chaos_experiment = ChaosExperiment(
            plan=experiment_replan.dict(),
            workflow_name=workflow_name,
            workflow=workflow
        )
        return chaos_experiment

    def run(
        self,
        experiment: ChaosExperiment,
        kube_context: str,
        work_dir: str,
        namespace: str = None,
        check_interval: int = 5,  # sec
        on_agent_start: Optional[Callable[[str], None]] = None,
        on_agent_end: Optional[Callable[[str, Any], None]] = None,
        resume_from_agent: Optional[str] = None,
        initial_retry_context: Optional[dict] = None,
    ) -> ChaosExperimentResult:
        if namespace is None:
            namespace = self.namespace

        checkpoint_dir = f"{work_dir}/checkpoints"

        #-----------------------------------------
        # Run agents using AgentRunner
        #-----------------------------------------
        runner = AgentRunner(
            phase="experiment",
            checkpoint_dir=checkpoint_dir,
            on_agent_start=on_agent_start,
            on_agent_end=on_agent_end,
        )

        # Step 1: Run the experiment
        runner.add_step(AgentStep(
            name="experiment_runner",
            run_fn=lambda: self._run_experiment_execution(
                experiment, kube_context, namespace, check_interval
            ),
            output_key="experiment_result",
        ))

        # Run all agents (with resume support)
        results = runner.run(
            resume_from_agent=resume_from_agent,
            initial_retry_context=initial_retry_context,
        )

        return results["experiment_result"]

    def _run_experiment_execution(
        self,
        experiment: ChaosExperiment,
        kube_context: str,
        namespace: str,
        check_interval: int
    ) -> ChaosExperimentResult:
        """Execute the chaos experiment workflow and collect results."""
        #-----------------------------------
        # run the valid chaos workflow
        #-----------------------------------
        self.message_logger.stream("#### Running the experiment... See http://localhost:2333 for more details.")
        # self.ce_tool.run_experiment() # TODO
        # reset the experiment
        type_cmd(f"kubectl delete --context {kube_context} -n {namespace} -f {experiment.workflow.path} --ignore-not-found")
        type_cmd(f'kubectl delete workflownode --context {kube_context} -n {namespace} --selector="chaos-mesh.org/workflow={experiment.workflow_name}" --ignore-not-found')
        type_cmd(f'kubectl delete po --context {kube_context} -n {namespace} --selector="chaos-mesh.org/workflow={experiment.workflow_name}" --ignore-not-found')
        # run the experiment
        type_cmd(f"kubectl apply --context {kube_context} -n {namespace} -f {experiment.workflow.path}")
        self.message_logger.iframe("http://localhost:2333/#/workflows")

        #--------------------------
        # wait for workflow to end
        #--------------------------
        workflow_running = True
        while(workflow_running):
            # is_running = self.ce_tool.status_check() # TODO
            # https://chaos-mesh.org/docs/check-workflow-status/
            entry_node_name = type_cmd(f'kubectl get workflownode --context {kube_context} -n {namespace} --selector="chaos-mesh.org/workflow={experiment.workflow_name}" -o custom-columns=:metadata.name | grep "^the-entry"', widget=False)
            entry_node_name = entry_node_name.strip()
            json_res = json.loads(type_cmd(f"kubectl get workflownode {entry_node_name} --context {kube_context} -n {namespace} -o json", widget=False))
            conditions = json_res["status"]["conditions"]
            status_accomplished = next((c["status"] for c in conditions if c["type"] == "Accomplished"), None)
            workflow_running = (status_accomplished == "False")
            time.sleep(check_interval)
        self.message_logger.stream("#### Completed the chaos experiment!", final=True)

        #-----------------------
        # organize the resullts
        #-----------------------
        yaml_dict = yaml.safe_load(experiment.workflow.content)
        prefixes = (
            "pre-unittest-",
            "fault-unittest-",
            "post-unittest-"
        )
        pod_prefixes= []
        for elm in yaml_dict["spec"]["templates"]:
            if elm["name"].startswith(prefixes):
                pod_prefixes.append(elm["name"])
        # get pod names
        pod_names = [
            type_cmd(f'kubectl get pod -o custom-columns=:metadata.name --context {kube_context} -n {namespace} --selector="chaos-mesh.org/workflow={experiment.workflow_name}" | grep "{pod_prefix + "-"}"').strip()
            for pod_prefix in pod_prefixes
        ]
        missed_idx =  [i for i, x in enumerate(pod_names) if x == ""]
        pod_names = list(filter(None, pod_names)) # If experiment exceeds deadline, we cannot find the pod
        assert len(pod_prefixes) == len(pod_names), f"WORKFLOW_DEADLINE_EXCEEDED: {len(pod_prefixes) - len(pod_names)} task(s) missed due to deadline exceeding.\nMissed task(s): {[pod_prefixes[idx] for idx in missed_idx]}"
        # get status
        pod_statuses = {}
        for pod_prefix, pod_name in zip(pod_prefixes, pod_names):
            pod_statuses[pod_prefix] = self.get_pod_status(
                pod_name=pod_name,
                kube_context=kube_context,
                namespace=namespace
            )
        return ChaosExperimentResult(
            pod_statuses=pod_statuses,
        )

    def get_pod_status(
        self,
        pod_name: str,
        kube_context: str,
        namespace: str
    ) -> Status:
        logs = type_cmd(f"kubectl logs {pod_name} --context {kube_context} -n {namespace}", widget=False)
        summary = type_cmd(f"kubectl get pod {pod_name} --context {kube_context} -n {namespace} -o json")
        # check container status
        pod_info = json.loads(summary)
        container_statuses = pod_info.get("status", {}).get("containerStatuses", [])
        assert len(container_statuses) > 0, f"Cannot find containerStatuses in the json summary: {container_statuses}."
        for container_status in container_statuses:
            state = container_status.get("state", {})
            terminated = state.get("terminated")
            if terminated:
                return Status(exitcode=int(terminated.get("exitCode")), logs=limit_string_length(logs))