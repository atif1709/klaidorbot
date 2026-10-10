
Normal login creates a browser session cookie with a server-side lifetime of 24 hours. **Remember Me** creates a persistent cookie and session valid for 30 days. Logout invalidates the current session.

Usernames accept 3–32 letters, numbers, periods, underscores or hyphens and are normalized to lowercase. A startup-loaded Bloom filter avoids unnecessary duplicate-name database lookups; SQLite's unique constraint remains authoritative, so Bloom-filter false positives never reject a valid new account. Passwords use Node's asynchronous scrypt with per-user random salts. Recovery codes and session tokens are random 256-bit values stored as SHA-256 hashes. Cookies are HttpOnly and SameSite=Lax. The API validates JSON input, enforces account ownership and checks browser origins on mutations. Account endpoints share a limit of 30 requests per connection IP per 15 minutes. This limiter is in memory and resets on restart. It intentionally ignores client-supplied forwarded IP headers; behind a proxy it limits the proxy connection IP.

For public hosting, use HTTPS, `NODE_ENV=production`, the correct `APP_ORIGIN`, and a persistent private database volume. Deploy this as one application instance; multi-instance hosting needs coordinated rate limiting and database infrastructure. Back up SQLite using its backup API or a consistent offline snapshot, including WAL state where applicable. Replace the terms/privacy placeholders and generic social homepage links with your actual pages before public launch.

## API

All mutation requests require `Content-Type: application/json`. Responses are JSON; errors use `{ "error": "message" }`. Browser requests use the same origin and session cookie.

| Method | Route | Body / purpose |
| --- | --- | --- |
| GET | `/api/health` | Readiness |
| POST | `/api/register` | `username`, `password`; optional boolean `remember`. Returns user and recovery code once. |
| POST | `/api/login` | `username`, `password`, optional boolean `remember` |
| POST | `/api/reset-password` | `username`, `password` (new), `recoveryCode`. Returns replacement recovery code once. |
| GET | `/api/me` | Current user; requires session |
| POST | `/api/logout` | `{}`; requires session |
| GET | `/api/faqs` | List current user's FAQs |
| POST | `/api/faqs` | `question`, `answer` |
| PUT | `/api/faqs/:id` | `question`, `answer` |
| DELETE | `/api/faqs/:id` | `{}` |
| POST | `/api/chat` | `question`; returns `answer` and optional `source` |
| POST | `/api/public/chat/:username` | Public FAQ answer for the named account; no login required |

FAQ endpoints and chat require a session. Questions support 1–500 characters, answers 1–5,000 characters, and workspaces up to 1,000 FAQs. The server only serves explicitly allowed frontend assets; it never exposes the database or backend source files.

## Verification

```bash
npm test
```

The test suite covers the shared API client's same-origin and embedded bearer-session behavior, generated embed assets, cookie and bearer authentication, FAQ/chat requests, and cross-origin mutation rejection.

## How the files work together

`npm start` runs `server.js`, which serves the HTML, styles, JavaScript modules and API from the same origin. Open the server URL rather than opening HTML files directly or running a separate static-file server.

- `index.html` → `login.js` → shared `api.js` → account/session endpoints → SQLite.
- After successful authentication, `/workspace` → `workspace.html` + `workspace.css` + `workspace.js`.
- Workspace startup checks the session, then loads saved FAQs before enabling editing or chat. A failed load offers a retry.
- Saving/deleting FAQs, asking the assistant and logging out are coordinated so only one workspace operation runs at a time. UI changes follow successful API responses. A failed save keeps the draft for retry.
- Login waits for the initial session check. Signup/recovery preserves the entered values while submitting and only proceeds after the server responds.

Network requests remain asynchronous so the browser stays responsive; dependent operations are awaited in order. The API rejects malformed responses rather than treating them as successful operations.

## Unified page and Google Sites

Open `/embed` for the merged single-page experience. `npm run build` combines the current login/workspace HTML and CSS into `embed.html`; `npm start` and `npm test` build it automatically. The bundle mounts the same login/workspace modules used by the standalone pages and imports their shared `api.js` client.

The workspace displays a public chat link and an iframe snippet. Anyone who opens that link can ask questions answered from **all FAQs in that account's workspace**; answers only expose the matching answer and its question. Public questions are rate-limited. For a Google Sites embed, use the snippet from the workspace and follow [docs/google-sites.md](docs/google-sites.md). The app requires a public HTTPS backend, and `EMBED_ANCESTORS` must include any custom embedding domain. `/embed` remains the login-and-workspace experience; use the account-specific `/chat/:username` link for a visitor-facing chatbot.

The embedded owner experience uses separate bearer sessions with cookie credentials omitted and falls back to in-memory sessions when browser storage is unavailable.
