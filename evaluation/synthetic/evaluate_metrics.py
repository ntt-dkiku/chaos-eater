import os
import re
import glob

from chaos_eater.utils.llms import load_llm
from chaos_eater.utils.functions import get_timestamp, load_jsonl, save_jsonl, save_json, load_json, remove_all_resources_in
from chaos_eater.utils.k8s import remove_all_resources_by_labels
from chaos_eater.utils.schemas import File
from chaos_eater.chaos_eater import ChaosEater, ChaosEaterInput, ChaosEaterOutput
from chaos_eater.ce_tools.ce_tool import CEToolType, CETool


def is_binary(file_content) -> str:
    return b'\0' in file_content or any(byte > 127 for byte in file_content)

def evaluate(
    dataset_dir: str,
    output_dir: str,
    model_name: str,
    temperature: float = 0.0,
    port: int = 8000,
    seed: int = 42,
    experiment_time_limit: int = 5,
    resume: bool = True,
    uses_dataset_cache: bool = False
) -> None:
    #----------------
    # load a dataset
    #----------------
    converted_dataset_path = os.path.join(dataset_dir, "dataset_cache.jsonl")
    if uses_dataset_cache and os.path.isfile(converted_dataset_path): # load the chache
        dataset = load_jsonl(converted_dataset_path)
    else:
        # find samples
        pattern = os.path.join(dataset_dir, "sample*")
        sample_dirs = glob.glob(pattern)
        sample_dirs = [d for d in sample_dirs if os.path.isdir(d)]
        sample_dirs.sort()
        # add samples to a dataset
        dataset = []
        project_files = []
        for sample_dir in sample_dirs:
            for root, _, files in os.walk(sample_dir):    
                for entry in files:
                    fpath = os.path.join(root, entry)
                    if os.path.isfile(fpath):
                        with open(fpath, "rb") as f:
                            file_content = f.read()
                        if is_binary(file_content):
                            content = file_content
                        else:
                            content = file_content.decode('utf-8')
                        # add a file
                        work_dir = f"{dataset_dir}/{fpath.removeprefix(dataset_dir).split('/')[1]}"
                        fname = fpath.removeprefix(f"{work_dir}/")
                        if os.path.basename(fpath) == "skaffold.yaml":
                            skaffold_yaml = File(
                                path=fpath,
                                content=content,
                                work_dir=work_dir,
                                fname=fname
                            )
                        else:
                            project_files.append(File(
                                    path=fpath,
                                    content=content,
                                    work_dir=work_dir,
                                    fname=fname
                            ))
            match = re.search(r'sample(.+)', os.path.basename(sample_dir))
            if match:
                suffix = match.group(1)
            else:
                assert False

            dataset.append((
                suffix,
                ChaosEaterInput(
                    skaffold_yaml=skaffold_yaml,
                    files=project_files,
                    ce_instructions=f"The Chaos-Engineering experiment must be completed within {experiment_time_limit} minute(s)."
                ).dict()
            ))
        # save the cache
        save_jsonl(converted_dataset_path, dataset)

    #-------------------------
    # load llm and ChaosEater 
    #-------------------------
    llm = load_llm(
        model_name=model_name, 
        temperature=temperature,
        port=port,
        model_kwargs={"seed": seed}
    )
    chaoseater = ChaosEater(
        llm=llm,
        ce_tool=CETool.init(CEToolType.chaosmesh),
        work_dir="sandbox",
        namespace="chaos-eater"
    )

    #------------
    # evaluation
    #------------
    project_name = "chaos-eater"
    os.makedirs(output_dir, exist_ok=True)
    for suffix, data in dataset:
        save_path = f"{output_dir}/result{suffix}.json"
        # skip samples already evaluated
        if resume: 
            if os.path.isfile(save_path):
                print(f"sample{suffix} was skipped")
                continue
        
        print(f"Evaluating sample{suffix} in {dataset_dir}")
        # clean resources
        remove_all_resources_in("chaos-eater")
        remove_all_resources_by_labels(label_selector=f"project={project_name}")
        # run ChaosEater
        input = ChaosEaterInput(**data)
        work_dir = f"{output_dir}/output{suffix}"
        try:
            output = chaoseater.run_ce_cycle(
                input=input,
                work_dir=work_dir,
                project_name=project_name,
                is_new_deployment=True
            )
            save_json(save_path, output.dict())
        except Exception as e:
            print(f"CE cycle failed: {e}")
            ce_output_path = f"{work_dir}/outputs/output.json"
            if os.path.exists(ce_output_path):
                ce_output = ChaosEaterOutput(**load_json(ce_output_path))
            else:
                ce_output = ChaosEaterOutput()
            save_json(save_path, ce_output.dict())


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset_dir", type=str, help="The path to the dataset")
    parser.add_argument("--output_dir", type=str, help="The path to the output")
    parser.add_argument("--model_name", default="openai/gpt-4o-2024-08-06", type=str, choices=["openai/gpt-4o-2024-08-06", "openai/gpt-4o-2024-05-13", "google/gemini-1.5-pro", "anthropic/claude-3-5-sonnet-20240620", "meta-llama/Meta-Llama-3-70B-Instruct"], help="Model name of an LLM")
    parser.add_argument("--temperature", default=0.0, type=float, help="Temperature of the LLM")
    parser.add_argument("--seed", default=42, type=int, help="Seed number of the LLM")
    parser.add_argument("--port", default=8000, type=int, help="Port number of the vLLM server")
    parser.add_argument("--experiment_time_limit", default=1, type=int, help="The maximum duration of the Chaos-Engineering experiment")
    parser.add_argument("--uses_dataset_cache", action="store_true", help="Whether to use the dataset cache")
    parser.add_argument("--restart", action="store_true", help="Evaluate all samaples (including already evaluated ones) from scratch.")
    args = parser.parse_args()
    evaluate(
        dataset_dir=args.dataset_dir,
        output_dir=args.output_dir,
        model_name=args.model_name,
        temperature=args.temperature,
        port=args.port,
        seed=args.seed,
        experiment_time_limit=args.experiment_time_limit,
        resume=(not args.restart),
        uses_dataset_cache=args.uses_dataset_cache
    )