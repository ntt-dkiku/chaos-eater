from typing import List

from chaos_eater.utils.llms import load_llm
from chaos_eater.utils.functions import get_timestamp
from evaluation.synthetic.data_generation.data_generator import DataGenerator


def generate_dataset(
    output_dir: str,
    model_name: str,
    temperature: float = 0.0,
    port: int = 8000,
    seed: int = 42,
    num_samples: int = 5,
    num_k8s_manifests_list: List[int] = [1, 2, 3, 4, 5],
    resume: bool = True
) -> None:
    #-----------------------------
    # load llm and data generator
    #-----------------------------
    llm = load_llm(
        model_name=model_name,
        temperature=temperature,
        port=port,
        model_kwargs={"seed": seed}
    )
    generator = DataGenerator(llm)

    #--------------------
    # generate a dataset
    #--------------------
    # generate a seed dateset
    dataset = generator.generate_dataset(
        num_samples=num_samples,
        num_k8s_manifests_list=num_k8s_manifests_list,
        output_dir=output_dir,
        resume=resume
    )
    weak_dataset = generator.weaken_dataset(
        num_samples=num_samples,
        num_k8s_manifests_list=num_k8s_manifests_list,
        k8s_applications_list=dataset,
        output_dir=f"{output_dir}_weak",
        resume=resume
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("-o", "--output_dir", default=f"datasets/dataset_{get_timestamp()}", type=str, help="The path to the dataset")
    parser.add_argument("--model_name", default="openai/gpt-4o-2024-08-06", type=str, choices=["openai/gpt-4o-2024-08-06", "openai/gpt-4o-2024-05-13", "google/gemini-1.5-pro", "anthropic/claude-3-5-sonnet-20240620", "meta-llama/Meta-Llama-3-70B-Instruct"], help="Model name of an LLM")
    parser.add_argument("--temperature", default=0.0, type=float, help="Temperature of the LLM")
    parser.add_argument("--seed", default=42, type=int, help="Seed number of the LLM")
    parser.add_argument("--port", default=8000, type=int, help="Port number of the vLLM server")
    parser.add_argument("--num_samples", default=1, type=int, help="Number of samples")
    parser.add_argument("--num_k8s_manifests_list", default=[1, 2, 3, 4, 5], nargs='+', type=int, help="Number of manifests per sample")
    parser.add_argument("--restart", action="store_true", help="Even if samples already exist in the output_dir, overwrite the samples from scratch.")
    args = parser.parse_args()
    generate_dataset(
        output_dir=args.output_dir,
        model_name=args.model_name,
        temperature=args.temperature,
        port=args.port,
        seed=args.seed,
        num_samples=args.num_samples,
        num_k8s_manifests_list=args.num_k8s_manifests_list,
        resume=(not args.restart)
    )
