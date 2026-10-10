import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

function bodyMarkup(html, file) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) throw new Error(`Could not find a body element in ${file}.`);
  return body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim();
}

function loginStyles(html) {
  const styles = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)?.[1];
  if (!styles) throw new Error('Could not find inline login styles in index.html.');
  return styles;
}

function shadowStyles(styles) {
  return styles
    .replace(/:root\b/g, ':host')
    .replace(/(^|[{},])(\s*)body(?=\s*(?:[.#:[>+~,{]|$))/gm, '$1$2:host');
}

function styleMarkup(styles) {
  const scoped = shadowStyles(styles);
  const imports = scoped.match(/^(?:\s*@import[^;]+;\s*)+/)?.[0] || '';
  return `<style>${imports}:host{display:block}[hidden]{display:none!important}\n${scoped.slice(imports.length)}\n</style>`;
}

const index = read('index.html');
const workspace = read('workspace.html');
const loginMarkup = `${styleMarkup(loginStyles(index))}\n${bodyMarkup(index, 'index.html')}`;
const workspaceMarkup = `${styleMarkup(read('workspace.css'))}\n${bodyMarkup(workspace, 'workspace.html')}`;
const script = `
import { configureEmbeddedClient } from '/api.js';
import { mountLogin } from '/login.js';
import { mountWorkspace } from '/workspace.js';

configureEmbeddedClient();
const host = document.querySelector('#klaidorbot');
if (!host) throw new Error('Missing embed host element.');
const root = host.attachShadow({ mode: 'open' });
const loginMarkup = ${JSON.stringify(loginMarkup)};
const workspaceMarkup = ${JSON.stringify(workspaceMarkup)};

async function showLogin() {
  root.innerHTML = loginMarkup;
  await mountLogin({ root, navigate: showWorkspace });
}

async function showWorkspace() {
  root.innerHTML = workspaceMarkup;
  await mountWorkspace({ root, navigate: showLogin });
}

await showLogin();
`.trim();

const output = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Klaidorbot · FAQ workspace</title>
  <style>body{margin:0;background:#fafbf7}#klaidorbot{display:block;min-height:100vh}</style>
</head>
<body>
  <div id="klaidorbot"></div>
  <noscript>Enable JavaScript to use Klaidorbot.</noscript>
  <script type="module">${script}</script>
</body>
</html>
`;

writeFileSync(resolve(root, 'embed.html'), output);
