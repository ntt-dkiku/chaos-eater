import os
import time
import argparse
from kubernetes import client, config

def check_front_end_replicas(namespace, deployment_name, duration):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.AppsV1Api()
    ready_replicas_count = 0

    for _ in range(duration):
        resp = v1.read_namespaced_deployment_status(deployment_name, namespace)
        ready_replicas = resp.status.ready_replicas or 0
        print(f"Ready replicas for {deployment_name}: {ready_replicas}")
        if ready_replicas >= 1:
            ready_replicas_count += 1
        time.sleep(1)

    print(f"{deployment_name} was ready {ready_replicas_count}/{duration} times.")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check front-end replicas')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the replicas')
    args = parser.parse_args()
    check_front_end_replicas('sock-shop', 'front-end', args.duration)
