"""Unit tests for chaos_eater/utils/k8s.py"""
import subprocess
from unittest.mock import Mock, patch, MagicMock
import pytest

from chaos_eater.utils.k8s import (
    kubectl_apply,
    create_api_client,
    check_deployment_status_by_label,
    check_pod_status_by_label,
    check_service_status_by_label,
    check_job_status_by_label,
    check_statefulset_status_by_label,
    check_daemonset_status_by_label,
    check_resources_status,
    wait_for_resources_ready,
    remove_all_resources_by_labels,
    remove_all_resources_by_namespace,
)


class TestKubectlApply:
    """Tests for kubectl_apply function"""

    @patch('chaos_eater.utils.k8s.subprocess.run')
    def test_apply_success(self, mock_run, capsys):
        mock_run.return_value = Mock(
            returncode=0,
            stdout="deployment.apps/test created\n",
            stderr=""
        )
        result = kubectl_apply("/path/to/manifest.yaml")
        assert result is True
        mock_run.assert_called_once_with(
            ["kubectl", "apply", "-f", "/path/to/manifest.yaml"],
            capture_output=True,
            text=True
        )

    @patch('chaos_eater.utils.k8s.subprocess.run')
    def test_apply_failure(self, mock_run, capsys):
        mock_run.return_value = Mock(
            returncode=1,
            stdout="",
            stderr="error: manifest not found"
        )
        result = kubectl_apply("/path/to/invalid.yaml")
        assert result is False

    @patch('chaos_eater.utils.k8s.subprocess.run')
    def test_apply_exception(self, mock_run, capsys):
        mock_run.side_effect = Exception("kubectl not found")
        result = kubectl_apply("/path/to/manifest.yaml")
        assert result is False


class TestCreateApiClient:
    """Tests for create_api_client function"""

    @patch.dict('os.environ', {}, clear=True)
    @patch('chaos_eater.utils.k8s.config.load_kube_config')
    @patch('chaos_eater.utils.k8s.client.ApiClient')
    @patch('chaos_eater.utils.k8s.client.Configuration')
    def test_create_api_client_outside_cluster(
        self, mock_config, mock_api_client, mock_load_kube_config, capsys
    ):
        # Remove KUBERNETES_SERVICE_HOST to simulate running outside cluster
        import os
        os.environ.pop('KUBERNETES_SERVICE_HOST', None)

        mock_config.return_value = Mock()
        mock_api_client.return_value = Mock()

        result = create_api_client(context="test-context")

        mock_load_kube_config.assert_called_once()
        assert mock_api_client.called

    @patch.dict('os.environ', {'KUBERNETES_SERVICE_HOST': '10.0.0.1'})
    @patch('chaos_eater.utils.k8s.config.load_incluster_config')
    @patch('chaos_eater.utils.k8s.client.ApiClient')
    @patch('chaos_eater.utils.k8s.client.Configuration')
    def test_create_api_client_inside_cluster(
        self, mock_config, mock_api_client, mock_load_incluster_config, capsys
    ):
        mock_config.return_value = Mock()
        mock_api_client.return_value = Mock()

        result = create_api_client()

        mock_load_incluster_config.assert_called_once()


