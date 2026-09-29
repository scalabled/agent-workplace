# Deploying Headcount to Cloudflare (test)

## Current status (2026-09-29)

**Owner decisions:**
- Sign-in is **Google sign-in** with an owner allowlist. Cloudflare Access (§4.1, §4.3) is superseded.
- Local data is **migrated**, not regenerated.

**Done on the account** (`Greg@scalabledynamicsllc.com's Account`, id `371ba7aa…44c0`, **Workers Free plan**):

| Resource | State |
|---|---|
| Worker `headcount` | Live as a **placeholder** (`apps/worker/placeholder/`) at https://headcount.greg-371.workers.dev. It serves a "coming soon" page, answers 503 on `/api/*` and reads no secret. |
| Secrets on `headcount` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, uploaded from `.dev.vars` (API keys only, never printed). |
| D1 `headcount` | `080a0f85-f9fe-4aa5-9dc5-08e025f0e951` (ENAM). Migrations 0001–0002 applied; **0003_auth.sql is still to apply**. |
| R2 `headcount-blobs` | Private. It holds the migrated data. |
| Migrated data | 1,376 objects (72.5 MiB): 176 portraits, 1,198 clips and 2 workspace clips, all with customMetadata. D1 has 176 portrait rows, all with landmarks. |
| Deploy config | `apps/worker/wrangler.deploy.jsonc` has the real ids, `AUTH_MODE=google`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, production vars and test limits. |

**Built (Phase B):**
- `apps/worker/src/auth/auth.ts` provides Google OAuth with PKCE, hashed one-time state, a verified email checked against `OWNER_EMAILS`, and hashed sessions in D1 (`0003_auth.sql`). It fails closed on any non-loopback host.
- `index.ts` gates every `/api` route and the feed socket, except health and the landing's read-only portraits. `POST /api/media/image` is gated behind `ENABLE_MEDIA_TOOLS`. Tests: `apps/worker/test/auth.test.ts`.
- `apps/web/public/_headers` holds the security headers with a report-only CSP. `.assetsignore` excludes `dev/` and `*.map`.

**Owner steps left:**
1. Set these secrets: `wrangler secret put GOOGLE_CLIENT_SECRET --name headcount` and `wrangler secret put OWNER_EMAILS --name headcount`.
2. Make sure the Google OAuth client's redirect URIs include `https://headcount.greg-371.workers.dev/api/auth/callback` and `http://localhost:5173/api/auth/callback`.
3. Recommended: switch to **Workers Paid** ($5/mo), because Free allows 10 ms CPU per request (H5).
4. Approve the real deploy, which replaces the placeholder.

Local sign-in testing: add `AUTH_MODE=google`, `APP_ORIGIN=http://localhost:5173`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `OWNER_EMAILS` to `apps/worker/.dev.vars`. Without them, localhost stays open.

---

## Original audit (for reference)

The sections below are the Phase A audit. Where they say Cloudflare Access or `headcount-test`, read Google sign-in and `headcount`.

Files in this kit:

| File | What it is |
|---|---|
| `apps/worker/wrangler.deploy.jsonc` | The live test config, created from `wrangler.deploy.example.jsonc`. |
| `scripts/deploy-preflight.mjs` | Offline checks before every deploy: config, build, secrets scan, size and auth. Exits 1 on a blocker. |
| `scripts/migrate-local-data.mjs` | Moves the local portraits, landmarks and clips. Dry run by default; `--execute` uploads. |
| `scripts/test/*.test.mjs` | `node --test scripts/test/*.test.mjs`. |

---

## 1. Target shape

```
owner's browser ─https─► Cloudflare Access (owner's e-mail only; one-time PIN or Google)
                         │
                         ▼  headcount-test.<account-subdomain>.workers.dev   (the only hostname; preview URLs off)
             ┌───────────┴────────────────────────────────────────────┐
             │ /api/* and /api/ws  (run_worker_first)                  │ every other path
             ▼                                                         ▼
   Worker src/index.ts: origin/host guard → Access JWT check    Static Assets from apps/web/dist
     → routes → WorkspaceDO · ProjectDO · RunDO (RoomDO stub)     SPA fallback (/app/floor → index.html)
     → D1 headcount-test (records, portraits, budgets)            _headers: CSP, nosniff, immutable /assets/*
     → R2 headcount-test-blobs (private: portraits, clips)        .assetsignore: dev/, *.map
     → Anthropic / OpenAI / xAI (keys are Worker secrets)
```

One Worker (`headcount-test`) holds the SPA as Static Assets, the four SQLite-backed Durable Object classes, one D1
database and one private R2 bucket. Nothing changes in dev: Vite still serves :5173 and proxies `/api` to wrangler on
:8787 (`apps/web/vite.config.ts:26`), and `apps/worker/wrangler.jsonc` stays the dev config.

---

## 2. Gap list

Severity: a **blocker** makes the test deployment fail or be unsafe. **High** items must be fixed before provider keys
go in. **Medium** items are for during testing, and **low** items for later. "Who" says whether the owner does it
(account, dashboard, config values) or it is a code change, named by area as in `docs/dev/CONTRACTS.md` §2. Code
changes are listed with file pointers in §6.

