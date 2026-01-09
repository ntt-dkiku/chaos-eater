import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestDeploymentSteadyState(K8sAPIBase):
    def __init__(self):
        super().__init__()

    def check_pods_status(self, namespace, label_selector):
        try:
            pods = self.v1.list_namespaced_pod(namespace=namespace, label_selector=label_selector)
            return [pod.status.phase for pod in pods.items]
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->list_namespaced_pod: {e}")
            return []

    def test_deployment_running_state(self, duration):
        namespace = 'default'
        label_selector = 'app=example'
        running_count = 0

        # Check the pod status every second for the specified duration
        for _ in range(duration):
            statuses = self.check_pods_status(namespace, label_selector)
            if any(status == 'Running' for status in statuses):
                running_count += 1
            time.sleep(1)

        # Calculate the running ratio
        running_ratio = running_count / duration

        # Assert that at least one pod is running at least 80% of the time
        assert running_ratio >= 0.8, f"Deployment 'example-deployment' did not have at least one pod running 80% of the time. Running ratio: {running_ratio}"


def main():
    parser = argparse.ArgumentParser(description='Test if the deployment has at least one pod running 80% of the time.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds')
    args = parser.parse_args()

    test = TestDeploymentSteadyState()
    test.test_deployment_running_state(args.duration)


if __name__ == '__main__':
    main()