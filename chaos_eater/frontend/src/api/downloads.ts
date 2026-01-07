/**
 * Options for downloading a file from the API
 */
export interface DownloadOptions {
  apiBase: string;
  pathOrUrl: string;
  suggestedFilename?: string;
  headers?: Record<string, string>;
}

/**
 * Resolve a path or URL to an absolute URL
 */
function resolveUrl(apiBase: string, pathOrUrl: string): string {
  try {
    new URL(pathOrUrl);
    return pathOrUrl; // Already absolute
  } catch {
    return `${apiBase}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }
}

/**
 * Parse filename from Content-Disposition header
 */
function parseFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;

  // Try UTF-8 encoded filename first
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  // Try plain filename
  const plainMatch = header.match(/filename="?([^"]+)"?/i);
  if (plainMatch) {
    return plainMatch[1];
  }

  return fallback;
}

/**
 * Download a file from the API and trigger browser save dialog
 */
export async function downloadFromApi(options: DownloadOptions): Promise<void> {
  const { apiBase, pathOrUrl, suggestedFilename = 'download', headers = {} } = options;

  const url = resolveUrl(apiBase, pathOrUrl);
  const res = await fetch(url, { method: 'GET', headers });

  if (!res.ok) {
    let detail = '';
    try {
      const json = await res.json();
      detail = json?.detail || '';
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(detail || `Download failed (HTTP ${res.status})`);
  }

  // Parse filename from Content-Disposition
  const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
  const filename = parseFilename(cd, suggestedFilename);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}
