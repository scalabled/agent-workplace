# oncloudnine — Server: provider registry/dispatch, orchestrator, agent runtime, MCP, task store, media & memory APIs

> Scope: `reference/oncloudnine/server/**` (≈9.5k lines of TypeScript), `server/_worker.ts`, `data/mcp-servers.json`, `config.example.json` (key names only), `wrangler.toml`, `docs/architecture/{server-api,agents-and-mcp,media-and-search,system-overview}.md`, and the unit/contract tests for providers, orchestrator, agent, MCP, media, search, memory, tasks, security and realtime. All paths below are relative to `reference/oncloudnine/` unless noted. No secrets files were opened.

---

## 1. Purpose & architecture

The server is a single **Cloudflare Pages advanced-mode Worker** (`server/_worker.ts`) that overlays 18 exact `/api/*` routes on top of static-asset serving. It is the *only* place provider credentials exist. Its jobs:

1. **One provider registry + dispatch layer** for four providers (Anthropic, OpenAI, xAI, Ollama) across chat, streaming, vision, tools, embeddings, STT, TTS, realtime voice, image gen, video gen and web search (`server/providers/*`).
2. **One chat orchestrator** (`server/lib/orchestrator.ts`) that turns every `/api/chat` turn into a tool-use loop and routes each tool call either **inline** (answer in-turn) or **background** (becomes a durable task delivered later to a "Pending tray").
3. **One provider-agnostic tool-use loop** (`server/lib/agentRuntime.ts`) that speaks three tool dialects (Anthropic `tool_use`, OpenAI Responses `function_call`, OpenAI-compatible `tool_calls`), with built-in tools plus namespaced MCP tools.
4. **A hand-written MCP client** over `fetch` (no SDK) with Streamable HTTP, legacy SSE and dev-only stdio transports (`server/mcp/*`).
5. **A background task store** in KV with per-kind wall clocks, concurrency caps, cancel, live SSE updates, detached large results and a lazy reaper (`server/lib/taskStore.ts`).
6. **Media & memory APIs**: image/video generation, provider-side web search, embeddings, STT/TTS, realtime session minting, themed HTML app generation, and knowledge-graph extraction with a tolerant JSON reader.
7. **A perimeter** (`server/lib/security.ts`): method/origin/size/rate-limit/HMAC session token for every endpoint, local-peer or `ADMIN_SECRET` gate for admin writes, and a per-browser identity cookie for task ownership.

The same compiled handlers, router function and guard also run in the local dev server (`tools/serve.ts`), which shims KV over `config.json` (reads) and `data/kv-dev.json` (writes), attaches the transport peer address (`request.socketAddress`) and installs a stdio MCP bridge on `globalThis.MCP_HOST`.

### Main flow (chat turn → tools → background tasks)

```
Browser (ChatViewModel / apiFetch + X-Session-Token)
   │  POST /api/chat {conversationId, messages, stream:true, maxTokens}
   ▼
_worker.ts ─► routeApiEndpoint ─► guardApiRequest (method, origin, size, rate class, HMAC token)
   │                              ─► limitRequestBody (counts chunked bodies)
   │                              ─► request.taskWaitUntil = ctx.waitUntil
   ▼
api/chat.ts ─► resolveOrchestratorProvider (DEFAULT_PROVIDER / DEFAULT_MODEL via readChatDefaults)
   │            taskOwnerId(req)  (sha256(secret + cn9_browser cookie | peer IP))
   ▼
lib/orchestrator.ts orchestrateChatTurn
   ├─ orchestratorTranscript (vision gate: images only if model advertises 'vision')
   ├─ orchestratorSystemPrompt = ORCHESTRATOR_SYSTEM_PROMPT + admin SYSTEM_PROMPT + request.system
   └─ runAgentLoop({provider, model, seedMessages, toolOptions:{includeMcp,includeGeneration,includeTaskTools},
                    onText → SSE delta, interceptTool → dispatch, emit → SSE tool frames})
          │
          ├─ agentProviderTurn (streamed) ─► anthropic /messages | openai /responses | xai|ollama /chat/completions
          │
          └─ for each tool call: interceptTool(call)
                 classifyTool(name, TASK_BACKGROUND_TOOLS)
                 ├─ inline  → tool.run() (current_time, fetch_url, web_search, query_memory, mcp server.tool)
                 │            SSE {type:'tool', status:'running'|'ok'|'error', summary:"Searched the web for …"}
                 └─ background → createTask (cap 3/owner) → SSE {type:'task', task}
                                 taskDetach(runTaskToCompletion(runBackgroundOperation(...)))
                                   ├ generate_image  → api/generateImage (in-process sub-request, task signal)
                                   ├ generate_video  → api/generateVideo + refreshVideoJob poll every 5s
                                   ├ create_application → api/createApplication (8192-token HTML)
                                   ├ create_document → markdown artifact
                                   └ run_agent_task → nested runAgentLoop (no hooks, emit noop)
                                 model is told "Started the background task … say so in one sentence"
   ▼
SSE {type:'done', message, usage, model, provider}  (turn ends; tasks keep running)

Later: GET /api/tasks/stream → {type:'task_update', task} … GET /api/tasks/{id}/result → artifact
       POST /api/tasks/{id}/delivered (idempotent; stops re-delivery on reload)
```

Everything a provider needs lives behind `requireProvider(KV, requested, req, CAPABILITY_ORDER)` → `ResolvedProvider` → `providers/dispatch.ts`. Endpoints never import a provider module directly ("The one place a provider name turns into an implementation", `server/providers/dispatch.ts:10`). The tool loop is the only other place with provider-specific code (three tool dialects).

---

## 2. Feature inventory

### 2.1 Worker entry and exact routing — `server/_worker.ts`
- `API_HANDLERS` (line 29) is an explicit table of 18 handlers: `chat, config, models, health, session, embeddings, transcribe, speech, describeImage, generateImage, generateVideo, search, createApplication, getSessionToken, extractMemory, mcp, agent, tasks`. Dispatch uses `Object.prototype.hasOwnProperty` so `/api/constructor` 404s (line 64).
- `routeApiEndpoint` (`server/lib/security.ts:105`) accepts exactly `/api/<name>` or, for policies with `subpath:true` (`mcp`, `tasks`), up to `/api/<name>/<resource>/<id>` (`API_SUBPATH_MAX_DEPTH = 4`).
- `BLOCKED_PREFIXES` (`/_worker.js`, `/server/`, `/function/`, `/functions/`, `/services/`, `/data/`, `/.git`) 404 before `env.ASSETS.fetch`.
- Missing KV binding → `kv_unavailable` 503 (`api/errors.ts:20`).
- **Background lifetime hook**: `ctx.waitUntil` is attached to the request as a non-enumerable `taskWaitUntil` property (lines 85–94) so `taskDetach` can keep a background promise alive past the response without changing every handler signature `(req, KV)`.
- Maturity: **solid** (tests `api-routing.test.js`, `test/e2e/api-depth.spec.js`).