class TestCheckDeploymentStatusByLabel:
    """Tests for check_deployment_status_by_label function"""

    def test_all_replicas_available(self):
        mock_api_client = Mock()
        mock_deployment = Mock()
        mock_deployment.metadata.name = "test-deployment"
        mock_deployment.metadata.namespace = "default"
        mock_deployment.status.available_replicas = 3
        mock_deployment.spec.replicas = 3

        mock_deployments = Mock()
        mock_deployments.items = [mock_deployment]

        with patch('chaos_eater.utils.k8s.client.AppsV1Api') as mock_apps_api:
            mock_api = Mock()
            mock_api.list_deployment_for_all_namespaces.return_value = mock_deployments
            mock_apps_api.return_value = mock_api

            result = check_deployment_status_by_label("app=test", mock_api_client)
            assert result is True

    def test_replicas_not_available(self):
        mock_api_client = Mock()
        mock_deployment = Mock()
        mock_deployment.metadata.name = "test-deployment"
        mock_deployment.metadata.namespace = "default"
        mock_deployment.status.available_replicas = 1
        mock_deployment.spec.replicas = 3

        mock_deployments = Mock()
        mock_deployments.items = [mock_deployment]

        with patch('chaos_eater.utils.k8s.client.AppsV1Api') as mock_apps_api:
            mock_api = Mock()
            mock_api.list_deployment_for_all_namespaces.return_value = mock_deployments
            mock_apps_api.return_value = mock_api

            result = check_deployment_status_by_label("app=test", mock_api_client)
            assert result is False


class TestCheckPodStatusByLabel:
    """Tests for check_pod_status_by_label function"""

    def test_all_pods_running(self):
        mock_api_client = Mock()
        mock_pod = Mock()
        mock_pod.metadata.name = "test-pod"
        mock_pod.metadata.namespace = "default"
        mock_pod.status.phase = "Running"

        mock_pods = Mock()
        mock_pods.items = [mock_pod]

        with patch('chaos_eater.utils.k8s.client.CoreV1Api') as mock_core_api:
            mock_api = Mock()
            mock_api.list_pod_for_all_namespaces.return_value = mock_pods
            mock_core_api.return_value = mock_api

            result = check_pod_status_by_label("app=test", mock_api_client)
            assert result is True

    def test_pod_not_running(self):
        mock_api_client = Mock()
        mock_pod = Mock()
        mock_pod.metadata.name = "test-pod"
        mock_pod.metadata.namespace = "default"
        mock_pod.status.phase = "Pending"

        mock_pods = Mock()
        mock_pods.items = [mock_pod]

        with patch('chaos_eater.utils.k8s.client.CoreV1Api') as mock_core_api:
            mock_api = Mock()
            mock_api.list_pod_for_all_namespaces.return_value = mock_pods
            mock_core_api.return_value = mock_api

            result = check_pod_status_by_label("app=test", mock_api_client)
            assert result is False


class TestCheckServiceStatusByLabel:
    """Tests for check_service_status_by_label function"""

    def test_service_has_cluster_ip(self):
        mock_api_client = Mock()
        mock_service = Mock()
        mock_service.metadata.name = "test-service"
        mock_service.metadata.namespace = "default"
        mock_service.spec.cluster_ip = "10.0.0.100"

        mock_services = Mock()
        mock_services.items = [mock_service]

        with patch('chaos_eater.utils.k8s.client.CoreV1Api') as mock_core_api:
            mock_api = Mock()
            mock_api.list_service_for_all_namespaces.return_value = mock_services
            mock_core_api.return_value = mock_api

            result = check_service_status_by_label("app=test", mock_api_client)
            assert result is True

    def test_service_no_cluster_ip(self):
        mock_api_client = Mock()
        mock_service = Mock()
        mock_service.metadata.name = "test-service"
        mock_service.metadata.namespace = "default"
        mock_service.spec.cluster_ip = None

        mock_services = Mock()
        mock_services.items = [mock_service]

        with patch('chaos_eater.utils.k8s.client.CoreV1Api') as mock_core_api:
            mock_api = Mock()
            mock_api.list_service_for_all_namespaces.return_value = mock_services
            mock_core_api.return_value = mock_api

            result = check_service_status_by_label("app=test", mock_api_client)
            assert result is False


