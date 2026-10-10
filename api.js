let embedded = false;
let session = null;
const storageKey = 'klaidorbot.embed.session';
function storage(name) { try { return window[name]; } catch { return null; } }
function readSession(name) {
  try {
    const value = JSON.parse(storage(name)?.getItem(storageKey) || 'null');
    return value && /^[a-f0-9]{64}$/.test(value.token) && value.expiresAt > Date.now() ? value : null;
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