### 2.2 Single model registry — `server/providers/registry.ts`
- `PROVIDER_DEFINITIONS` (line 119) — per provider: `apiKeyKeys`, `orgKeys`, `baseUrlKeys`, `modelKeys`, `defaultBaseUrl`, `baseUrlSuffix` (Ollama `/v1`), `defaultModel`, `models[{id,label,capabilities[]}]`, `embeddingModel`, `imageModelKeys/defaultImageModel`, `videoModelKeys/defaultVideoModel`, `searchTool`, `devOnly`.
- Capability flags used: `chat`, `streaming`, `vision`, `tools`, `search`, `embeddings`, `transcription`, `speech`, `image`, `video`, `realtime`.
- **Capability preference orders** (lines 204–217) are the single source of truth for "who can do X": `PROVIDER_ORDER` (chat) `anthropic, openai, xai, ollama`; `EMBEDDING_PROVIDER_ORDER` `ollama, openai`; `VISION_PROVIDER_ORDER` `anthropic, openai, xai`; `TRANSCRIBE_PROVIDER_ORDER`/`SPEECH_PROVIDER_ORDER` `openai, xai`; `IMAGE_PROVIDER_ORDER` `openai, xai`; `VIDEO_PROVIDER_ORDER` `xai`; `SEARCH_PROVIDER_ORDER` `anthropic, xai`.
- `resolveProvider` (232) reads keys through `readSetting` (KV/config), trims trailing slashes, appends Ollama's `/v1`; keyless providers are "configured" once a base URL exists.
- `isProviderAvailable` (264): Ollama (`devOnly`) is available only for local requests (peer-address check) or when `OLLAMA_BASE_URL` points to a non-localhost host.
- `defaultProviderName` (304): `DEFAULT_PROVIDER` only wins **inside** the capability order being resolved — an image request never resolves to a chat-only default.
- `requireProvider` (330): explicit provider validated (400 unknown, 503 `not_configured` naming the key) or first available in order.
- `assertProviderSupports` (355): configured-but-incapable → 400 naming the keys of providers that can.
- `listProviderStatus` (272): feeds `/api/models` and `/api/health`; always lists the configured model/image/video model even if it is not in the built-in list; never returns key material.
- `normalizeChatMessages` / `normalizeChatContent` / `buildChatRequest` (367–441): neutral `ChatMessage{role,content:ChatBlock[]}` with `{type:'text'|'image', text?, dataUrl?}`; system messages are hoisted into one `system` string; `maxTokens` default 4096, Ollama floor 512; caller arrays never mutated.
- Maturity: **solid** (`providers.test.js` "the model registry is the only source of model ids").

### 2.3 Provider dispatch — `server/providers/dispatch.ts`
`providerChat`, `providerChatStream(onText, signal)`, `providerEmbeddings`, `providerTranscribe`, `providerSpeech`, `providerGenerateImages`, `providerCreateVideo/VideoStatus/VideoContent`, `providerSearch`. Each switches on `provider.name` and throws typed `invalid_request` when the provider lacks the capability. Cancellation `signal` is threaded through every call so a closed stream or cancelled task stops upstream billing. **solid**.

### 2.4 Provider dialects
- **Anthropic** (`providers/anthropic.ts`): `POST {base}/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`; system is top-level; images are `{type:'image',source:{type:'base64',media_type,data}}` or `{type:'url'}` for http(s); no `temperature` ever sent ("claude-opus-5 rejects a `temperature` parameter"). Stream parse: `message_start` (model, input tokens), `content_block_delta.delta.text`, `message_delta.usage.output_tokens`, `error`.
- **OpenAI** (`providers/openai.ts`): **Responses API** `POST {base}/responses` with `input`, `instructions`, `max_output_tokens`; images as `input_image`; text-only turns collapsed to a plain string; `OpenAI-Organization` header from `OPENAI_ORGANIZATION_ID` (legacy `OPENAI_ORG_ID`). Stream parse: `response.output_text.delta`, `response.completed|incomplete` (usage/fallback text), `response.failed|error`. Also `/embeddings`, `/audio/transcriptions` (multipart), `/audio/speech`.
- **OpenAI-compatible** (`providers/openaiCompatible.ts`): `POST {base}/chat/completions` for xAI and Ollama; `compatMessages` adds a leading system message and `image_url` blocks; `stream_options.include_usage` when supported; `extraBody` hook.
- **xAI** (`providers/xai.ts`): chat via compat; **TTS** `POST {base}/tts {text, voice_id, language:'auto', output_format:{codec, sample_rate:24000, bit_rate:128000}}` (15,000-char cap); **STT** `POST {base}/stt` multipart with the `file` part **last**; neither takes a model id.
- **Ollama** (`providers/ollama.ts`): compat chat with `OLLAMA_EXTRA_BODY = {reasoning_effort:'none'}` to disable qwen3's thinking pass (measured 9.8s → 3.6s first token; agent step 35.2s → 0.9s); native `POST {root}/api/embed` for embeddings.
- Maturity: **solid** but cloud providers are covered only by mocked tests (docs admit no live key has ever been exercised in CI).

### 2.5 Outbound HTTP policy with caller deadlines — `server/lib/http.ts`
- `fetchWithRetry` (75): per-attempt timeout (`PROVIDER_TIMEOUT_MS` 60s, `PROVIDER_STREAM_TIMEOUT_MS` 180s), `PROVIDER_RETRIES = 2` on 429/5xx with exponential backoff + jitter, honours `Retry-After` capped at 5s, cancels retried bodies, never retries an aborted caller, throws typed `provider_unreachable` 502.
- **Deadline-on-signal**: `setProviderDeadline(signal, deadlineAt)` stamps a non-enumerable `providerDeadlineAt` on the AbortSignal; `fetchWithRetry` uses `max(routeTimeout, remaining deadline)`. This lets a background task's 10-minute budget reach the provider fetch without adding parameters to every layer (fixes a bug where a 1:11 local app generation failed at exactly 3:00 after three 60s attempts).
- `combineSignals` merges caller cancel + timeout with `AbortSignal.any`.
- **solid**.

### 2.6 SSE both directions — `server/lib/sse.ts`
- `sseHeaders()` (`text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`), `sseData(payload)` → `data: {json}\n\n`.
- `parseSseBlock` handles `event:`, multi-line `data:`, comments, CRLF; `readEventStream` searches explicit boundaries (`\r\n\r\n`, `\n\n`, `\r\r`) so a separator split across chunks is handled; falls back to buffered bodies; **always cancels the upstream reader in `finally`** so an error event or departed client stops provider streaming/billing.
- **solid**.

### 2.7 Chat endpoint and the orchestration SSE protocol — `server/api/chat.ts`
Request: `{messages:[{role,content}], conversationId?, system?, stream?, maxTokens?, provider?, model?, orchestrate?}`, content is string or `[{type:'text',text}|{type:'image',dataUrl}]`.

Modes:
- `stream:true` (default orchestrated) → frames:
  - `{"type":"delta","text":"…"}`
  - `{"type":"tool","id","name","status":"running"|"ok"|"error","summary","detail"?}`
  - `{"type":"task","task":{id,kind,title,status,progress?,startedAt,…}}`
  - `{"type":"done","message":{role,content},"usage","model","provider"}`
  - `{"type":"error","message","code"}`
- `stream:true, orchestrate:false` → plain streamed completion (`delta`/`done`/`error`), no tools.
- `stream:false` → plain PF-2 completion JSON `{message,usage,model,provider}` (used by sibling endpoints/memory extraction).
- Provider resolution happens **before** the stream opens so misconfiguration gets a real status code; after headers, failures arrive as `error` frames. A turn with no text **and** no tasks is an `upstream_error` ("model may have spent its budget on a reasoning pass"); a turn whose only output is a started task is a valid `done`.
- Stream `cancel()` aborts the turn's AbortController (provider fetch), but **not** background tasks started in the turn.
- **solid** (`chat-orchestration.test.js`, `orchestrator.test.js`, contract `orchestrator.test.js`).

