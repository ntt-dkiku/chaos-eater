.PHONY: setup-sandbox set-mode-sandbox start-sandbox cluster-sandbox
.PHONY: setup-standard set-mode-standard start-standard cluster-standard
.PHONY: reload stop redis-flush
.PHONY: test test-cov test-watch test-file test-match build-test clean-test
.PHONY: frontend-test frontend-test-watch frontend-test-coverage build-frontend-test clean-frontend-test
.PHONY: open-jupyter stop-jupyter
.PHONY: eval-ase2025 _eval-ase2025-run


#----------------
# mode selection
#----------------
MODE_FILE := .chaoseater-mode
MODE := $(shell cat $(MODE_FILE) 2>/dev/null || echo sandbox)

set-mode-sandbox:
	echo "sandbox" > $(MODE_FILE)

set-mode-standard:
	echo "standard" > $(MODE_FILE)

#---------------
# gpu detection
#---------------
HAS_NVIDIA := $(shell \
	( command -v nvidia-smi >/dev/null 2>&1 ) && \
	( docker info 2>/dev/null | grep -qi 'NVIDIA' || docker info 2>/dev/null | grep -qi 'nvidia' ) && echo 1 || echo 0 )
GPU ?= $(HAS_NVIDIA)

#--------------
# os detection
#--------------
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Linux)
    OLLAMA_HOST := 172.17.0.1
else
    # Mac/Windows use host.docker.internal
    OLLAMA_HOST := host.docker.internal
endif
export OLLAMA_BASE ?= http://$(OLLAMA_HOST):11434

#--------------
# sandbox mode
#--------------
BASE_SANDBOX   := -f docker/docker-compose.sandbox.yaml
OLLAMA_COMPOSE := -f docker/docker-compose.ollama.yaml
OLLAMA_GPU_COMPOSE := $(if $(filter 1,$(GPU)),-f docker/docker-compose.ollama.nvidia.yaml,)

# run the entire process
setup-sandbox: set-mode-sandbox start-sandbox cluster-sandbox

# Step 1: launch sandbox container
start-sandbox:
	docker compose $(BASE_SANDBOX) $(OLLAMA_COMPOSE) $(OLLAMA_GPU_COMPOSE) up -d
	@echo "Waiting for container to be ready..."
	@sleep 3

# Step 2: create a kind cluster
cluster-sandbox:
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "/app/create_kind_cluster.sh"


#---------------
# standard mode
#---------------
# run the entire process
setup-standard: set-mode-standard start-standard cluster-standard

# Step 1: install environment
# Install dependency tools in local using create_environment.sh. 
# The installed tools include kubectl, kind, krew, kubectl-graph, skaffold.
# Note that tools that are already installed in local will be skipped.
start-standard:
	./create_environment.sh

# Step 2: create a kind cluster
# Create a kind cluster and the ChaosEater container using create_kind_cluster.sh.
# You may change the cluster name and the port number of the ChaosEater app 
# with the the -n,--name <your-favorite-name> and -p,--port <port> options, respectively.
cluster-standard:
	./create_kind_cluster.sh --ollama


#---------------
# reload & stop
#---------------
# reload: rebuild and restart services inside the container
reload:
ifeq ($(MODE),sandbox)
	docker compose $(BASE_SANDBOX) exec chaos-eater \
		bash -c "docker compose -f docker/docker-compose.yaml up --build"
else ifeq ($(MODE),standard)
	docker compose -f docker/docker-compose.yaml up --build
endif

# stop
stop:
ifeq ($(MODE),sandbox)
	docker compose $(BASE_SANDBOX) $(OLLAMA_COMPOSE) $(OLLAMA_GPU_COMPOSE) down
else ifeq ($(MODE),standard)
	docker compose -f docker/docker-compose.yaml down
	kind delete cluster --name chaos-eater-cluster
endif

# flush redis
redis-flush:
ifeq ($(MODE),sandbox)
	@echo "Flushing Redis in sandbox mode..."
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "docker compose -f docker/docker-compose.yaml exec -T redis redis-cli FLUSHDB"
else
	@echo "Flushing Redis in standard mode..."
	docker compose -f docker/docker-compose.yaml exec -T redis redis-cli FLUSHDB
endif
	@echo "Redis flushed successfully."


#--------
# testing
#--------
TEST_COMPOSE := docker compose -f docker/docker-compose.test.yaml

# Run all tests (no coverage for speed)
test:
	@$(TEST_COMPOSE) run --rm test sh -c "uv sync --extra dev && pytest"

# Run all tests with coverage
test-cov:
	@$(TEST_COMPOSE) run --rm test

# Run tests in watch mode
test-watch:
	@$(TEST_COMPOSE) run --rm test-watch

