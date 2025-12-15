#!/bin/bash

#--------------------------------
# Determine if running in Docker
#--------------------------------
if [ "${INSIDE_DOCKER}" = "true" ]; then
    echo "Running inside Docker."
    USE_SUDO=""
else
    echo "Running on a local machine."
    USE_SUDO="sudo"
fi

#----------------------
# OS/ARCH detection
#----------------------
OS="$(uname | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
esac
echo "Detected OS: ${OS}, ARCH: ${ARCH}"

#----------------------
# Environment settings
#----------------------
# Install kubectl
if ! command -v kubectl &> /dev/null; then
    echo "Installing kubectl..."
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/${OS}/${ARCH}/kubectl"
    chmod +x ./kubectl
    $USE_SUDO mv ./kubectl /usr/local/bin/kubectl
else
    echo "kubectl is already installed, skipping."
fi

# Install kind
if ! command -v kind &> /dev/null; then
    echo "Installing kind..."
    curl -Lo ./kind "https://kind.sigs.k8s.io/dl/v0.23.0/kind-${OS}-${ARCH}"
    chmod +x ./kind
    $USE_SUDO mv ./kind /usr/local/bin/kind
else
    echo "kind is already installed, skipping."
fi

# Install krew
if ! command -v kubectl-krew &> /dev/null; then
    echo "Installing krew..."
    (
      set -x; cd "$(mktemp -d)" &&
      OS="$(uname | tr '[:upper:]' '[:lower:]')" &&
      ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/\(arm\)\(64\)\?.*/\1\2/' -e 's/aarch64$/arm64/')" &&
      KREW="krew-${OS}_${ARCH}" &&
      curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz" &&
      tar zxvf "${KREW}.tar.gz" &&
      ./"${KREW}" install krew
    )
else
    echo "krew is already installed, skipping."
fi
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

# Install kubectl-graph
if ! kubectl krew list | grep -q "^graph$"; then
    echo "Installing kubectl-graph..."
    kubectl krew install graph
else
    echo "kubectl-graph is already installed, skipping."
fi

# Install skaffold
if ! command -v skaffold &> /dev/null; then
    echo "Installing skaffold..."
    curl -Lo skaffold "https://storage.googleapis.com/skaffold/releases/latest/skaffold-${OS}-${ARCH}"
    chmod +x ./skaffold
    $USE_SUDO mv ./skaffold /usr/local/bin/skaffold
else
    echo "skaffold is already installed, skipping."
fi

#----------
# epilogue
#----------
echo "Environment has been installed successuly!"