| # | Sev. | Gap | Evidence | Change | Who |
|---|---|---|---|---|---|
| B1 | blocker | **No authentication.** Every `owner` route is open ("open locally and session-gated later"). The origin guard lets requests with no `Origin` header through (curl, scripts), so once the deployed host is allowed, anyone can call `/api/talk`, `/api/speech/tts`, `/api/portraits/:id/generate`, `/api/expr/prevoice` or `/api/media/image` on your keys. The landing also calls TTS. | `packages/protocol/src/routes.ts:13`; `apps/worker/src/lib/origin.ts:60-68`; `apps/web/src/landing/voice.ts:60` | Cloudflare Access on the hostname (§4.2), plus a Worker check of `Cf-Access-Jwt-Assertion` that fails closed off loopback (§4.3). The preflight fails until both exist. | owner (Access) + code C1 |
| B2 | blocker | **The Worker does not serve the web app.** Non-`/api` paths get a JSON 404 ("served by Vite on :5173"). | `apps/worker/src/index.ts:98`; `apps/web/vite.config.ts:26` | Static Assets block: `directory: ../web/dist`, `not_found_handling: single-page-application`, `run_worker_first: ["/api/*"]` (§3). Config only, already in the example. Verified locally (§11.3). | config (done in the example) |
| B3 | blocker | **No remote resources.** The D1 `database_id` is the all-zero placeholder. There is no R2 bucket and no account login. | `apps/worker/wrangler.jsonc:21-23` | `wrangler d1 create`, `wrangler r2 bucket create` (private), `d1 migrations apply --remote`. The first deploy creates the 4 SQLite DO classes (tag `v1`). §8.1. | owner |
| B4 | blocker | **Dev settings would ship.** `ENABLE_MOCK=true` and `MOCK_DELAY_MS=15`; `ALLOWED_ORIGINS` is localhost-only, so the deployed page would get a 403 on every call; `OLLAMA_BASE_URL=http://127.0.0.1:11434`, which `/api/capabilities` probes. | `apps/worker/wrangler.jsonc:32-40`; `lib/origin.ts:12,29,58` | A separate `wrangler.deploy.jsonc` from the example: the exact https origin, no Ollama, Mock off in the file (the smoke deploy passes Mock with `--var`). The preflight enforces all of it, plus DO and migration parity with the dev config. | owner (fill values) |
| B5 | blocker | **No deployed secrets.** Keys exist only in `apps/worker/.dev.vars`. | `.dev.vars.example`; CONTRACTS §3 "Secrets" | Keys made for this deployment, each with a provider-side monthly cap, set with `wrangler secret put` **after** Access is on. Never `wrangler secret bulk .dev.vars`: it would also push `ENABLE_MOCK`, the Ollama URL and your local keys. | owner |
| H1 | high | **A dev page ships.** `public/dev/landmarks.html` is copied into `dist/`. It does not work in production (it imports `/@id/…` from Vite), but it would be published. | `docs/dev/INC0.md:494-495`; `apps/web/public/dev/landmarks.html` | `apps/web/public/.assetsignore` with `dev/` and `*.map` (§3.3). The preflight fails while it ships. | code C2 (web) |
| H2 | high | **No security headers on the HTML.** There is no CSP, frame-ancestors, Permissions-Policy or nosniff. Hashed `/assets/*` files are revalidated on every load. | The Worker sets headers only on its own responses (`lib/http.ts:49-54`, media routes) | `apps/web/public/_headers` (§3.2). The CSP hashes the inline theme script in `index.html`: `sha256-lEADc7WDvApqYvxLx4DYrW8oMqcmFbYHdPXvJwaIbiQ=` for today's build. The hash changes when the hero image changes, and the preflight recomputes it on every build. | code C2 (web) |
| H3 | high | **A generic image-generation route is live.** `POST /api/media/image` exists for `scripts/marketing-images.mjs`. It takes any prompt and stores the result in R2. | `apps/worker/src/index.ts:103-104`; `media/media-images.ts:70-81` | Gate it behind `ENABLE_MEDIA_TOOLS=true` (404 otherwise). The example already sets `"false"`. Until the gate exists, `PORTRAIT_DAILY_LIMIT=10` caps it (the budget is shared). | code C3 (media) |
| H4 | high | **Spending limits are dev-sized.** Defaults per day: 1500 chat turns, 60 jobs, 3000 TTS, 600 STT, 200 images and 600 clips, plus 30 renders a minute. They count calls, not dollars. | `lib/limits.ts:9-18`; `expr/config.ts:5-12`; `env.ts:20-36` | The test values in the example (§5.3), provider-side monthly caps, and keys dedicated to this deployment. | owner (values are in the example) |
| H5 | high | **Workers plan.** Free allows **10 ms CPU per request**. Chat turns, prompt building from the 4.8 MB catalog, and stream parsing in the DOs will likely exceed that and fail with error 1102. Bundle size no longer matters: since 2026-09-04 only the uncompressed size counts, 64 MiB on both plans, and ours is 8.2 MiB. | §11.1 | **Workers Paid** ($5/month minimum; 30 s CPU by default). Free is fine for the keyless smoke deploy only. | owner (decision) |
| H6 | high | **Background portrait generation relies on `waitUntil`.** In production that work is cut 30 s after the response, and image providers are often slower. The web's Generate button does not use `?wait=1`, so it can leave a "generating" lock for 5 minutes and lose a paid image. | `media/portraits.ts:82-89`; `apps/web/src/lib/generate.ts:54`; `api/client.ts:90`; `portrait-store.ts:27` | Generate inside the request (`?wait=1` from the web; there is no wall-clock limit while the client is connected), or run it in a RunDO alarm. Until then, keep `PORTRAIT_DAILY_LIMIT` low or at 0. Migrating the 176 existing portraits (§7) means few new ones are needed. | code C4 (media + web) |
| H7 | high | **Local data that cost money would be lost.** Local R2 holds 176 portraits (47.0 MiB), 1,198 clip objects (25.4 MiB: about 600 clips plus sidecars), 2 workspace clips and 16 marketing originals (27.5 MiB). Local D1 has 176 portrait rows, **all with browser-measured landmarks**. | inventory in §7 | `scripts/migrate-local-data.mjs --execute` copies them with their R2 metadata. Rehearsed locally: 1,376 objects and 176 rows in 11.5 s, and a re-run skips all of them. | owner (runs it) |
| M1 | medium | **Tooling cannot reach an Access-protected Worker.** `prevoice-office.mjs`, `portraits-generate.mjs`, `voice-samples.mjs`, `marketing-images.mjs` and `landmarks-precompute.mjs` send only `Origin`. | `packages/expressions/scripts/prevoice-office.mjs:67` | Optional `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` headers (an Access service token). This is needed to pre-voice coworkers on the deployment; the app pre-voices the Chief itself. | code C5 (expressions, media) |
| M2 | medium | **To verify on the deployment:** Chief, desk and room turns, and voiced announcements, run through `ctx.waitUntil` inside the WorkspaceDO after the RPC returns. Jobs and pre-voice use alarms, which are durable. | `workspace/workspace-do.ts:418,532,637,775` | During testing, confirm that long cloud turns (reason tier) always finish. If some are cut off, move them onto an alarm, as ProjectDO does (`jobs/project-do.ts:270`). | owner verifies; code C9 if needed |
| M3 | medium | **MediaPipe loads from third-party CDNs** (jsDelivr WASM, a Google Storage model). The CSP must allow them. | `packages/avatar/src/landmarks.ts:24-25` | Keep the §3.2 allowances. For zero risk, ship the first deploy with `Content-Security-Policy-Report-Only`. Migrated landmarks mean detection rarely runs. | code C2 (web) |
| M4 | medium | **Source maps would be published:** 15 maps, 4.6 MiB. | `apps/web/vite.config.ts:31` (`sourcemap: true`) | `*.map` in `.assetsignore` keeps them local. The preflight warns. | code C2 (web) |
| M5 | medium | **Access session expiry.** When the session expires, `/api` fetches get a 302 to the Access login (a CORS failure) and the socket reconnect fails. | Access behaviour | Set a 7–30 day session for testing. Later, reload the page on an opaque redirect or a 403 that asks for sign-in. | owner; code C6 later |
| M6 | medium | **No build stamp.** `APP_VERSION` is static. | `wrangler.jsonc` vars; `lib/health.ts:5` | Deploy with `--var APP_VERSION:$(git rev-parse --short HEAD)`. `/api/health` reports it. | owner (deploy command) |
| L1 | low | **Dev wording in the cloud.** Errors say "Raise X in apps/worker/.dev.vars", "Open the app at http://localhost" and "served by Vite on :5173". | `lib/limits.ts:42`, `media/portraits.ts:79`, `media/media-images.ts:147`, `expr/clips.ts:151`, `expr/routes.ts:159,259`, `expr/huddle-render.ts:75`, `lib/origin.ts:58`, `index.ts:98` | Environment-neutral wording. | code C7 |
| L2 | low | **A 25 s app-level ping wakes the WorkspaceDO** for each open tab, so hibernation never lasts long. | `apps/web/src/api/ws.ts:32`; `workspace-do.ts:271` | Negligible for one owner. Later: `setWebSocketAutoResponse` with a fixed ping string. | code C10 |
| L3 | low | **`/api/health` is behind Access too**, so uptime checks need a service token or a bypass policy. | — | `health` is exempt from the Worker JWT check (§4.3). Access still gates it at the edge. | owner |
| L4 | low | **Log hygiene is by convention.** Only error messages are logged, and `redact()` is tested, but no end-to-end test drives failing upstreams and asserts that no key or prompt is logged (ARCHITECTURE §14.3). | `index.ts:126-127`; `packages/models/src/lib/lib.test.ts` | Add that test before real traffic. The preflight already scans published files and the Worker bundle for key shapes and local key values. | code C8 |
| L5 | low | **No cron, and none needed.** All timers are DO alarms. | `jobs/project-do.ts:270`; `runs/run-do.ts:218` | — | — |
| L6 | low | **Single-tenant id.** `WORKSPACE_ID` is `"local"`. | `wrangler.jsonc` vars | Keep `local` for the test, so migrated `ws/local/*` clips carry over. | — |
| L7 | low | **No CI/CD.** | ARCHITECTURE §17.3 | §12. | later |

