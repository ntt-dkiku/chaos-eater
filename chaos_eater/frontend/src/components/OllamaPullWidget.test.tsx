import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OllamaPullWidget from './OllamaPullWidget';

describe('OllamaPullWidget', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should render with default model', () => {
    render(<OllamaPullWidget />);
    const input = screen.getByLabelText('Model name');
    expect(input).toHaveValue('qwen2.5:7b');
  });

  it('should render pull button', () => {
    render(<OllamaPullWidget />);
    expect(screen.getByRole('button')).toHaveTextContent('Pull');
  });

  it('should display initial status', () => {
    render(<OllamaPullWidget />);
    expect(screen.getByText('Status: idle')).toBeInTheDocument();
  });

  it('should update model input', () => {
    render(<OllamaPullWidget />);

    const input = screen.getByLabelText('Model name');
    fireEvent.change(input, { target: { value: 'llama2:13b' } });

    expect(input).toHaveValue('llama2:13b');
  });

  it('should render progress bar', () => {
    render(<OllamaPullWidget />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('max', '100');
    expect(progress).toHaveAttribute('value', '0');
  });

  it('should have placeholder text', () => {
    render(<OllamaPullWidget />);
    const input = screen.getByLabelText('Model name');
    expect(input).toHaveAttribute('placeholder', 'Enter model (e.g. qwen2.5:7b)');
  });

  it('should call fetch with correct parameters when pull is clicked', async () => {
    // Create a mock readable stream
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ value: new TextEncoder().encode('{"status":"downloading"}\n'), done: false })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('{"status":"success","done":true}\n'), done: false })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/ollama/pull',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'qwen2.5:7b' }),
        })
      );
    });
  });

  it('should show Pulling... when pull is in progress', async () => {
    // Create a mock that doesn't resolve immediately
    const mockReader = {
      read: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveTextContent('Pulling...');
      expect(button).toBeDisabled();
    });
  });

  it('should update status based on stream response', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"downloading"}\n'),
          done: false
        })
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"success","done":true}\n'),
          done: false
        })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Status: success')).toBeInTheDocument();
    });
  });

  it('should update progress based on percentage in response', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"percentage":0.5}\n'),
          done: false
        })
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"success","done":true}\n'),
          done: false
        })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      const progress = screen.getByRole('progressbar');
      expect(progress).toHaveAttribute('value', '100'); // Final value after success
    });
  });

  it('should append lines to output', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"line1"}\n{"status":"line2"}\n'),
          done: false
        })
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"success","done":true}\n'),
          done: false
        })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      const pre = document.querySelector('pre');
      expect(pre?.textContent).toContain('{"status":"line1"}');
      expect(pre?.textContent).toContain('{"status":"line2"}');
    });
  });

  it('should handle response without body', async () => {
    mockFetch.mockResolvedValue({
      body: null,
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Status: idle')).toBeInTheDocument();
    });
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Status: idle')).toBeInTheDocument();
      expect(button).toHaveTextContent('Pull');
      expect(button).not.toBeDisabled();
    });
  });

  it('should handle percentage greater than 1 (as raw percentage)', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"percentage":75}\n'),
          done: false
        })
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"status":"success","done":true}\n'),
          done: false
        })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Wait for completion
    await waitFor(() => {
      expect(screen.getByText('Status: success')).toBeInTheDocument();
    });
  });

  it('should cap progress at 100', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          value: new TextEncoder().encode('{"percentage":150}\n'),
          done: false
        })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      body: {
        getReader: () => mockReader,
      },
    });

    render(<OllamaPullWidget />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      const progress = screen.getByRole('progressbar');
      expect(progress).toHaveAttribute('value', '100');
    });
  });
});
