import os
import re
import glob
import yaml
from typing import List

import kubernetes_validate

from .llm_agents.generate_seed_k8s_manifests import K8sAppGenerationAgent, K8sApplication
from .llm_agents.weaken_seed_k8s_manifests import K8sAppVulnerabilityAgent, WeakK8sApplication
from chaos_eater.utils.wrappers import LLM
from chaos_eater.utils.functions import load_json, save_json, write_file, list_to_bullet_points, render_jinja_template, sanitize_filename
from chaos_eater.utils.constants import SKAFFOLD_YAML_TEMPLATE_PATH, K8S_VALIDATION_VERSION


class DataGenerator:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm
        self.data_generation_agent = K8sAppGenerationAgent(llm)
        self.data_vul_agent = K8sAppVulnerabilityAgent(llm)
    
    def generate_dataset(
        self,
        num_samples: int,
        num_k8s_manifests_list: List[int],
        output_dir: str,
        resume: bool = True,
        max_loop_margin: int = 5
    ) -> List[List[K8sApplication]]:
        k8s_applications_list = []
        for num_k8s_manifests in num_k8s_manifests_list:
            k8s_applications = []
            prefix = f"sample_{num_k8s_manifests}manifests_id"
            if resume:
                pattern = os.path.join(output_dir, f"{prefix}*")
                sample_dirs = glob.glob(pattern)
                sample_dirs = [d for d in sample_dirs if os.path.isdir(d)]
                sample_dirs.sort()
                for sample_dir in sample_dirs:
                    k8s_application = K8sApplication(**load_json(f"{sample_dir}/application_cache.json"))
                    k8s_applications.append(k8s_application)

            loop_count = 0
            while (len(k8s_applications) < num_samples):
                assert loop_count < num_samples + max_loop_margin, f"Exceed max_loop_count: {num_samples + max_loop_margin}"
                loop_count += 1

                #-------------------
                # generate a sample
                #-------------------
                # generate a k8s application
                k8s_application = self.data_generation_agent.generate_k8s_manifests(
                    num_k8s_manifests=num_k8s_manifests,
                    generation_history=k8s_applications
                )
                # validate the k8s manifests
                if len(k8s_application.k8s_manifests) != num_k8s_manifests:
                    continue
                is_valid = True
                for k8s_manifest in k8s_application.k8s_manifests:
                    k8s_manifest_dict = yaml.safe_load(k8s_manifest.content)
                    try:
                        kubernetes_validate.validate(k8s_manifest_dict, K8S_VALIDATION_VERSION)
                    except kubernetes_validate.ValidationError as e:
                        is_valid = False
                        break
                if not is_valid:
                    continue

                #-----------------
                # save the sample
                #-----------------
                number = len(k8s_applications)
                sample_dir = f"{output_dir}/{prefix}{number}" 
                os.makedirs(sample_dir, exist_ok=True)
                # save README
                write_file(f"{sample_dir}/README.md", f"# {k8s_application.title}  \n{k8s_application.description}")
                # save project
                project_dir = f"{sample_dir}/{sanitize_filename(k8s_application.title)}"
                os.makedirs(project_dir, exist_ok=True)
                # save manifests
                yaml_paths = []
                for k8s_manifest in k8s_application.k8s_manifests:
                    path = f"{project_dir}/{k8s_manifest.file_name}"
                    os.makedirs(os.path.dirname(path), exist_ok=True) # support cases like "nginx/sample.yaml"
                    write_file(path, k8s_manifest.content)
                    yaml_paths.append(k8s_manifest.file_name)
                # save skaffold.yaml
                write_file(
                    f"{project_dir}/skaffold.yaml",
                    render_jinja_template(
                        SKAFFOLD_YAML_TEMPLATE_PATH,
                        name=f"sample{number}",
                        yaml_paths=list_to_bullet_points(yaml_paths)
                    )
                )
                save_json(f"{sample_dir}/application_cache.json", k8s_application.dict())
                k8s_applications.append(k8s_application)
            k8s_applications_list.append(k8s_applications)
        return k8s_applications_list

    def weaken_dataset(
        self,
        num_samples: int,
        num_k8s_manifests_list: List[int],
        k8s_applications_list: List[List[K8sApplication]],
        output_dir: str,
        resume: bool = True,
        max_mod_loop: int = 5
    ) -> List[List[WeakK8sApplication]]:
        weak_applications_list = []
        for num_k8s_manifests, k8s_applications in zip(num_k8s_manifests_list, k8s_applications_list):
            weak_applications = []
            prefix = f"sample_{num_k8s_manifests}manifests_id"
            if resume:
                pattern = os.path.join(output_dir, f"{prefix}*")
                sample_dirs = glob.glob(pattern)
                sample_dirs = [d for d in sample_dirs if os.path.isdir(d)]
                sample_dirs.sort()
                manifest_ids = []
                for sample_dir in sample_dirs:
                    weak_application = WeakK8sApplication(**load_json(f"{sample_dir}/application_cache.json"))
                    weak_applications.append(weak_application)
                    match = re.search(rf'{prefix}(\d+)', sample_dir)
                    if match:
                        manifest_ids.append(int(match.group(1)))
                all_ids = [i for i in range(num_samples)]
                not_generated_ids = list(set(all_ids) - set(manifest_ids))
            else:
                not_generated_ids = [i for i in range(num_samples)]

            for id in not_generated_ids:
                k8s_application = k8s_applications[id]
                #-------------------
                # weaken the sample
                #-------------------
                weak_application = self.data_vul_agent.weaken_k8s_manifests(k8s_application)
                # validate the k8s manifests
                is_added_deleted = False
                if len(weak_application.k8s_manifests) != len(k8s_application.k8s_manifests):
                    is_added_deleted = True
                is_valid = True
                for k8s_manifest in k8s_application.k8s_manifests:
                    k8s_manifest_dict = yaml.safe_load(k8s_manifest.content)
                    try:
                        kubernetes_validate.validate(k8s_manifest_dict, K8S_VALIDATION_VERSION)
                    except kubernetes_validate.ValidationError as e:
                        is_valid = False
                        break
                if not is_valid or is_added_deleted:
                    continue

                #------------------------
                # save the k8s manifests
                #-------------------------
                number = len(weak_applications)
                sample_dir = f"{output_dir}/{prefix}{number}" 
                os.makedirs(sample_dir, exist_ok=True)
                # save README
                write_file(f"{sample_dir}/README.md", f"# {weak_application.title}  \n{weak_application.description}")
                # save the project
                project_dir = f"{sample_dir}/{sanitize_filename(weak_application.title)}"
                os.makedirs(project_dir, exist_ok=True)
                # save manifests
                yaml_paths = []
                for k8s_manifest in weak_application.k8s_manifests:
                    path = f"{project_dir}/{k8s_manifest.file_name}"
                    os.makedirs(os.path.dirname(path), exist_ok=True) # support cases like "nginx/sample.yaml"
                    write_file(path, k8s_manifest.content)
                    yaml_paths.append(k8s_manifest.file_name)
                # save skaffold.yaml
                write_file(
                    f"{project_dir}/skaffold.yaml",
                    render_jinja_template(
                        SKAFFOLD_YAML_TEMPLATE_PATH,
                        name=f"sample{number}",
                        yaml_paths=list_to_bullet_points(yaml_paths)
                    )
                )
                save_json(f"{sample_dir}/application_cache.json", weak_application.dict())
                weak_applications.append(weak_application)
            weak_applications_list.append(weak_applications)
        return weak_applications_list