import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestFrontEndLivenessProbe(K8sAPIBase):
    def check_frontend_liveness(self, namespace, duration):
        success_count = 0
        total_checks = 0

        for _ in range(duration):
            # List pods with the label 'name=front-end' in the specified namespace
            pods = self.v1.list_namespaced_pod(namespace=namespace, label_selector="name=front-end").items
            if pods:
                pod = pods[0]
                if pod.status.conditions:
                    for condition in pod.status.conditions:
                        if condition.type == "Ready" and condition.status == "True":
                            success_count += 1
                            break
            total_checks += 1
            time.sleep(1)

        # Calculate the success rate of the liveness probe
        success_rate = (success_count / total_checks) * 100
        print(f"Liveness Probe Success Rate: {success_rate}%")
        return success_rate

    def test_liveness_probe_success_rate(self, namespace='sock-shop', duration=60):
        # Check the liveness probe success rate
        success_rate = self.check_frontend_liveness(namespace, duration)
        # Assert that the success rate is at least 95%
        assert success_rate >= 95, f"Liveness probe success rate is below 95%: {success_rate}%"


def main():
    parser = argparse.ArgumentParser(description='Test Front-End Liveness Probe Success Rate')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the liveness probe in seconds')
    args = parser.parse_args()

    # Create an instance of the test class
    test_instance = TestFrontEndLivenessProbe()
    # Run the test with the specified duration
    test_instance.test_liveness_probe_success_rate(duration=args.duration)


if __name__ == '__main__':
    main()