import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CleanClusterButton from '../../components/CleanClusterButton';
import * as clusterApi from '../../api/cluster';

vi.mock('../../api/cluster', () => ({
  cleanCluster: vi.fn(),
}));

describe('CleanClusterButton', () => {
  const mockOnNotify = vi.fn();
  const defaultProps = {
    API_BASE: 'http://localhost:8000',
    kubeContext: 'test-context',
    onNotify: mockOnNotify,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with default text', () => {
    render(<CleanClusterButton {...defaultProps} />);
    expect(screen.getByRole('button')).toHaveTextContent('Clean cluster');
  });

  it('should have correct title attribute', () => {
    render(<CleanClusterButton {...defaultProps} />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      'Clean resources within the selected cluster'
    );
  });

  it('should call onNotify with error when kubeContext is null', async () => {
    render(<CleanClusterButton {...defaultProps} kubeContext={null} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(mockOnNotify).toHaveBeenCalledWith('error', 'Please select a cluster');
  });

  it('should call cleanCluster with correct parameters', async () => {
    vi.mocked(clusterApi.cleanCluster).mockResolvedValue(undefined);

    render(
      <CleanClusterButton
        {...defaultProps}
        namespace="custom-namespace"
        projectName="custom-project"
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(clusterApi.cleanCluster).toHaveBeenCalledWith('http://localhost:8000', {
        kube_context: 'test-context',
        namespace: 'custom-namespace',
        project_name: 'custom-project',
      });
    });
  });

  it('should call onNotify with success on successful clean', async () => {
    vi.mocked(clusterApi.cleanCluster).mockResolvedValue(undefined);

    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockOnNotify).toHaveBeenCalledWith('success', 'Cluster cleaned');
    });
  });

  it('should call onNotify with error on failure', async () => {
    vi.mocked(clusterApi.cleanCluster).mockRejectedValue(new Error('Network error'));

    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockOnNotify).toHaveBeenCalledWith('error', 'Network error');
    });
  });

  it('should use default error message when error has no message', async () => {
    vi.mocked(clusterApi.cleanCluster).mockRejectedValue({});

    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockOnNotify).toHaveBeenCalledWith('error', 'Clean failed');
    });
  });

  it('should be disabled when disabled prop is true', () => {
    render(<CleanClusterButton {...defaultProps} disabled={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('should have not-allowed cursor when disabled', () => {
    render(<CleanClusterButton {...defaultProps} disabled={true} />);
    expect(screen.getByRole('button')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('should have reduced opacity when disabled', () => {
    render(<CleanClusterButton {...defaultProps} disabled={true} />);
    expect(screen.getByRole('button')).toHaveStyle({ opacity: '0.6' });
  });

  it('should use default namespace and projectName', async () => {
    vi.mocked(clusterApi.cleanCluster).mockResolvedValue(undefined);

    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(clusterApi.cleanCluster).toHaveBeenCalledWith('http://localhost:8000', {
        kube_context: 'test-context',
        namespace: 'chaos-eater',
        project_name: 'chaos-project',
      });
    });
  });

  it('should change color on mouse enter when not disabled', () => {
    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button);

    expect(button).toHaveStyle({ backgroundColor: '#2a2a2a' });
    expect(button).toHaveStyle({ color: 'rgb(132, 204, 22)' }); // #84cc16
  });

  it('should restore color on mouse leave', () => {
    render(<CleanClusterButton {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);

    expect(button).toHaveStyle({ backgroundColor: '#1f1f1f' });
    expect(button).toHaveStyle({ color: 'rgb(229, 231, 235)' }); // #e5e7eb
  });

  it('should not change color on hover when disabled', () => {
    render(<CleanClusterButton {...defaultProps} disabled={true} />);

    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button);

    // Should keep original background color (hover style not applied)
    expect(button).toHaveStyle({ backgroundColor: '#1f1f1f' });
  });

  it('should work without onNotify callback', async () => {
    vi.mocked(clusterApi.cleanCluster).mockResolvedValue(undefined);

    render(
      <CleanClusterButton
        API_BASE="http://localhost:8000"
        kubeContext="test-context"
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Should not throw
    await waitFor(() => {
      expect(clusterApi.cleanCluster).toHaveBeenCalled();
    });
  });
});
