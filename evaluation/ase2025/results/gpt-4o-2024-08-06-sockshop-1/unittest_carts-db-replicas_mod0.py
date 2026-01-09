import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestCartsDBReplicas(K8sAPIBase):
    def __init__(self, duration):
        super().__init__()
        self.duration = duration

    def test_carts_db_replicas(self):
        namespace = 'sock-shop'
        deployment_name = 'carts-db'
        v1 = client.AppsV1Api()

        # Initialize counters
        total_checks = 0
        successful_checks = 0

        # Check the deployment status for the specified duration
        for _ in range(self.duration):
            try:
                deployment = v1.read_namespaced_deployment(deployment_name, namespace)
                ready_replicas = deployment.status.ready_replicas or 0
                print(f"Ready replicas: {ready_replicas}")

                # Increment total checks
                total_checks += 1

                # Check if the ready replicas meet the threshold
                if ready_replicas >= 2:
                    successful_checks += 1

            except client.exceptions.ApiException as e:
                print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")

            time.sleep(1)

        # Calculate the percentage of successful checks
        success_rate = (successful_checks / total_checks) * 100
        print(f"Success rate: {success_rate}%")

        # Assert that the success rate meets the 95% threshold
        assert success_rate >= 95, f"Threshold not met: {success_rate}% < 95%"


def main():
    parser = argparse.ArgumentParser(description='Test carts-db replicas')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the replicas')
    args = parser.parse_args()

    # Create an instance of the test class with the specified duration
    test = TestCartsDBReplicas(args.duration)
    test.test_carts_db_replicas()


if __name__ == '__main__':
    main()