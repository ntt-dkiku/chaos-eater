import os
import time
from kubernetes import client, config

def check_front_end_replicas(namespace, deployment_name, duration):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.AppsV1Api()
    for _ in range(duration):
        try:
            deployment = v1.read_namespaced_deployment(deployment_name, namespace)
            replicas = deployment.status.replicas
            ready_replicas = deployment.status.ready_replicas
            print(f"Desired replicas: {replicas}, Ready replicas: {ready_replicas}")
        except client.exceptions.ApiException as e:
            print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
        time.sleep(1)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Check front-end replicas')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the replicas')
    args = parser.parse_args()
    check_front_end_replicas('sock-shop', 'front-end', args.duration)