const ROOT = '/api';
export async function api(path, options = {}) {
  const token = localStorage.getItem('sms_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  const response = await fetch(`${ROOT}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('sms-logout'));   // expired session
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
export const date = value => value ? new Date(value).toLocaleDateString('en-IN') : '—';
