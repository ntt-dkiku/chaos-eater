import os
import time
from kubernetes import client, config

# Load Kubernetes configuration based on the environment
if os.getenv('KUBERNETES_SERVICE_HOST'):
    config.load_incluster_config()
else:
    config.load_kube_config()

v1 = client.CoreV1Api()

namespace = 'sock-shop'
deployment_name = 'front-end'

# Function to check the status of the front-end pod
def check_front_end_status():
    pods = v1.list_namespaced_pod(namespace=namespace, label_selector=f'name={deployment_name}').items
    running_pods = [pod for pod in pods if pod.status.phase == 'Running']
    ready_pods = [pod for pod in running_pods if all(container.ready for container in pod.status.container_statuses)]
    return len(ready_pods)

def main(duration):
    for _ in range(duration):
        running_and_ready = check_front_end_status()
        print(f'Running and ready front-end pods: {running_and_ready}')
        time.sleep(1)
    print('Status check completed.')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Check front-end pod status.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the status in seconds')
    args = parser.parse_args()
    main(args.duration)
