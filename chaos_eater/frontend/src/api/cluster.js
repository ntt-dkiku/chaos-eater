// cluster cleaning
export async function cleanCluster(API_BASE, { kube_context, namespace, project_name }) {
    const res = await fetch(`${API_BASE}/clusters/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kube_context,
        namespace,
        project_name
      })
    });
  
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.cleaned !== true) {
      const msg = json?.error || `Clean failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  }
  