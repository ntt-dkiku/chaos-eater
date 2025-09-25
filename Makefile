.PHONY: setup-sandbox set-mode-sandbox start-sandbox cluster-sandbox
.PHONY: setup-standard set-mode-standard start-standard cluster-standard
.PHONY: reload stop


#----------------
# mode selection
#----------------
MODE_FILE := .chaoseater-mode
MODE := $(shell cat $(MODE_FILE) 2>/dev/null || echo sandbox)

set-mode-sandbox:
	echo "sandbox" > $(MODE_FILE)

set-mode-standard:
	echo "standard" > $(MODE_FILE)


#--------------
# sandbox mode
#--------------
# run the entire process
setup-sandbox: set-mode-sandbox start-sandbox cluster-sandbox

# Step 1: launch sandbox container
start-sandbox:
	docker compose -f docker/docker-compose.sandbox.yaml up -d
	@echo "Waiting for container to be ready..."
	@sleep 3

# Step 2: create a kind cluster
cluster-sandbox:
	docker compose -f docker/docker-compose.sandbox.yaml exec chaos-eater bash -c "/app/create_kind_cluster.sh"


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
	./create_kind_cluster.sh


#---------------
# reload & stop
#---------------
# reload: rebuild and restart services inside the container
reload:
ifeq ($(MODE),sandbox)
	docker compose -f docker/docker-compose.sandbox.yaml exec chaos-eater \
		bash -c "docker compose -f docker/docker-compose.yaml up --build"
else ifeq ($(MODE),standard)
	docker compose -f docker/docker-compose.yaml up --build
endif

# stop
stop:
ifeq ($(MODE),sandbox)
	docker compose -f docker/docker-compose.sandbox.yaml down
else ifeq ($(MODE),standard)
	docker compose -f docker/docker-compose.yaml down
	kind delete cluster --name chaos-eater-cluster
endif