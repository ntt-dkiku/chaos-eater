"""
Reproducibility script for ASE2025 paper.
Runs ChaosEater on nginx and sockshop examples (5 times each),
then generates reviews using LLM-as-a-judge.
"""
import os
import sys
import argparse
import shutil

from chaos_eater.utils.llms import load_llm
from chaos_eater.utils.functions import save_json, load_json
from chaos_eater.utils.schemas import File
from chaos_eater.utils.k8s import remove_all_resources_by_labels
from chaos_eater.chaos_eater import ChaosEater, ChaosEaterInput, ChaosEaterOutput
from chaos_eater.ce_tools.ce_tool import CEToolType, CETool
from chaos_eater.reviewing.reviwer import Reviewer


# Example configurations (matching GUI examples)
EXAMPLES = {
    "nginx": {
        "path": "examples/nginx",
        "instructions": "The Chaos-Engineering experiment must be completed within 1 minute."
    },
    "sockshop": {
        "path": "examples/sock-shop-2",
        "instructions": "\n".join([
            "- The Chaos-Engineering experiment must be completed within 1 minute.",
            "- When using k6 in steady-state definition, always select a request URL from the following options (other requests are invalid):",
            "  1. http://front-end.sock-shop.svc.cluster.local/",
            "  2. http://front-end.sock-shop.svc.cluster.local/catalogue?size=10",
            "  3. http://front-end.sock-shop.svc.cluster.local/detail.html?id=<ID>",
            "     Replace <ID> with an available ID: [`03fef6ac-1896-4ce8-bd69-b798f85c6e0b`, `3395a43e-2d88-40de-b95f-e00e1502085b`, `510a0d7e-8e83-4193-b483-e27e09ddc34d`, `808a2de1-1aaa-4c25-a9b9-6612e8f29a38`, `819e1fbf-8b7e-4f6d-811f-693534916a8b`, `837ab141-399e-4c1f-9abc-bace40296bac`, `a0a4f044-b040-410d-8ead-4de0446aec7e`, `d3588630-ad8e-49df-bbd7-3167f7efb246`, `zzz4f044-b040-410d-8ead-4de0446aec7e`]",
            "  4. http://front-end.sock-shop.svc.cluster.local/category/",
            "  5. http://front-end.sock-shop.svc.cluster.local/category?tags=<TAG>",
            "     Replace <TAG> with an available tag: [`magic`, `action`, `blue`, `brown`, `black`, `sport`, `formal`, `red`, `green`, `skin`, `geek`]",
            "  6. http://front-end.sock-shop.svc.cluster.local/basket.html",
        ])
    }
}

DEFAULT_REVIEWERS = [
    "openai/gpt-4o-2024-08-06",
    "google/gemini-1.5-pro",
    "anthropic/claude-3-5-sonnet-20240620"
]


def is_binary(file_content: bytes) -> bool:
    return b'\0' in file_content or any(byte > 127 for byte in file_content)


def load_example_input(example_name: str) -> ChaosEaterInput:
    """Load input files from example directory."""
    example = EXAMPLES[example_name]
    example_path = example["path"]
    instructions = example["instructions"]

    skaffold_yaml = None
    project_files = []

    for root, _, files in os.walk(example_path):
        for entry in files:
            fpath = os.path.join(root, entry)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    file_content = f.read()
                if is_binary(file_content):
                    content = file_content
                else:
                    content = file_content.decode('utf-8')

                fname = os.path.relpath(fpath, example_path)

                if os.path.basename(fpath) == "skaffold.yaml":
                    skaffold_yaml = File(
                        path=fpath,
                        content=content,
                        work_dir=example_path,
                        fname=fname
                    )
                else:
                    project_files.append(File(
                        path=fpath,
                        content=content,
                        work_dir=example_path,
                        fname=fname
                    ))

    return ChaosEaterInput(
        skaffold_yaml=skaffold_yaml,
        files=project_files,
        ce_instructions=instructions
    )


def remove_all_resources_in(namespace: str) -> None:
    """Remove all resources in a namespace."""
    import subprocess
    try:
        subprocess.run(
            ["kubectl", "delete", "all", "--all", "-n", namespace],
            capture_output=True,
            timeout=60
        )
    except Exception:
        pass


