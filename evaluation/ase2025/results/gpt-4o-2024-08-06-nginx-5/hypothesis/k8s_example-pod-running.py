import os
import time
from kubernetes import client, config

def check_pod_status(namespace, pod_name):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.CoreV1Api()
    try:
        pod = v1.read_namespaced_pod(name=pod_name, namespace=namespace)
        return pod.status.phase
    except client.exceptions.ApiException as e:
        print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
        return None

def main(duration):
    namespace = 'default'
    pod_name = 'example-pod'
    running_count = 0
    for _ in range(duration):
        status = check_pod_status(namespace, pod_name)
        if status == 'Running':
            running_count += 1
        time.sleep(1)
    print(f"Pod '{pod_name}' running status checked {duration} times, running count: {running_count}")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check if the pod is running.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds')
    args = parser.parse_args()
    main(args.duration)