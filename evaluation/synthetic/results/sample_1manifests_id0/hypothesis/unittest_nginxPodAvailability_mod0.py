import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestNginxPodAvailability(K8sAPIBase):
    def __init__(self):
        super().__init__()

    def check_pod_availability(self, duration):
        namespace = 'default'
        pod_name = 'nginx-pod'
        running_count = 0
        for _ in range(duration):
            try:
                pod = self.v1.read_namespaced_pod(name=pod_name, namespace=namespace)
                if pod.status.phase == 'Running':
                    running_count += 1
                print(f"Pod {pod_name} status: {pod.status.phase}")
            except client.exceptions.ApiException as e:
                print(f"Exception when calling CoreV1Api->read_namespaced_pod: {e}")
            time.sleep(1)
        running_percentage = (running_count / duration) * 100
        print(f"Pod was running {running_count} out of {duration} seconds, which is {running_percentage:.2f}%.")
        # Assert that the running percentage is at least 95%
        assert running_percentage >= 95, f"Pod availability is below threshold: {running_percentage:.2f}% < 95%"


def main():
    parser = argparse.ArgumentParser(description='Test nginx Pod availability.')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the Pod status in seconds.')
    args = parser.parse_args()
    test = TestNginxPodAvailability()
    test.check_pod_availability(args.duration)

if __name__ == '__main__':
    main()