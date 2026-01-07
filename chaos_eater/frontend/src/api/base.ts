/**
 * Make a JSON API request
 */
export async function fetchJSON<T = unknown>(
  apiBase: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { headers: initHeaders, ...restInit } = init;
  const res = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    ...restInit,
    headers: { 'Content-Type': 'application/json', ...((initHeaders as Record<string, string>) || {}) },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json() as Promise<T>;
  }

  return res.text() as unknown as T;
}

/**
 * Make a POST request with JSON body
 */
export async function postJSON<T = unknown, B = unknown>(
  apiBase: string,
  path: string,
  body: B,
  init: RequestInit = {}
): Promise<T> {
  return fetchJSON<T>(apiBase, path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...init,
  });
}
