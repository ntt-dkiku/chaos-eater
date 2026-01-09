import os
import time
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

v1 = client.AppsV1Api()

def check_carts_db_pod_count(namespace, expected_count):
    pod_count = 0
    try:
        resp = v1.read_namespaced_deployment(name='carts-db', namespace=namespace)
        pod_count = resp.status.replicas
    except client.exceptions.ApiException as e:
        print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
    return pod_count

def main(duration):
    namespace = 'sock-shop'
    expected_count = 2
    for _ in range(duration):
        pod_count = check_carts_db_pod_count(namespace, expected_count)
        print(f"Current 'carts-db' pod count: {pod_count}")
        if pod_count == expected_count:
            print("Pod count matches expected count.")
        else:
            print("Pod count does not match expected count.")
        time.sleep(1)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check carts-db pod count.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod count in seconds')
    args = parser.parse_args()
    main(args.duration)
