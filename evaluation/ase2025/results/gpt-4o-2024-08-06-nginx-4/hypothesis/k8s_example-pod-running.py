import os
import time
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

v1 = client.CoreV1Api()

def check_pod_status(namespace, pod_name):
    try:
        pod = v1.read_namespaced_pod(name=pod_name, namespace=namespace)
        return pod.status.phase == 'Running'
    except client.exceptions.ApiException as e:
        print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
        return False

def main(duration):
    namespace = 'default'
    pod_name = 'example-pod'
    running_count = 0
    for _ in range(duration):
        if check_pod_status(namespace, pod_name):
            running_count += 1
        time.sleep(1)
    print(f"Pod '{pod_name}' running status checked {duration} times. Running count: {running_count}.")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check if a pod is running.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds.')
    args = parser.parse_args()
    main(args.duration)