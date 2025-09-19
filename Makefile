.PHONY: start setup cluster reload stop

# run the entire process
setup: start cluster

# Step 1: launch sandbox container
start:
	docker compose -f docker/docker-compose.sandbox.yaml up -d
	@echo "Waiting for container to be ready..."
	@sleep 3

# Step 2: create a kind cluster
cluster:
	docker compose -f docker/docker-compose.sandbox.yaml exec chaos-eater bash -c "/app/create_kind_cluster.sh"

# reload: rebuild and restart services inside the container
reload:
	docker compose -f docker/docker-compose.sandbox.yaml exec chaos-eater bash -c "docker compose -f docker/docker-compose.yaml up --build"

# stop
stop:
	docker compose -f docker/docker-compose.sandbox.yaml down