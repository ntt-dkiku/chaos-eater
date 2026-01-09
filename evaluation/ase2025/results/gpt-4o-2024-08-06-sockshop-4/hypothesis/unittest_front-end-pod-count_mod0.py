import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestFrontEndPodCount(K8sAPIBase):
    def __init__(self, namespace, duration):
        super().__init__()
        self.namespace = namespace
        self.duration = duration

    def test_front_end_pod_count(self):
        pod_label_selector = 'name=front-end'
        successful_checks = 0

        # Check the pod count every second for the specified duration
        for _ in range(self.duration):
            pods = self.v1.list_namespaced_pod(namespace=self.namespace, label_selector=pod_label_selector)
            pod_count = len(pods.items)
            print(f'Current front-end pod count: {pod_count}')

            # Increment successful checks if pod count is 1 or more
            if pod_count >= 1:
                successful_checks += 1

            time.sleep(1)

        # Calculate the percentage of successful checks
        success_rate = (successful_checks / self.duration) * 100
        print(f'Success rate: {success_rate}%')

        # Assert that the success rate meets the 95% threshold
        assert success_rate >= 95, f"Front-end pod count did not meet the 95% threshold. Success rate: {success_rate}%"

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test front-end pod count in the sock-shop namespace.')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the pod count in seconds.')
    args = parser.parse_args()

    test = TestFrontEndPodCount(namespace='sock-shop', duration=args.duration)
    test.test_front_end_pod_count()