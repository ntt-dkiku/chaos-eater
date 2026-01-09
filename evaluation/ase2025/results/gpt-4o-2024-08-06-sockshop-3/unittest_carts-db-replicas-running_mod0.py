import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestCartsDBReplicas(K8sAPIBase):
    def __init__(self):
        super().__init__()
        self.v1_apps = client.AppsV1Api()

    def check_carts_db_replicas(self, namespace='sock-shop', deployment_name='carts-db'):
        try:
            deployment = self.v1_apps.read_namespaced_deployment(name=deployment_name, namespace=namespace)
            replicas = deployment.status.replicas
            ready_replicas = deployment.status.ready_replicas
            print(f"Total replicas: {replicas}, Ready replicas: {ready_replicas}")
            return ready_replicas == replicas
        except client.exceptions.ApiException as e:
            print(f"Exception when calling AppsV1Api->read_namespaced_deployment: {e}")
            return False

    def test_replicas_ready_threshold(self, duration):
        success_count = 0
        for _ in range(duration):
            if self.check_carts_db_replicas():
                success_count += 1
            time.sleep(1)
        # Calculate the threshold as 90% of the duration
        threshold = 0.9 * duration
        print(f"Carts-db replicas running successfully for {success_count}/{duration} seconds.")
        # Assert that the success count meets or exceeds the threshold
        assert success_count >= threshold, f"Replicas were not ready for at least 90% of the time. Success count: {success_count}, Required: {threshold}"


def main():
    parser = argparse.ArgumentParser(description='Test carts-db replicas readiness threshold.')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the state in seconds')
    args = parser.parse_args()

    test = TestCartsDBReplicas()
    test.test_replicas_ready_threshold(args.duration)


if __name__ == '__main__':
    main()
