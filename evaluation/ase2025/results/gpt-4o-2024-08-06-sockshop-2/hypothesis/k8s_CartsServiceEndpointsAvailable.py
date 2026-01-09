import os
import time
import argparse
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()

namespace = 'sock-shop'
service_name = 'carts'
deployment_name = 'carts'

# Function to get the number of endpoints
def get_endpoints_count():
    endpoints = v1.read_namespaced_endpoints(service_name, namespace)
    return len(endpoints.subsets[0].addresses) if endpoints.subsets else 0

# Function to get the number of replicas
def get_replicas_count():
    deployment = apps_v1.read_namespaced_deployment(deployment_name, namespace)
    return deployment.status.replicas

# Main function to check the state
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check Carts Service Endpoints Availability')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the state in seconds')
    args = parser.parse_args()

    duration = args.duration
    for _ in range(duration):
        endpoints_count = get_endpoints_count()
        replicas_count = get_replicas_count()
        print(f'Endpoints available: {endpoints_count}, Expected replicas: {replicas_count}')
        time.sleep(1)

    print('Check completed.')