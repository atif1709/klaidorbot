
Normal login creates a browser session cookie with a server-side lifetime of 24 hours. **Remember Me** creates a persistent cookie and session valid for 30 days. Logout invalidates the current session.

Passwords use Node's asynchronous scrypt with per-user random salts. Recovery codes and session tokens are random 256-bit values stored as SHA-256 hashes. Cookies are HttpOnly and SameSite=Lax. The API validates JSON input, enforces account ownership and checks browser origins on mutations. Account endpoints share a limit of 30 requests per connection IP per 15 minutes. This limiter is in memory and resets on restart. It intentionally ignores client-supplied forwarded IP headers; behind a proxy it limits the proxy connection IP.

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

FAQ endpoints and chat require a session. Questions support 1–500 characters, answers 1–5,000 characters, and workspaces up to 1,000 FAQs. The server only serves explicitly allowed frontend assets; it never exposes the database or backend source files.

## Verification

```bash
npm test
```

Tests use isolated temporary databases and cover credential validation, password/token storage, cookie lifetimes, login/logout, recovery rotation and revocation, origin rejection, rate limiting, private FAQ ownership, CRUD, answers, and persistence across restart.

## How the files work together

`npm start` runs `server.js`, which serves the HTML, styles, JavaScript modules and API from the same origin. Open the server URL rather than opening HTML files directly or running a separate static-file server.

- `index.html` → `login.js` → shared `api.js` → account/session endpoints → SQLite.
- After successful authentication, `/workspace` → `workspace.html` + `workspace.css` + `workspace.js`.
- Workspace startup checks the session, then loads saved FAQs before enabling editing or chat. A failed load offers a retry.
- Saving/deleting FAQs, asking the assistant and logging out are coordinated so only one workspace operation runs at a time. UI changes follow successful API responses. A failed save keeps the draft for retry.
- Login waits for the initial session check. Signup/recovery preserves the entered values while submitting and only proceeds after the server responds.

Network requests remain asynchronous so the browser stays responsive; dependent operations are awaited in order. The API rejects malformed responses rather than treating them as successful operations.

## Unified page and Google Sites

Open `/embed` for the merged single-page experience. `npm run build` combines the current login/workspace HTML, CSS and JavaScript into `embed.html`; `npm start` and `npm test` build it automatically. Source modules remain editable, so the standalone pages and merged page share the same behavior.

For a Google Sites embed, follow [docs/google-sites.md](docs/google-sites.md). The app requires a public HTTPS backend; paste one iframe snippet pointing to `/embed` into Google Sites. The embedded client uses separate bearer sessions with cookie credentials omitted, scoped framing permissions, and in-memory fallback when browser storage is unavailable. Set `EMBED_ANCESTORS` to include your Google Sites custom domain if needed.
