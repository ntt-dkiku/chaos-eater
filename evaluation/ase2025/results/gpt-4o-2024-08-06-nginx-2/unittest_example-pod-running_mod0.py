import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestDeploymentRunningState(K8sAPIBase):
    def __init__(self, namespace, label_selector, duration):
        super().__init__()
        self.namespace = namespace
        self.label_selector = label_selector
        self.duration = duration

    def test_deployment_running_state(self):
        running_count = 0
        total_pods = 0
        # Check the pod status every second for the specified duration
        for _ in range(self.duration):
            try:
                pods = self.v1.list_namespaced_pod(namespace=self.namespace, label_selector=self.label_selector).items
                total_pods = len(pods)
                running_pods = [pod for pod in pods if pod.status.phase == 'Running']
                running_count += len(running_pods)
                print(f"Running pods: {len(running_pods)} out of {total_pods}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->list_namespaced_pod: {e}")
            time.sleep(1)
        # Calculate the running percentage
        running_percentage = (running_count / (self.duration * total_pods)) * 100 if total_pods > 0 else 0
        print(f"Pods were running {running_count} out of {self.duration * total_pods} checks.")
        print(f"Running percentage: {running_percentage}%")
        # Assert that the running percentage meets the threshold
        assert running_percentage >= 90, f"Pod running percentage {running_percentage}% is below the threshold of 90%."

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test the running state of a Kubernetes Deployment.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds')
    args = parser.parse_args()
    # Create an instance of the test class
    test = TestDeploymentRunningState(namespace='default', label_selector='app=example', duration=args.duration)
    # Run the test
    test.test_deployment_running_state()