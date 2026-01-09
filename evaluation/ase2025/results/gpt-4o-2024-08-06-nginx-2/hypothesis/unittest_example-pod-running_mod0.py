import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestPodRunningState(K8sAPIBase):
    def __init__(self, namespace, pod_name, duration):
        super().__init__()
        self.namespace = namespace
        self.pod_name = pod_name
        self.duration = duration

    def test_pod_running_state(self):
        running_count = 0
        # Check the pod status every second for the specified duration
        for _ in range(self.duration):
            try:
                pod = self.v1.read_namespaced_pod(name=self.pod_name, namespace=self.namespace)
                if pod.status.phase == 'Running':
                    running_count += 1
                print(f"Pod status: {pod.status.phase}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
            time.sleep(1)
        # Calculate the running percentage
        running_percentage = (running_count / self.duration) * 100
        print(f"Pod was running {running_count} out of {self.duration} seconds.")
        print(f"Running percentage: {running_percentage}%")
        # Assert that the running percentage meets the threshold
        assert running_percentage >= 90, f"Pod running percentage {running_percentage}% is below the threshold of 90%."

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test the running state of a Kubernetes Pod.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds')
    args = parser.parse_args()
    # Create an instance of the test class
    test = TestPodRunningState(namespace='default', pod_name='example-pod', duration=args.duration)
    # Run the test
    test.test_pod_running_state()
