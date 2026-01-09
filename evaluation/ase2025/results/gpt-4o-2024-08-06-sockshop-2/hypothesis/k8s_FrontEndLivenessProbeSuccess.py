import os
import time
import argparse
from kubernetes import client, config

def check_frontend_liveness(namespace, duration):
    # Load Kubernetes configuration based on the environment
    if os.getenv('KUBERNETES_SERVICE_HOST'):
        config.load_incluster_config()
    else:
        config.load_kube_config()

    v1 = client.CoreV1Api()
    success_count = 0
    total_checks = 0

    for _ in range(duration):
        pods = v1.list_namespaced_pod(namespace=namespace, label_selector="name=front-end").items
        if pods:
            pod = pods[0]
            if pod.status.conditions:
                for condition in pod.status.conditions:
                    if condition.type == "Ready" and condition.status == "True":
                        success_count += 1
                        break
        total_checks += 1
        time.sleep(1)

    success_rate = (success_count / total_checks) * 100
    print(f"Liveness Probe Success Rate: {success_rate}%")
    return success_rate


def main():
    parser = argparse.ArgumentParser(description='Check Front-End Liveness Probe Success')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the liveness probe in seconds')
    args = parser.parse_args()

    namespace = 'sock-shop'
    success_rate = check_frontend_liveness(namespace, args.duration)
    if success_rate >= 95:
        print("Liveness probe is successful 95% of the time.")
    else:
        print("Liveness probe success rate is below 95%.")

if __name__ == '__main__':
    main()