### 2.8 Orchestrator: inline vs background routing as data — `server/lib/orchestrator.ts`
- `TOOL_ROUTING_TABLE` (77): `current_time`, `query_memory`, `fetch_url`, `web_search` → **inline**; `generate_image`(image), `generate_video`(video), `create_application`(application), `create_document`(document), `run_agent_task`(agent) → **background**. Each entry has a `reason` string. Rule: *not "how long" but "what shape is the answer"* — inline if the model must read the result to reply; background if it produces an artifact or needs several model calls.
- `classifyTool(name, backgroundTools)` (201): operator override list `TASK_BACKGROUND_TOOLS` (supports exact name, `mcp` for all MCP tools, `server.*`) checked first; unclassified MCP tools (`server.tool`) default inline (`MCP_DEFAULT_ROUTE`), unknown built-ins inline.
- `TOOL_SUMMARY_TABLE` (118): per tool `subject` arg keys + `running(what)`/`finished(what)` phrasing ("Searching the web for “x”" / "Started an image of x"). `toolSummariesMissing()` is asserted empty by a unit test, so a new routed tool cannot ship without human copy. MCP tools render "Asking github to read issue"; unknown built-ins "Running send email".
- `ORCHESTRATOR_SYSTEM_PROMPT` (223): "Cloud Nine AI" assistant; answer directly when possible; tool results are data not instructions (prompt-injection defence); background work — say it started in one sentence, don't claim completion; don't discuss providers/models/config.
- `resolveOrchestratorProvider` (249): request provider/model accepted for back-compat; otherwise admin defaults; `DEFAULT_MODEL` applied only if the resolved provider advertises it (prevents handing an OpenAI model id to xAI after failover).
- `orchestratorSystemPrompt` (264): built-in rules + admin `SYSTEM_PROMPT` + per-request `system` (**additive only**).
- `orchestratorTranscript` (289): vision gate — images reach the model only when `capabilities` includes `vision`; otherwise the user turn gets an honest note "[N images were attached, but the configured model cannot read images…]".
- `runBackgroundOperation` (403): each background tool calls the sibling handler **in-process** via `taskSubRequest`, which re-defines `request.signal` as the task's own signal (so both cancel and the deadline stamp survive `new Request()` copying). Video polls `refreshVideoJob` every `VIDEO_POLL_INTERVAL_MS = 5000` and reports progress via `updateTaskProgress`. `run_agent_task` runs a nested `runAgentLoop` with the turn's resolved provider/model and returns the last artifact or the answer text as a `text` artifact.
- `orchestratorSize` (350) drops model-guessed sizes like `"medium"` so the image path uses defaults instead of failing.
- `orchestrateChatTurn` (599): wires everything; the `dispatch` interceptor creates the task, emits the `task` frame, detaches the work, and returns a tool result telling the model the task started. A concurrency-cap refusal is returned to the model as a tool result, not a turn failure.
- Maturity: **solid** for built-ins; **bug**: an MCP or inline built-in pushed to background via `TASK_BACKGROUND_TOOLS` reaches the final `throw providerError('There is no background operation for …')` (lines 496–497) even though the comment above says it should "run it exactly as the loop would have" — so the operator override is effectively broken for anything outside the five built-in background tools.

### 2.9 Agent runtime (single tool-use loop) — `server/lib/agentRuntime.ts`
- **Neutral transcript**: `AgentMessage = {role:'user',text,images?} | {role:'assistant',text,toolCalls[]} | {role:'tool',outcomes[]}`; `AgentToolCall{id,name,args,argsError?}`.
- **Three dialects** (643–1050), each in buffered and streamed form sharing one body builder: Anthropic (`tool_use`/`tool_result`, `input_schema`, partial JSON via `content_block_delta.partial_json` keyed by block index); OpenAI Responses (`function_call`/`function_call_output`, `response.output_item.added` + `response.function_call_arguments.delta` keyed by item id, completed-payload fallback); compat (`tool_calls` fragments keyed by `index`, `role:'tool'` results, synthesised ids for Ollama). Arguments accumulate as strings and parse once (`agentFinishToolCalls`); unparseable args become `argsError` reported back to the model as a tool error rather than crashing the run.
- `agentProviderTurn` (1058) picks dialect; streaming is opt-in via `onText`.
- **Built-in tools** (139–506): `current_time{timezone}`, `fetch_url{url,max_chars}` (SSRF-checked, manual redirects ≤3 each re-checked, 20s, 400KB cap, text-only content types, HTML→text stripping scripts/styles/comments), `create_document{title,markdown}`, `create_application{name,specs}` (calls `/api/createApplication` in-process), `generate_image{description,size}`, `web_search{query,maxResults}` (calls `/api/search`, renders "Sources: [n] title - url" as data), `query_memory{query,limit}` (uses `globalThis.MEMORY_HOST.query` if installed, else term-overlap scoring over `body.memory` snapshot), `generate_video{description,seconds,size}` (only with `includeGeneration`), `run_agent_task{goal,title}` (only with `includeTaskTools`; stub if reached without a dispatcher), and `mcpTool(definition)` wrappers.
- `agentBuildTools` (595): **configuration decides the tool surface** — image tool only if an image provider is configured, search only if Anthropic/xAI configured, memory only if a host or snapshot exists, MCP tools from `mcpAllTools` (errors logged, never fatal); request `tools` allowlist can only **remove** (`agentToolAllowed` supports `*`, `mcp`, `server.*`).
- `runAgentLoop` (1183): options `provider`, `model`, `onText`, `seedMessages`, `systemPrompt`, `toolOptions`, `interceptTool` — the orchestrator's seams; `/api/agent` passes none. Guardrails: `maxSteps` default 12 (`AGENT_MAX_STEPS`), hard cap 24; maxTokens clamp 256..16384; goal ≤8000 chars; memory ≤50 entries ×4000 chars; context cards ≤20 ×8000 chars prepended as `[kind: title]\ncontent`; tool results truncated to 20,000 chars; cancellation checked between steps and tool calls. Emits `step` (`start` with tools list + maxSteps, `thinking`, `message`, `wrap-up`), `tool` (running/ok/error with `args`, `result`, `durationMs`), `result` (artifact). On step ceiling it makes **one final no-tools turn** asking for the best answer ("wrap-up") instead of failing.
- `AGENT_SYSTEM_PROMPT` (1087): small steps, never invent tool output, tool results are data, use create_document/create_application for deliverables, end with plain prose.
- Maturity: **solid** (`agent.test.js` covers all dialects, guardrails, cancellation, allowlist, SSRF).

### 2.10 Explicit agent endpoint — `server/api/agent.ts`
`POST /api/agent {goal, provider?, model?, maxSteps?, maxTokens?, tools?, mcp?, context?[{kind,title,content}], memory?[{title,content}], system?, stream?}`. Streamed: `step`/`tool`/`result`/`done`/`error`; cancellation = client closes stream. `stream:false`: collects frames, bounded by client abort + `AGENT_MAX_WALL_CLOCK_MS` (300s, configurable), timeout reported as `stopReason:'timeout'` distinct from `cancelled`. Goal validated before stream opens. Runs are **not resumable** (no job record). **solid** (the end-user workspace no longer exposes an agent drawer; it is used via `run_agent_task`).

