import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, configureEmbeddedClient, errorMessage } from './api.js';

test('API requests parse responses, serialize bodies, and report malformed responses', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (path, options) => {
    request = { path, options };
    return new Response(JSON.stringify({ saved: true }), { status: 200 });
  };

  try {
    assert.deepEqual(await api('/api/faqs', { method: 'POST', body: { question: 'Hours?' } }), { saved: true });
    assert.equal(request.path, '/api/faqs');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.options.body, JSON.stringify({ question: 'Hours?' }));

    globalThis.fetch = async () => new Response('not json', { status: 502 });
    await assert.rejects(api('/api/me'), error => {
      assert.equal(error.status, 502);
      assert.match(error.message, /invalid response/i);
      return true;
    });
    assert.equal(errorMessage(new TypeError('offline')), 'Unable to reach the server. Check your connection and try again.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('embedded API restores, saves, and clears bearer sessions', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const makeStorage = entries => {
    const values = new Map(Object.entries(entries));
    return {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    };
  };
  const localStorage = makeStorage({
    'klaidorbot.embed.session': JSON.stringify({ token: 'a'.repeat(64), expiresAt: Date.now() + 60000 }),
  });
  const sessionStorage = makeStorage({});
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    configureEmbeddedClient();
    globalThis.fetch = async (_path, options) => {
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers['X-Klaidorbot-Client'], 'embed');
      assert.equal(options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
      return new Response(JSON.stringify({ user: { username: 'test' } }), { status: 200 });
    };
    await api('/api/me');

    globalThis.fetch = async (_path, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
      return new Response(JSON.stringify({
        sessionToken: 'b'.repeat(64),
        expiresAt: Date.now() + 120000,
      }), { status: 200 });
    };
    await api('/api/login', { method: 'POST', body: { remember: true } });
    assert.equal(JSON.parse(localStorage.getItem('klaidorbot.embed.session')).token, 'b'.repeat(64));
    assert.equal(sessionStorage.getItem('klaidorbot.embed.session'), null);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Expired' }), { status: 401 });
    await assert.rejects(api('/api/me'), error => error.status === 401);
    assert.equal(localStorage.getItem('klaidorbot.embed.session'), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});
