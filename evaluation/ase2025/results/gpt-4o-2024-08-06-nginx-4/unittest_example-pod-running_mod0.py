import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestDeploymentRunningState(K8sAPIBase):
    def __init__(self):
        super().__init__()

    def check_deployment_pods_status(self, namespace, deployment_name):
        try:
            pods = self.v1.list_namespaced_pod(namespace=namespace, label_selector=f'app={deployment_name}').items
            running_pods = [pod for pod in pods if pod.status.phase == 'Running']
            return len(running_pods) > 0
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->list_namespaced_pod: {e}")
            return False

    def test_deployment_running_state(self, duration):
        namespace = 'default'
        deployment_name = 'example'
        running_count = 0

        # Check the deployment pods status every second for the specified duration
        for _ in range(duration):
            if self.check_deployment_pods_status(namespace, deployment_name):
                running_count += 1
            time.sleep(1)

        # Calculate the running percentage
        running_percentage = (running_count / duration) * 100

        # Assert that the running percentage is at least 90%
        assert running_percentage >= 90, f"Deployment '{deployment_name}' running percentage is below threshold: {running_percentage}%"

        print(f"Deployment '{deployment_name}' running status checked {duration} times. Running percentage: {running_percentage}%.")


def main():
    parser = argparse.ArgumentParser(description='Test if a deployment has at least one pod running at least 90% of the time.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the deployment pods status in seconds.')
    args = parser.parse_args()

    test = TestDeploymentRunningState()
    test.test_deployment_running_state(args.duration)


if __name__ == '__main__':
    main()