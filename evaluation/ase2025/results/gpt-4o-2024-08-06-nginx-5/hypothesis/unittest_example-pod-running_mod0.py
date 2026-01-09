import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestPodSteadyState(K8sAPIBase):
    def __init__(self):
        super().__init__()

    def check_pod_status(self, namespace, pod_name):
        try:
            pod = self.v1.read_namespaced_pod(name=pod_name, namespace=namespace)
            return pod.status.phase
        except client.exceptions.ApiException as e:
            print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
            return None

    def test_pod_running_state(self, duration):
        namespace = 'default'
        pod_name = 'example-pod'
        running_count = 0

        # Check the pod status every second for the specified duration
        for _ in range(duration):
            status = self.check_pod_status(namespace, pod_name)
            if status == 'Running':
                running_count += 1
            time.sleep(1)

        # Calculate the running ratio
        running_ratio = running_count / duration

        # Assert that the pod is running at least 80% of the time
        assert running_ratio >= 0.8, f"Pod '{pod_name}' was not running at least 80% of the time. Running ratio: {running_ratio}"


def main():
    parser = argparse.ArgumentParser(description='Test if the pod is running at least 80% of the time.')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the pod status in seconds')
    args = parser.parse_args()

    test = TestPodSteadyState()
    test.test_pod_running_state(args.duration)


if __name__ == '__main__':
    main()