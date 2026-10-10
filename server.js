import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsernameBloomFilter } from './username-bloom.js';

const root = dirname(fileURLToPath(import.meta.url));
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('hex');
const cookieName = 'klaidorbot_session';
const day = 86400000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Send a valid JSON object.'); }
}

function textField(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new HttpError(400, `${name} must contain ${min}–${max} characters.`);
  }
  return value.trim();
}

function usernameField(value) {
  const username = textField(value, 'Username', 3, 32).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new HttpError(400, 'Use letters, numbers, periods, underscores or hyphens for your username.');
  }
  return username;
}

function passwordField(value, isNew = false) {
  if (typeof value !== 'string' || value.length < (isNew ? 12 : 1) || value.length > 128) {
    throw new HttpError(400, `Password must contain ${isNew ? 12 : 1}–128 characters.`);
  }
  return value;
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64)).toString('hex');
  return { salt, hash };
}

function answerFromFaqs(question, faqs) {
  const normalize = value => value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const stop = new Set(['a', 'an', 'the', 'is', 'are', 'do', 'does', 'i', 'you', 'my', 'your', 'can', 'how', 'what', 'when', 'where', 'to', 'of', 'for', 'it']);
  const normalized = normalize(question);
  const exact = faqs.find(faq => normalize(faq.question) === normalized);
  if (exact) return exact;
  const words = [...new Set(normalized.split(' ').filter(word => word && !stop.has(word)))];
  if (!words.length) return null;
  const ranked = faqs.map(faq => {
    const candidate = new Set(normalize(faq.question).split(' '));
    return { faq, score: words.filter(word => candidate.has(word)).length / words.length };
  }).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.5 || (ranked[1] && ranked[0].score === ranked[1].score)) return null;
  return ranked[0].faq;
}

