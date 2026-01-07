.PHONY: setup-sandbox set-mode-sandbox start-sandbox cluster-sandbox
.PHONY: setup-standard set-mode-standard start-standard cluster-standard
.PHONY: reload stop
.PHONY: test test-cov test-watch test-file test-match build-test clean-test
.PHONY: frontend-test frontend-test-watch frontend-test-coverage build-frontend-test clean-frontend-test


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