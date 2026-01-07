import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadZipToBackend } from '../../api/uploads';

describe('uploadZipToBackend', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should upload file and return project_path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ project_path: '/tmp/project' }),
    });

    const file = new File(['content'], 'test.zip', { type: 'application/zip' });
    const result = await uploadZipToBackend('http://localhost:8000', file);

    expect(result).toBe('/tmp/project');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/upload',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should send file as FormData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ project_path: '/tmp/project' }),
    });

    const file = new File(['content'], 'test.zip', { type: 'application/zip' });
    await uploadZipToBackend('http://localhost:8000', file);

    const calledBody = mockFetch.mock.calls[0][1].body;
    expect(calledBody).toBeInstanceOf(FormData);
    expect(calledBody.get('file')).toBe(file);
  });

  it('should throw error on failed upload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      text: () => Promise.resolve('Invalid file'),
    });

    const file = new File(['content'], 'test.zip');
    await expect(uploadZipToBackend('http://localhost:8000', file)).rejects.toThrow(
      'Upload failed: Invalid file'
    );
  });

  it('should use statusText when text() fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      text: () => Promise.reject(new Error('parse error')),
    });

    const file = new File(['content'], 'test.zip');
    await expect(uploadZipToBackend('http://localhost:8000', file)).rejects.toThrow(
      'Upload failed: Internal Server Error'
    );
  });

  it('should throw error if no project_path returned', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const file = new File(['content'], 'test.zip');
    await expect(uploadZipToBackend('http://localhost:8000', file)).rejects.toThrow(
      'Server did not return project_path'
    );
  });

  it('should throw error if project_path is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ project_path: null }),
    });

    const file = new File(['content'], 'test.zip');
    await expect(uploadZipToBackend('http://localhost:8000', file)).rejects.toThrow(
      'Server did not return project_path'
    );
  });
});