Also checked and fine: WebSocket hibernation (`workspace-do.ts:231`); same-origin API and socket URLs, with `wss:` on
https (`apps/web/src/api/ws.ts:71-73`); DEV-only hooks behind `import.meta.env.DEV`; body caps before handlers; private
R2, whose images are served only through `/api/portraits` and `/api/media`; `compatibility_date` 2026-09-01 with
`nodejs_compat`; no request bodies, env or keys in log lines; and `.dev.vars` is git-ignored.

---

## 3. Serving the SPA from the Worker

### 3.1 Config (already in `wrangler.deploy.example.jsonc`)

```jsonc
"assets": {
  "directory": "../web/dist",                       // pnpm build → vite build output
  "not_found_handling": "single-page-application",  // /app/floor, /app/desk/:id/profile → index.html
  "run_worker_first": ["/api/*"]                    // /api (HTTP and the /api/ws upgrade) always runs the Worker
}
```

- With the array form, only `/api/*` invokes the Worker. Everything else is served by the asset layer, where `_headers`
  applies and requests are free and do not count toward the Workers request quota. The array form also turns off the
  automatic `Sec-Fetch-Mode: navigate` rule, so typing `/api/x` into the address bar reaches the router (its JSON 404)
  instead of getting `index.html`. No `ASSETS` binding is needed. `run_worker_first: true` would send every request to
  `src/index.ts`, which 404s non-API paths, so the preflight rejects it.
- The WebSocket handshake to `/api/ws` matches `/api/*` and goes to the Worker, which hands it to the WorkspaceDO.
  Verified locally.
- Limits: 113 files and 8.9 MiB after `.assetsignore` (129 files and 13.5 MiB without it). The largest file is 0.9
  MiB. The limits are 20,000 files on Free, 100,000 on Paid, and 25 MiB per file.

### 3.2 `apps/web/public/_headers` (to add: C2)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-lEADc7WDvApqYvxLx4DYrW8oMqcmFbYHdPXvJwaIbiQ=' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: microphone=(self), camera=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/fonts/*
  Cache-Control: public, max-age=604800
