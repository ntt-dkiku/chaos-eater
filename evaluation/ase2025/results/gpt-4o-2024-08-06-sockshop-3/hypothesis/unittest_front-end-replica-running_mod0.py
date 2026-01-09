import os
import time
import argparse
from kubernetes import client, config
from unittest_base import K8sAPIBase

class TestFrontEndReplicaRunning(K8sAPIBase):
    def __init__(self):
        super().__init__()
        self.namespace = 'sock-shop'
        self.deployment_name = 'front-end'

    def check_front_end_status(self):
        # List all pods in the specified namespace with the label 'name=front-end'
        pods = self.v1.list_namespaced_pod(namespace=self.namespace, label_selector=f'name={self.deployment_name}').items
        # Filter pods that are in the 'Running' state
        running_pods = [pod for pod in pods if pod.status.phase == 'Running']
        # Further filter pods that are ready
        ready_pods = [pod for pod in running_pods if all(container.ready for container in pod.status.container_statuses)]
        return len(ready_pods)

    def test_steady_state(self, duration):
        successful_checks = 0
        total_checks = duration

        for _ in range(duration):
            running_and_ready = self.check_front_end_status()
            print(f'Running and ready front-end pods: {running_and_ready}')
            if running_and_ready >= 1:
                successful_checks += 1
            time.sleep(1)

        # Calculate the percentage of successful checks
        success_rate = (successful_checks / total_checks) * 100
        print(f'Success rate: {success_rate}%')

        # Assert that the success rate is at least 95%
        assert success_rate >= 95, f'Success rate {success_rate}% is below the threshold of 95%'


def main():
    parser = argparse.ArgumentParser(description='Test front-end pod steady state.')
    parser.add_argument('--duration', type=int, default=60, help='Duration to check the status in seconds')
    args = parser.parse_args()

    test = TestFrontEndReplicaRunning()
    test.test_steady_state(args.duration)


if __name__ == '__main__':
    main()