# Run specific test file: make test-file FILE=tests/test_xxx.py
test-file:
ifndef FILE
	$(error FILE is required. Usage: make test-file FILE=tests/test_xxx.py)
endif
	@$(TEST_COMPOSE) run --rm test sh -c "uv sync --extra dev && pytest $(FILE)"

# Run tests matching pattern: make test-match PATTERN=test_parse
test-match:
ifndef PATTERN
	$(error PATTERN is required. Usage: make test-match PATTERN=test_parse)
endif
	@$(TEST_COMPOSE) run --rm test sh -c "uv sync --extra dev && pytest -k '$(PATTERN)'"

# Build test container
build-test:
	@$(TEST_COMPOSE) build

# Clean up test containers
clean-test:
	@$(TEST_COMPOSE) down --rmi local -v


#-----------------
# frontend testing
#-----------------
FRONTEND_TEST_COMPOSE := docker compose -f docker/docker-compose.frontend-test.yaml

# Run frontend tests with coverage
frontend-test:
	@$(FRONTEND_TEST_COMPOSE) run --rm frontend-test

# Run frontend tests in watch mode
frontend-test-watch:
	@$(FRONTEND_TEST_COMPOSE) run --rm frontend-test-watch

# Run frontend tests with coverage report
frontend-test-coverage:
	@$(FRONTEND_TEST_COMPOSE) run --rm frontend-test
	@echo "Coverage report: chaos_eater/frontend/coverage/index.html"

# Build frontend test container
build-frontend-test:
	@$(FRONTEND_TEST_COMPOSE) build

# Clean up frontend test containers
clean-frontend-test:
	@$(FRONTEND_TEST_COMPOSE) down --rmi local -v


#--------------------
# sandbox API testing (sandbox内で実行)
#--------------------
.PHONY: sandbox-test sandbox-test-match

# Run sandbox API tests inside sandbox backend container
# Requires: make setup-sandbox && make reload
sandbox-test:
ifeq ($(MODE),sandbox)
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "\
		docker compose -f docker/docker-compose.yaml exec chaos-eater-backend \
		sh -c 'uv sync --extra dev && CE_SANDBOX_TEST=1 pytest tests/test_sandbox_api.py -v'"
else
	@echo "Error: Sandbox API tests require sandbox mode. Run 'make setup-sandbox' first."
	@exit 1
endif

# Run specific sandbox API test by pattern: make sandbox-test-match PATTERN=test_resume
sandbox-test-match:
ifndef PATTERN
	$(error PATTERN is required. Usage: make sandbox-test-match PATTERN=test_resume)
endif
ifeq ($(MODE),sandbox)
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "\
		docker compose -f docker/docker-compose.yaml exec chaos-eater-backend \
		sh -c 'uv sync --extra dev && CE_SANDBOX_TEST=1 pytest tests/test_sandbox_api.py -v -k \"$(PATTERN)\"'"
else
	@echo "Error: Sandbox API tests require sandbox mode."
	@exit 1
endif


#-----------------
# jupyter notebook
#-----------------
JUPYTER_PORT ?= 8888

open-jupyter:
	@echo "Starting Jupyter Lab on port $(JUPYTER_PORT)..."
	JUPYTER_PORT=$(JUPYTER_PORT) docker compose -f docker/docker-compose.notebook.yaml up

stop-jupyter:
	docker compose -f docker/docker-compose.notebook.yaml down


#---------------------
# Common Evaluation Options
#---------------------
EVAL_MODEL ?= openai/gpt-4o-2024-08-06
EVAL_RUNS ?= 5
EVAL_REVIEWS ?= 5
EVAL_TEMPERATURE ?= 0.0
EVAL_SEED ?= 42
EVAL_PORT ?= 8000
EVAL_REVIEWERS ?= all
EVAL_SYSTEMS ?= all
# EVAL_OUTPUT_DIR can be set to override the default output directory for all evaluations

#---------------------
# ASE2025 evaluation
#---------------------
ASE_OUTPUT_DIR = $(or $(EVAL_OUTPUT_DIR),evaluation/ase2025/results)

# Run ASE2025 evaluation in sandbox
# Usage: make eval-ase2025 [EVAL_MODEL=...] [EVAL_RUNS=...] [EVAL_REVIEWS=...]
eval-ase2025:
	@if docker ps --format '{{.Names}}' | grep -q '^chaos-eater-sandbox$$'; then \
		echo "Sandbox is running. Starting evaluation..."; \
		$(MAKE) _eval-ase2025-run; \
	else \
		echo "Sandbox is not running."; \
		read -p "Start sandbox and run evaluation? [y/N] " confirm; \
		if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
			echo "Starting sandbox..."; \
			$(MAKE) setup-sandbox && $(MAKE) _eval-ase2025-run; \
		else \
			echo "Cancelled."; \
		fi \
	fi

