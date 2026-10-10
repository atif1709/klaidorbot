import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('generated embed scopes styles and loads the shared frontend modules', () => {
  const html = readFileSync(new URL('./embed.html', import.meta.url), 'utf8');
  const importIndex = html.indexOf('@import url(');
  const hostStyleIndex = html.indexOf(':host{display:block}');
  assert.notEqual(importIndex, -1);
  assert.ok(importIndex < hostStyleIndex);
  assert.match(html, /\.chat-body\s*\{/);
  assert.doesNotMatch(html, /\.chat-:host/);
  assert.match(html, /from '\/api\.js'/);
  assert.match(html, /from '\/login\.js'/);
  assert.match(html, /from '\/workspace\.js'/);
  assert.match(html, /public-chat-link/);
  assert.match(html, /public-embed-code/);
});
