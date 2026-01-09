import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestFrontEndReplica(K8sAPIBase):
    def __init__(self, namespace, deployment_name, duration):
        super().__init__()
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.duration = duration

    def test_steady_state(self):
        ready_replicas_count = 0

        # Loop for the specified duration
        for _ in range(self.duration):
            # Get the deployment status
            resp = self.v1.read_namespaced_deployment_status(self.deployment_name, self.namespace)
            ready_replicas = resp.status.ready_replicas or 0
            print(f"Ready replicas for {self.deployment_name}: {ready_replicas}")

            # Check if the number of ready replicas is at least 1
            if ready_replicas >= 1:
                ready_replicas_count += 1

            # Wait for 1 second before the next check
            time.sleep(1)

        # Calculate the percentage of time the deployment was ready
        readiness_percentage = (ready_replicas_count / self.duration) * 100
        print(f"{self.deployment_name} was ready {ready_replicas_count}/{self.duration} times.")

        # Assert that the deployment was ready 100% of the time
        assert readiness_percentage == 100, f"{self.deployment_name} readiness was {readiness_percentage}%, expected 100%."


def main():
    parser = argparse.ArgumentParser(description='Test front-end replica readiness')
    parser.add_argument('--duration', type=int, default=5, help='Duration to check the replicas')
    args = parser.parse_args()

    # Create a test instance and run the test
    test = TestFrontEndReplica('sock-shop', 'front-end', args.duration)
    test.test_steady_state()


if __name__ == '__main__':
    main()