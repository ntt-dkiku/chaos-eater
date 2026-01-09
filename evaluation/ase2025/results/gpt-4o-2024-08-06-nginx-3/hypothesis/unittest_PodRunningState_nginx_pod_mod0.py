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

        # Loop for the specified duration, checking the Pod's status every second
        for _ in range(self.duration):
            try:
                pod = self.v1.read_namespaced_pod(name=self.pod_name, namespace=self.namespace)
                if pod.status.phase == 'Running':
                    running_count += 1
                print(f"Pod {self.pod_name} status: {pod.status.phase}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
            time.sleep(1)

        # Calculate the percentage of time the Pod was running
        running_percentage = (running_count / self.duration) * 100
        print(f"Pod {self.pod_name} was running {running_count} out of {self.duration} seconds.")

        # Assert that the Pod was running at least 90% of the time
        assert running_percentage >= 90, f"Pod {self.pod_name} was not running at least 90% of the time. Running percentage: {running_percentage}%"

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test the running status of a Kubernetes Pod.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the Pod status in seconds')
    args = parser.parse_args()

    # Create an instance of the test class and run the test
    test = TestPodRunningState(namespace='default', pod_name='example-pod', duration=args.duration)
    test.test_pod_running_state()