_eval-ase2025-run:
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "\
		docker compose -f docker/docker-compose.yaml exec chaos-eater-backend \
		sh -c 'cd /app && PYTHONPATH=/app uv run python evaluation/ase2025/reproduce_ase2025.py \
			--model \"$(EVAL_MODEL)\" \
			--output_dir \"$(ASE_OUTPUT_DIR)\" \
			--num_samples $(EVAL_RUNS) \
			--num_review_samples $(EVAL_REVIEWS) \
			--temperature $(EVAL_TEMPERATURE) \
			--seed $(EVAL_SEED) \
			--port $(EVAL_PORT) \
			--examples \"$(EVAL_SYSTEMS)\" \
			--reviewers \"$(EVAL_REVIEWERS)\"'"


#---------------------
# Synthetic Evaluation
#---------------------
SYNTH_DATA_DIR ?= evaluation/synthetic/data
SYNTH_OUTPUT_DIR = $(or $(EVAL_OUTPUT_DIR),evaluation/synthetic/results)
SYNTH_NUM_SAMPLES ?= 5
SYNTH_MANIFESTS ?= 1 2 3
SYNTH_DATA_TYPE ?= weak
SYNTH_EXP_TIME ?= 1

.PHONY: eval-synth _eval-synth-run

# Run synthetic data evaluation in sandbox
# Usage: make eval-synth [EVAL_MODEL=...] [EVAL_RUNS=...] [SYNTH_NUM_SAMPLES=...] ...
eval-synth:
	@if docker ps --format '{{.Names}}' | grep -q '^chaos-eater-sandbox$$'; then \
		echo "Sandbox is running. Starting synthetic evaluation..."; \
		$(MAKE) _eval-synth-run; \
	else \
		echo "Sandbox is not running."; \
		read -p "Start sandbox and run evaluation? [y/N] " confirm; \
		if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
			echo "Starting sandbox..."; \
			$(MAKE) setup-sandbox && $(MAKE) _eval-synth-run; \
		else \
			echo "Cancelled."; \
		fi \
	fi

_eval-synth-run:
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "\
		docker compose -f docker/docker-compose.yaml exec chaos-eater-backend \
		sh -c 'cd /app && PYTHONPATH=/app uv run python evaluation/synthetic/reproduce_synthetic.py \
			--model \"$(EVAL_MODEL)\" \
			--data_dir \"$(SYNTH_DATA_DIR)\" \
			--output_dir \"$(SYNTH_OUTPUT_DIR)\" \
			--num_data_samples $(SYNTH_NUM_SAMPLES) \
			--num_samples $(EVAL_RUNS) \
			--num_review_samples $(EVAL_REVIEWS) \
			--num_manifests $(SYNTH_MANIFESTS) \
			--data_type \"$(SYNTH_DATA_TYPE)\" \
			--temperature $(EVAL_TEMPERATURE) \
			--seed $(EVAL_SEED) \
			--port $(EVAL_PORT) \
			--experiment_time_limit $(SYNTH_EXP_TIME) \
			--reviewers \"$(EVAL_REVIEWERS)\"'"

.PHONY: gen-synth-data _gen-synth-data-run

# Generate synthetic data only (no ChaosEater execution or review)
# Usage: make gen-synth-data [EVAL_MODEL=...] [SYNTH_NUM_SAMPLES=...] [SYNTH_MANIFESTS=...] ...
gen-synth-data:
	@if docker ps --format '{{.Names}}' | grep -q '^chaos-eater-sandbox$$'; then \
		echo "Sandbox is running. Starting data generation..."; \
		$(MAKE) _gen-synth-data-run; \
	else \
		echo "Sandbox is not running."; \
		read -p "Start sandbox and generate data? [y/N] " confirm; \
		if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
			echo "Starting sandbox..."; \
			$(MAKE) setup-sandbox && $(MAKE) _gen-synth-data-run; \
		else \
			echo "Cancelled."; \
		fi \
	fi

_gen-synth-data-run:
	docker compose $(BASE_SANDBOX) exec chaos-eater bash -c "\
		docker compose -f docker/docker-compose.yaml exec chaos-eater-backend \
		sh -c 'cd /app && PYTHONPATH=/app uv run python evaluation/synthetic/generate_dataset.py \
			-o \"$(SYNTH_DATA_DIR)\" \
			--model_name \"$(EVAL_MODEL)\" \
			--num_samples $(SYNTH_NUM_SAMPLES) \
			--num_k8s_manifests_list $(SYNTH_MANIFESTS) \
			--temperature $(EVAL_TEMPERATURE) \
			--seed $(EVAL_SEED) \
			--port $(EVAL_PORT)'"