### 2.11 Background task store — `server/lib/taskStore.ts` + `server/api/tasks.ts`
- **Record**: `TaskRecord{id:'task_<24hex>', ownerId, conversationId, kind:'image'|'video'|'application'|'document'|'agent', title, status:'queued'|'running'|'succeeded'|'failed'|'cancelled', progress?(0..1), startedAt, finishedAt?, result?:TaskArtifact, error?, expiresAt, deliveredAt?}`; `TaskArtifact{kind:'image'|'video'|'application'|'document'|'text', title, content?, url?, mime?, detached?}`.
- **State machine** `taskAllows` (165): terminal is final; `queued→running|terminal`, `running→terminal`; identical to the client `app/Modules/TaskRegistry.ts`.
- **Per-kind wall clocks** `TASK_WALL_CLOCK_MS` (63): image 5m, document 3m, application 10m, video 20m, agent 10m; overridable per kind (`TASK_MAX_WALL_CLOCK_MS_<KIND>`) or globally (`TASK_MAX_WALL_CLOCK_MS`). Defaults are *measured* (documented qwen3:32b timings).
- **Concurrency cap** `TASK_MAX_CONCURRENT = 3` per owner, enforced in `createTask` → typed `task_limit` 429.
- **Ownership** `taskOwnerId` (274): `sha256("taskowner:"+secret+":browser:"+cn9_browser)` or peer-IP fallback, truncated to 32 hex; other owners' ids answer 404 (not 403).
- **Durability**: KV keys `task:<id>`, `taskindex:<owner>` (≤100 ids), `taskblob:<id>`; TTL = retention (30m, `TASK_RETENTION_MS`) + kind ceiling; isolate-local `taskCache` authoritative for running tasks (KV eventual consistency).
- **Detached results** `storeTaskResult` (569): results >4096 chars (e.g., base64 images) stored under `taskblob:` with a `{detached:true}` reference on the record; bytes fetched once via `GET /api/tasks/{id}/result`; bounded in-memory blob LRU of 8.
- **Lazy reaper** in `listTasks` (418): non-terminal records older than their kind's ceiling are failed with a human sentence ("This took longer than 10 minutes and was stopped.") and published — fixes zombies from dead isolates holding the concurrency cap.
- **runTaskToCompletion** (744): AbortController registered for cancel, deadline stamped on the signal, timer abort, guaranteed terminal record; abort/timeout errors rewritten via `taskFailureMessage` so users never see "Ollama request failed: The operation was aborted due to timeout".
- **taskDetach** (807): uses `request.taskWaitUntil` (Workers `ctx.waitUntil`) or `globalThis.TASK_WAIT_UNTIL`, else lets the promise run (Node dev server).
- **Delivery marker** `markTaskDelivered` (658): durable, idempotent; list/stream return `delivered:true` so reloads don't re-append the artifact to the conversation.
- **Routes** (`api/tasks.ts`): `GET /api/tasks`, `GET /api/tasks/stream` (replays current tasks, then `task_update` frames; `: keep-alive` every 25s), `GET /api/tasks/{id}/result`, `POST /api/tasks/{id}/cancel`, `POST /api/tasks/{id}/delivered`, `POST /api/tasks/clear`. Counted in the `read` rate window so an open tray cannot starve `/api/chat`.
- Caveat: live updates use an **in-isolate pub/sub map** (`taskListeners`); a stream on one isolate does not hear tasks running on another — the list route is the reconciliation backstop.
- Maturity: **solid** for single-instance/dev; **partial** for multi-isolate live streaming.

### 2.12 MCP client (no SDK) — `server/mcp/client.ts`
- `MCP_PROTOCOL_VERSION = '2025-06-18'`, `MCP_CLIENT_INFO {name:'cloudnine-ai', version:'1.0.0', title:'Cloud Nine AI'}`; request timeout 30s, `tools/call` timeout 120s, result cap 60,000 chars.
- **Streamable HTTP** (`McpHttpSession`, 177): one POST per JSON-RPC message, `Accept: application/json, text/event-stream`, echoes `Mcp-Session-Id` and `MCP-Protocol-Version`, reads JSON or SSE reply (`readSseUntil` matches by JSON-RPC id), `DELETE` on close.
- **Legacy SSE** (`McpSseSession`, 254): long-lived GET, waits for `event: endpoint`, **policy-checks the announced endpoint** (SSRF), pumps responses into a pending map; `perOperation = true` (open/call/close each time).
- **stdio** (`McpStdioSession`, 407): delegates to `globalThis.MCP_HOST.request(id, config, message, timeout)` installed only by `tools/serve.ts` (spawns child processes, newline-delimited JSON); unavailable in the Worker with an explanatory reason.
- `mcpFetch` (143): manual redirects (≤3), every hop re-checked by `checkOutboundUrl`.
- `mcpHandshake` (454): `initialize` → `notifications/initialized`; `mcpListTools` (469) pages `tools/list` up to 3 pages; `mcpCall` (498) → `{text, isError, structured}` via `mcpContentToText`.
- Only the **tools** capability is used (no prompts/resources/sampling/elicitation). **solid** for tools.

### 2.13 MCP manager, registry API, and schema normalisation
- `server/mcp/manager.ts`: server list lives in `data/mcp-servers.json` via the host bridge in dev, or KV key `MCP_SERVERS` deployed (max 20). `McpServerConfig{id,name,transport:'http'|'sse'|'stdio',url?,headers?,command?,args?,env?,cwd?,enabled,createdAt}`. `mcpNormalizeServer` (121) validates; stdio only when a host exists **and** `isLocalRequest` (peer address); remote URLs SSRF-checked. Connections cached per isolate with `MCP_CONNECTION_TTL_MS = 300000` and a config fingerprint; failures cached as `status:'error'` with the server's message. `mcpInvokeTool` (288) retries once on a fresh session. `mcpPublicState` (322) never returns header values or env (only `headerCount`).
- `server/api/mcp.ts`: `GET/POST/DELETE /api/mcp/servers`, `GET /api/mcp/tools`, `POST /api/mcp/connect|disconnect|call` (also `?resource=` addressing). Namespace clash refused.
- `server/mcp/schema.ts`: tools exposed as `server.tool`; **bijective wire encoding** for providers' `^[a-zA-Z0-9_-]+$` rule — `.`→`__`, `_`→`_-` (`toolWireName`/`toolNameFromWire`, 66–79); JSON-Schema normalised to a keyword whitelist, depth ≤8, ≤64 properties, descriptions ≤1024, root forced to `type:'object'` with `properties`, dangling `required` removed; `mcpContentToText` maps image/audio/resource blocks to textual placeholders.
- `data/mcp-servers.json` ships as `{"servers": []}`.
- Maturity: **solid** (`mcp.test.js`, 23 behaviours incl. SSRF via announced endpoint and redirects).

