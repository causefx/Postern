export async function readBody(res) {
  return res.json().catch(() => ({}));
}

/** Error thrown by admin API calls. Login uses the same shape without the 401 redirect. */
export function errorFromResponse(res, body, fallback) {
  const err = new Error((body && body.error) || fallback || res.statusText || 'Request failed');
  err.errors = (body && body.errors) || null;
  err.status = res.status;
  return err;
}

async function request(path, opts = {}) {
  // Use origin without userinfo — fetch rejects URLs that inherit embedded credentials.
  const res = await fetch(`${location.protocol}//${location.host}/admin/api/${path}`, {
    ...opts,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Postern-Admin': '1',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && !path.startsWith('login')) {
    location.replace('/admin/login');
    throw new Error('unauthorized');
  }
  if (res.status === 204) return null;
  const j = await readBody(res);
  if (!res.ok) throw errorFromResponse(res, j);
  return j;
}

export const api = {
  meta: () => request('meta'),
  listServices: () => request('services'),
  createService: (body) => request('services', { method: 'POST', body: JSON.stringify(body) }),
  updateService: (name, body) => request('services/' + encodeURIComponent(name), { method: 'PUT', body: JSON.stringify(body) }),
  setEnabled: (name, enabled) => request('services/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  rotateToken: (name) => request('services/' + encodeURIComponent(name) + '/rotate', { method: 'POST', body: '{}' }),
  deleteService: (name) => request('services/' + encodeURIComponent(name), { method: 'DELETE' }),
  testConnection: (body) => request('services/test', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('logout', { method: 'POST', body: '{}' }),
};
