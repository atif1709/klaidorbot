let embedded = false;
let session = null;
const storageKey = 'klaidorbot.embed.session';

function storage(name) {
  try { return window[name]; }
  catch { return null; }
}

function readSession(name) {
  try {
    const value = JSON.parse(storage(name)?.getItem(storageKey) || 'null');
    return value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof value.token === 'string'
      && /^[a-f0-9]{64}$/.test(value.token)
      && Number.isFinite(value.expiresAt)
      && value.expiresAt > Date.now()
      ? { token: value.token, expiresAt: value.expiresAt }
      : null;
  } catch { return null; }
}

function clearSession() {
  session = null;
  for (const name of ['sessionStorage', 'localStorage']) {
    try { storage(name)?.removeItem(storageKey); } catch { /* Storage may be blocked in an embed. */ }
  }
}

export function configureEmbeddedClient() {
  embedded = true;
  session = readSession('localStorage') || readSession('sessionStorage');
}

function saveSession(data, remember) {
  clearSession();
  session = { token: data.sessionToken, expiresAt: data.expiresAt };
  try { storage(remember ? 'localStorage' : 'sessionStorage')?.setItem(storageKey, JSON.stringify(session)); }
  catch { /* In-memory login continues to work when embedded storage is blocked. */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: embedded ? 'omit' : 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(embedded ? {
        'X-Klaidorbot-Client': 'embed',
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data;
  try {
    data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
  } catch {
    const error = new Error('The server returned an invalid response. Please try again.');
    error.status = response.status;
    throw error;
  }

  if (embedded && response.status === 401 && path !== '/api/login') clearSession();
  if (!response.ok) {
    const error = new Error(data.error || 'The server could not complete your request.');
    error.status = response.status;
    throw error;
  }

  if (embedded) {
    if ((path === '/api/register' || path === '/api/login') && data.sessionToken) {
      saveSession(data, body?.remember === true);
    }
    if (path === '/api/logout' || path === '/api/reset-password') clearSession();
  }
  return data;
}

export function errorMessage(error) {
  return error instanceof TypeError
    ? 'Unable to reach the server. Check your connection and try again.'
    : error.message;
}
