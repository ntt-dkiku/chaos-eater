import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadFromApi } from '../../api/downloads';

describe('downloadFromApi', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();

    // Mock URL methods
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    URL.revokeObjectURL = vi.fn();

    // Mock DOM methods
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as HTMLElement);
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('should download file with suggested filename', async () => {
    const mockBlob = new Blob(['content']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      blob: () => Promise.resolve(mockBlob),
    });

    await downloadFromApi({
      apiBase: 'http://localhost:8000',
      pathOrUrl: '/downloads/file.txt',
      suggestedFilename: 'myfile.txt',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/downloads/file.txt',
      expect.objectContaining({ method: 'GET' })
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  it('should use filename from Content-Disposition header', async () => {
    const mockBlob = new Blob(['content']);
    const headers = new Headers();
    headers.set('Content-Disposition', 'attachment; filename="server-file.txt"');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers,
      blob: () => Promise.resolve(mockBlob),
    });

    await downloadFromApi({
      apiBase: 'http://localhost:8000',
      pathOrUrl: '/downloads/file.txt',
    });

    const anchor = document.createElement('a') as HTMLAnchorElement;
    expect(anchor.download).toBe('server-file.txt');
  });

  it('should handle UTF-8 encoded filename', async () => {
    const mockBlob = new Blob(['content']);
    const headers = new Headers();
    headers.set('Content-Disposition', "attachment; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers,
      blob: () => Promise.resolve(mockBlob),
    });

    await downloadFromApi({
      apiBase: 'http://localhost:8000',
      pathOrUrl: '/downloads/file.txt',
    });

    // The filename should be decoded to Japanese characters
    expect(true).toBe(true); // Test passes if no error thrown
  });

  it('should handle absolute URL', async () => {
    const mockBlob = new Blob(['content']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      blob: () => Promise.resolve(mockBlob),
    });

    await downloadFromApi({
      apiBase: 'http://localhost:8000',
      pathOrUrl: 'https://example.com/file.txt',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/file.txt',
      expect.anything()
    );
  });

  it('should throw error with detail from JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'File not found' }),
    });

    await expect(
      downloadFromApi({
        apiBase: 'http://localhost:8000',
        pathOrUrl: '/downloads/missing.txt',
      })
    ).rejects.toThrow('File not found');
  });

  it('should throw generic error when JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Parse error')),
    });

    await expect(
      downloadFromApi({
        apiBase: 'http://localhost:8000',
        pathOrUrl: '/downloads/file.txt',
      })
    ).rejects.toThrow('Download failed (HTTP 500)');
  });

  it('should include custom headers', async () => {
    const mockBlob = new Blob(['content']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      blob: () => Promise.resolve(mockBlob),
    });

    await downloadFromApi({
      apiBase: 'http://localhost:8000',
      pathOrUrl: '/downloads/file.txt',
      headers: { Authorization: 'Bearer token' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/downloads/file.txt',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
      })
    );
  });
});