```

- The `sha256-…` value covers the inline theme script in `dist/index.html`. It was recomputed from a fresh build today
  and has not changed. The script embeds the hero image path at build time, so a new hero changes the hash. The
  preflight fails if the CSP would block the script and prints the value to use. To stop hashing, move the script to
  `/theme.js` (a web change).
- `'unsafe-inline'` for styles covers Preact `style` attributes and the office's injected `<style>`. `jsdelivr` and
  `storage.googleapis.com` are only for in-browser landmark detection (M3). `connect-src 'self'` covers the same-host
  `wss:` socket in current browsers. If an older Safari refuses it, add
  `wss://headcount-test.<account-subdomain>.workers.dev`.
- Verified locally: with these headers, the landing, `/app/floor` and onboarding render with no CSP violations
  (§11.3). The flows that load MediaPipe were not exercised, so a report-only first deploy is the cautious choice
  (decision 9).

### 3.3 `apps/web/public/.assetsignore` (to add: C2)

```
dev/
*.map
```

Wrangler never uploads `.assetsignore`, `_headers` or `_redirects` themselves.

---

## 4. Authentication

### 4.1 Options

| | Cloudflare Access + Worker JWT check | Built-in owner passcode + session cookie | Google OAuth (as in personagram-ai) |
|---|---|---|---|
| Code | About 70 lines in the Worker, no web change | Login page, login route, hashed session store, brute-force limiting, logout: about 300 lines | `users`, `auth_sessions` and `oauth_states` tables, PKCE, callback, session cookie, Google client: 500+ lines |
| Covers | Assets, API and WebSocket, on every hostname it is attached to, at the edge before the Worker runs | Only what the Worker checks (assets would need `run_worker_first` for everything) | Same as the passcode |
| Owner effort | Zero Trust free plan (up to 50 users), one policy "emails = you", one-time PIN or Google as the IdP | Pick and store a passcode secret | Google Cloud OAuth client and consent screen |
| Revocation / audit | Dashboard, Access logs | Rotate the secret | Session table |
| Later multi-user | Stays as a perimeter in front of real sign-in | No | Yes (ARCHITECTURE §14.1) |

**Recommendation for testing: Cloudflare Access, plus the Worker verifying `Cf-Access-Jwt-Assertion`.** It is the
smallest change. It protects the landing, the SPA, the API and the socket at the edge, so a request without a login
never costs a Worker invocation. The Worker check makes it fail closed if Access is ever switched off, a custom domain
is added without it, or a preview URL appears. Google OAuth stays the product answer for multi-user, and Access can sit
in front of it.

### 4.2 Owner setup

1. After the smoke deploy (§8.1 step 9), open **Workers & Pages → headcount-test → Settings → Domains & Routes →
   workers.dev → Enable Cloudflare Access**. If that toggle is not offered, create a self-hosted Access application for
   the hostname in Zero Trust. Allow only your e-mail address (one-time PIN, or Google as the IdP) and set the session
   duration to 7–30 days (M5).
2. Copy the application's **AUD tag** and your **team domain** (`https://<team>.cloudflareaccess.com`) into
   `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in `wrangler.deploy.jsonc`. Neither is a secret.
3. For scripts and uptime checks (M1, L3), create a service token and add it to the policy as Service Auth.

### 4.3 Worker check (proposed `apps/worker/src/lib/access.ts`: C1)

This was checked as a JS transliteration against a locally generated RSA key. It accepts a valid token and rejects a
missing token, a wrong aud, a wrong iss, an expired token, a forged signature, an unknown kid and garbage. Loopback is
exempt, and it denies everything off loopback while unconfigured.

```ts
// Cloudflare Access sits in front of the deployment; this is the fail-closed check behind it (docs/DEPLOY.md §4).
import { errorResponse } from './http';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CERTS_TTL_MS = 10 * 60_000;
let certs: { team: string; at: number; keys: Map<string, CryptoKey> } | null = null;

const b64url = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function signingKeys(team: string, fresh = false): Promise<Map<string, CryptoKey>> {
  const age = certs?.team === team ? Date.now() - certs.at : Infinity;
  if (certs && (age < 60_000 || (!fresh && age < CERTS_TTL_MS))) return certs.keys; // refetch at most once a minute
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs answered ${res.status}`);
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const map = new Map<string, CryptoKey>();
  for (const k of keys) if (k.kid && k.kty === 'RSA') map.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  certs = { team, at: Date.now(), keys: map };
  return map;
}

/** null when the request carries a valid Access token for this application; otherwise a 403. Loopback (dev) is exempt. */
export async function verifyAccess(req: Request, url: URL, env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): Promise<Response | null> {
  if (LOOPBACK.has(url.hostname)) return null;
  const deny = (why: string) => errorResponse('forbidden', why);
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return deny('Sign-in is not configured for this deployment.');
  const [h, p, s] = req.headers.get('cf-access-jwt-assertion')?.split('.') ?? [];
  if (!h || !p || !s) return deny('Sign in through Cloudflare Access first.');
  try {
    const dec = (part: string) => JSON.parse(new TextDecoder().decode(b64url(part)));
    const header = dec(h) as { alg?: string; kid?: string };
    const claims = dec(p) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number };
    if (header.alg !== 'RS256' || !header.kid) return deny('Sign in through Cloudflare Access first.');
    const key = (await signingKeys(team)).get(header.kid) ?? (await signingKeys(team, true)).get(header.kid); // keys rotate
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const signed = !!key && (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`)));
    const ok = signed && aud.includes(env.ACCESS_AUD) && claims.iss === team && typeof claims.exp === 'number' && claims.exp > now && (claims.nbf ?? 0) <= now + 60;
    return ok ? null : deny('Your sign-in expired or is not for this app. Reload the page to sign in again.');
  } catch {
    return deny('Sign in through Cloudflare Access first.');
  }
}
```

Wiring, in `src/index.ts` right after the origin guard (line 101):
`const denied = guardRequest(…) ?? (routeId === 'health' ? null : await verifyAccess(request, url, env));`. Also add
`ACCESS_TEAM_DOMAIN?` and `ACCESS_AUD?` to `Env`, and a unit test with a generated key pair and a stubbed certs
`fetch`. The `/api/ws` upgrade carries the same header, so the socket is covered. Keep `ALLOWED_ORIGINS` as well: it
still blocks cross-site pages (CSRF, socket hijacking) inside an Access session.

---

## 5. Config, storage, secrets and limits

### 5.1 Two configs

`apps/worker/wrangler.jsonc` stays the dev config. `apps/worker/wrangler.deploy.jsonc`, copied from the example, is
used with `-c wrangler.deploy.jsonc`. The database id, bucket name and AUD are not secret, so it can be committed. The
preflight fails if the DO bindings, classes, migration tags or D1 migrations directory drift between the two. When a
class changes, add `v2` to **both** configs and never edit `v1`.

| Setting | Dev (`wrangler.jsonc`) | Test deploy (example) |
|---|---|---|
| name | `headcount` | `headcount-test` |
| workers_dev / preview_urls | default | `true` / `false` |
| assets | none (Vite serves) | `../web/dist`, SPA, `run_worker_first: ["/api/*"]` |
| D1 | `headcount`, id all zeros | `headcount-test`, id from `wrangler d1 create` |
| R2 | `headcount-blobs` | `headcount-test-blobs` (private) |
| ENABLE_MOCK / DEFAULT_CHAT / MOCK_MEDIA | `true` / `auto` / `false` | `false` / `auto` / `false` (smoke deploy: `--var` overrides) |
| MOCK_DELAY_MS | `15` | `0` |
| ALLOWED_ORIGINS | localhost ports | `https://headcount-test.<account-subdomain>.workers.dev` |
| OLLAMA_* | `127.0.0.1:11434` | removed |
| ACCESS_TEAM_DOMAIN / ACCESS_AUD | — | from §4.2 |
| ENABLE_MEDIA_TOOLS | — | `false` (read once C3 lands) |
| APP_VERSION | `0.0.0-inc0` | `--var APP_VERSION:<git sha>` on each deploy |
| compatibility | `2026-09-01`, `nodejs_compat` | same |
| observability | enabled | enabled, `head_sampling_rate: 1` |

