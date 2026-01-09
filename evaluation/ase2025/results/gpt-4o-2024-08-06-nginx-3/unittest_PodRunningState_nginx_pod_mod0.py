import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestDeploymentRunningState(K8sAPIBase):
    def __init__(self, namespace, deployment_name, duration):
        super().__init__()
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.duration = duration

    def test_deployment_running_state(self):
        running_count = 0

        # Loop for the specified duration, checking the Pods' status every second
        for _ in range(self.duration):
            try:
                # List all Pods with the label app=example
                pods = self.v1.list_namespaced_pod(namespace=self.namespace, label_selector="app=example").items
                all_running = all(pod.status.phase == 'Running' for pod in pods)
                if all_running:
                    running_count += 1
                print(f"Deployment {self.deployment_name} Pods status: {[pod.status.phase for pod in pods]}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->list_namespaced_pod: {e}")
            time.sleep(1)

        # Calculate the percentage of time all Pods were running
        running_percentage = (running_count / self.duration) * 100
        print(f"Deployment {self.deployment_name} Pods were all running {running_count} out of {self.duration} seconds.")

        # Assert that all Pods were running at least 90% of the time
        assert running_percentage >= 90, f"Deployment {self.deployment_name} Pods were not all running at least 90% of the time. Running percentage: {running_percentage}%"

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test the running status of a Kubernetes Deployment.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the Pods status in seconds')
    args = parser.parse_args()

    # Create an instance of the test class and run the test
    test = TestDeploymentRunningState(namespace='default', deployment_name='example-deployment', duration=args.duration)
    test.test_deployment_running_state()