import os
import re
import glob

from chaos_eater.utils.llms import load_llm
from chaos_eater.utils.functions import save_json, load_json
from chaos_eater.chaos_eater import ChaosEaterOutput
from evaluation.reviewing.reviewer import Reviewer


def evaluate_cecycle_by_llms(
    result_dir: str,
    model_name: str,
    temperature: float = 0.0,
    num_review_samples = 10,
    port: int = 8000,
    seed: int = None,
    uses_cache: bool = False
) -> None:
    #-----------------
    # load the result
    #-----------------
    result = ChaosEaterOutput(**load_json(f"{result_dir}/outputs/output.json"))

    #-------------------------
    # load llm and reviewer
    #-------------------------
    llm = load_llm(
        model_name=model_name,
        temperature=temperature,
        port=port,
        seed=seed
    )
    reviewer = Reviewer(llm)

    #------------
    # evaluation
    #------------
    model_name_ = model_name.split('/')[-1]
    os.makedirs(f"{result_dir}/reviews", exist_ok=True)
    if uses_cache:
        pattern_ = re.compile(rf'{re.escape(model_name_)}_review\d+\.json')
        offset = 0
        for file_name in os.listdir(f"{result_dir}/reviews"):
            if pattern_.match(file_name):
                offset += 1
    else:
        offset = 0
    for i in range(num_review_samples):
        print(f"sample #{i+1}")
        if result.ce_cycle.completes_reconfig:
            review = reviewer.review(result.ce_cycle)
            review_dict = review.dict()
        else:
            raise ValueError("The input cycle did not perform any system reconfiguration. Input one that does.")
        save_json(f"{result_dir}/reviews/{model_name_}_review{i+offset}.json", review_dict)

def evaluate_cecycles_by_llms(
    result_dir: str,
    model_name: str,
    temperature: float = 0.0,
    num_review_samples = 10,
    port: int = 8000,
    seed: int = None,
    uses_cache: bool = False
) -> None:
    #--------------
    # load results
    #--------------
    # find results
    pattern = os.path.join(result_dir, "gpt-4o*")
    result_paths = glob.glob(pattern)
    result_paths.sort()
    # add results to test
    for path in result_paths:
        print(path)
        evaluate_cecycle_by_llms(
            result_dir=path,
            model_name=model_name,
            temperature=temperature,
            num_review_samples=num_review_samples,
            port=port,
            seed=seed,
            uses_cache=uses_cache
        )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--result_dir", default="dataset", type=str, help="The path to the dataset")
    parser.add_argument("--model_name", default="openai/gpt-4o-2024-08-06", type=str, choices=["openai/gpt-4o-2024-08-06", "openai/gpt-4o-2024-05-13", "google/gemini-1.5-pro", "anthropic/claude-3-5-sonnet-20240620", "meta-llama/Meta-Llama-3-70B-Instruct"], help="Model name of an LLM")
    parser.add_argument("--temperature", default=0.0, type=float, help="Temperature of the LLM")
    parser.add_argument("--num_review_samples", default=5, type=int, help="The number of review samples. The reviews are repeated this number of times under the same settings.")
    parser.add_argument("--seed", default=None, type=int, help="Seed number of the LLM")
    parser.add_argument("--port", default=8000, type=int, help="Port number of the vLLM server")
    parser.add_argument("--uses_cache", action="store_true", help="Whether to use the dataset cache")
    args = parser.parse_args()
    evaluate_cecycles_by_llms(
        result_dir=args.result_dir,
        model_name=args.model_name,
        temperature=args.temperature,
        num_review_samples=args.num_review_samples,
        port=args.port,
        seed=args.seed,
        uses_cache=args.uses_cache
    )
