import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './server.js';

async function withServer(options, run) {
  const directory = mkdtempSync(join(tmpdir(), 'klaidorbot-test-'));
  const server = await createApp({ dbPath: join(directory, 'app.sqlite'), ...options });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

function jsonRequest(origin, path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(new URL(path, origin), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('cookie sessions register, manage FAQs, and log out', async () => {
  await withServer({}, async origin => {
    const registration = await jsonRequest(origin, '/api/register', {
      method: 'POST',
      body: { username: 'test.user', password: 'correct-horse-battery' },
    });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const sessionCookie = cookie.split(';', 1)[0];

    const me = await jsonRequest(origin, '/api/me', { headers: { Cookie: sessionCookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.username, 'test.user');

    const duplicate = await jsonRequest(origin, '/api/register', {
      method: 'POST',
      body: { username: 'TEST.USER', password: 'correct-horse-battery' },
    });
    assert.equal(duplicate.status, 409);

    const created = await jsonRequest(origin, '/api/faqs', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: { question: 'When are you open?', answer: 'Weekdays.' },
    });
    assert.equal(created.status, 201);
    const { faq } = await created.json();

    const chat = await jsonRequest(origin, '/api/chat', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: { question: 'When are you open?' },
    });
    assert.deepEqual(await chat.json(), {
      answer: 'Weekdays.',
      source: { id: faq.id, question: 'When are you open?' },
    });

    const publicChat = await jsonRequest(origin, '/api/public/chat/test.user', {
      method: 'POST',
      body: { question: 'When are you open?' },
    });
    assert.equal(publicChat.status, 200);
    assert.deepEqual(await publicChat.json(), {
      answer: 'Weekdays.',
      source: { question: 'When are you open?' },
    });

    const noMatch = await jsonRequest(origin, '/api/public/chat/test.user', {
      method: 'POST',
      body: { question: 'What color is the moon?' },
    });
    assert.equal(noMatch.status, 200);
    assert.equal((await noMatch.json()).source, null);

    const logout = await jsonRequest(origin, '/api/logout', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: {},
    });
    assert.equal(logout.status, 200);
    const expired = await jsonRequest(origin, '/api/me', { headers: { Cookie: sessionCookie } });
    assert.equal(expired.status, 401);
  });
});

test('public chatbot page can be embedded and its question endpoint is rate limited', async () => {
  await withServer({ publicChatLimit: 1, embedAncestors: 'https://sites.google.com' }, async origin => {
    const registration = await jsonRequest(origin, '/api/register', {
      method: 'POST',
      body: { username: 'shared-bot', password: 'correct-horse-battery' },
    });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get('set-cookie').split(';', 1)[0];
    const created = await jsonRequest(origin, '/api/faqs', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: { question: 'Where are you?', answer: 'In the cloud.' },
    });
    assert.equal(created.status, 201);

    const page = await fetch(`${origin}/chat/shared-bot`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/sites\.google\.com/);
    assert.equal(page.headers.get('x-frame-options'), null);
    assert.match(await page.text(), /public-chat\.js/);

    const answer = await jsonRequest(origin, '/api/public/chat/shared-bot', {
      method: 'POST',
      body: { question: 'Where are you?' },
    });
    assert.equal(answer.status, 200);

    const limited = await jsonRequest(origin, '/api/public/chat/shared-bot', {
      method: 'POST',
      body: { question: 'Where are you?' },
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  });
});

test('embedded sessions use bearer tokens and reject cross-origin mutations', async () => {
  await withServer({}, async origin => {
    const embeddedHeaders = { 'X-Klaidorbot-Client': 'embed' };
    const registration = await jsonRequest(origin, '/api/register', {
      method: 'POST',
      headers: embeddedHeaders,
      body: { username: 'embed-user', password: 'correct-horse-battery' },
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.headers.get('set-cookie'), null);
    const { sessionToken } = await registration.json();
    assert.match(sessionToken, /^[a-f0-9]{64}$/);

    const me = await jsonRequest(origin, '/api/me', {
      headers: { ...embeddedHeaders, Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.username, 'embed-user');

    const rejected = await jsonRequest(origin, '/api/faqs', {
      method: 'POST',
      headers: { ...embeddedHeaders, Origin: 'https://attacker.example' },
      body: { question: 'Test?', answer: 'No.' },
    });
    assert.equal(rejected.status, 403);
  });
});
