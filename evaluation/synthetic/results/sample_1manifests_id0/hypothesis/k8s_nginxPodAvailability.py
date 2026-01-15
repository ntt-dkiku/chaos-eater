import os
import time
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

def check_pod_availability(duration):
    v1 = client.CoreV1Api()
    namespace = 'default'
    pod_name = 'nginx-pod'
    running_count = 0
    for _ in range(duration):
        try:
            pod = v1.read_namespaced_pod(name=pod_name, namespace=namespace)
            if pod.status.phase == 'Running':
                running_count += 1
            print(f"Pod {pod_name} status: {pod.status.phase}")
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
        time.sleep(1)
    print(f"Pod was running {running_count} out of {duration} seconds.")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check nginx Pod availability.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the Pod status in seconds.')
    args = parser.parse_args()
    check_pod_availability(args.duration)
