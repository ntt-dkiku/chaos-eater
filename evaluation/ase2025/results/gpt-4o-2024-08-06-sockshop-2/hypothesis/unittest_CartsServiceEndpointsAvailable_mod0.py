import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestCartsServiceEndpoints(K8sAPIBase):
    def __init__(self):
        super().__init__()
        self.namespace = 'sock-shop'
        self.service_name = 'carts'
        self.deployment_name = 'carts'

    def get_endpoints_count(self):
        endpoints = self.v1.read_namespaced_endpoints(self.service_name, self.namespace)
        return len(endpoints.subsets[0].addresses) if endpoints.subsets else 0

    def get_replicas_count(self):
        deployment = self.v1.read_namespaced_deployment(self.deployment_name, self.namespace)
        return deployment.status.replicas

    def test_endpoints_availability(self, duration):
        success_count = 0
        total_checks = duration

        for _ in range(duration):
            endpoints_count = self.get_endpoints_count()
            replicas_count = self.get_replicas_count()
            print(f'Endpoints available: {endpoints_count}, Expected replicas: {replicas_count}')

            # Check if at least 1 endpoint is available
            if endpoints_count >= 1:
                success_count += 1

            time.sleep(1)

        # Calculate the success rate
        success_rate = (success_count / total_checks) * 100
        print(f'Success rate: {success_rate}%')

        # Assert that the success rate is at least 95%
        assert success_rate >= 95, f'Success rate {success_rate}% is below the threshold of 95%'


def main():
    parser = argparse.ArgumentParser(description='Test Carts Service Endpoints Availability')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the state in seconds')
    args = parser.parse_args()

    test = TestCartsServiceEndpoints()
    test.test_endpoints_availability(args.duration)


if __name__ == '__main__':
    main()
