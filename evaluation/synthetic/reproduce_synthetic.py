"""
Reproducibility script for synthetic data evaluation.
Generates synthetic K8s manifests, runs ChaosEater, and generates reviews.
"""
import os
import re
import glob
import argparse
import shutil
import sys

from chaos_eater.utils.llms import load_llm
from chaos_eater.utils.functions import save_json, load_json
from chaos_eater.utils.k8s import remove_all_resources_by_labels
from chaos_eater.utils.schemas import File
from chaos_eater.chaos_eater import ChaosEater, ChaosEaterInput, ChaosEaterOutput
from chaos_eater.ce_tools.ce_tool import CEToolType, CETool
from chaos_eater.backend.cli_logger import CLIMessageLogger
from evaluation.reviewing.reviewer import Reviewer
from evaluation.synthetic.data_generation.data_generator import DataGenerator


DEFAULT_DATA_DIR = "evaluation/synthetic/data"
DEFAULT_OUTPUT_DIR = "evaluation/synthetic/results"
DEFAULT_REVIEWERS = [
    "openai/gpt-4o-2024-08-06",
    # "google/gemini-1.5-pro",  # retired
    "google/gemini-2.5-pro",
    # "anthropic/claude-3-5-sonnet-20240620",  # retired
    "anthropic/claude-sonnet-4-5-20250929"
]

K8S_CONTEXT = "kind-chaos-eater-cluster"


def remove_all_resources_in(namespace: str) -> None:
    """Remove all resources in a namespace."""
    import subprocess
    try:
        subprocess.run(
            ["kubectl", "delete", "all", "--all", "-n", namespace, "--context", K8S_CONTEXT],
            capture_output=True,
            timeout=60
        )
    except Exception:
        pass


def is_binary(file_content: bytes) -> bool:
    return b'\0' in file_content or any(byte > 127 for byte in file_content)


def check_data_exists(data_dir: str, data_type: str) -> bool:
    """Check if dataset exists."""
    target_dir = f"{data_dir}_weak" if data_type == "weak" else data_dir
    pattern = os.path.join(target_dir, "sample*")
    return len(glob.glob(pattern)) > 0


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


def run_data_generation_phase(
    model_name: str,
    data_dir: str,
    data_type: str,
    num_samples: int,
    num_manifests: list[int],
    temperature: float,
    port: int,
    seed: int,
    regenerate: bool
) -> None:
    """Phase 1: Generate synthetic dataset."""
    print("\n" + "=" * 60)
    print("Phase 1: Data Generation")
    print("=" * 60)

    if check_data_exists(data_dir, data_type) and not regenerate:
        print(f"Data already exists in {data_dir}. Skipping generation.")
        print("Use --regenerate_data to regenerate.")
        return

    print(f"Generating synthetic dataset...")
    print(f"  - Output dir: {data_dir}")
    print(f"  - Samples: {num_samples}")
    print(f"  - Manifests: {num_manifests}")

    llm = load_llm(
        model_name=model_name,
        temperature=temperature,
        port=port,
        seed=seed
    )
    generator = DataGenerator(llm)

    # Generate seed dataset
    dataset = generator.generate_dataset(
        num_samples=num_samples,
        num_k8s_manifests_list=num_manifests,
        output_dir=data_dir,
        resume=(not regenerate)
    )

    # Generate weak (vulnerable) dataset
    generator.weaken_dataset(
        num_samples=num_samples,
        num_k8s_manifests_list=num_manifests,
        k8s_applications_list=dataset,
        output_dir=f"{data_dir}_weak",
        resume=(not regenerate)
    )

    print("Data generation complete.")


def load_dataset(dataset_dir: str, experiment_time_limit: int) -> list:
    """Load dataset from directory."""
    pattern = os.path.join(dataset_dir, "sample*")
    sample_dirs = glob.glob(pattern)
    sample_dirs = [d for d in sample_dirs if os.path.isdir(d)]
    sample_dirs.sort()

    dataset = []
    for sample_dir in sample_dirs:
        skaffold_yaml = None
        project_files = []

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
            continue

        dataset.append((
            suffix,
            ChaosEaterInput(
                skaffold_yaml=skaffold_yaml,
                files=project_files,
                ce_instructions=f"The Chaos-Engineering experiment must be completed within {experiment_time_limit} minute(s)."
            )
        ))

    return dataset