### 5.2 Where state lives

| Store | Tables / keys | Created by |
|---|---|---|
| **D1** `DB` | `workspaces`, `ledger_events`, `jobs` (roll-ups; `0001_init.sql`); `portraits` (rows, generation lock, **landmarks**) and `media_usage` (daily budgets for `tts`, `stt`, `portrait`, `expr_clip`; `0002_media.sql`) | `wrangler d1 migrations apply --remote` |
| **WorkspaceDO** SQLite | `events` (talk, desk and room frames), `ops`, `mirrored`, `jobs_seen`, `meta` (settings), `pending_announcements`, `presence_claims`, `voice_*`, `expr_*`, `usage_daily` (chat budget) | `CREATE TABLE IF NOT EXISTS` in the constructors |
| **ProjectDO** SQLite | `events`, `jobs`, `steers`, `usage_daily` (job budget) | same |
| **RunDO** SQLite | `prevoice_runs`, `prevoice_items` | same |
| **RoomDO** | none (stub; rooms run in the WorkspaceDO) | — |
| **R2** `BLOBS` | `portraits/<id>.<ext>`, `expr/clips/<clipKey>.{mp3,wav,align.json}` (shared), `ws/<ws>/expr/…` (workspace clips), `media/<key>.<ext>` (tooling) | the Worker |

### 5.3 Secrets and spending limits

