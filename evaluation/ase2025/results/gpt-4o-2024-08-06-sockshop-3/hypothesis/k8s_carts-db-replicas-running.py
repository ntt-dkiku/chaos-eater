import os
import time
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

v1 = client.AppsV1Api()

def check_carts_db_replicas(namespace='sock-shop', deployment_name='carts-db'):
    try:
        deployment = v1.read_namespaced_deployment(name=deployment_name, namespace=namespace)
        replicas = deployment.status.replicas
        ready_replicas = deployment.status.ready_replicas
        print(f"Total replicas: {replicas}, Ready replicas: {ready_replicas}")
        return ready_replicas == replicas
    except client.exceptions.ApiException as e:
        print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
        return False

def main(duration):
    success_count = 0
    for _ in range(duration):
        if check_carts_db_replicas():
            success_count += 1
        time.sleep(1)
    print(f"Carts-db replicas running successfully for {success_count}/{duration} seconds.")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check carts-db replicas running state.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the state in seconds')
    args = parser.parse_args()
    main(args.duration)
