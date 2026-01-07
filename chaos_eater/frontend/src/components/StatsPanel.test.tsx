import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import StatsPanel from './StatsPanel';

describe('StatsPanel', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should render with empty state', () => {
    render(<StatsPanel apiBase="http://localhost:8000" jobId={null} />);

    expect(screen.getByText('Totals')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
    // Multiple elements with "0" for input/output/total tokens
    expect(screen.getAllByText('0')).toHaveLength(3);
  });

  it('should display token counts', () => {
    render(<StatsPanel apiBase="http://localhost:8000" jobId={null} />);

    expect(screen.getByText('Input tokens')).toBeInTheDocument();
    expect(screen.getByText('Output tokens')).toBeInTheDocument();
    expect(screen.getByText('Total tokens')).toBeInTheDocument();
  });

  it('should display elapsed time', () => {
    render(<StatsPanel apiBase="http://localhost:8000" jobId={null} />);

    expect(screen.getByText('Elapsed')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument(); // formatDuration(null) returns '-'
  });

  it('should display by agent section', () => {
    render(<StatsPanel apiBase="http://localhost:8000" jobId={null} />);

    expect(screen.getByText('By Agent (top 5)')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('should be hidden when collapsed', () => {
    const { container } = render(
      <StatsPanel apiBase="http://localhost:8000" jobId={null} collapsed={true} />
    );

    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveStyle({ display: 'none' });
  });

  it('should be visible when not collapsed', () => {
    const { container } = render(
      <StatsPanel apiBase="http://localhost:8000" jobId={null} collapsed={false} />
    );

    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveStyle({ display: 'block' });
  });

  it('should fetch stats when jobId is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          time: { elapsed_sec: 30, first_ts: null, last_ts: null },
          by_agent: [],
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/jobs/test-job-1/stats');
    });
  });

  it('should display fetched stats', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 },
          time: { elapsed_sec: 120, first_ts: null, last_ts: null },
          by_agent: [],
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    expect(screen.getByText('567')).toBeInTheDocument();
    expect(screen.getByText('1,801')).toBeInTheDocument();
    expect(screen.getByText('2m 0s')).toBeInTheDocument();
  });

  it('should display agent stats', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: null, first_ts: null, last_ts: null },
          by_agent: [
            { agent_name: 'Agent1', token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
            { agent_name: 'Agent2', token_usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } },
          ],
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('Agent1')).toBeInTheDocument();
    });

    expect(screen.getByText('Agent2')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
  });

  it('should only show top 5 agents', async () => {
    const agents = Array.from({ length: 7 }, (_, i) => ({
      agent_name: `Agent${i + 1}`,
      token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: null, first_ts: null, last_ts: null },
          by_agent: agents,
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('Agent1')).toBeInTheDocument();
    });

    expect(screen.getByText('Agent5')).toBeInTheDocument();
    expect(screen.queryByText('Agent6')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent7')).not.toBeInTheDocument();
  });

  it('should display time window when timestamps available', async () => {
    // Fixed timestamps for consistent test
    const firstTs = 1704067200; // 2024-01-01 00:00:00 UTC
    const lastTs = 1704070800; // 2024-01-01 01:00:00 UTC

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: 3600, first_ts: firstTs, last_ts: lastTs },
          by_agent: [],
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      const windowText = screen.getByText(/Window:/);
      expect(windowText).toBeInTheDocument();
      expect(windowText.textContent).not.toBe('Window: -');
    });
  });

  it('should display error message on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Internal server error' }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should have aria-live attribute for accessibility', () => {
    const { container } = render(<StatsPanel apiBase="http://localhost:8000" jobId={null} />);

    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveAttribute('aria-live', 'polite');
  });

  it('should use snapshotKey when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: null, first_ts: null, last_ts: null },
          by_agent: [],
        }),
    });

    render(
      <StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" snapshotKey="custom-key" />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should format hours in elapsed time', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: 3665, first_ts: null, last_ts: null }, // 1h 1m 5s
          by_agent: [],
        }),
    });

    render(<StatsPanel apiBase="http://localhost:8000" jobId="test-job-1" />);

    await waitFor(() => {
      expect(screen.getByText('1h 1m 5s')).toBeInTheDocument();
    });
  });
});