class TestCheckJobStatusByLabel:
    """Tests for check_job_status_by_label function"""

    def test_job_succeeded(self):
        mock_api_client = Mock()
        mock_job = Mock()
        mock_job.metadata.name = "test-job"
        mock_job.metadata.namespace = "default"
        mock_job.status.succeeded = 1

        mock_jobs = Mock()
        mock_jobs.items = [mock_job]

        with patch('chaos_eater.utils.k8s.client.BatchV1Api') as mock_batch_api:
            mock_api = Mock()
            mock_api.list_job_for_all_namespaces.return_value = mock_jobs
            mock_batch_api.return_value = mock_api

            result = check_job_status_by_label("app=test", mock_api_client)
            assert result is True

    def test_job_not_succeeded(self):
        mock_api_client = Mock()
        mock_job = Mock()
        mock_job.metadata.name = "test-job"
        mock_job.metadata.namespace = "default"
        mock_job.status.succeeded = None

        mock_jobs = Mock()
        mock_jobs.items = [mock_job]

        with patch('chaos_eater.utils.k8s.client.BatchV1Api') as mock_batch_api:
            mock_api = Mock()
            mock_api.list_job_for_all_namespaces.return_value = mock_jobs
            mock_batch_api.return_value = mock_api

            result = check_job_status_by_label("app=test", mock_api_client)
            assert result is False


class TestCheckStatefulsetStatusByLabel:
    """Tests for check_statefulset_status_by_label function"""

    def test_statefulset_ready(self):
        mock_api_client = Mock()
        mock_statefulset = Mock()
        mock_statefulset.metadata.name = "test-statefulset"
        mock_statefulset.metadata.namespace = "default"
        mock_statefulset.status.ready_replicas = 3
        mock_statefulset.spec.replicas = 3

        mock_statefulsets = Mock()
        mock_statefulsets.items = [mock_statefulset]

        with patch('chaos_eater.utils.k8s.client.AppsV1Api') as mock_apps_api:
            mock_api = Mock()
            mock_api.list_stateful_set_for_all_namespaces.return_value = mock_statefulsets
            mock_apps_api.return_value = mock_api

            result = check_statefulset_status_by_label("app=test", mock_api_client)
            assert result is True


class TestCheckDaemonsetStatusByLabel:
    """Tests for check_daemonset_status_by_label function"""

    def test_daemonset_ready(self):
        mock_api_client = Mock()
        mock_daemonset = Mock()
        mock_daemonset.metadata.name = "test-daemonset"
        mock_daemonset.metadata.namespace = "default"
        mock_daemonset.status.number_available = 5
        mock_daemonset.status.desired_number_scheduled = 5

        mock_daemonsets = Mock()
        mock_daemonsets.items = [mock_daemonset]

        with patch('chaos_eater.utils.k8s.client.AppsV1Api') as mock_apps_api:
            mock_api = Mock()
            mock_api.list_daemon_set_for_all_namespaces.return_value = mock_daemonsets
            mock_apps_api.return_value = mock_api

            result = check_daemonset_status_by_label("app=test", mock_api_client)
            assert result is True


class TestRemoveAllResourcesByLabels:
    """Tests for remove_all_resources_by_labels function"""

    @patch('chaos_eater.utils.k8s.run_command')
    def test_remove_resources_success(self, mock_run_command):
        mock_run_command.return_value = None

        mock_handler = Mock()
        remove_all_resources_by_labels(
            context="test-context",
            label_selector="app=test",
            display_handler=mock_handler
        )

        mock_run_command.assert_called_once()
        call_args = mock_run_command.call_args
        assert "kubectl delete all" in call_args.kwargs['cmd']
        assert "test-context" in call_args.kwargs['cmd']
        assert "app=test" in call_args.kwargs['cmd']


class TestRemoveAllResourcesByNamespace:
    """Tests for remove_all_resources_by_namespace function"""

    @patch('chaos_eater.utils.k8s.run_command')
    def test_remove_resources_by_namespace(self, mock_run_command):
        mock_run_command.return_value = None

        mock_handler = Mock()
        remove_all_resources_by_namespace(
            context="test-context",
            namespace="test-namespace",
            display_handler=mock_handler
        )

        # Should be called for each resource type
        assert mock_run_command.call_count == 5  # workflow, workflownode, deployments, pods, services
