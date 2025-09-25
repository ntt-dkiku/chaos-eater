#!/bin/bash

#------------------
# parameters
#------------------
CLUSTER_NAME="chaos-eater-cluster"
OLLAMA="False"

#-----------------
# analyze options
#-----------------
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -n|--name) CLUSTER_NAME="$2"; shift 2;;
        -l|--ollama) OLLAMA="True"; shift 1;;
        *) echo "Unknown parameter passed: $1"; exit 1;;
    esac
done

#------------------
# cluster settings
#------------------
echo "Constructing kind clusters..."
# Create the kind cluster with our configuration, replacing the environment variable "PWD" with the root dir
envsubst < k8s/kind_config.yaml | kind create cluster --config=- --name "${CLUSTER_NAME}"
# Check if kind cluster creation was successful
if [ $? -ne 0 ]; then
    echo "Failed to create the kind cluster."
    exit 1
fi

#------------------
# kubectl commands
#------------------
# Switch to the created cluster's context
kubectl config use-context kind-${CLUSTER_NAME}

# Create namespace "chaos-eater"
kubectl create namespace chaos-eater

# Deploy pv/pvc
kubectl apply -f k8s/pv.yaml
kubectl apply -f k8s/pvc.yaml

# Grant superuser authorization to the "default" service account in the "chaos-eater" namespace
kubectl apply -f k8s/super_user_role_binding.yaml

# Enable `kubectl top` by deploying the metrics-server
kubectl apply -n kube-system -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

#-----------------------------
# Build & load a docker image
#-----------------------------
# build and load the docker image for k8s api pod used by ChaosEater
docker build -t chaos-eater/k8sapi:1.0 -f docker/Dockerfile_k8sapi .
kind load docker-image chaos-eater/k8sapi:1.0 --name ${CLUSTER_NAME}

#------------
# Chaos Mesh
#------------
curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm repo update
# NOTE (authentication problem): https://chaos-mesh.org/docs/manage-user-permissions/#enable-or-disable-permission-authentication
helm install chaos-mesh chaos-mesh/chaos-mesh --namespace chaos-mesh --create-namespace --set chaosDaemon.runtime=containerd --set chaosDaemon.socketPath=/run/containerd/containerd.sock --set dashboard.create=true --version 2.6.3 --set dashboard.securityMode=false
# Function to check if chaos-dashboard is running
check_chaos_dashboard() {
    kubectl get pods -n chaos-mesh -l app.kubernetes.io/component=chaos-dashboard -o jsonpath='{.items[0].status.phase}' 2>/dev/null
}
# Wait for chaos-dashboard to be running
echo "Waiting for chaos-dashboard to be ready..."
while [[ "$(check_chaos_dashboard)" != "Running" ]]; do
    echo "Waiting for chaos-dashboard to be ready..."
    sleep 5
done

echo "Chaos dashboard is ready. Starting port-forward..."
# Enable Chaos Mesh dashboard via port-forwarding in the background
nohup kubectl port-forward -n chaos-mesh svc/chaos-dashboard 2333:2333 --address 0.0.0.0 &
# Get the PID of the background port-forward process
PORT_FORWARD_PID=$!
# Print the background job information and the PID
echo "Chaos Mesh dashboard is being port-forwarded at http://localhost:2333 in the background."
echo "To stop the port-forward process, use: kill ${PORT_FORWARD_PID}"

#-----------------------------------
# launch ollama server if requested
#-----------------------------------
docker compose -f docker/docker-compose.yaml up --build

# if [ "${OLLAMA}" = "True" ]; then
#     echo "Starting Ollama container..."
#     docker run -d \
#         --name ollama \
#         -p 11434:11434 \
#         -v ollama_data:/root/.ollama \
#         ollama/ollama:latest
# fi

#----------
# epilogue
#----------
echo "A kind cluster named '${CLUSTER_NAME}' has been created successuly!"