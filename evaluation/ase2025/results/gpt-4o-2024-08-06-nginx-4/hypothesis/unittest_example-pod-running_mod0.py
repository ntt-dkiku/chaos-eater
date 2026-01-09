import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestPodRunningState(K8sAPIBase):
    def __init__(self):
        super().__init__()

    def check_pod_status(self, namespace, pod_name):
        try:
            pod = self.v1.read_namespaced_pod(name=pod_name, namespace=namespace)
            return pod.status.phase == 'Running'
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
            return False

    def test_pod_running_state(self, duration):
        namespace = 'default'
        pod_name = 'example-pod'
        running_count = 0

        # Check the pod status every second for the specified duration
        for _ in range(duration):
            if self.check_pod_status(namespace, pod_name):
                running_count += 1
            time.sleep(1)

        # Calculate the running percentage
        running_percentage = (running_count / duration) * 100

        # Assert that the running percentage is at least 90%
        assert running_percentage >= 90, f"Pod '{pod_name}' running percentage is below threshold: {running_percentage}%"

        print(f"Pod '{pod_name}' running status checked {duration} times. Running percentage: {running_percentage}%.")


def main():
    parser = argparse.ArgumentParser(description='Test if a pod is running at least 90% of the time.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds.')
    args = parser.parse_args()

    test = TestPodRunningState()
    test.test_pod_running_state(args.duration)


if __name__ == '__main__':
    main()