def prompt_for_action(results_dir: str) -> str:
    """Prompt user for action when results directory exists."""
    print(f"\nWARNING: {results_dir} directory already exists.\n")
    print("Choose an action:")
    print("  [o] Overwrite - Delete existing results and start fresh")
    print("  [s] Skip CE execution - Keep existing results, only run reviews")
    print("  [c] Cancel - Exit without making changes")
    print()

    while True:
        choice = input("Your choice [o/s/c]: ").strip().lower()
        if choice in ['o', 's', 'c']:
            return choice
        print("Invalid choice. Please enter 'o', 's', or 'c'.")


def run_chaoseater_phase(
    model_name: str,
    output_dir: str,
    num_samples: int,
    seed: int,
    temperature: float,
    port: int,
    examples: list[str]
) -> None:
    """Phase 1: Run ChaosEater on specified examples."""
    print("\n" + "=" * 60)
    print("Phase 1: Running ChaosEater")
    print("=" * 60)

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

    model_name_short = model_name.split('/')[-1]
    project_name = "chaos-eater"
    os.makedirs(output_dir, exist_ok=True)

    for example_name in examples:
        print(f"\n--- {example_name.upper()} ---")
        ce_input = load_example_input(example_name)

        for i in range(1, num_samples + 1):
            result_dir = f"{output_dir}/{model_name_short}-{example_name}-{i}"
            output_json_path = f"{result_dir}/outputs/output.json"

            if os.path.isfile(output_json_path):
                print(f"[{example_name}-{i}] Already completed, skipping...")
                continue

            print(f"[{example_name}-{i}] Starting ChaosEater run...")

            remove_all_resources_in("chaos-eater")
            remove_all_resources_by_labels(label_selector=f"project={project_name}")

            try:
                chaoseater.run_ce_cycle(
                    input=ce_input,
                    work_dir=result_dir,
                    project_name=project_name,
                    is_new_deployment=True
                )
                print(f"[{example_name}-{i}] Completed successfully")
            except Exception as e:
                print(f"[{example_name}-{i}] Failed: {e}")
                if not os.path.exists(output_json_path):
                    os.makedirs(f"{result_dir}/outputs", exist_ok=True)
                    save_json(output_json_path, ChaosEaterOutput().dict())


