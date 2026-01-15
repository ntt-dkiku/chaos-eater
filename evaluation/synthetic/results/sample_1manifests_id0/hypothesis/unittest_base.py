import os
from kubernetes import client, config

class K8sAPIBase:
    def __init__(self):
        # Load Kubernetes configuration based on the environment
        if os.getenv('KUBERNETES_SERVICE_HOST'):
            config.load_incluster_config()
        else:
            config.load_kube_config()

        # Create a Kubernetes API client
        self.v1 = client.CoreV1Api()