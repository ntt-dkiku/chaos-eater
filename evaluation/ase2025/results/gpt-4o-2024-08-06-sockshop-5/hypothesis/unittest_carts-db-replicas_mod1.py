import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestCartsDBReplicas(K8sAPIBase):
    def __init__(self, namespace='sock-shop', deployment_name='carts-db', duration=5):
        super().__init__()
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.duration = duration
        # Use the correct API client for deployments
        self.apps_v1 = client.AppsV1Api()

    def test_replicas_threshold(self):
        # Initialize counters for ready replicas
        total_checks = 0
        ready_replicas_count = 0
        fully_ready_replicas_count = 0

        for _ in range(self.duration):
            try:
                # Read the deployment status using the correct API client
                deployment = self.apps_v1.read_namespaced_deployment(self.deployment_name, self.namespace)
                replicas = deployment.status.replicas
                ready_replicas = deployment.status.ready_replicas
                print(f"Total replicas: {replicas}, Ready replicas: {ready_replicas}")

                # Increment the total checks
                total_checks += 1

                # Check if at least 1 replica is ready
                if ready_replicas >= 1:
                    ready_replicas_count += 1

                # Check if both replicas are ready
                if ready_replicas == 2:
                    fully_ready_replicas_count += 1

            except client.exceptions.ApiException as e:
                print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")

            # Wait for 1 second before the next check
            time.sleep(1)

        # Calculate the percentage of time conditions are met
        one_ready_percentage = (ready_replicas_count / total_checks) * 100
        two_ready_percentage = (fully_ready_replicas_count / total_checks) * 100

        # Assert the threshold conditions
        assert one_ready_percentage == 100, "At least 1 ready replica was not available 100% of the time."
        assert two_ready_percentage >= 80, "2 ready replicas were not available at least 80% of the time."

        print("Test passed: Steady state conditions are satisfied.")


def main():
    parser = argparse.ArgumentParser(description='Test carts-db replicas threshold')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the replicas')
    args = parser.parse_args()

    # Create an instance of the test class with the specified duration
    test = TestCartsDBReplicas(duration=args.duration)
    # Run the test
    test.test_replicas_threshold()


if __name__ == '__main__':
    main()
