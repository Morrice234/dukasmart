const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export function getToken() {
  return localStorage.getItem('admin_token');
}

export function setToken(t) {
  if (t) localStorage.setItem('admin_token', t);
  else localStorage.removeItem('admin_token');
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    setToken(null);
    window.location.reload();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Downloads a file from an admin endpoint (keeps the auth header, unlike a plain link)
export async function apiDownload(path, filename) {
  const res = await fetch(`${API_URL}/api/admin${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) { alert('Download failed'); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ksh = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
