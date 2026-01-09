import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestDeploymentRunningStatus(K8sAPIBase):
    def __init__(self, namespace, deployment_name, duration):
        super().__init__()
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.duration = duration

    def test_deployment_running_status(self):
        running_count = 0
        # Loop for the specified duration
        for _ in range(self.duration):
            try:
                # List the Pods with the label selector matching the Deployment
                pods = self.v1.list_namespaced_pod(namespace=self.namespace, label_selector="app=example")
                # Check if at least one Pod is in 'Running' state
                if any(pod.status.phase == 'Running' for pod in pods.items):
                    running_count += 1
                print(f"Number of running Pods: {sum(pod.status.phase == 'Running' for pod in pods.items)}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->list_namespaced_pod: {e}")
            time.sleep(1)
        # Calculate the percentage of time at least one Pod was running
        running_percentage = (running_count / self.duration) * 100
        print(f"At least one Pod was running {running_count} out of {self.duration} seconds, which is {running_percentage}% of the time.")
        # Assert that at least one Pod was running at least 90% of the time
        assert running_percentage >= 90, "Deployment did not meet the 90% running threshold."

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test the running status of a Kubernetes Deployment.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the Deployment status in seconds.')
    args = parser.parse_args()
    # Create an instance of the test class
    test = TestDeploymentRunningStatus(namespace='default', deployment_name='example-deployment', duration=args.duration)
    # Run the test
    test.test_deployment_running_status()