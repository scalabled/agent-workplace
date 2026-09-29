# Admin: settings, people and roles, token usage

The Admin page is at `/app/admin` (⌘K "Admin", "Usage and costs", "People and roles"). It is for owners only. Every
section has its own link, `/app/admin/<section>`, so an owner can send someone straight to it:

- `general`: the Chief of Staff's name, what the team calls you, spoken replies, ambience, theme, "view as", and links
  to the places the team itself is configured (coworkers, skills, connectors, automations, Handbook, memory).
- `people`: who can sign in, and as what.
- `usage`: what the models did and cost.
- `limits`, `work`, `voice`, `models`, `keys`, `deployment`: every setting the worker reads.

## Roles

| Role | May |
|---|---|
| Owner | Everything, including settings, people, connectors, automations, coworker and skill settings, and costs. |
| Contributor | Talk with the team, start and steer work, answer raised hands, edit the Handbook and memory, share files, build on the canvas. |
| Reader | Read everything: conversations, projects, documents, memory. Changes nothing. |

- The owners named in `OWNER_EMAILS` are always owners. Everyone else is invited on the People page (D1 `members`).
- A removed member is signed out at once: their sessions are deleted.
- Every route in `packages/protocol/src/routes.ts` names the least role it needs (`auth: 'public' | 'reader' |
  'contributor' | 'owner'`). `authorize()` in `apps/worker/src/auth/auth.ts` enforces it:
  - a missing session gets 401;
  - too low a role gets 403, with a sentence that says who can change it.
- Paths outside the table (`/api/media/*`) need a reader to read and a contributor to change anything.
- Local mode (loopback, sign-in off) is the owner.
- **View as**: `POST /api/auth/view-as {role}` sets a cookie that can only lower the role in effect, never raise it.
  - `/api/auth/me` reports `role` and, while previewing, `actualRole`.
  - The web shows a bar with "Back to owner".
- The web marks controls `needs-contributor` or `needs-owner` and hides them by role (`data-role` on `<html>`).
- A reader's Talk shows "You can read along" instead of the composer.
- Coworker settings are a disabled fieldset for anyone but an owner.

## Settings

`CONFIG_OPTIONS` in `packages/protocol/src/ext/admin.ts` lists every option the worker reads from its environment.
Each has a group, a label, help text, its kind (number, switch, choice, text, url, secret) and its default.

- **Changing a setting.** Values changed on the page are stored in D1 `settings_kv`.
- **Keys are sealed** (AES-GCM, with the connector secret and the key name as additional data). They are write-only:
  the page shows only whether a key is set. Without an encryption secret on a deployed worker, keys cannot be stored
  here.
- **Applying them.** `apps/worker/src/admin/config.ts` layers the stored values over the deployment's environment with
  a Proxy (`configured(env)`). So every existing `env.X` read picks them up with no call site changing, in the
  worker, in every Durable Object (their constructors wrap `env`) and in the model registry.
  - Each isolate caches the values for 5 s.
  - A change applies at once in the isolate that saved it, and everywhere else within seconds.
- **What can never change here.** Sign-in (`AUTH_MODE`, `OWNER_EMAILS`, `APP_ORIGIN`, the Google client),
  `ALLOWED_ORIGINS`, `CONNECTOR_SECRET` and `WORKSPACE_ID` change only with the deployment. They are shown for
  reference, and the overlay ignores them even if a row exists.
- **Limit messages.** A limit that is reached now says an owner can raise it in Admin → Settings, and names the
  variable.

## Token usage

- **Recording.** Every model call is metered where the providers are handed out.
  - `models(env, {surface, agentId})` in `apps/worker/src/workspace/runtime.ts` wraps the registry
    (`usage/meter.ts`). Whatever it resolves (chat, embeddings, speech, images) reports each call:
    - surface, coworker, provider and model;
    - tokens in, out and cached;
    - the cost the provider reported;
    - time and, for chat, time to the first token;
    - success or the error.
  - The realtime voice reports its tokens from `response.done`.
- **Surfaces.** Talk, desk chats, office rooms, team projects, meetings, background jobs, canvas, memory,
  automations, web search, announcements, the realtime voice, speech and images.
- **Storage.** D1 `model_usage` holds a daily roll-up by surface, coworker, provider, model and capability.
  `model_calls` keeps the newest ~3,000 calls one by one. Writes never hold up a call.
- **The report.** `GET /api/admin/usage?days=` shows:
  - totals, and a bar per day;
  - tables by surface, coworker and model;
  - the latest calls;
  - today's use of every daily limit, from each Durable Object's counters and D1 `media_usage`.
- **Costs.** Most providers report no cost. The owner enters prices per million tokens (in, cached, out) for a
  provider and model, or `*` for all of that provider's models. Costs are then worked out from those prices, and the
  page says how many calls are priced.
- **Project totals.** A team project's total (and its token budget check) now comes from a running total per project.
  It no longer sums only the newest 120 runs, which undercounted long projects.

## API

```
GET    /api/admin/config                  → {values: [{key, value, source, set?, updatedAt?, updatedBy?}], canStoreKeys}
PUT    /api/admin/config {values: {KEY: value | null}}
GET    /api/admin/members                 → {members: [{email, name?, role, source, lastSeenAt?}], signIn}
PUT    /api/admin/members/:email {role, name?}
DELETE /api/admin/members/:email
GET    /api/admin/usage?days=1..90
PUT    /api/admin/prices {prices: [{provider, model, input, output, cached?}]}
POST   /api/auth/view-as {role: 'contributor' | 'reader' | null}
```

## Deploying

Migration `0004_admin.sql` adds `members`, `settings_kv`, `model_usage`, `model_calls` and `model_prices`. It must be
applied remotely before the new worker serves traffic:

```
wrangler d1 migrations apply DB --remote
```

Local dev (`pnpm dev`) applies migrations on start.

## Tests

- `apps/worker/test/admin.test.ts` covers:
  - settings, including a limit that reaches the Durable Object and a sealed key;
  - roles on every kind of route, including a removed member signed out;
  - view as;
  - usage by surface, coworker and limits;
  - prices.
- `apps/web/src/routes/admin.test.tsx` covers settings, keys, people, usage and the owners-only gate.
- `e2e/admin.spec.ts` covers a limit changed and reset, usage after a Talk message, and view as a reader.
