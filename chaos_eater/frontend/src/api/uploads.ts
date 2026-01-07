/**
 * Response from file upload endpoint
 */
export interface UploadResponse {
  project_path: string;
}

/**
 * Upload a zip file to the backend and return the project path
 */
export async function uploadZipToBackend(
  apiBase: string,
  file: File
): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${apiBase}/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${text || res.statusText}`);
  }

  const json: UploadResponse = await res.json();
  if (!json?.project_path) {
    throw new Error('Server did not return project_path');
  }

  return json.project_path;
}
