import os
import time
import argparse
from kubernetes import client, config

def check_carts_db_replicas(namespace='sock-shop', deployment_name='carts-db', duration=5):
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
            print(f"Total replicas: {replicas}, Ready replicas: {ready_replicas}")
        except client.exceptions.ApiException as e:
            print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
        time.sleep(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check carts-db replicas')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the replicas')
    args = parser.parse_args()
    check_carts_db_replicas(duration=args.duration)
