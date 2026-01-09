import os
import time
import argparse
from kubernetes import client, config

def check_front_end_pod_count(namespace, duration):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.CoreV1Api()
    pod_label_selector = 'name=front-end'

    for _ in range(duration):
        pods = v1.list_namespaced_pod(namespace=namespace, label_selector=pod_label_selector)
        pod_count = len(pods.items)
        print(f'Current front-end pod count: {pod_count}')
        time.sleep(1)

    print('Finished checking front-end pod count.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check front-end pod count in the sock-shop namespace.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod count in seconds.')
    args = parser.parse_args()

    check_front_end_pod_count(namespace='sock-shop', duration=args.duration)