def run_review_phase(
    output_dir: str,
    num_review_samples: int,
    temperature: float,
    port: int,
    reviewers: list[str]
) -> None:
    """Phase 2: Generate reviews using LLM-as-a-judge."""
    print("\n" + "=" * 60)
    print("Phase 2: Generating Reviews (LLM-as-a-judge)")
    print("=" * 60)

    result_dirs = sorted([
        d for d in os.listdir(output_dir)
        if os.path.isdir(os.path.join(output_dir, d))
    ])

    for dir_name in result_dirs:
        result_dir = os.path.join(output_dir, dir_name)
        output_json_path = os.path.join(result_dir, "outputs", "output.json")

        if not os.path.isfile(output_json_path):
            print(f"\n[{dir_name}] No output.json found, skipping...")
            continue

        print(f"\n[{dir_name}] Processing reviews...")

        result = ChaosEaterOutput(**load_json(output_json_path))

        for reviewer_model in reviewers:
            reviewer_name = reviewer_model.split('/')[-1]
            reviews_dir = os.path.join(result_dir, "reviews")
            os.makedirs(reviews_dir, exist_ok=True)

            # Count existing reviews for this reviewer
            existing_reviews = len([
                f for f in os.listdir(reviews_dir)
                if f.startswith(f"{reviewer_name}_review") and f.endswith(".json")
            ])

            if existing_reviews >= num_review_samples:
                print(f"  - {reviewer_name}: Already completed ({existing_reviews} reviews)")
                continue

            print(f"  - {reviewer_name}: Generating reviews...")

            llm = load_llm(
                model_name=reviewer_model,
                temperature=temperature,
                port=port
            )
            reviewer = Reviewer(llm)

            for i in range(existing_reviews, num_review_samples):
                try:
                    review = reviewer.review(result.ce_cycle)
                    save_json(
                        os.path.join(reviews_dir, f"{reviewer_name}_review{i}.json"),
                        review.dict()
                    )
                except Exception as e:
                    print(f"    Review {i} failed: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="ASE2025 Reproducibility Script - Run ChaosEater and generate reviews"
    )
    parser.add_argument(
        "--model", default="openai/gpt-4o-2024-08-06", type=str,
        help="Model name for ChaosEater (default: openai/gpt-4o-2024-08-06)"
    )
    parser.add_argument(
        "--output_dir", default="evaluation/ase2025/results", type=str,
        help="Output directory for results (default: evaluation/ase2025/results)"
    )
    parser.add_argument(
        "--num_samples", default=5, type=int,
        help="Number of ChaosEater runs per example (default: 5)"
    )
    parser.add_argument(
        "--num_review_samples", default=5, type=int,
        help="Number of reviews per reviewer (default: 5)"
    )
    parser.add_argument(
        "--seed", default=42, type=int,
        help="Seed number for LLM (default: 42)"
    )
    parser.add_argument(
        "--temperature", default=0.0, type=float,
        help="Temperature for LLM (default: 0.0)"
    )
    parser.add_argument(
        "--port", default=8000, type=int,
        help="Port number for vLLM server (default: 8000)"
    )
    parser.add_argument(
        "--examples", default="all", type=str,
        help="Comma-separated list of examples to run (nginx,sockshop) or 'all' (default: all)"
    )
    parser.add_argument(
        "--reviewers", default="all", type=str,
        help="Comma-separated list of reviewers or 'all' (default: all)"
    )

    args = parser.parse_args()

    # Parse examples
    if args.examples == "all":
        examples_to_run = list(EXAMPLES.keys())
    else:
        examples_to_run = [e.strip() for e in args.examples.split(",")]
        invalid = [e for e in examples_to_run if e not in EXAMPLES]
        if invalid:
            print(f"Error: Invalid example(s): {invalid}")
            print(f"Available examples: {list(EXAMPLES.keys())}")
            sys.exit(1)

    # Parse reviewers
    if args.reviewers == "all":
        reviewers_to_use = DEFAULT_REVIEWERS
    else:
        reviewers_to_use = [r.strip() for r in args.reviewers.split(",")]

    print("=" * 60)
    print("ASE2025 Reproducibility Script")
    print("=" * 60)
    print(f"Model: {args.model}")
    print(f"Examples: {', '.join(examples_to_run)}")
    print(f"Samples per example: {args.num_samples}")
    print(f"Reviews per reviewer: {args.num_review_samples}")
    print(f"Reviewers: {', '.join([r.split('/')[-1] for r in reviewers_to_use])}")
    print(f"Output directory: {args.output_dir}")
    print("=" * 60)

    # Check if results directory exists
    skip_ce_execution = False
    if os.path.isdir(args.output_dir):
        choice = prompt_for_action(args.output_dir)
        if choice == 'o':
            print("Removing existing results...")
            shutil.rmtree(args.output_dir)
        elif choice == 's':
            print("Skipping ChaosEater execution, proceeding to review phase...")
            skip_ce_execution = True
        else:
            print("Cancelled.")
            sys.exit(1)

    # Phase 1: Run ChaosEater
    if not skip_ce_execution:
        run_chaoseater_phase(
            model_name=args.model,
            output_dir=args.output_dir,
            num_samples=args.num_samples,
            seed=args.seed,
            temperature=args.temperature,
            port=args.port,
            examples=examples_to_run
        )

    # Phase 2: Generate reviews
    run_review_phase(
        output_dir=args.output_dir,
        num_review_samples=args.num_review_samples,
        temperature=args.temperature,
        port=args.port,
        reviewers=reviewers_to_use
    )

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)
    print(f"Results saved to: {args.output_dir}")
    examples_summary = ", ".join([f"{e}: {args.num_samples}" for e in examples_to_run])
    print(f"  - ChaosEater runs: {args.num_samples * len(examples_to_run)} ({examples_summary})")
    print(f"  - Reviews per result: {len(reviewers_to_use) * args.num_review_samples}")


if __name__ == "__main__":
    main()
