import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestFrontEndReplicas(K8sAPIBase):
    def __init__(self, namespace, deployment_name, duration):
        super().__init__()
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.duration = duration
        # Use AppsV1Api for deployment operations
        self.apps_v1 = client.AppsV1Api()

    def test_steady_state(self):
        # Initialize variables to track the number of successful checks
        successful_checks = 0

        # Loop for the specified duration
        for _ in range(self.duration):
            try:
                # Read the deployment status
                deployment = self.apps_v1.read_namespaced_deployment(self.deployment_name, self.namespace)
                ready_replicas = deployment.status.ready_replicas or 0

                # Check if the number of ready replicas is at least 1
                if ready_replicas >= 1:
                    successful_checks += 1

            except client.exceptions.ApiException as e:
                print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")

            # Wait for 1 second before the next check
            time.sleep(1)

        # Calculate the success ratio
        success_ratio = successful_checks / self.duration

        # Assert that the success ratio is 100%
        assert success_ratio == 1.0, f"Steady state not maintained: {success_ratio * 100}% of the time"

        # Print success message
        print("Steady state maintained 100% of the time")


def main():
    parser = argparse.ArgumentParser(description='Test front-end replicas steady state')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the replicas')
    args = parser.parse_args()

    # Create an instance of the test class
    test = TestFrontEndReplicas('sock-shop', 'front-end', args.duration)

    # Run the test
    test.test_steady_state()


if __name__ == '__main__':
    main()
