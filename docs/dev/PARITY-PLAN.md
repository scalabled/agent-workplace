# biz-bot parity, then Inc 2 — build plan

Owner ask (29 Sep 2026): "feature parity with reference/biz-bot for web search, orchestration/planning, inter-agent
communication, and the ability to see the prompts and skills of agents. MCP integration too!" — then "continue the next
increment" (MVP-PLAN Inc 2). Built directly (no Workflow). Specs come from three read-only studies of biz-bot (web
search + MCP; orchestration + inter-agent; prompts + skills). Where biz-bot has a gap (plaintext tokens, string-only
SSRF checks, unframed MCP results, no prompt viewer), we match the feature and close the gap.

## Status (29 Sep 2026)
| Stage | State | Commit |
| --- | --- | --- |
| 1 · Web search and page reading | done | 65651c9 |
| 2 · Agent configuration and transparency | done | 3d41cc0 |
| 3 · Orchestration and planning | done | 3d41cc0 |
| 4 · Inter-agent communication | done | cb26d94 |
| 5 · MCP connectors | done | 6b31808 |
| 3b · Automations | done | (this commit) |
| Inc 2 · Rooms, voices and listen-in | not started | |

Stage 5 as built: `apps/worker/src/connectors/` (catalog, Streamable HTTP client, sealed keys, store, agent tools,
routes) and `/app/connectors` on the web. Grants per coworker live in `AgentConfig.connectors` (or "every coworker");
the Chief uses a connector in Talk when allowed. Calls wait for the owner per the connector's policy (every call /
calls that change things / never): in a project step the step waits (an Inbox hand: once / this project / always); the
Chief's call waits up to 60 s on a card in Talk. A demo notebook served inside the worker (mock mode only) makes the
whole flow testable keyless. Like biz-bot, OAuth-only services take a pasted access token; a real OAuth sign-in flow
(discovery, dynamic client registration, PKCE, refresh) is not built.

Stage 3b as built: `apps/worker/src/automations/` (host in the ProjectDO, ticked by its alarm; the gate's judge; the
Chief's `set_up_automation`; routes) and `/app/automations`. Schedules (every N ≥ 15 min, or daily HH:MM UTC — first run
at the next occurrence) and page watchers (https, optional regex, changed / contains / no longer contains / below /
above, checked every ≥ 15 min, SSRF-guarded reader, risky patterns refused) start a background job or a team project
(which can start its plan without the owner's OK). One run at a time. The gate: after every run / only when it matters
(failures, page changes, else a short model judgement) / never; the Chief says it within the interruption budget.
The Chief proposes automations on a card; the owner's OK creates them (biz-bot guards create_automation the same way).

## Stage 1 · Web search and page reading
- `ChatRequest.hostedTools` (`web_search`, `x_search`) → native search per adapter (OpenAI/xAI Responses with
  `include: web_search_call.action.sources`, xAI `no_inline_citations`; Anthropic `web_search_20260209`; Gemini
  `google_search`). Descriptor flags `webSearch`/`xSearch`. Mock: a canned citation.
- Worker `web_search` function fallback (a search-capable provider answers with sources) when the agent's provider has
  no native search; its sources become citation events (biz-bot drops them).
- `fetch_page`: http(s) only, IP/host blocklist incl. 100.64/10, ULA, link-local, v4-mapped v6, `*.localhost|local|
  internal`; DNS-over-HTTPS check of A/AAAA; manual redirects (≤4, re-checked); 15 s total incl. body; 2 MB; content
  types text/json/xml/markdown; charset-aware decode; HTML→text; `max_chars` 1k–60k (20k).
- Every external text is wrapped `<external source="…">` and prompts carry the external-content rule.
- Citations are kept per step/job (`sources`) and shown ("Sources"); the deliverable writer gets them as evidence.
- Daily caps: `SEARCH_DAILY_LIMIT`, `FETCH_DAILY_LIMIT`.

## Stage 2 · Agent configuration and transparency (prompts, skills, tools, models)
- Per-coworker config (WorkspaceDO `agent_config`): instructions override (history, reset), skills on/off, tool grants
  (web_search, fetch_page, ask_coworker, `mcp:<id>`), model (provider/model/reasoning).
- Skills: index (name + when) in prompts; `use_skill` returns full instructions + quality checks; owner can edit a
  skill's instructions (versions + rollback) and read every skill in a library.
- Prompt viewer: the assembled system prompt per surface (team work, review, quick chat, room) in labelled sections;
  the Chief's live prompt. (biz-bot has none.)
- Run inspector: every model call of a project (system, prompt, tool calls with args/results, sources, model, tokens,
  duration) stored per step and shown on demand; token totals per project.

## Stage 3 · Orchestration and planning
- LLM planner (`submit_plan`, schema with member enums): tasks with owner clusters (1–3) and reviewers (0–2),
  dependsOn, deliverable kind (document/web/code), finisher; normalise + break cycles; recipe skeleton as a seed and the
  Mock/fallback plan.
- Cluster execution: lead = owners[attempts % n]; co-owners and reviewers review in parallel; revise once; still
  CHANGES → `needs_review` + Inbox decision (accept / give direction → fresh revision); failures → co-owner takeover,
  then failed; dependents skipped; project `partial`.
- `request_owner_input` → the step waits, an Inbox question; other steps continue.
- Owner plan editing while proposed or paused: edit / add / remove steps, owners, reviewers, dependencies (cycle check).
- Final QA by a reviewer with one revision; typed deliverables (Markdown, sandboxed HTML app, code file).
- Token budget per project → pause + decision. Automations: schedules and page watchers with notification gating.
- Plan graph (DAG, live) on the project page.

## Stage 4 · Inter-agent communication
- Team channel (the shared transcript) per project, persisted and live; every work, review, ask, answer, hand-off,
  note and decision lands there; agents read its recent part.
- `ask_coworker` (depth ≤ 2, teammates; answer recorded), `message_coworker` (async hand-off → their next step),
  `add_specialist` (catalog coworker joins, ≤ 4 extra, team ≤ 12).
- Discussions: kickoff (teams ≥ 3) and on demand — chair frames, members open, debate, chair synthesises; the
  synthesis feeds the steps. The owner posts in the channel with @mentions (replies at once, D2).
- Who-talked-to-whom graph.

## Stage 5 · MCP connectors
- Catalog (biz-bot's 11 + ours), Streamable HTTP client (versions 2025-11-25 → 2025-03-26, SSE, sessions, timeouts,
  SSRF check, no blind retry of `tools/call`).
- Tokens AES-GCM encrypted at rest (`CONNECTOR_SECRET`), never returned to the browser.
- Tools `<connector>__<tool>` with framed, clipped results; grants per coworker and per project; approvals as Inbox
  decisions (once / this project / always).
- Settings → Connectors: catalog, connect, test (tools + schemas), approval toggle, grants, remove.

## Then Inc 2 (MVP-PLAN): rooms, voices and listen-in
- Project meetings (kickoff/review) as real per-coworker turns in a project room; the owner listens (voiced on demand in
  team voices, cached), joins, takes the floor, whispers; replay with captions; now-playing bar.
