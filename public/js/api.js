// Klient API: obsługa sesji (ciasteczko), tokenu CSRF i błędów.

let csrfToken = null;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.fields = (data && data.fields) || {};
    this.data = data || {};
  }
}

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/csrf', { credentials: 'same-origin' });
  const body = await res.json();
  csrfToken = body.csrfToken;
  return csrfToken;
}

export function setCsrf(token) {
  if (token) csrfToken = token;
}

export function resetCsrf() {
  csrfToken = null;
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, url, body, { retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  const opts = { method, headers, credentials: 'same-origin' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await ensureCsrf();
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api${url}`, opts);
  } catch {
    throw new ApiError(0, 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return data;

  // Token CSRF mógł wygasnąć wraz z sesją — pobieramy nowy i ponawiamy raz.
  if (res.status === 403 && retry && method !== 'GET' && data && /Odśwież stronę/.test(data.error || '')) {
    csrfToken = null;
    return request(method, url, body, { retry: false });
  }
  if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
  throw new ApiError(res.status, (data && data.error) || 'Wystąpił błąd. Spróbuj ponownie.', data);
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
};