Secrets, set once Access is on: `npx wrangler secret put <NAME> -c wrangler.deploy.jsonc` for `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, and optionally `GEMINI_API_KEY`. Set `OPENAI_COMPATIBLE_*` only if that endpoint is
on the public internet. Nothing else is secret. The preflight fails if a key-shaped value or a `*_KEY`/`*_SECRET`/
`*_TOKEN` name appears in `vars`.

| Var | Dev default | Test value | Caps |
|---|---|---|---|
| `CHAT_DAILY_LIMIT` | 1500 | 300 | Chief of Staff, desk, room and huddle turns |
| `JOB_DAILY_LIMIT` / `MAX_ACTIVE_JOBS` | 60 / 3 | 10 / 2 | background jobs (multi-step, reason tier) |
| `TTS_DAILY_LIMIT` | 3000 | 500 | spoken sentences |
| `STT_DAILY_LIMIT` | 600 | 100 | recordings |
| `PORTRAIT_DAILY_LIMIT` | 200 | 10 (0 until C4) | portraits **and** `/api/media/image` |
| `EXPR_CLIP_DAILY_LIMIT` | 600 | 200 | clip renders (R2 hits are free, and migrated clips are hits) |
| `EXPR_RENDER_PER_MIN` | 30 | 10 | runtime renders a minute |
| `EXPR_PREVOICE_MAX_CLIPS` | 300 | 100 | clips per pre-voice run |

The preflight warns when a limit is unset or above a test ceiling, and fails when one is not a whole number (the
Worker would silently fall back to the dev default).

---

## 6. Code changes (Phase B)

None of these were made by this kit: another workflow is editing `apps/web/src`, `apps/worker/src` and `packages/`.
Land them after Office Phase 2, then re-run the preflight.

**Required before provider keys go in:**

- **C1 Access JWT check (B1).** New `apps/worker/src/lib/access.ts` (code in §4.3) and a unit test. Wire it into
  `apps/worker/src/index.ts:101` after `guardRequest`, exempting `health`. Add `ACCESS_TEAM_DOMAIN?` and `ACCESS_AUD?`
  to `apps/worker/src/env.ts`. Owner: integrator. The preflight's "worker verifies Access" check turns green.
- **C2 Static headers and ignore list (H1, H2, M3, M4).** New `apps/web/public/_headers` (§3.2) and
  `apps/web/public/.assetsignore` (§3.3). Owner: web.

**Strongly recommended before keys:**

- **C3 Gate the media tool route (H3).** Return 404 from `POST /api/media/image` unless `env.ENABLE_MEDIA_TOOLS ===
  'true'`, in `apps/worker/src/media/media-images.ts:70-81` (or at `index.ts:104`). Add the var to `env.ts`, and add
  `--var ENABLE_MEDIA_TOOLS:true` to the note in `scripts/marketing-images.mjs`. Owner: media.
- **C4 Portrait generation that survives production (H6).** Either the web calls
  `POST /api/portraits/:id/generate?wait=1` (`apps/web/src/lib/generate.ts:54`, `apps/web/src/api/client.ts:90`) and
  shows progress while it waits, or `media/portraits.ts:82-89` hands the job to a RunDO alarm. Owner: media + web.

**During testing:**

- **C5 Service-token headers for tooling (M1).** Send `CF-Access-Client-Id` / `CF-Access-Client-Secret` from env when
  set: `packages/expressions/scripts/prevoice-office.mjs:67`, `scripts/portraits-generate.mjs`,
  `scripts/voice-samples.mjs`, `scripts/marketing-images.mjs`, `scripts/landmarks-precompute.mjs`. Owner: expressions,
  media.
- **C6 Access session expiry (M5).** In `apps/web/src/api/client.ts` (fetch) and `apps/web/src/api/ws.ts` (reconnect),
  treat an opaque redirect or a 403 "Sign in" body as "reload to sign in". Owner: web.

**Later:**

- **C7 Environment-neutral error wording (L1):** the files listed under L1. Owners of each file.
- **C8 Log-hygiene end-to-end test (L4):** failing upstreams, asserting no key, prompt or body in logs. Owner: integrator.
- **C9 Only if M2 shows cut-off turns:** move `workspace-do.ts:418,532,637,775` work onto an alarm. Owner: worker-core.
- **C10 Hibernation-friendly ping (L2):** `setWebSocketAutoResponse` in the WorkspaceDO and a matching fixed ping in
  `apps/web/src/api/ws.ts:32`. Owner: web + worker-core.

---

## 7. Data: what moves and how

`node scripts/migrate-local-data.mjs` is a dry run by default. It reads snapshot copies of the local state, so a running
`pnpm dev` is never locked or written. It makes no network calls, never reads `.dev.vars`, and prints only keys, counts
and sizes.

| Local store | Contents today | Plan |
|---|---|---|
| R2 `portraits/` | 176 objects, 47.0 MiB, with `customMetadata.version` etc. | **migrate** (paid images) |
| D1 `portraits` | 176 rows, **all with landmarks** (measured in a browser, bound to the image version) | **migrate** (upsert, landmarks kept) |
| R2 `expr/clips/` | 1,198 objects, 25.4 MiB (clips + `.align.json`) | **migrate**. Clips are content-addressed, so later renders become free hits, and the first pre-voice run rebuilds the manifest from them at no cost (`expr/routes.ts:248-269`). |
| R2 `ws/local/expr/` | 2 objects | migrate (only while `WORKSPACE_ID` stays `local`) |
| R2 `media/` | 16 objects, 27.5 MiB (marketing originals) | skip; `--include portraits,clips,ws-clips,media` to take them |
| D1 `media_usage` | today's counters | not migrated (budgets start fresh) |
| D1 `ledger_events` 265, `jobs` 5, `workspaces` 1 | roll-ups of DO state | not migrated |
| DO SQLite | WorkspaceDO `events` 183, `expr_manifest` 627, settings; ProjectDO `events` 82, `jobs` 5; RunDO pre-voice history | **not migrated**: a deployed DO has no import path. Onboarding runs again, the manifest rebuilds from R2, and old conversations stay local. |

**Why a script and not `wrangler r2 object put`:** that command has no custom-metadata option (checked on wrangler
4.143.0), and 776 of the 1,376 objects need their metadata. Clips carry `durationMs`, `voiceKey` and `alignment`;
portraits carry the `version` behind their ETag and immutable caching. The S3 API would lowercase the names that the
Worker reads in camelCase. So `--execute` uses wrangler's own bindings (`getPlatformProxy`) against a temporary
config: `"remote": true` for the account, or local files for a rehearsal. It verifies size and metadata after each
upload, skips objects already there, keeps a remote portrait whose version differs (unless `--overwrite`), and writes
rows only for images that arrived.

```sh
node scripts/migrate-local-data.mjs                     # dry run: inventory, plan, and the exact commands below
(cd apps/worker && npx wrangler d1 migrations apply headcount-test --remote -c wrangler.deploy.jsonc)
node scripts/migrate-local-data.mjs --execute           # asks you to type the bucket name; re-runs skip what is there
(cd apps/worker && npx wrangler d1 execute headcount-test --remote -c wrangler.deploy.jsonc \
  --command "SELECT count(*), count(landmarks) FROM portraits")   # expect 176, 176
```

- Rehearsal without an account:
  `node scripts/migrate-local-data.mjs --execute --target local --persist-to /tmp/hc-rehearsal --config apps/worker/wrangler.deploy.jsonc`.
  Today it moved 1,376 objects (72.5 MiB) and 176 rows in 11.5 s. A second run uploaded 0 and skipped 1,376.
- Plain-wrangler fallback, only if `--execute` cannot run: `--export <dir>` writes the objects, `r2-manifest.json`,
  `r2-put.sh` (1,376 `wrangler r2 object put <bucket>/<key> --remote` lines with content types) and
  `d1-portraits.sql` (for `wrangler d1 execute --remote --file`; the largest statement is 6.6 KB, and D1 allows
  100 KB). This route loses the metadata: clips read `durationMs` 0 with no alignment, and portraits are served
  revalidating instead of immutable. The dry run prints these commands with today's counts.

---

## 8. Runbook

### 8.1 Owner's one-time steps (in order)

Run these from `apps/worker` unless noted.

1. **Plan** (decision 1). If you choose Paid: dashboard → Workers & Pages → Plans → Workers Paid.
2. `npx wrangler login`, then `npx wrangler whoami` to confirm the account. If several accounts are listed, set
   `account_id` in `wrangler.deploy.jsonc` or export `CLOUDFLARE_ACCOUNT_ID`.
3. `cp wrangler.deploy.example.jsonc wrangler.deploy.jsonc`
4. `npx wrangler d1 create headcount-test`, then paste the printed `database_id` into `wrangler.deploy.jsonc`. If
   wrangler offers to add the binding to a config, decline: the binding already exists, and the dev config must stay
   as it is.
5. `npx wrangler r2 bucket create headcount-test-blobs`. It is private by default; never enable public access or an
   r2.dev URL.
6. Set `ALLOWED_ORIGINS` to `https://headcount-test.<your subdomain>.workers.dev`. The subdomain is on the dashboard's
   Workers overview (the personagram-ai reference used `greg-371`).
