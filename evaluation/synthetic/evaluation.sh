#!/bin/bash

dataset_dir="datasets/dataset"
result_dir="results/result"
seed_model="openai/gpt-4o-2024-08-06"
models=("openai/gpt-4o-2024-08-06") # "google/gemini-1.5-pro" "anthropic/claude-3-5-sonnet-20240620")
reviewers=("openai/gpt-4o-2024-08-06" "google/gemini-1.5-pro" "anthropic/claude-3-5-sonnet-20240620")
data_types=("weak") # ""
num_samples=1
num_k8s_manifests=2 # (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

#--------------------
# generate a dataset
#--------------------
# python evaluation/synthetic/generate_dataset.py --output_dir "${dataset_dir}" \
#                            --model_name "${seed_model}" \
#                            --num_samples "${num_samples}" \
#                            --num_k8s_manifests "${num_k8s_manifests}" \

#------------------------------------
# evaluate ChaosEater on the dataset
#------------------------------------
# for model in "${models[@]}"
# do
#   model_name=$(basename "${model}")
#   model_suffix="_${model_name}"
#   for suffix in "_weak"
#   do
#     python evaluation/synthetic/evaluate_metrics.py --dataset_dir "${dataset_dir}${suffix}" \
#                                             --output_dir "${result_dir}${model_suffix}${suffix}" \
#                                             --model_name "${model}"
#   done
# done

#--------------------------------------------------------
# review the ChaosEater outputs by LLMs (LLM-as-a-judge)
#--------------------------------------------------------
for reviewer in "${reviewers[@]}"
do
  for model in "${models[@]}"
  do
    model_name=$(basename "${model}")
    model_suffix="_${model_name}"
    for suffix in "_${data_types[@]}"
    do
      python evaluation/reviewing/evaluate_quality.py --result_dir "${result_dir}${model_suffix}${suffix}" \
                                             --model_name "${reviewer}" \
                                             --uses_cache
    done
  done
done
