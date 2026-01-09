import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestCartsDBPodCount(K8sAPIBase):
    def __init__(self):
        super().__init__()
        self.v1_apps = client.AppsV1Api()

    def check_carts_db_pod_count(self, namespace, expected_count):
        pod_count = 0
        try:
            resp = self.v1_apps.read_namespaced_deployment(name='carts-db', namespace=namespace)
            pod_count = resp.status.replicas
        except client.exceptions.ApiException as e:
            print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
        return pod_count

    def test_steady_state(self, duration):
        namespace = 'sock-shop'
        expected_count = 2
        successful_checks = 0

        for _ in range(duration):
            pod_count = self.check_carts_db_pod_count(namespace, expected_count)
            print(f"Current 'carts-db' pod count: {pod_count}")
            if pod_count == expected_count:
                successful_checks += 1
            time.sleep(1)

        # Calculate the percentage of successful checks
        success_percentage = (successful_checks / duration) * 100
        print(f"Success percentage: {success_percentage}%")

        # Assert that the success percentage is at least 95%
        assert success_percentage >= 95, f"Pod count was not stable enough: {success_percentage}% < 95%"


def main():
    parser = argparse.ArgumentParser(description='Test carts-db pod count steady state.')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the pod count in seconds')
    args = parser.parse_args()

    test = TestCartsDBPodCount()
    test.test_steady_state(args.duration)


if __name__ == '__main__':
    main()
