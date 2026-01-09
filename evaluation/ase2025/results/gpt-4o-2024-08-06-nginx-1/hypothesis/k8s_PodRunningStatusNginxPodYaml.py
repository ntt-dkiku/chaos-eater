import os
import time
from kubernetes import client, config

def check_pod_status(namespace, pod_name, duration):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.CoreV1Api()
    running_count = 0
    for _ in range(duration):
        try:
            pod = v1.read_namespaced_pod(name=pod_name, namespace=namespace)
            if pod.status.phase == 'Running':
                running_count += 1
            print(f"Pod status: {pod.status.phase}")
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
        time.sleep(1)
    print(f"Pod was running {running_count} out of {duration} seconds.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Check the status of a Kubernetes Pod.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the Pod status in seconds.')
    args = parser.parse_args()
    check_pod_status(namespace='default', pod_name='example-pod', duration=args.duration)
