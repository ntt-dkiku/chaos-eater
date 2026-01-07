/**
 * Response from save API key endpoint
 */
export interface SaveApiKeyResponse {
  provider: string;
  configured: boolean;
}

/**
 * Check if a provider has an API key configured
 */
export async function checkProviderStatus(
  apiBase: string,
  provider: string
): Promise<boolean> {
  if (!provider) return false;

  try {
    const res = await fetch(`${apiBase}/config/api-key?provider=${encodeURIComponent(provider)}`);
    const info = await res.json();
    return !!info?.configured;
  } catch {
    return false;
  }
}

/**
 * Save an API key for a provider
 */
export async function saveApiKey(
  apiBase: string,
  provider: string,
  apiKey: string
): Promise<SaveApiKeyResponse> {
  if (!provider) {
    throw new Error('Unknown provider');
  }
  if (!apiKey?.trim()) {
    throw new Error('API Key is empty');
  }

  const res = await fetch(`${apiBase}/config/api-key?persist=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey.trim() }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}