7. `npx wrangler d1 migrations apply headcount-test --remote -c wrangler.deploy.jsonc`
8. From the repo root: `pnpm build`, then `node scripts/deploy-preflight.mjs --smoke`. Fix every FAIL.
9. **Keyless smoke deploy.** No provider can be called, so an open URL costs nothing:
   `npx wrangler deploy -c wrangler.deploy.jsonc --var ENABLE_MOCK:true --var DEFAULT_CHAT:mock --var MOCK_MEDIA:true --var APP_VERSION:$(git rev-parse --short HEAD)`.
   Then run the smoke test (§8.3, phase A).
10. **Access** (§4.2): enable it on the workers.dev hostname, allow only your e-mail, set a 7–30 day session, and fill
    `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Optionally create a service token for scripts.
11. Wait for C1 and C2 (§6). Then, from the repo root, run `pnpm build` and `node scripts/deploy-preflight.mjs`. **No FAIL
    may remain.**
12. Redeploy with the step 9 command (still Mock), and confirm that a private window gets the Access login page.
13. **Data**, from the repo root: `node scripts/migrate-local-data.mjs` (read the plan), then
    `node scripts/migrate-local-data.mjs --execute`.
14. **Keys:** create keys for this deployment, each with a provider-side monthly cap (decision 6), then
    `npx wrangler secret put ANTHROPIC_API_KEY -c wrangler.deploy.jsonc`, and the same for `OPENAI_API_KEY` and
    `XAI_API_KEY`.
15. **Real deploy:** `npx wrangler deploy -c wrangler.deploy.jsonc --var APP_VERSION:$(git rev-parse --short HEAD)`
    (no Mock overrides). Then run the smoke test (§8.3, phase B).

### 8.2 Every later deploy (automatable)

```sh
pnpm install --frozen-lockfile && pnpm build
node --test scripts/test/*.test.mjs
node scripts/deploy-preflight.mjs                          # exit 1 = do not deploy
(cd apps/worker && npx wrangler d1 migrations apply headcount-test --remote -c wrangler.deploy.jsonc)
(cd apps/worker && npx wrangler deploy -c wrangler.deploy.jsonc --var APP_VERSION:$(git rev-parse --short HEAD))
```

Migrations go first: they are additive, and the old version keeps working against the new schema.

### 8.3 Smoke test

Phase A (Mock, before Access):

- `curl -sI https://headcount-test.<sub>.workers.dev/` returns 200 with a `content-security-policy` header (once C2 is
  in), and `/app/floor` returns 200 with HTML.
- `curl -s https://headcount-test.<sub>.workers.dev/api/health` returns JSON with your git sha as the version.
- `curl -s https://…/api/nope` returns the JSON 404. A request with `-H 'Origin: https://evil.example'` gets a 403.
- In the browser: the landing, onboarding, Talk with Mock replies, the Floor, and a reload on `/app/floor`. The socket
  indicator should be connected.

Phase B (Access and keys):

- A private window gets the Access login. `curl -sI` without a token gets a 302 to `<team>.cloudflareaccess.com`.
- `/api/portraits` lists 176 portraits with landmarks, and a portrait image loads.
- One text turn and one voice turn with the Chief, a job, the Floor and a room. Watch
  `npx wrangler tail headcount-test`, check that long turns finish (M2), and check the console for CSP reports.

---

## 9. Rollback and emergency stop

```sh
cd apps/worker
npx wrangler deployments list -c wrangler.deploy.jsonc      # what is live, with version ids
npx wrangler versions list -c wrangler.deploy.jsonc         # the last 10 versions
npx wrangler rollback <version-id> -c wrangler.deploy.jsonc -m "why"   # no id = the previous version
```

- A rollback restores code, config and vars. If secrets changed since that version, wrangler lists them and asks you to
  confirm. It does **not** undo D1 migrations, R2 objects or Durable Object storage, and a Durable Object migration tag,
  once applied, stays applied. Ship a deploy that adds a DO migration on its own.
- D1 point-in-time restore: `npx wrangler d1 time-travel info headcount-test`, then
  `npx wrangler d1 time-travel restore headcount-test --timestamp <RFC3339>` (the command accepts the last 30 days).
- R2: the migration only adds objects, and re-runs are idempotent.
- **Stop spending now:** revoke the key at the provider, or `npx wrangler secret delete ANTHROPIC_API_KEY -c
  wrangler.deploy.jsonc` (the routes then answer "not configured").
- **Take the site down:** set `"workers_dev": false` and deploy, or turn off the workers.dev route in the dashboard.

---

## 10. Cost controls and limits

| Layer | Control | Setting for the test |
|---|---|---|
| Provider | Monthly spend cap per key, with keys used only by this deployment | owner's choice (decision 6). This is the real ceiling. |
| Worker | Daily call caps (§5.3) | example values. Worst case per day: 300 chat turns, 10 jobs, 500 TTS sentences, 100 transcriptions, 10 images, 200 clips. |
| Access | Only the owner (and a service token) reaches the Worker | B1 |
| Cloudflare plan | Workers Paid: $5/month minimum, including 10M requests and 30M CPU ms. Durable Objects include 1M requests and 400k GB-s a month. Static asset requests are free and unlimited. | single-owner use stays inside the included amounts |
| Worker CPU | `"limits": { "cpu_ms": … }` in the config caps CPU per invocation on Paid (default 30 s, up to 5 min) | leave the default; lower it only if a runaway loop shows up |

Each chat turn sends about 3.9k prompt tokens (INC0.md:431). The call caps count calls, not dollars, which is why
provider caps matter. Without Access (B1), the same caps apply to anyone with the URL.

---

## 11. Measurements and verification (this machine, 2026-09-29)

### 11.1 Worker

- Bundle (`wrangler deploy --dry-run -c wrangler.deploy.example.jsonc`): **Total Upload 8,402.85 KiB (8.21 MiB)
  uncompressed**, 1,872 KiB gzip. That is 13% of the 64 MiB limit, which since 2026-09-04 is the only size limit and is
  the same on Free and Paid; gzip is informational only. `packages/catalog/generated/full.js` (4.8 MB) and
  `packages/expressions/generated/expressions.json` (3.1 MB) are most of it. Wrangler printed no config warnings.
- Startup (`wrangler check startup`, measured earlier today): 37.8 ms active CPU (13.8 ms of it GC). The limit is 1 s
  on both plans.
- Durable Objects: all four are SQLite-backed, which both plans support. The feed uses WebSocket Hibernation, and the
  ProjectDO and RunDO loops are alarms.

### 11.2 Static assets

A fresh `vite build` into a scratch directory (the shared `apps/web/dist` was left alone) produced 129 files and 13.5
MiB: 113 files and 8.9 MiB after `.assetsignore`. The largest file is `slim-*.js` (919 KB, 228 KB gzip). All 15
JavaScript files parse as modules. The inline-script CSP hash is unchanged
(`sha256-lEADc7WDvApqYvxLx4DYrW8oMqcmFbYHdPXvJwaIbiQ=`), and the lightbox rule is in `OfficeView-*.js`.

### 11.3 The proposed config, served locally (earlier today)

`wrangler dev` ran on :8799 with a scratch copy of the example config (Mock only, no keys, scratch state holding the
rehearsed migration), the proposed `_headers` and `.assetsignore`. The owner's :5173 and :8787 were left alone.

- `/` and `/app/floor` (navigation) return `index.html` with the CSP. `/assets/index-*.js` is served
  `public, max-age=31536000, immutable`.
- `/dev/landmarks.html`, `*.map`, `/_headers` and `/.assetsignore` are not served.
- `/api/nope` gets the router's JSON 404. A foreign `Host` gets 403 (the DNS-rebinding guard), a foreign `Origin` gets
  403, and a cross-site socket is refused.
- `/api/capabilities` reports Mock, with Ollama not configured. `/api/portraits` lists 176 portraits, all with
  landmarks, and a portrait `?v=` is served immutable.
- The feed socket opens. `POST /api/talk` returns 202, and 20 frames arrive.
- In Chromium the landing, the Floor and onboarding render with the migrated portraits, and no
  `securitypolicyviolation` fires.

### 11.4 Preflight on the current tree

`node scripts/deploy-preflight.mjs --config apps/worker/wrangler.deploy.example.jsonc` fails exactly on the open items:
the D1 placeholder, the `ALLOWED_ORIGINS` placeholder, the Access config, the missing Worker JWT check (C1) and the
published dev page (C2). It warns about source maps, the ungated media route (C3) and the missing `_headers` (C2).
Everything else passes: DO and migration parity, assets and SPA, Mock off, Ollama off, limits, module parse, the
secret scan of 130 files, secret-file names, bundle size and the plan. With the proposed `_headers` and
`.assetsignore`, filled placeholders and `--accept-access-only`, it passes with only the C1 and C3 warnings.

---

## 12. Observability and CI/CD (later)

- **Logs:** Workers Logs (`observability.enabled`) captures `console.error` lines, which carry only error messages
  (provider errors are redacted), plus invocation metadata. Use `wrangler tail` while testing. Add the log-hygiene test
  (C8) before real traffic.
- **CI/CD** (ARCHITECTURE §17.3): typecheck → unit → e2e on Mock → `pnpm build` → `node --test scripts/test/*.test.mjs`
  → `deploy-preflight` → `wrangler d1 migrations apply --remote` → `wrangler versions upload` → smoke →
  `wrangler versions deploy`. It needs a scoped API token (Workers Scripts, D1 and R2 edit) as a CI secret, plus an
  Access service token for the smoke step.

---

## 13. Decisions for the owner

1. **Workers plan:** Paid ($5/month, recommended because of the 10 ms CPU limit on Free), or Free for the smoke test
   only? Bundle size is no longer a factor.
2. **Auth:** Cloudflare Access with the Worker JWT check (recommended), or a passcode or Google OAuth now? Which
   sign-in: a one-time PIN to your e-mail, or Google as the IdP? Should anyone besides you get access?
3. **Landing visibility:** gate everything (simplest, recommended), or keep `/` public and protect only `/app*` and
   `/api*`? A public landing would lose portraits and voiced samples, since those call `/api`, unless a public
   read-only route is added.
4. **Hostname:** `headcount-test.<subdomain>.workers.dev` (probably `greg-371`), or a custom domain on a zone you own?
   A custom domain needs its own Access application and an `ALLOWED_ORIGINS` entry.
5. **Names:** a separate `headcount-test` Worker, database and bucket (recommended, so a later production deploy starts
   clean), or reuse `headcount`?
6. **Keys and caps:** which providers to enable, the monthly cap for each, and whether the §5.3 limits suit your
   testing.
7. **Data:** migrate the 16 marketing originals too? Do you accept that local conversations, jobs and settings stay
   local (you run onboarding again)?
8. **Portrait generation before C4:** off (`PORTRAIT_DAILY_LIMIT=0`), or 10 a day, accepting that a slow provider may
   lose a paid image?
9. **CSP rollout:** enforce from day one, or report-only for the first week?