def run_chaoseater_phase(
    model_name: str,
    data_dir: str,
    data_type: str,
    output_dir: str,
    num_samples: int,
    experiment_time_limit: int,
    temperature: float,
    port: int,
    seed: int
) -> None:
    """Phase 2: Run ChaosEater on dataset."""
    print("\n" + "=" * 60)
    print("Phase 2: Running ChaosEater")
    print("=" * 60)

    dataset_dir = f"{data_dir}_weak" if data_type == "weak" else data_dir
    print(f"Loading dataset from: {dataset_dir}")

    dataset = load_dataset(dataset_dir, experiment_time_limit)
    print(f"Found {len(dataset)} samples, running {num_samples} times each")

    if not dataset:
        print("No samples found. Please generate data first.")
        return

    llm = load_llm(
        model_name=model_name,
        temperature=temperature,
        port=port,
        seed=seed
    )

    chaoseater = ChaosEater(
        llm=llm,
        ce_tool=CETool.init(CEToolType.chaosmesh),
        message_logger=CLIMessageLogger(),
        work_dir="sandbox",
        namespace="chaos-eater"
    )

    project_name = "chaos-eater"
    os.makedirs(output_dir, exist_ok=True)

    for suffix, ce_input in dataset:
        print(f"\n--- sample{suffix} ---")

        for i in range(1, num_samples + 1):
            result_dir = f"{output_dir}/sample{suffix}-{i}"
            output_json_path = f"{result_dir}/outputs/output.json"

            if os.path.isfile(output_json_path):
                print(f"[sample{suffix}-{i}] Already completed, skipping...")
                continue

            print(f"[sample{suffix}-{i}] Starting ChaosEater run...")

            remove_all_resources_in("chaos-eater")
            remove_all_resources_by_labels(context=K8S_CONTEXT, label_selector=f"project={project_name}")

            try:
                chaoseater.run_ce_cycle(
                    input=ce_input,
                    work_dir=result_dir,
                    project_name=project_name,
                    is_new_deployment=True,
                    kube_context=K8S_CONTEXT
                )
                print(f"[sample{suffix}-{i}] Completed successfully")
            except Exception as e:
                print(f"[sample{suffix}-{i}] Failed: {e}")
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
    """Phase 3: Generate reviews using LLM-as-a-judge."""
    print("\n" + "=" * 60)
    print("Phase 3: Generating Reviews (LLM-as-a-judge)")
    print("=" * 60)

    result_dirs = sorted([
        d for d in os.listdir(output_dir)
        if os.path.isdir(os.path.join(output_dir, d)) and d.startswith("sample")
    ])

    if not result_dirs:
        print("No results found. Please run ChaosEater first.")
        return

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
        description="Synthetic Data Evaluation Script - Generate data, run ChaosEater, and generate reviews"
    )
    # Common options
    parser.add_argument(
        "--model", default="openai/gpt-4o-2024-08-06", type=str,
        help="Model name for data generation and ChaosEater (default: openai/gpt-4o-2024-08-06)"
    )
    parser.add_argument(
        "--data_dir", default=DEFAULT_DATA_DIR, type=str,
        help=f"Directory for synthetic data (default: {DEFAULT_DATA_DIR})"
    )
    parser.add_argument(
        "--output_dir", default=DEFAULT_OUTPUT_DIR, type=str,
        help=f"Output directory for results (default: {DEFAULT_OUTPUT_DIR})"
    )
    parser.add_argument(
        "--temperature", default=0.0, type=float,
        help="Temperature for LLM (default: 0.0)"
    )
    parser.add_argument(
        "--seed", default=42, type=int,
        help="Seed number for LLM (default: 42)"
    )
    parser.add_argument(
        "--port", default=8000, type=int,
        help="Port number for vLLM server (default: 8000)"
    )

    # Data generation options
    parser.add_argument(
        "--num_data_samples", default=5, type=int,
        help="Number of data samples to generate (default: 5)"
    )
    parser.add_argument(
        "--num_manifests", default=[1, 2, 3], nargs='+', type=int,
        help="Number of K8s manifests per sample (default: 1 2 3)"
    )
    parser.add_argument(
        "--data_type", default="weak", choices=["normal", "weak"],
        help="Type of dataset to use (default: weak)"
    )
    parser.add_argument(
        "--regenerate_data", action="store_true",
        help="Regenerate data even if it exists"
    )

    # ChaosEater options
    parser.add_argument(
        "--num_samples", default=5, type=int,
        help="Number of ChaosEater runs per sample (default: 5)"
    )
    parser.add_argument(
        "--experiment_time_limit", default=1, type=int,
        help="Maximum duration of CE experiment in minutes (default: 1)"
    )

    # Review options
    parser.add_argument(
        "--num_review_samples", default=5, type=int,
        help="Number of reviews per reviewer (default: 5)"
    )
    parser.add_argument(
        "--reviewers", default="all", type=str,
        help="Comma-separated list of reviewers or 'all' (default: all)"
    )

    args = parser.parse_args()

    # Parse reviewers
    if args.reviewers == "all":
        reviewers_to_use = DEFAULT_REVIEWERS
    else:
        reviewers_to_use = [r.strip() for r in args.reviewers.split(",")]

    print("=" * 60)
    print("Synthetic Data Evaluation Script")
    print("=" * 60)
    print(f"Model: {args.model}")
    print(f"Data directory: {args.data_dir}")
    print(f"Data type: {args.data_type}")
    print(f"Data samples: {args.num_data_samples}")
    print(f"Manifests per sample: {args.num_manifests}")
    print(f"CE runs per sample: {args.num_samples}")
    print(f"Output directory: {args.output_dir}")
    print(f"Reviews per reviewer: {args.num_review_samples}")
    print(f"Reviewers: {', '.join([r.split('/')[-1] for r in reviewers_to_use])}")
    print("=" * 60)

    # Check if results directory exists
    skip_ce_execution = False
    if os.path.isdir(args.output_dir) and os.listdir(args.output_dir):
        choice = prompt_for_action(args.output_dir)
        if choice == 'o':
            print("Removing existing results...")
            shutil.rmtree(args.output_dir)
        elif choice == 's':
            print("Skipping data generation and ChaosEater execution...")
            skip_ce_execution = True
        else:
            print("Cancelled.")
            sys.exit(1)

    # Phase 1: Generate data
    if not skip_ce_execution:
        run_data_generation_phase(
            model_name=args.model,
            data_dir=args.data_dir,
            data_type=args.data_type,
            num_samples=args.num_data_samples,
            num_manifests=args.num_manifests,
            temperature=args.temperature,
            port=args.port,
            seed=args.seed,
            regenerate=args.regenerate_data
        )

    # Phase 2: Run ChaosEater
    if not skip_ce_execution:
        run_chaoseater_phase(
            model_name=args.model,
            data_dir=args.data_dir,
            data_type=args.data_type,
            output_dir=args.output_dir,
            num_samples=args.num_samples,
            experiment_time_limit=args.experiment_time_limit,
            temperature=args.temperature,
            port=args.port,
            seed=args.seed
        )

    # Phase 3: Generate reviews
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


if __name__ == "__main__":
    main()