export async function createApp({
  dbPath = process.env.DB_PATH || resolve(root, 'data/klaidorbot.sqlite'),
  secureCookies = process.env.NODE_ENV === 'production',
  appOrigin = process.env.APP_ORIGIN || '',
  embedAncestors = process.env.EMBED_ANCESTORS || 'https://sites.google.com https://*.googleusercontent.com',
  authLimit = 30,
  publicChatLimit = 60,
  now = Date.now,
} = {}) {
  if (appOrigin) appOrigin = new URL(appOrigin).origin;
  const ancestors = embedAncestors.trim().split(/\s+/);
  if (!ancestors.every(value => /^https:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?$/i.test(value))) {
    throw new Error('EMBED_ANCESTORS must list HTTPS origins, optionally with a wildcard subdomain.');
  }
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS faqs (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL, answer TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS faqs_user ON faqs(user_id);`);
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'kind')) {
    db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'cookie'");
  }
  const usernameBloom = new UsernameBloomFilter();
  for (const { username } of db.prepare('SELECT username FROM users').iterate()) {
    usernameBloom.add(username);
  }
  const dummy = await passwordHash(randomToken());
  const attempts = new Map();
  const publicChatAttempts = new Map();
  const cleanup = setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    for (const limits of [attempts, publicChatAttempts]) {
      for (const [key, value] of limits) if (value.until <= now()) limits.delete(key);
    }
  }, 60000).unref();

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`;
  const isEmbed = req => req.headers['x-klaidorbot-client'] === 'embed';
  const tokenFrom = req => isEmbed(req)
    ? (/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1] || '')
    : req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const getUser = req => db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND sessions.kind = ?`).get(digest(tokenFrom(req)), now(), isEmbed(req) ? 'embed' : 'cookie');
  const newSession = (req, res, userId, remember) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').run(digest(tokenFrom(req)), now());
    const token = randomToken();
    const duration = remember ? 30 * day : day;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, kind) VALUES (?, ?, ?, ?)').run(digest(token), userId, now() + duration, isEmbed(req) ? 'embed' : 'cookie');
    if (isEmbed(req)) return { sessionToken: token, expiresAt: now() + duration };
    res.setHeader('Set-Cookie', cookie(token, remember ? duration / 1000 : undefined));
    return {};
  };
  function rateLimit(req, res, limits = attempts, limit = authLimit, message = 'Too many account attempts. Please try again in 15 minutes.') {
    const key = req.socket.remoteAddress;
    let entry = limits.get(key);
    if (!entry || entry.until <= now()) {
      if (!entry && limits.size >= 10000) throw new HttpError(429, 'Please try again later.');
      entry = { count: 0, until: now() + 15 * 60000 };
      limits.set(key, entry);
    }
    if (++entry.count > limit) {
      res.setHeader('Retry-After', Math.ceil((entry.until - now()) / 1000));
      throw new HttpError(429, message);
    }
  }

  const assets = new Map([
    ['/embed', ['embed.html', 'text/html']],
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ['/login.js', ['login.js', 'text/javascript']], ['/api.js', ['api.js', 'text/javascript']],
    ['/workspace', ['workspace.html', 'text/html']], ['/workspace.js', ['workspace.js', 'text/javascript']],
    ['/workspace.css', ['workspace.css', 'text/css']],
    ['/public-chat.js', ['public-chat.js', 'text/javascript']],
    ['/public-chat.css', ['public-chat.css', 'text/css']],
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const method = req.method;
      if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
      if (!path.startsWith('/api/')) {
        const publicChat = /^\/chat\/[a-z0-9._-]{3,32}$/i.test(path);
        const asset = publicChat ? ['chat.html', 'text/html'] : assets.get(path);
        if (!asset || !['GET', 'HEAD'].includes(method)) throw new HttpError(404, 'Page not found.');
        if (path === '/workspace' && !getUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
        const body = readFileSync(resolve(root, asset[0]));
        if (path === '/embed' || publicChat) {
          const script = body.toString().match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
          if (path === '/embed' && !script) throw new Error('Missing embed bundle; run npm run build.');
          res.removeHeader('X-Frame-Options');
          const scriptPolicy = script ? ` 'sha256-${createHash('sha256').update(script).digest('base64')}'` : '';
          res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${scriptPolicy}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' ${ancestors.join(' ')}; base-uri 'none'; form-action 'self'`);
        }
        res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        return res.end(method === 'HEAD' ? undefined : body);
      }
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Method not allowed.');
      if (method !== 'GET') {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Invalid request origin.'); }
          const matches = appOrigin ? origin.origin === appOrigin : ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
          if (!matches) throw new HttpError(403, 'Invalid request origin.');
        }
      }
      const publicChatMatch = /^\/api\/public\/chat\/([a-z0-9._-]{3,32})$/i.exec(path);
      if (publicChatMatch) {
        if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
        rateLimit(req, res, publicChatAttempts, publicChatLimit, 'Too many chatbot questions. Please try again later.');
        const username = publicChatMatch[1].toLowerCase();
        const body = await readJson(req);
        const question = textField(body.question, 'Question', 1, 500);
        const owner = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (!owner) throw new HttpError(404, 'This chatbot is unavailable.');
        const faqs = db.prepare('SELECT id, question, answer FROM faqs WHERE user_id = ? ORDER BY id DESC').all(owner.id);
        const faq = answerFromFaqs(question, faqs);
        return json(res, 200, {
          answer: faq?.answer || 'I couldn’t find a clear answer in these FAQs. Please contact the business for help.',
          source: faq ? { question: faq.question } : null,
        });
      }
      if (['/api/register', '/api/login', '/api/reset-password'].includes(path) && method === 'POST') {
        rateLimit(req, res);
        const body = await readJson(req);
        const username = usernameField(body.username);
        const password = passwordField(body.password, path !== '/api/login');
        if (body.remember !== undefined && typeof body.remember !== 'boolean') throw new HttpError(400, 'Remember me must be a boolean.');
        const user = path === '/api/register'
          ? (usernameBloom.mightContain(username) ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) : undefined)
          : db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (path === '/api/register') {
          const { salt, hash } = await passwordHash(password);
          if (user) throw new HttpError(409, 'That username is unavailable.');
          const recoveryCode = randomToken();
          let result;
          try { result = db.prepare('INSERT INTO users (username, salt, password_hash, recovery_hash) VALUES (?, ?, ?, ?)').run(username, salt, hash, digest(recoveryCode)); }
          catch (error) {
            if (error.errcode === 2067) throw new HttpError(409, 'That username is unavailable.');
            throw error;
          }
          usernameBloom.add(username);
          const session = newSession(req, res, Number(result.lastInsertRowid), body.remember === true);
          return json(res, 201, { user: { id: Number(result.lastInsertRowid), username }, recoveryCode, ...session });
        }
        if (path === '/api/login') {
          const candidate = await derive(password, user?.salt || dummy.salt, 64);
          const valid = timingSafeEqual(candidate, Buffer.from(user?.password_hash || dummy.hash, 'hex'));
          if (!valid || !user) throw new HttpError(401, 'Incorrect username or password.');
          // A reset may have revoked these credentials while scrypt was running.
          const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
          if (current.password_hash !== user.password_hash) throw new HttpError(401, 'Incorrect username or password.');
          const session = newSession(req, res, user.id, body.remember === true);
          return json(res, 200, { user: { id: user.id, username }, ...session });
        }
        const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
        if (!/^[a-f0-9]{64}$/.test(recoveryCode) || !user || !timingSafeEqual(Buffer.from(digest(recoveryCode), 'hex'), Buffer.from(user.recovery_hash, 'hex'))) {
          throw new HttpError(400, 'Incorrect username or recovery code.');
        }
        const { salt, hash } = await passwordHash(password);
        const nextCode = randomToken();
        db.exec('BEGIN IMMEDIATE');
        try {
          const changed = db.prepare('UPDATE users SET salt = ?, password_hash = ?, recovery_hash = ? WHERE id = ? AND recovery_hash = ?').run(salt, hash, digest(nextCode), user.id, user.recovery_hash);
          if (!changed.changes) throw new HttpError(400, 'Incorrect username or recovery code.');
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        if (!isEmbed(req)) res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { recoveryCode: nextCode });
      }
      const user = getUser(req);
      if (!user) throw new HttpError(401, 'Please log in to continue.');
      if (path === '/api/me' && method === 'GET') return json(res, 200, { user });
      if (path === '/api/logout' && method === 'POST') {
        await readJson(req);
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(tokenFrom(req)));
        if (!isEmbed(req)) res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { ok: true });
      }
      const listFaqs = () => db.prepare('SELECT id, question, answer FROM faqs WHERE user_id = ? ORDER BY id DESC').all(user.id);
      if (path === '/api/faqs' && method === 'GET') return json(res, 200, { faqs: listFaqs() });
      const match = /^\/api\/faqs\/(\d+)$/.exec(path);
      if ((path === '/api/faqs' && method === 'POST') || (match && method === 'PUT')) {
        const body = await readJson(req);
        const question = textField(body.question, 'Question', 1, 500);
        const answer = textField(body.answer, 'Answer', 1, 5000);
        if (match) {
          const result = db.prepare('UPDATE faqs SET question = ?, answer = ? WHERE id = ? AND user_id = ?').run(question, answer, Number(match[1]), user.id);
          if (!result.changes) throw new HttpError(404, 'FAQ not found.');
          return json(res, 200, { faq: { id: Number(match[1]), question, answer } });
        }
        if (db.prepare('SELECT count(*) AS count FROM faqs WHERE user_id = ?').get(user.id).count >= 1000) throw new HttpError(400, 'Your workspace supports up to 1,000 FAQs.');
        const result = db.prepare('INSERT INTO faqs (user_id, question, answer) VALUES (?, ?, ?)').run(user.id, question, answer);
        return json(res, 201, { faq: { id: Number(result.lastInsertRowid), question, answer } });
      }
      if (match && method === 'DELETE') {
        await readJson(req);
        const result = db.prepare('DELETE FROM faqs WHERE id = ? AND user_id = ?').run(Number(match[1]), user.id);
        if (!result.changes) throw new HttpError(404, 'FAQ not found.');
        return json(res, 200, { ok: true });
      }
      if (path === '/api/chat' && method === 'POST') {
        const body = await readJson(req);
        const question = textField(body.question, 'Question', 1, 500);
        const faq = answerFromFaqs(question, listFaqs());
        return json(res, 200, { answer: faq?.answer || 'I couldn’t find a clear answer in your FAQs. Try another question or add an FAQ.', source: faq ? { id: faq.id, question: faq.question } : null });
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (!res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
      if (!error.status) console.error('Request failed:', error.code || error.name);
    }
  });
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const server = await createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Klaidorbot is listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