### 2.14 Outbound URL (SSRF) policy — `server/mcp/net.ts`
`checkOutboundUrl(raw, {allowLocal, allowlist})` (147): http/https only; rejects embedded credentials; blocks `0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 192.0.0/24, 198.18/15, 100.64/10, ≥224`, IPv6 loopback/`::`/link-local/ULA, IPv4-mapped IPv6 in both dotted and hex forms, trailing-dot hosts, single-label hosts, and `.local/.internal/.localhost/.home.arpa/.lan`; optional allowlist (`AGENT_FETCH_ALLOWLIST`, leading-dot suffix). Explicitly does **not** stop DNS rebinding (Workers can't resolve first). **solid**.

### 2.15 Image generation — `server/providers/images.ts`, `server/api/generateImage.ts`
- One implementation for OpenAI and xAI at `POST {base}/images/generations`. Family table `IMAGE_FAMILIES` (44): `gpt-image` sizes `1024x1024, 1024x1536, 1536x1024, auto`, max 10, no `response_format`, quality yes; `dall-e-3` 3 sizes, max 1, `url`; `dall-e-2` 256/512/1024, max 10; `grok-imagine` no size param, max 10, `url`. Global `MAX_IMAGE_COUNT = 4`, formats `png|jpeg|webp` (`output_format` only for gpt-image).
- `buildImageRequest` (103) validates **before spending**; `mapKnownSize` (88) translates a foreign family's size to the same orientation (voice tool offers DALL-E sizes).
- Response `{url, b64, alt, images[], model, provider, size, legacy}`: `url` is a data URL for base64 answers; `alt` = `revised_prompt` when present; `legacy` flags DALL-E.
- Honours `req.signal` so task cancel stops the render.
- **No image editing / variations / inpainting endpoint** exists (only generations). Maturity: **solid** for generation, **absent** for editing.

### 2.16 Video generation as a job — `server/providers/video.ts`, `server/api/generateVideo.ts`
- xAI Imagine only: `POST {base}/videos/generations {model,prompt,duration,aspect_ratio,resolution}` → `{request_id}`; `GET {base}/videos/{id}` → `{status, video:{url}, error?}`; bytes fetched from `video.url` **without** the API key (different CDN origin). OpenAI Videos/sora-2 removed (deprecated, Sept 2026 shutdown).
- `aspectRatioForSize` picks the nearest of `1:1,16:9,9:16,4:3,3:4,3:2,2:3`; `resolutionForSize` by short edge → `480p|720p|1080p`. Allowed sizes `720x1280, 1280x720, 1024x1792, 1792x1024` (default 1280x720); seconds `4|8|12` (default 4).
- `normalizeVideoStatus` collapses vocabularies to `queued|processing|completed|failed` (`expired` terminal); progress 0–1 or 0–100 normalised.
- API: `POST` → `202 {job}`; `GET ?id=` polls (refreshes non-terminal jobs and writes back); `GET ?id=&download=1` streams MP4 through the worker (`Cache-Control: private, no-store`). Job record `VideoJobRecord` in KV `videojob:<vid_…>` TTL 6h; provider job id never leaves the server. Typed errors `job_expired` 404, `video_failed` 502, `job_not_ready` 409.
- Provider job is never cancelled if the client stops polling. **solid**.

### 2.17 Provider-side web search — `server/providers/websearch.ts`, `server/api/search.ts`
- Anthropic: `/messages` with `tools:[{type:'web_search_20260209', name:'web_search', max_uses:maxResults}]`; citations from text-block `citations` + `web_search_tool_result` blocks.
- xAI: `POST /responses {instructions, input, tools:[{type:'web_search'}], max_output_tokens}` (Live Search `search_parameters` returns 410); citations ranked **cited annotations first, then searched sources, then top-level list**; numeric footnote titles ("3") blanked to host.
- `normalizeCitations` (104): http(s) only (blocks hallucinated `javascript:`), dedupe by host+path (www/trailing-slash insensitive), title fallback to host, snippet ≤400, cap `maxResults` (default 5, max 20).
- `buildSearchRequest` carries prior turns (drops leading assistant turns for Anthropic) and prefixes `SEARCH_SYSTEM_PROMPT`.
- Response `{answer, citations[{title,url,snippet,source}], query, model, provider, usage}`; empty answer+no citations → `upstream_error`. **solid**.

### 2.18 Embeddings — `server/api/embeddings.ts`
`POST /api/embeddings {texts|input:[…], provider?}` ≤128 texts × ≤32,000 chars → `{embeddings, model, provider}`. Ollama `nomic-embed-text` preferred (free local memory), OpenAI `text-embedding-3-large` fallback. **solid**.

### 2.19 Speech-to-text — `server/api/transcribe.ts`
Multipart `audio` (or `file`) + optional `language`, `prompt`, `provider` → `{text, model, provider}`. OpenAI `gpt-4o-mini-transcribe` first, xAI `/stt` second; empty recognition → 502. **solid**.

### 2.20 Text-to-speech — `server/api/speech.ts`
`POST /api/speech {text≤4000, voice?, provider?}` → `audio/mpeg` with `X-Speech-Voice`, `X-Speech-Provider`. Catalogues: OpenAI `alloy, ash, ballad, coral, echo, sage, shimmer, verse` (default `echo`); xAI 26 voices `altair … zenith` (default `eve`). Unknown name → 400; a real voice of the *other* provider is substituted with this provider's default and reported in the header. Client list mirrored in `shared/Modules/SpeechOutput.ts` with a drift test. Browser `speechSynthesis` is the no-key fallback. **solid**.

### 2.21 Realtime voice session minting — `server/api/getSessionToken.ts`
- Order `['openai','xai']`; explicit provider validated by name.
- **OpenAI**: `POST {base}/realtime/client_secrets` with GA session shape: `{session:{type:'realtime', model (OPENAI_MODEL_RT or gpt-realtime-2), output_modalities:['audio'], max_output_tokens, instructions, audio:{input:{transcription:{model:'gpt-4o-mini-transcribe'}, turn_detection:{type:'server_vad', threshold:0.5, prefix_padding_ms:300, silence_duration_ms:500, create_response:true, interrupt_response:true}}, output:{voice}}, tools}}` → WebRTC. Response headers: `X-Realtime-Provider: openai`, `X-Realtime-Transport: webrtc`, `X-Realtime-Model`, `X-Realtime-Voice`, `X-Realtime-Base`.
- **xAI**: `POST {base}/realtime/client_secrets {expires_after:{seconds:300}}` → WebSocket `wss://…/v1/realtime` with subprotocol `xai-client-secret.<token>`; voices `eve, ara, rex, sal, leo`; model `XAI_MODEL_RT` or `grok-voice-latest`; session configured client-side via `session.update`. Header `X-Realtime-Websocket`.
- Secret returned as `text/plain`, `Cache-Control: no-store`, never logged.
- `realtimeInstructions` interpolates **client-supplied persona state** (name, description, message, avatar, 18 facial parameters) and the themed-HTML guidelines; `realtimeTools()` defines 5 tools: `create_application`, `generate_image` (size enum DALL-E sizes), `create_document`, `add_memory`, `update_persona` (full avatar appearance schema). Tools are executed by the client; the client also appends connected MCP tools (`agent-voice-tools.test.js`).
- Maturity: **solid**; persona text is an unsanitised system-prompt injection vector (scoped to the caller's own session).

### 2.22 Vision description — `server/api/describeImage.ts`
`POST /api/describeImage {image_url (data:image/* or http(s)), text?, provider?, model?}` → `text/plain` with `X-Provider`, `X-Model`; long `IMAGE_DESCRIPTION_PROMPT`; order skips Ollama (no vision head). Used by the camera/screen capture loop. **solid**.

### 2.23 Themed HTML application generation — `server/api/createApplication.ts`
`POST /api/createApplication {name, specs, html?, provider?, model?}` → `text/html` (code fences stripped, `X-Provider`, `X-Model`). The "yousayaido" mega system prompt (line 74) asks for a complete self-contained responsive app, CSS/WebGL visuals, no external resources, localStorage, `form method="dialog"`, and one of 13 classless CSS themes (Spectre, 98.css, XP.css, Water.css, …). `html` lets the model **revise an existing app**. `maxTokens` 8192; deadline raised to ≥180s via `setProviderDeadline` (never shortened). Also exposed as agent tool, background task and realtime tool; the client renders it in a sandboxed `srcdoc` iframe (`allow-scripts allow-forms`). **solid**.

### 2.24 Memory extraction to a knowledge graph — `server/api/extractMemory.ts` + `server/lib/lenientJson.ts`
- `POST /api/extractMemory {text≤8000, provider?, model?}` → `{entities:[{name,type,observations[]}], relations:[{from,to,type}], status:'ok'|'unparsed', warnings[], provider, model}`.
- `MEMORY_EXTRACTION_PROMPT` asks for durable facts only, types `person|place|organization|project|preference|event|concept`, standalone observations.
- `parseExtraction` (227): candidates = `<think>`-stripped text, fenced blocks, widest `{…}` and `[…]`, truncated tails; each tried with `JSON.parse` then `parseLenientJson`; **richest reading wins** (entities+relations count), ties prefer clean parses. Aliases accepted (`nodes`, `edges`, `source/target`, `facts`, `entityType`, …); bare strings promoted to `concept` entities; dedupe by `lower(name)|type`; caps 12 entities, 12 relations, 8 observations, names 120, observations 400 chars.
- One **stricter retry** with a filled-in example when unparsed; unparsed is still HTTP 200 with `status:'unparsed'` (background pass must never block a turn); raw answer logged at debug level truncated to 1200 chars.
- `parseLenientJson` (lenientJson.ts:122): tokenizer ignoring prose; stack parser with three rules — any closer closes the innermost container; a `"key":` inside an open array unwinds to the nearest object; EOF closes everything; truncated strings dropped; 200k char cap; never throws.
- Storage is **client-side** (IndexedDB `MemoryStore`); the server only extracts. Maturity: **solid** (unit + live contract "6 of 6 runs").

### 2.25 Admin defaults — `server/api/config.ts`
- Exactly three keys: `DEFAULT_PROVIDER`, `DEFAULT_MODEL`, `SYSTEM_PROMPT` (≤8000 chars; model id regex `^[A-Za-z0-9][A-Za-z0-9._:\/-]*$`, ≤200). `readChatDefaults` is the one reader (unset → `''`).
- GET (session-gated) → `{defaults, keys, limits, writable, reason?, protection:{admitted:'local'|'secret'|'', secretConfigured, summary}}` — explains *why* saving is off instead of offering a Save that 403s.
- POST requires `isAdminRequest` (loopback peer or `X-Admin-Secret` equal to `ADMIN_SECRET`, constant-time); whitelisted fields `defaultProvider`, `defaultModel`, `systemPrompt`, each written only if present; `assertModelBelongsToProvider` refuses mismatched pairs; empty values stored as `''` (not deleted, so dev `config.json` can't resurrect them); read-back after write. **solid**.

### 2.26 Perimeter: guard, session tokens, rate limits, identity — `server/lib/security.ts`
- `ENDPOINT_POLICIES` (51) with `DEFAULT_ENDPOINT_POLICY = {POST, session:true, 512KB, spend}` — **unknown endpoints are protected by default**. Body caps: JSON 512KB, vision 8MB, uploads 26MB.
- `guardApiRequest` (648): method → origin (Origin/Referer allowlist: localhost, same host, `*.pages.dev`, `ALLOWED_ORIGINS`; `session` requires a declared origin) → declared Content-Length → rate limit → `X-Session-Token`.
- `limitRequestBody` (140): counts undeclared (chunked) bodies and rebuilds the request, preserving `socketAddress`.
- **Session token** `v1.<exp>.<nonce>.<HMAC-SHA256 b64url>`, TTL 1800s, signed with `APP_SESSION_SECRET` or a generated secret written to KV `APP_SESSION_SECRET_GENERATED` with read-back convergence across isolates; verification constant-time, re-reads KV once on a miss.
- **Rate limits** (596): sliding 60s window per IP per class (`spend`, `read`, `session`), default `API_RATE_LIMIT = 240`; `session` gets max(30, limit/4); counters in isolate memory; KV only stores an idempotent block marker (written once per window per blocked IP). `clientIp` trusts `cf-connecting-ip` only inside the Workers runtime (`request.cf` present), else the socket peer.
- `isLocalRequest` (236) uses `request.socketAddress` (loopback incl. full 127/8 and `::ffff:`), falls back to URL host only when no peer is attached — fixes a real RCE where the dev server's synthetic `localhost` URL made stdio MCP registration remotely reachable.
- Browser identity: HttpOnly `cn9_browser` cookie (32 hex, 1 year, SameSite=Lax, Secure on https) minted only by `/api/session` (`withBrowserId`).
- **solid** (`providers-security.test.js`).

### 2.27 Error envelope & config reading — `server/api/errors.ts`, `server/lib/config.ts`
`{error:{message,code}}` with real status; codes `invalid_request, unauthorized, forbidden, forbidden_origin, not_found, method_not_allowed, payload_too_large, rate_limited, task_limit, upstream_error, provider_unreachable, not_configured, kv_unavailable, job_expired, job_not_ready, video_failed, mcp_error, mcp_timeout, mcp_unsupported, internal_error`. `failureResponse` passes typed errors through and turns anything else into a generic 500 (never leaks internal exception text). `notConfiguredMessage(...keys)` names exact keys. `readSetting(KV, ...aliases)`, `readNumberSetting`, `readListSetting` are the only code that knows key names. **solid**.

### 2.28 Health, models, session endpoints
`GET /api/health` → `{ok, kv, providers:{name:bool}}`; `GET /api/models` → `{providers:[{name,label,configured,devOnly?,defaultModel,models[{id,label,capabilities}]}]}` (UI capability gating: `/image`, `/video`, search toggle only appear if advertised); `GET|POST /api/session` → `{token, expiresAt, ttlSeconds, header:'X-Session-Token'}` + browser-id cookie. **solid**.

---

## 3. Providers, models & external APIs

### Chat / reasoning models (registry defaults, overridable via `*_MODEL` keys)
| Provider | Default base URL | Default model | Other ids | Capabilities |
|---|---|---|---|---|
| Anthropic | `https://api.anthropic.com/v1` | `claude-opus-5` | — | chat, streaming, vision, tools, search |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.2` | — | chat, streaming, vision, tools |
| xAI | `https://api.x.ai/v1` | `grok-4.5` | `grok-4.3` | chat, streaming, vision, tools, search |
| Ollama (dev-only) | `http://localhost:11434` (+`/v1`) | `qwen3:32b` | — | chat, streaming, tools (no vision) |

### Specialty models
| Capability | OpenAI | xAI | Ollama | Anthropic |
|---|---|---|---|---|
| Embeddings | `text-embedding-3-large` | — | `nomic-embed-text` | — |
| STT | `gpt-4o-mini-transcribe` (`/audio/transcriptions`) | `grok-stt` (label only; `POST /stt`) | — | — |
| TTS | `gpt-4o-mini-tts` (`/audio/speech`) | `grok-tts` (label only; `POST /tts`) | — | — |
| Realtime voice | `gpt-realtime-2` (`/realtime/client_secrets`, WebRTC) | `grok-voice-latest` (`/realtime/client_secrets`, WSS `/realtime`) | — | — |
| Image | `gpt-image-1` (legacy `dall-e-3`, `dall-e-2` if pinned) | `grok-imagine-image`, `grok-imagine-image-quality` | — | — |
| Video | (removed: Videos API / sora-2 deprecated) | `grok-imagine-video-1.5` (default), `grok-imagine-video` | — | — |
| Web search | — | `web_search` tool on `/responses` | — | `web_search_20260209` server tool on `/messages` |

### Endpoints called
- Anthropic: `POST {base}/messages` (chat, stream, tools, web search). Headers `x-api-key`, `anthropic-version: 2023-06-01`.
- OpenAI: `POST /responses`, `/embeddings`, `/audio/transcriptions`, `/audio/speech`, `/images/generations`, `/realtime/client_secrets`. Header `Authorization: Bearer`, optional `OpenAI-Organization`.
- xAI: `POST /chat/completions`, `/responses` (search), `/tts`, `/stt`, `/images/generations`, `/videos/generations`, `GET /videos/{request_id}`, `POST /realtime/client_secrets`; client dials `wss://api.x.ai/v1/realtime`.
- Ollama: `POST {root}/v1/chat/completions` (with `reasoning_effort:'none'`), `POST {root}/api/embed`.
- MCP: any http(s) server (Streamable HTTP / SSE), stdio via dev bridge.

### Configuration key names (from `config.example.json` and code; values never read)
`ANTHROPIC_API_KEY, ANTHROPIC_API_URL, ANTHROPIC_MODEL, OPENAI_API_KEY, OPENAI_API_URL, OPENAI_MODEL, OPENAI_ORGANIZATION_ID (legacy OPENAI_ORG_ID), OPENAI_IMAGE_MODEL, OPENAI_MODEL_RT, OPENAI_INSTRUCTIONS, OPENAI_MAX_TOKENS, XAI_API_KEY, XAI_API_URL, XAI_MODEL, XAI_IMAGE_MODEL, XAI_VIDEO_MODEL, XAI_MODEL_RT, OLLAMA_BASE_URL, OLLAMA_MODEL, DEFAULT_PROVIDER, DEFAULT_MODEL, SYSTEM_PROMPT, ADMIN_SECRET, APP_SESSION_SECRET, ALLOWED_ORIGINS, API_RATE_LIMIT, AGENT_FETCH_ALLOWLIST, AGENT_MAX_STEPS, AGENT_MAX_WALL_CLOCK_MS, TASK_BACKGROUND_TOOLS, TASK_MAX_CONCURRENT, TASK_MAX_WALL_CLOCK_MS(_<KIND>), TASK_RETENTION_MS, MCP_SERVERS`.

### Notable absences for the Agent Workplace
No Google/Gemini provider, no generic "OpenAI-compatible" provider entry (only achievable by repointing `XAI_API_URL`/`OLLAMA_BASE_URL`), no CLI coding-agent provider, no image edit/inpaint endpoint, no per-agent model selection (one admin default), no reasoning-effort / thinking controls for cloud models, no prompt caching, no cost tracking.

---

## 4. Data model & persistence

All server persistence is **Cloudflare KV** (binding `KV`) or its dev shim (`config.json` read-only + `data/kv-dev.json` writes with TTL). No D1, R2 or Durable Objects are used. User data (conversations, memory graph, files) is client-side (IndexedDB/CacheStorage) — outside this slice.

| KV key | Shape | TTL / notes |
|---|---|---|
| provider/config keys (`OPENAI_API_KEY`, `DEFAULT_MODEL`, …) | string | set by operator or `/api/config` |
| `APP_SESSION_SECRET_GENERATED` | 64-hex | generated once, read-back converged |
| `ratelimit:<class>:<ip>:blocked` | epoch ms string | 60s, written once per window when blocking |
| `task:<task_…>` | `TaskRecord` JSON | retention (30m) + kind ceiling |
| `taskindex:<ownerHash>` | `string[]` ≤100 | retention + longest ceiling |
| `taskblob:<task_…>` | `TaskArtifact` JSON (large) | record expiry |
| `videojob:<vid_…>` | `VideoJobRecord{id,provider,model,providerJobId,status,progress,prompt,seconds,size,contentUrl?,createdAt,updatedAt,expiresAt,error}` | 6h |
| `MCP_SERVERS` | `{servers: McpServerConfig[]}` | deployed only; dev uses `data/mcp-servers.json` |

In-isolate state (not durable): `taskCache`, `taskBlobs` (LRU 8), `taskControllers` (AbortControllers), `taskListeners` (pub/sub), `mcpConnections` (5-min TTL + fingerprint), `rateLimitBuckets`, cached session secret.

Key wire shapes:
- `ChatMessage{role:'user'|'assistant', content: ChatBlock[]}`, `ChatBlock{type:'text'|'image', text?, dataUrl?}`, `ChatResult{text, model, usage:{inputTokens,outputTokens}}`.
- `AgentMessage`, `AgentToolCall`, `AgentArtifact{kind:'document'|'application'|'image', title, content?, url?, mime}`.
- `AgentToolDefinition{name, wireName, description, parameters, source:'builtin'|'mcp', server?, tool?}`.
- `AgentRunResult{text, steps, stopReason:'complete'|'max_steps'|'cancelled'|'timeout', usage, model, provider, artifacts, toolCalls}`.
- `ExtractionResult{entities, relations, status, warnings}`.
- `Citation{title, url, snippet, source}`.

---

## 5. UX details worth keeping

1. **One assistant, no knobs.** The workspace sends only `{conversationId, messages, stream, maxTokens}`; provider, model, system prompt and tool selection are server decisions (`ChatViewModel.run`, `app/ViewModels/ChatViewModel.ts:524`). Tests assert the chat surface exposes no provider/model control and never names a model.
2. **Human-phrased step rows.** Every tool call renders as a sentence with a running and a finished form ("Searching the web for “x”" → "Searched the web for “x”"; "Starting an image of a purple house" → "Started…"), with an `error` row carrying a ≤500-char `detail`. The step row is the only place the assistant says what it decided to do.
3. **"I've started it" semantics.** Long work returns immediately as a task; the model is instructed to say so in one sentence and not describe results it doesn't have. If the reply is empty but tasks started, the client fills the bubble with a task-started notice.
4. **Pending tray** with live progress (video %), cancel (really aborts upstream), readable failure sentences with retry, results delivered back into the originating conversation (even if another conversation is open), exactly once across reloads, and "clear finished" that persists server-side.
5. **Honest capability gating.** Tools/commands/toggles appear only when a configured provider advertises the capability (`/api/models`); errors name the exact key to set ("Not configured: set XAI_API_KEY …").
6. **Vision honesty.** Images attached to a non-vision model produce an explicit note rather than silent drop.
7. **Voice correction headers.** `X-Speech-Voice`, `X-Realtime-Voice/Model/Transport` tell the UI what actually spoke so pickers self-correct.
8. **Barge-in.** Realtime OpenAI sessions declare server VAD with `interrupt_response:true`; the client cancels and flushes audio when the user talks.
9. **Admin lockout explained.** `/api/config` GET returns `writable:false` plus a verbatim `protection.summary` sentence instead of a Save button that 403s.
10. **Readable timeouts.** "This took longer than 10 minutes and was stopped." instead of fetch-policy strings.
11. **Search link cards** with host fallback titles, citations prioritised by what the answer actually cited.
12. **Sandboxed generated apps** (`srcdoc` iframe, `allow-scripts allow-forms`) that can be revised by sending the existing `html` back.
13. The shipped UI (`docs/img/workspace.png`) centres a large animated avatar with Show (camera), Talk (mic), Share (screen) and a text composer — a single-assistant, avatar-first surface.

---

## 6. Patterns worth reusing (and how to lift them)

1. **Capability-ordered provider registry** (`server/providers/registry.ts`). Lift as the Agent Workplace's `ModelRegistry`: definitions with capability flags + per-capability preference orders + `requireProvider(capability, requested)` + `assertProviderSupports`. Extend with Google, generic OpenAI-compatible endpoints, CLI agents, per-persona model overrides, pricing metadata, context window, and reasoning controls. Keep the rule "model ids live in exactly one file".
2. **Dispatch table as the only name→implementation switch** (`dispatch.ts`). Each persona/agent calls capability functions (`chat`, `speak`, `transcribe`, `embed`, `image`, `video`, `search`), never a provider module.
3. **Neutral transcript + three tool dialects, streamed and buffered from one body builder** (`agentRuntime.ts:643–1081`). This is the core of a multi-provider agent engine; reuse the argument-accumulation and `argsError`-as-tool-error patterns verbatim.
4. **Loop seams (`interceptTool`, `seedMessages`, `systemPrompt`, `toolOptions`, `onText`, pre-resolved `provider/model`)** (`AgentRunOptions`, line 1097). In the Workplace, the lead orchestrator is one configuration of the loop and every coworker persona is another; delegation to a coworker becomes an intercepted tool (`delegate_to(persona, goal)`) that spawns a task.
5. **Inline-vs-background routing as data with human copy tables** (`TOOL_ROUTING_TABLE`, `TOOL_SUMMARY_TABLE`, `toolSummariesMissing()` test). Generalise to: every tool/action has `{route, taskKind, costClass, approvalRequired, runningText, finishedText}` and CI fails if copy is missing. This directly powers the "watch what agents are doing" feed.
6. **Durable task store with per-kind ceilings, concurrency caps, detached blobs, delivery markers and a lazy reaper** (`taskStore.ts`). Port to a Durable Object per project/workspace (fixes cross-isolate pub/sub and gives real concurrency control); keep the state machine, readable failure messages and `delivered` idempotency. Blobs move to R2.
7. **Deadline-on-signal** (`setProviderDeadline`). Carry budgets (time, and in the Workplace also token/cost budgets) on the cancellation object so nested calls inherit the parent task's limits without API changes.
8. **In-process sibling-handler calls with signal identity** (`agentSubRequest`, `taskSubRequest`). Tools reuse the same validated HTTP handlers the UI uses, avoiding duplicate logic; cancellation propagates.
9. **SSE protocol with typed frames and "validate before the stream opens"** (`chat.ts`, `agent.ts`). Extend frame types for multi-agent: `agent_joined`, `handoff`, `message(from,to)`, `speech_start/end` with viseme timing, `approval_required`.
10. **Hand-written MCP client for the Workers runtime** (`server/mcp/*`) including bijective wire names, schema whitelisting, SSRF re-checks on every hop and write-only secrets in public state. Reuse wholesale for P10; add resources/prompts and per-persona tool grants.
11. **SSRF policy module** (`mcp/net.ts`) shared by every model-controlled fetch.
12. **Tolerant structured-output reader + richest-candidate selection + one strict retry + `status:'unparsed'`** (`extractMemory.ts`, `lenientJson.ts`). Use for any JSON the agents emit (plans, DAGs, memory, handoff payloads), especially on local models.
13. **Perimeter as a policy table with protected-by-default** (`security.ts`): three rate-limit classes, HMAC session tokens, peer-address locality, constant-time admin secret, browser identity hashed with a server secret. In the Workplace replace session/browser identity with real accounts but keep the policy-table shape and "unknown endpoint is spendable".
14. **Realtime minting that tells the client exactly what it got** (`X-Realtime-*` headers, WebRTC vs WebSocket). Each avatar persona can mint its own voice session with its own voice/instructions/tools.
15. **Honest, key-naming errors and admin-state sentences** — a support-cost reducer worth copying into onboarding.
16. **Measured constants with comments** (timings for qwen3, ceilings) — a documentation discipline worth adopting.

---

## 7. Gaps, debt & risks

**Bugs / correctness**
- `runBackgroundOperation` has no branch for MCP tools or for inline built-ins moved to background by `TASK_BACKGROUND_TOOLS`; it throws `There is no background operation for "<name>"` (`server/lib/orchestrator.ts:496–497`), so the documented operator override only works for the five built-in background tools.
- `query_memory` is effectively not offered in orchestrated chat: nothing installs `globalThis.MEMORY_HOST` (only referenced in `agentRuntime.ts:401–404`) and the client does not send `body.memory` to `/api/chat` (recall is injected client-side as context). The tool appears in the routing table but is dormant in the main path.
- Doc drift: `server-api.md` says transcription/speech are OpenAI-only and `isAdminRequest` accepts the secret in the body; code orders `openai, xai` and reads only the `X-Admin-Secret` header. `agents-and-mcp.md` says `generate_image` requires OpenAI; code offers it for any image provider. `api/search.ts` comment still mentions xAI "Live Search".

**Scaling / runtime**
- Live task updates are in-isolate pub/sub; a `/api/tasks/stream` connection on isolate A never hears a task running on isolate B. Background work relies on `ctx.waitUntil`, which has runtime limits (a 20-minute video poll can outlive it; the reaper then fails it).
- Rate limiting and MCP connection caches are per isolate; KV is eventually consistent. Durable Objects are the documented fix, not implemented.
- Sequential `await readSetting` calls per request (e.g., 5+ on `getSessionToken`) with no caching.

**Product gaps relative to the Agent Workplace**
- Single assistant persona; no server-side personas, roles, voices-per-agent, or multi-agent conversation. `run_agent_task` sub-agents run with `emit: () => {}` — their steps are invisible (no listen-in, no progress except terminal state).
- No projects/plans/DAGs, no approvals, no triggers/schedules, no retries at the task level, no resumable agent runs.
- No budgets or cumulative cost tracking (per-turn token caps only; 24-step runs can cost far more than expected).
- No image editing, no audio/video understanding, no file ingestion server-side (client-side only), no R2 artifact storage (large results live in KV with 30-minute retention).
- MCP: tools only (no resources/prompts/sampling); headers/env are write-only so they can't be edited, only replaced.
- Video: provider job never cancelled when polling stops; only one video provider.

**Security**
- Admin is "locality or shared secret"; no accounts or RBAC. Session tokens are handed to any allowlisted origin (not authentication).
- Realtime instructions interpolate client-supplied persona fields verbatim (prompt injection into the caller's own session).
- DNS rebinding not mitigated without `AGENT_FETCH_ALLOWLIST`.
- `createApplication` prompt is creative ("counterfactual internet") rather than business-grade; generated HTML safety relies on the client sandbox.

**Testing**
- Cloud providers covered only by mocked unit tests; Ollama is the only live contract target.

---

## 8. Relevance to the Agent Workplace

| Pillar | What this slice offers | Adopt / Adapt / Avoid |
|---|---|---|
| **P1 Lead orchestrator** | `orchestrateChatTurn` + `ORCHESTRATOR_SYSTEM_PROMPT` + inline/background routing; single point of interaction; "I started it" semantics; admin-owned model/prompt | **Adapt**: make the chief-of-staff an orchestrator configuration whose background tools include `spawn_coworker`, `create_project`, `delegate(persona, goal)`, `convene_meeting`. Keep the routing table + summary table discipline. |
| **P2 Personas** | Only persona fields in realtime instructions and `update_persona` tool (face params, voice, name, description) | **Adapt**: promote persona to a server record (role, system prompt, tools/grants, model, voice, face params) consumed by `runAgentLoop` via `systemPrompt`/`toolOptions`/`provider`/`model` seams. |
| **P3 Avatars** | Server side: voice catalogues, realtime minting with VAD barge-in, `update_persona` schema; lip sync is client-side (outside slice) | **Adopt** minting + header contract per avatar; add TTS with timestamps/visemes for non-realtime speaking so users can "listen in" to agents talking. |
| **P4 Workflow orchestration** | Task store (state machine, ceilings, cancel, concurrency, reaper, delivery), background dispatch, video poll loop, agent step ceilings + wrap-up | **Adopt** task semantics; **adapt** into DAG nodes in a Durable Object with dependencies, approvals, retries, triggers. Fix the MCP-background bug pattern (every routed tool needs an executor). |
| **P5 Intra-agent comms** | None beyond nested `run_agent_task` (silent) | **Build new**; reuse SSE frame protocol and tool-summary copy for an observable agent channel; delegation as intercepted tool calls. |
| **P6 Projects with plans** | `conversationId` on tasks; artifacts (`document`, `application`, `image`, `video`, `text`) | **Adapt**: add `projectId`, plan records, artifact store in R2, inbox of `delivered`/`needs decision` items. |
| **P7 All LLM providers** | 4 providers, 3 dialects, capability orders, typed errors, retries, deadlines, Ollama reasoning switch | **Adopt** architecture; **extend** with Google, generic OpenAI-compatible, Bedrock/Vertex, CLI coding agents, pricing, context windows. |
| **P8 Multimodal** | STT (OpenAI/xAI), TTS (34 voices), realtime voice (WebRTC/WSS), vision gate, describeImage, image gen (4 families), video jobs, embeddings, web search with citations | **Adopt** nearly all; add image editing, document/audio understanding, server-side file ingestion. |
| **P9 Context & memory** | `extractMemory` (entities/relations/observations), lenient JSON, embeddings, `context` cards and `memory` snapshots on `/api/agent`, `query_memory` tool | **Adopt** extraction + lenient reader; **adapt** memory into a server-side graph/vector store (D1 + Vectorize) shared across coworkers and scoped per project. |
| **P10 Tools / MCP** | Workers-native MCP client, namespacing, schema normalisation, SSRF, write-only secrets, built-in tools, `createApplication` in-app apps | **Adopt** wholesale; add per-persona tool grants, resources/prompts, and self-extension via generated apps. |
| **P11 Navigation & UX** | Human step rows, Pending tray, capability-gated affordances, honest errors | **Adopt** copy patterns; extend to per-agent timelines the user can open, join and listen to. |
| **P12 Trust & governance** | Policy-table guard, protected-by-default, HMAC tokens, rate-limit classes, admin gate with explained state, SSRF, secrets never returned, prompt-injection instructions, cancel that really aborts | **Adopt**; **add** accounts/RBAC, approvals before spend, cost budgets carried on signals, audit log of tool calls. **Avoid** relying on locality/shared secret for multi-tenant. |
| **P13 Business** | None (single-tenant, no billing/sharing) | Build new. |
| **P14 Infrastructure** | Cloudflare Pages Worker + KV, dual-runtime dev server, `ctx.waitUntil` threading, measured timeouts, large test suite | **Adopt** dual-runtime handler pattern; **move** tasks/pub-sub/rate-limits to Durable Objects, artifacts to R2, records to D1. |

**Bottom line:** this slice is the strongest reference for a **multi-provider, Workers-native agent engine**. Its registry, the single tool loop with three dialects, the inline/background routing tables, the task store, the MCP client and the perimeter can be lifted almost directly. What it lacks is everything *multi-agent*: personas as server entities, delegation, agent-to-agent messaging, observable sub-agent streams, projects/plans, approvals and budgets. Those should be built on its seams (`interceptTool`, `seedMessages`, `systemPrompt`, `toolOptions`, pre-resolved provider/model) rather than beside them.
