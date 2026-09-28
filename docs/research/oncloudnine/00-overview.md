# oncloudnine ("Cloud Nine AI") — consolidated overview

> Lead-analyst consolidation of the four slice reports (`oc1-server.md`, `oc2-client-app.md`, `oc3-shared-core.md`, `oc4-input-persona.md`) plus a completeness pass over `reference/oncloudnine/README.md`, `docs/README.md`, all eleven `docs/architecture/*.md`, 1,005 test titles (840 unit/contract, 163 e2e, 2 describe blocks) and targeted source reads. All paths are relative to `reference/oncloudnine/`. No secret-bearing file (`config.json`, `data/kv-dev.json`, `.dev.vars`) was opened; key **names** come from `config.example.json` and code.

---

## 1. Identity

**What it is.** Cloud Nine AI is an MIT-licensed, **local-first, single-user AI workspace**: one chat conversation surface fronted by **one animated 2D avatar that speaks with audio-driven lip-sync**, backed by a **server-side orchestrator** that decides per turn whether to answer, call a tool inline, or start a durable background task (image, video, generated app, document, nested agent run). It adds multimodal capture (files, folders, camera, screen, microphone, dictation), a browser-resident knowledge-graph memory with visible hybrid recall, realtime voice over two providers/transports, image/video generation, provider-side web search, an MCP client, and a files hub.

**Who it is for.** An individual power user or a small team's operator who wants a vendor-neutral assistant that runs with **zero cloud keys** (Ollama `qwen3:32b` + `nomic-embed-text`) and unlocks features incrementally as keys for Anthropic/OpenAI/xAI are added. The README also positions it as a **reference architecture** (eleven documents with Mermaid diagrams and an honest "Issues & Technical Debt" ledger each) and as the front door to a **consulting practice** (Cloudflare/Azure/GCP deployment, model optimisation).

**Runtime / deploy shape.**
- **Browser:** three TypeScript micro-frontends (`input/`, `persona/`, `app/`) on a framework-free shared core (`shared/`, custom JSX-to-DOM factory `$element`), compiled per project and concatenated into one IIFE bundle (`build/public/js/app.js`); two documents (`public/index.html` workspace, `public/admin.html` operator page). All user data lives in the browser: IndexedDB `cloudnine` (conversations), `c9ai-memory` (graph), `cloudnine-folders` (folder handles); CacheStorage buckets for files; `localStorage` for persona/settings.
- **Server:** a single **Cloudflare Pages advanced-mode Worker** (`server/_worker.ts`) with 18 exact `/api/*` routes behind one guard (`server/lib/security.ts`), provider keys in **Cloudflare KV** (binding `KV`). No Durable Objects, D1, R2 or Vectorize.
- **Local dev:** `build.js` (compiled from `tools/*.ts`) is bundler + watcher + dev server (`127.0.0.1:8080`) that runs the *same* compiled handlers and guard, shims KV over `config.json`/`data/kv-dev.json`, and installs a stdio MCP host bridge (`globalThis.MCP_HOST`).
- **Providers:** Anthropic (`claude-opus-5`), OpenAI (`gpt-5.2`, `gpt-realtime-2`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`, `gpt-image-1`, `text-embedding-3-large`), xAI (`grok-4.5`/`grok-4.3`, `grok-voice-latest`, `grok-imagine-image(-quality)`, `grok-imagine-video-1.5`, `/stt`, `/tts`), Ollama dev-only (`qwen3:32b`, `nomic-embed-text`). One registry: `server/providers/registry.ts`.
- **Quality bar:** 852 node:test unit+contract tests claimed (840 static titles; loops generate the rest), 163 Playwright specs across 20 files; cloud providers are mock-tested only ("nothing ... has ever been run against a paid key"); Ollama is the only live contract target.

---

## 2. Signature ideas (must survive into the Agent Workplace)

1. **One conversation, server-owned brain, zero model chrome.** The client sends only `{conversationId, messages, stream, maxTokens}`; provider, model, system prompt and tool choice are server decisions (`server/lib/orchestrator.ts`). Tests assert the workspace DOM never exposes a provider/model/system-prompt control nor names the model (`test/unit/chat-orchestration.test.js:474,617`, `test/e2e/chat.spec.js:329,352`). This is the P1 "talk to one agent" contract in miniature.
2. **Routing by the *shape of the answer*, as data.** `TOOL_ROUTING_TABLE` (`orchestrator.ts:77`) routes a tool **inline** if the model must read the result to reply, **background** if it produces an artifact or needs several model calls; `TOOL_SUMMARY_TABLE` (`:118`) gives every tool a human "running/finished" sentence, and a unit test fails if any routed tool lacks copy. The model is told: "say it started in one sentence, don't describe results you don't have."
3. **Results come to you, exactly once.** Durable tasks (`server/lib/taskStore.ts`) with per-kind wall clocks, concurrency caps, real cancel (aborts upstream), detached large results, lazy zombie reaper and a durable `delivered` marker; the client `TaskRegistry` + **Pending tray** deliver the artifact into the *originating* conversation, dedupe by `taskId` in the transcript, and toast when you are elsewhere.
4. **Everything is a visible, removable chip before it is a prompt.** `ContextCard {id, kind:'file'|'capture'|'memory', ...}` on a typed `ContextBus`: upsert-by-id (progressive enrichment — a camera frame appears immediately and is silently upgraded when its vision description lands), consumed on send, retired ids ignored, archived by the files hub. Recalled memory is a card too ("instead of an invisible prompt injection").
5. **Visible hybrid memory.** Browser knowledge graph (entities / relations / embedded chunks), BM25 + cosine merged by reciprocal-rank fusion, injected as a labelled block whose "memory used" disclosure lists exactly what fit, with the retriever that found it; editable graph panel with d3 view.
6. **A face that follows the real sound.** Any audio source exposes a `MediaStream` (WebRTC remote track, WebSocket playback tap, or TTS clip `captureStream()`); an `AnalyserNode` envelope drives mouth-shape classes; text-timed visemes are the fallback; reduced-motion removes decorative motion but keeps lip-sync as functional feedback. The model can **restyle and re-voice its own avatar** through a JSON-schema tool (`update_persona`).
7. **Two realtime transports, one protocol.** OpenAI WebRTC and xAI WebSocket share `handleRealtimeEvent`; the server mints an ephemeral secret and states exactly what it minted in `X-Realtime-*` headers; barge-in cancels the response but keeps the mic; one session gate means Connect and Talk never mint twice.
8. **Honest capability gating.** Capability flags per model (`chat, streaming, vision, tools, search, embeddings, transcription, speech, image, video, realtime`) drive every affordance; unavailable controls are **hidden, not disabled**, and errors name the exact config key to set.
9. **Failure is a sentence.** Typed error envelope, human failure copy ("This took longer than 10 minutes and was stopped."), `status:'unparsed'` distinct from "nothing to remember", a lenient JSON reader for small local models, and measured constants with the measurement in the comment.
10. **Workers-native, protected by default.** Hand-written MCP client over `fetch` (no SDK), SSRF policy re-checked on every redirect hop, a policy table where an unlisted endpoint is spendable and session-gated, and the same guard in dev and prod.
11. **Contracts kept honest by tests.** Doc-sync tests (event map ↔ `context-bus.md`), client/server drift tests (voice catalogues, step ceiling, rate-limit classes, config keys), a deploy preflight that scans published assets for any `config.json` value.

---

## 3. Pillar coverage at a glance

| Pillar | Strength in oncloudnine | Best source |
|---|---|---|
| P1 Lead orchestrator | Strong single-agent pattern (thin client, server orchestrator, inline/background routing, "I started it" semantics). No multi-agent delegation. | `server/lib/orchestrator.ts`, `app/ViewModels/ChatViewModel.ts` |
| P2 Personas | Weak: one persona in `localStorage`; persona fields in realtime instructions; `update_persona`. | `persona/`, `server/api/getSessionToken.ts` |
| P3 Avatars | Moderate: CSS/PNG face, ECS, envelope lip-sync, presence states; single avatar, no conversational face states. | `persona/Modules/FaceAnimation.ts`, `shared/Modules/SpeechOutput.ts` |
| P4 Workflow | Moderate: task store + registry + tray, agent loop with guardrails; no DAGs, approvals, triggers, retries-as-policy, resumable runs. | `server/lib/taskStore.ts`, `app/Modules/TaskRegistry.ts` |
| P5 Intra-agent comms | Absent beyond a page event bus and silent nested `run_agent_task`. | `shared/Modules/ContextBus.ts` |
| P6 Projects & plans | Weak: conversations, files hub, deliver-to-origin. No projects, plans, inbox. | `ConversationStore`, `FileStore` |
| P7 LLM providers | Strong architecture, 4 providers / 3 dialects; no Google, generic OpenAI-compatible, CLI agents, pricing. | `server/providers/*` |
| P8 Multimodal | Strong: STT, TTS (34 voices), realtime (2 transports), vision, image gen, video jobs, embeddings, search, file/folder ingestion, camera/screen. No image edit, no audio/video understanding. | `server/api/*`, `input/` |
| P9 Context & memory | Strong client-side: ContextCard lifecycle, hybrid recall, graph extraction. Browser-only, unscoped. | `shared/Modules/Memory/*`, `server/api/extractMemory.ts` |
| P10 Tools / MCP | Strong: MCP http/sse/stdio, namespacing, schema normalisation, voice bridging, in-app HTML apps. Tools capability only. | `server/mcp/*`, `server/api/createApplication.ts` |
| P11 Navigation & UX | Strong single-surface UX and a11y discipline; no spatial/office model. | `app/Components/*` |
| P12 Trust & governance | Strong perimeter hygiene; no accounts, RBAC, approvals, budgets, audit. | `server/lib/security.ts`, `mcp/net.ts` |
| P13 Business | Minimal: local-only mode, config bootstrap, usage footer, consulting positioning. | `README.md`, `tools/build.ts` |
| P14 Infrastructure | Moderate: Pages Worker + KV, dual runtime, deploy preflight, fingerprinted dev server; custom bundler is fragile. | `tools/*`, `server/_worker.ts` |

---

## 4. Complete feature inventory

Maturity: **solid** (implemented, tested) · **partial** (works with known defects or unverified live) · **stub** (declared/wired but inert) · **docs-only**. Reuse: **Adopt** (lift nearly as-is) · **Adapt** (keep the idea/contract, rebuild for multi-agent/server) · **Reference** (learn from, don't port) · **Avoid**.

### 4.1 Server (slice oc1)

| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Exact API routing and Worker entry (18 handlers, own-property dispatch, blocked prefixes, `ctx.waitUntil` threading) | P14 | solid | Adopt | oc1 §2.1; `server/_worker.ts:29-94` |
| Single model registry with capability flags and preference orders | P7 | solid | Adopt (extend) | oc1 §2.2; `server/providers/registry.ts:119-217` |
| Provider dispatch table (only name→implementation switch) | P7 | solid | Adopt | oc1 §2.3; `server/providers/dispatch.ts` |
| Provider dialects: Anthropic Messages, OpenAI Responses, OpenAI-compatible (xAI/Ollama, `reasoning_effort:'none'`) | P7 | solid (cloud paths mock-tested only) | Adopt | oc1 §2.4; `server/providers/{anthropic,openai,openaiCompatible,xai,ollama}.ts` |
| Outbound fetch policy: retries, `Retry-After`, deadline-on-signal | P7/P14 | solid | Adopt | oc1 §2.5; `server/lib/http.ts:75` |
| SSE parser and emitter (split-boundary safe, cancels upstream) | P14 | solid | Adopt | oc1 §2.6; `server/lib/sse.ts` |
| Chat endpoint with orchestration SSE protocol (`delta/tool/task/done/error`) | P1 | solid | Adapt | oc1 §2.7; `server/api/chat.ts` |
| Inline vs background tool routing as data | P1/P4 | solid | Adopt | oc1 §2.8; `server/lib/orchestrator.ts:77,201` |
| Human-phrased tool step summaries (copy table checked by test) | P11 | solid | Adopt | oc1 §2.8; `orchestrator.ts:118` |
| Admin-resolved provider, model and additive system prompt | P1/P7 | solid | Adapt | oc1 §2.8; `orchestrator.ts:249-264` |
| Vision capability gate (honest note when images are dropped) | P8 | solid | Adopt | oc1 §2.8; `orchestrator.ts:289` |
| Background operation executors (image/video/app/document/agent, in-process sub-requests) | P4 | partial (operator override to background breaks for MCP/inline tools) | Adapt | oc1 §2.8; `orchestrator.ts:403-497` |
| Provider-agnostic tool-use agent loop (neutral transcript, 3 dialects, seams) | P1/P4 | solid | Adopt | oc1 §2.9; `server/lib/agentRuntime.ts:643-1183` |
| Configuration-derived built-in tools (`current_time, fetch_url, create_document, create_application, generate_image, web_search, query_memory, generate_video, run_agent_task`) | P10 | solid | Adopt | oc1 §2.9; `agentRuntime.ts:595-614` |
| Explicit agent run endpoint `/api/agent` (step/tool/result/done frames, guardrails, wrap-up turn) | P4 | solid (not resumable) | Adapt | oc1 §2.10; `server/api/agent.ts` |
| Durable background task store (state machine, per-kind ceilings, cap 3/owner, reaper) | P4 | solid single-isolate / partial multi-isolate | Adapt (to Durable Object) | oc1 §2.11; `server/lib/taskStore.ts` |
| Task API: list, live stream (25 s keep-alive), detached result, cancel, delivered, clear | P4/P6 | solid | Adapt | oc1 §2.11; `server/api/tasks.ts` |
| Per-browser task ownership identity (`cn9_browser` cookie hashed with server secret) | P12 | solid | Avoid (replace with accounts) | oc1 §2.11; `taskStore.ts:274-278` |
| Workers-native MCP client (Streamable HTTP, legacy SSE, stdio via bridge) | P10 | solid (tools capability only) | Adopt | oc1 §2.12; `server/mcp/client.ts` |
| MCP server registry, connection manager (5-min TTL, fingerprint) and API | P10 | solid | Adapt | oc1 §2.13; `server/mcp/manager.ts`, `server/api/mcp.ts` |
| MCP tool namespacing, bijective wire names, schema normalisation | P10 | solid | Adopt | oc1 §2.13; `server/mcp/schema.ts:66-79` |
| Outbound URL (SSRF) policy, per-hop re-check | P12 | solid (no DNS-rebinding defence) | Adopt | oc1 §2.14; `server/mcp/net.ts:147` |
| Image generation across model families (`gpt-image`, `dall-e-3/2`, `grok-imagine`) | P8 | solid (no edit/inpaint) | Adopt | oc1 §2.15; `server/providers/images.ts` |
| Video generation job API (xAI Imagine, KV job records, MP4 proxy) | P8 | solid (single provider) | Adopt | oc1 §2.16; `server/providers/video.ts`, `server/api/generateVideo.ts` |
| Provider-side web search with normalized citations | P8/P10 | solid | Adopt | oc1 §2.17; `server/providers/websearch.ts` |
| Embeddings endpoint (Ollama first, OpenAI fallback) | P8/P9 | solid | Adopt | oc1 §2.18; `server/api/embeddings.ts` |
| Speech-to-text endpoint (OpenAI, xAI `/stt`) | P8 | solid | Adopt | oc1 §2.19; `server/api/transcribe.ts` |
| Text-to-speech with dual voice catalogues (8 OpenAI + 26 xAI) | P8/P2 | solid | Adopt | oc1 §2.20; `server/api/speech.ts:11-28` |
| Realtime voice session minting (OpenAI WebRTC / xAI WebSocket, `X-Realtime-*`) | P8/P3 | solid (never exercised live) | Adopt | oc1 §2.21; `server/api/getSessionToken.ts` |
| Realtime persona instructions and 5 tool schemas | P2/P3 | partial (unsanitised persona text; schema drift vs xAI) | Adapt | oc1 §2.21; `getSessionToken.ts:167-366` |
| Image description (vision) endpoint | P8 | solid | Adopt | oc1 §2.22; `server/api/describeImage.ts` |
| Themed HTML application generator (in-app apps, revise via `html`) | P10 | solid | Adapt (prompt is whimsical, not business-grade) | oc1 §2.23; `server/api/createApplication.ts:74` |
| Knowledge-graph memory extraction endpoint (richest-candidate parse, strict retry, never 5xx) | P9 | solid | Adopt | oc1 §2.24; `server/api/extractMemory.ts:227` |
| Lenient JSON reader for model output | P7/P9 | solid | Adopt | oc1 §2.24; `server/lib/lenientJson.ts:122` |
| `query_memory` agent tool | P9 | partial (dormant in chat: no `MEMORY_HOST`, no `body.memory`) | Adapt | oc1 §2.9/§7; `agentRuntime.ts:398-404` |
| Admin defaults endpoint with explained protection state | P12/P7 | solid | Adapt | oc1 §2.25; `server/api/config.ts` |
| Policy-table API guard with protected-by-default endpoints | P12 | solid | Adopt | oc1 §2.26; `server/lib/security.ts:51,648` |
| HMAC session tokens with converging generated secret | P12 | solid | Adapt | oc1 §2.26; `security.ts` |
| Three-class rate limiting (`spend`, `read`, `session`) | P12 | solid per-isolate / partial global | Adapt (to DO counter) | oc1 §2.26; `security.ts:596` |
| Peer-address locality gate (`socketAddress`, fixes an RCE) | P12 | solid | Adopt (local bridge) | oc1 §2.26; `security.ts:236` |
| Typed error envelope and config readers | P14 | solid | Adopt | oc1 §2.27; `server/api/errors.ts`, `server/lib/config.ts` |
| Health, models, session endpoints | P7/P14 | solid | Adopt | oc1 §2.28 |
| Dual-runtime handlers with dev KV shim | P14 | solid | Adopt | oc1 §1; `tools/serve.ts` |

### 4.2 Client app (slice oc2)

| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Workspace shell composition (header, drawer tabs with ARIA, dock, `--dock-height`) | P11 | solid | Reference | oc2 §2.1; `app/Views/WorkspaceView.tsx` |
| Thin-client chat turn orchestration (`ChatViewModel.send/run`) | P1 | solid | Adopt (pattern) | oc2 §2.2; `app/ViewModels/ChatViewModel.ts:388-524` |
| Five-frame SSE orchestration wire contract (unknown frames ignored) | P1/P5 | solid | Adopt + extend | oc2 §2.3; `app/Modules/ChatClient.ts` |
| Transcript rendering with tool steps and artifacts (patched in place, 60 ms coalescing) | P11 | solid | Adapt | oc2 §2.4; `app/Components/ChatView.tsx` |
| Composer dock with context chips and transcript preview | P11 | solid | Adapt | oc2 §2.5; `app/Components/ChatComposer.tsx` |
| Conversation management (create/switch/inline rename/delete, auto-title) | P6 | solid | Adapt | oc2 §2.6; `app/Components/ConversationList.tsx` |
| Per-message actions (copy, speak with spinner, regenerate, delete) | P11 | solid | Adopt | oc2 §2.7; `app/Components/MessageActions.tsx` |
| Slash commands (`/image`, `/video`, `/search`) and web-search mode | P8/P11 | solid | Adapt | oc2 §2.8; `app/Components/SearchToggle.tsx` |
| Image and video generation with media cards (resume polling after reload) | P8 | solid | Adapt | oc2 §2.9; `app/Components/MediaGenPanel.tsx` |
| TaskRegistry background-job backbone (reconcile + SSE + backoff) | P4 | solid | Adopt | oc2 §2.10; `app/Modules/TaskRegistry.ts` |
| Pending tray (elapsed clock, progress, stop, retry, auto-open on new work) | P4/P11 | solid | Adopt | oc2 §2.11; `app/Components/PendingTray.tsx` |
| Deliver finished task into originating conversation (exactly once) | P6 | solid | Adopt | oc2 §2.12 |
| Realtime voice over WebRTC (OpenAI) and WebSocket (xAI) | P8/P3 | partial (never live-tested; `ScriptProcessorNode`) | Adopt with fixes | oc2 §2.13; `app/Modules/VoiceChat.ts:573,637` |
| Barge-in and interrupt (cancel + clear, mic kept alive) | P3 | solid | Adopt | oc2 §2.13; `VoiceChat.ts:1031` |
| Voice transcript state machine | P3/P5 | solid | Adopt | oc2 §2.14; `VoiceChat.ts:56` |
| Voice tool calls (client-executed, always-resolving registry, 2000-char bound) | P1/P10 | partial (handler bugs; separate brain from chat) | Adapt (route to server) | oc2 §2.15; `WorkspaceView.tsx:898-1074` |
| MCP tools bridged into realtime voice (cap 24, hijack-safe) | P10 | solid | Adopt | oc2 §2.16; `VoiceChat.ts:348` |
| Voice mode resolution (`auto/realtime/stt` matrix) | P8 | solid | Adopt | oc2 §2.17; `app/Modules/VoiceMode.ts:175` |
| Single-session voice coordinator (floor rules) | P3 | solid | Adapt (per agent + office arbiter) | oc2 §2.18; `VoiceMode.ts:403` |
| Voice panel UX (status pill, mode/voice pickers, live transcript) | P11 | solid | Adapt | oc2 §2.19; `app/Components/VoicePanel.tsx` |
| TTS fallback and STT dictation paths | P8 | solid | Adopt | oc2 §2.20 |
| Persona driven while speaking (lip-sync from realtime/TTS stream; self-restyle) | P3 | solid (single avatar) | Adopt | oc2 §2.21; `WorkspaceView.tsx:796-863` |
| Persona settings model (`assistant-settings`) | P2 | partial | Adapt (server-side per agent) | oc2 §2.21 |
| Visible memory recall via context cards | P9/P12 | solid | Adopt | oc2 §2.22 |
| Knowledge-graph memory panel with d3 graph | P9/P11 | solid (full re-render; search is keyword-only, see §6) | Adapt | oc2 §2.23; `app/Components/MemoryPanel.tsx` |
| Files hub (scope, select, zip, preview by type) | P6 | solid | Adapt | oc2 §2.24; `app/Components/FilesHub.tsx` |
| Agent task runner (admin diagnostic timeline) | P4 | solid (diagnostic) | Adapt into "Run view" | oc2 §2.25; `app/Components/AgentPanel.tsx` |
| MCP server management panel | P10 | solid | Adapt | oc2 §2.26; `app/Components/admin/McpPanel.tsx` |
| Admin global defaults (provider, model, system prompt) | P7 | solid | Adapt | oc2 §2.27 |
| Admin providers and capability registry view (key names only) | P7 | solid | Adopt | oc2 §2.27 |
| Admin diagnostics (health, session, rate classes, request log) | P12/P14 | solid | Adopt | oc2 §2.27 |
| Admin memory store and folder-rule defaults | P9 | solid | Adopt | oc2 §2.27 |
| Separate admin document from one bundle (`renderAdminView`) | P11/P12 | solid | Adapt | oc2 §2.27; `public/admin.html` |
| Theme manager (`light/dark/system`) | P11 | solid | Adopt | oc2 §2.28; `app/Modules/Theme.ts` |
| Error humanization for chat and voice | P11 | solid | Adopt | oc2 §2.29 |
| Client-side content security primitives (`safeMediaUrl`, sandbox without same-origin, `textContent`) | P12 | solid | Adopt | oc2 §2.30 |
| Capability-driven feature gating | P7/P11 | solid | Adopt | oc2 §3.3 |
| Mobile-first responsive and accessible layout (44 px, safe areas, 768 px drawer) | P11 | solid | Adopt | oc2 §2.31 |
| Context bus integration (intra-page event contract) | P5 | solid | Adapt | oc2 §1 |
| Camera/screen capture cadence in the dock | P8 | solid | Adopt | oc2 §2.32 |

### 4.3 Shared core, build and deploy (slice oc3)

| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| JSX-to-DOM element factory (`$element/$children/$reference/$event`) | P14 | partial (fragments crash, `false` props) | Avoid | oc3 §2.1; `shared/element.ts` |
| Reactive primitives (`EventManager`, `ObservableList`) | P14 | partial | Avoid | oc3 §2.3 |
| ContextBus typed integration bus (count-returning `emit`, declaration merging) | P5 | solid | Adapt | oc3 §2.4; `shared/Modules/ContextBus.ts` |
| ContextCard contract and lifecycle (upsert, consume, retire, archive) | P9 | solid | Adopt | oc3 §2.5 |
| ECS engine (drives persona face) | P3 | partial (save/load key mismatch, uncancellable loop) | Adapt | oc3 §2.6; `shared/Modules/ECS.ts` |
| ConversationStore (IndexedDB, durable on `oncomplete`) | P6 | solid (single-user) | Avoid as system of record | oc3 §2.7 |
| Conversation and message schema (`ChatToolStep`, `ChatArtifact`, `taskId`) | P6 | solid | Adapt | oc3 §2.8 |
| FileStore (CacheStorage buckets, metadata in response headers) | P6 | solid | Adapt (cache in front of R2) | oc3 §2.9 |
| FileLibrary files hub with zip export (dedupe, safe paths) | P6 | solid | Adopt | oc3 §2.10 |
| SpeechOutput TTS with browser fallback (generation counter, LRU 24) | P8/P3 | solid (no chunking, 4000-char cut) | Adopt (per agent) | oc3 §2.11; `shared/Modules/SpeechOutput.ts` |
| Speech stream tap for lip sync (`captureTap`) | P3 | solid | Adopt | oc3 §2.11; `SpeechOutput.ts:432` |
| ApiSession / `apiFetch` session-token client | P12 | solid | Adopt | oc3 §2.12 |
| TextCompletionService with SSE parser | P7 | partial (no consumer) | Reference | oc3 §2.13 |
| TextEmbeddingService | P9 | partial (no consumer) | Reference | oc3 §2.14 |
| ImageDescriptionService (vision) | P8 | solid | Adopt | oc3 §2.15 |
| SearchService (provider-side search, capability check) | P8 | solid | Adopt | oc3 §2.16 |
| Connector contracts incl. unimplemented speech interfaces | P7 | stub | Avoid | oc3 §2.17; `shared/connector.ts` |
| Markdown renderer with allowlist DOM sanitizer (`aido:` send links) | P12/P11 | solid | Adopt | oc3 §2.18; `shared/Components/Markdown.tsx` |
| Sandboxed HTML preview for generated apps | P10/P12 | solid | Adopt | oc3 §2.19; `shared/Components/Document.tsx:29-96` |
| DocumentPanel with client-side DOCX round-trip | P6 | partial (several bugs) | Adapt | oc3 §2.20 |
| Graph visualization (d3 tree and force) | P9/P11 | partial | Adapt | oc3 §2.21 |
| Data components: Table, List, Card, Form, ListEditor | P11 | partial / stub | Avoid | oc3 §2.22 |
| Chrome components: Tabs, ModalDialog, Tooltip, Menu, Loader, IconButton | P11 | partial | Avoid | oc3 §2.23 |
| Toast notifications driven by the bus | P11 | solid | Adopt (pattern) | oc3 §2.23 |
| Inline SVG icon set and Disclosure | P11 | solid | Adopt | oc3 §2.24; `shared/Components/Icon.tsx` |
| Theming tokens and CSS conventions | P11 | partial | Adapt | oc3 §2.25 |
| Zero-dependency build system (tsc + concatenation) | P14 | solid but fragile | Avoid | oc3 §2.26; `tools/build.ts`, `tools/tools.ts` |
| Coalescing watch loop (`createTaskQueue`, `writeFileIfChanged`) | P14 | solid | Adopt (pattern) | oc3 §2.26 |
| Config bootstrap and migration from example file | P13/P14 | solid | Adopt | oc3 §2.27; `tools/build.ts:32-128` |
| Cloudflare Pages advanced-mode worker bundling | P14 | solid | Reference | oc3 §2.28 |
| Dev server with Cloudflare emulation (shared guard, KV shim, body draining) | P14 | solid | Adapt | oc3 §2.29; `tools/serve.ts` |
| stdio MCP host bridge (`globalThis.MCP_HOST`) | P10/P14 | solid | Adapt (local bridge) | oc3 §2.30; `tools/serve.ts:13-134` |
| Build fingerprint, `/__dev/build-info` and release takeover + e2e guard | P14 | solid | Adopt | oc3 §2.31 |
| Deployment preflight (13 checks incl. leaked-config scan) | P14/P12 | solid | Adopt | oc3 §2.32; `tools/deploy.ts` |
| Unit-test harness for global-script TS and doc-sync tests | P14 | solid | Adopt (doc-sync idea) | oc3 §2.33 |
| Capability-gated affordances / local-only mode (no keys → Ollama or client-only) | P7/P13 | solid | Adopt | oc3 §2.35; README |

### 4.4 Input and persona (slice oc4)

| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Layered PNG + CSS persona face (4 faceless busts, CSS eyes/mouth, photo masking) | P3 | solid | Adapt (lightweight tiles) | oc4 §2.1; `persona/Components/Persona.tsx` |
| FaceAnimation ECS loop | P3 | solid core (leaks per re-render) | Adapt | oc4 §2.2; `persona/Modules/FaceAnimation.ts:23-61` |
| Blinking (5 s / 150 ms) | P3 | solid | Adopt | oc4 §2.3 |
| Gaze tracking with idle look-around | P3 | partial (idle state machine sticks) | Adapt (fix) | oc4 §2.4; `FaceAnimation.ts:130-196` |
| Random eyebrow gestures | P3 | partial (left/right bug; unrelated to state) | Adapt (drive from events) | oc4 §2.5; `FaceAnimation.ts:226-240` |
| Audio-envelope lip-sync (mid-band mean → 6 shapes) | P3 | solid (amplitude, not phonetic) | Adopt | oc4 §2.6; `FaceAnimation.ts:355-466` |
| Text-driven viseme fallback (11 classes) | P3 | solid | Adopt | oc4 §2.7; `FaceAnimation.ts:313-345,473-508` |
| Reduced-motion gate (decoration off, lip-sync on) | P3/P11 | solid | Adopt | oc4 §2.8 |
| PersonaSettings appearance/identity/voice config (33 fields) | P2 | partial (dead fields, `||` defaults) | Adapt | oc4 §2.9; `persona/Modules/PersonaSettings.ts` |
| `update_persona` self-restyling tool | P2/P3 | partial (see corrections) | Adapt | oc4 §2.10 |
| Avatar presence scaling states (`--scale-factor`, 76 px phone bubble) | P3/P11 | solid | Adopt | oc4 §2.11 |
| Speech-stream to persona wiring (realtime wins over TTS) | P3 | solid | Adopt | oc4 §2.6 |
| Camera interval snapshot capture (aspect-preserving, readiness gate) | P8 | solid | Adopt | oc4 §2.13; `input/Modules/CameraInputManager.ts` |
| Screen-share snapshot capture | P8 | solid | Adopt | oc4 §2.14 |
| Front/back camera flip | P8 | solid | Adopt | oc4 §2.15 |
| Capability detection and human-readable media errors | P8/P11 | solid | Adopt | oc4 §2.16; `input/Modules/UserMediaManager.ts:5-45` |
| Vision description pipeline for frames (SingleFlight drop-not-queue) | P8 | solid | Adopt | oc4 §2.17; `input/Modules/CaptureContextPublisher.ts` |
| Capture strip UI (truthful privacy dot, cadence, Now, thumbnails) | P11/P12 | solid | Adapt | oc4 §2.18; `input/Components/MediaInput.tsx` |
| Continuous mic recording with decodable segments (header-prefix trick) | P8 | solid | Adopt | oc4 §2.19; `input/Modules/CaptureSupport.ts:158-216` |
| Server transcription with rolling prompt | P8 | solid | Adopt | oc4 §2.20 |
| Browser speech recognition with bounded restart | P8 | solid | Adopt | oc4 §2.21 |
| Dictation commits to composer, not auto-send | P1/P11 | solid | Adopt | oc4 §2.22 |
| Voice activity detector (`AudioAnalyzer`) | P3/P8 | stub (no subscribers) | Adapt | oc4 §2.23; `input/Modules/AudioAnalyzer.ts:118-127` |
| Audio frequency visualizer | P11 | solid (cosmetic) | Reference | oc4 §2.24 |
| FileProcessor multi-format extraction (DOCX, XLSX, PDF, CSV/TSV, JSON, text, images, audio) | P8 | solid | Adopt | oc4 §2.25; `input/Modules/FileProcessor.ts:628-691` |
| RFC 4180 CSV/TSV tokenizer | P8 | solid | Adopt | oc4 §2.26 |
| OOXML XLSX reader without SheetJS | P8 | solid | Adopt | oc4 §2.27 |
| Window drop overlay, paste and per-file progress | P11 | solid | Adopt | oc4 §2.28; `input/Components/DropOverlay.tsx` |
| Context card persistence and retirement (restore after reload) | P9 | solid | Adopt | oc4 §2.29 |
| Folder ignore rules and classification (visible, reversible) | P6/P9 | solid | Adopt | oc4 §2.30; `input/Modules/FolderContext.ts` |
| Folder tree with selection and token budget | P9 | solid | Adopt | oc4 §2.31 |
| Folder re-sync diff, persisted handles, permission re-request | P6/P9 | solid (hard-denied gap) | Adopt | oc4 §2.32 |
| Bounded-concurrency ingestion with cancel (stable per-path card ids) | P4/P9 | solid | Adopt | oc4 §2.33 |
| Composer text input and sanitisation (legacy `InputView`) | P11 | partial (superseded, regex strip) | Avoid | oc4 §2.34 |
| Memory extraction hook on ingested context | P9 | solid wiring (noisy for captures) | Adapt (gate) | oc4 §2.35 |
| Fake-media e2e test harness (oscillator mic, bus probes) | P14 | solid | Adopt | oc4 §2.36; `test/e2e/capture.spec.js` |
| Session-token gated media endpoints | P12 | solid | Adopt | oc4 §3 |

### 4.5 Newly found in this consolidation (not in any slice)

| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| BM25 inverted index with Unicode tokenization, stopword-lite list and prefix expansion | P9 | solid | Adopt | `shared/Modules/Memory/FtsIndex.ts:18-153` |
| Dimension-safe cosine top-k and weighted reciprocal-rank fusion | P9 | solid | Adopt | `shared/Modules/Memory/VectorIndex.ts:50-126` |
| Bounded hybrid recall with provenance labels and budget-fitted block | P9/P12 | solid | Adopt | `shared/Modules/Memory/MemoryRecall.ts:32-186` |
| Debounced, serialized, chunk-first extraction queue | P9 | solid | Adopt | `shared/Modules/Memory/GraphExtractor.ts:102-203` |
| Extraction self-throttling on 503 and one-shot "unreadable" notice | P9/P12 | solid | Adopt | `GraphExtractor.ts:219-263` |
| Graph identity model: `name|type` keys, relations by key, rename-merge, cascade delete | P9 | solid | Adopt | `shared/Modules/Memory/MemoryStore.ts:139-160,480-520,674-690` |
| Sentence-boundary chunking, text dedupe and embedding upgrade | P9 | solid | Adopt | `MemoryStore.ts:590-660` |
| Single `remember()` entry for voice `add_memory` and manual notes | P9 | solid | Adopt | `MemoryStore.ts:632-640`, `GraphExtractor.ts:122` |
| Vision data-URL parser shared by provider dialects | P8 | solid | Adopt | `server/lib/media.ts:9-26` |
| Task record / stream-frame size ceiling (no artifact bytes in list or stream) | P4/P14 | solid | Adopt | `test/unit/task-store.test.js:792`, `server/lib/taskStore.ts:82` |
| Log-hygiene contract test (no key, token or request body in logs) | P12 | solid | Adopt | `test/unit/server-api.test.js:571` |
| Zero-dependency test fixture generator (hand-built PDF/DOCX/XLSX/PNG/WAV) | P14 | solid | Adopt | `scripts/make-fixtures.mjs:1-10,40-271` |
| Architecture docs with a per-subsystem "Issues & Technical Debt" ledger | P14 | solid (docs; partly drifted, see §6) | Adopt (practice) | `docs/architecture/*.md` |
| MIT licence + consulting-services business model | P13 | docs-only | Reference | `README.md` ("Consulting Services") |

**Inventory size:** 43 (oc1) + 40 (oc2) + 36 (oc3) + 37 (oc4) + 14 new = **170 rows**.

---

## 5. Missed features (detailed)

The shared memory package (`shared/Modules/Memory/*`) was marked "covered by another slice" in oc3 §2.34, but no slice reviewed its internals; oc2 covered only the panel and oc1 only the server extraction endpoint. It is one of the most reusable parts of the codebase for P9.

1. **BM25 inverted index with prefix expansion** (P9) — `FtsIndex.ts:18-153`. Every entity (name, type and observations) and every chunk is tokenized once on write into `postings: term → (docId → tf)`. Tokenizer: lowercase, apostrophes stripped, split on `[^\p{L}\p{N}]+` so "café" and "東京" survive, tokens under 2 chars dropped, a 31-word "stopword-lite" list that keeps `not`/`no`. BM25 `k1=1.2`, `b=0.75`, idf floored at `0.01` so a ubiquitous term is weak rather than negative evidence. Query tokens of 3 or more characters also match every term with that prefix, at weight `0.5`. Repeated query tokens count once, and ties break on doc id for deterministic ordering. The index is rebuilt in memory from IndexedDB on `ready()`.
2. **Dimension-safe vectors and weighted RRF** (P9) — `VectorIndex.ts:50-126`. `cosine()` never returns NaN (0 for mismatched lengths, empty, zero-norm or non-finite components). `topK()` **skips** mismatched dimensions rather than scoring them 0, so mixing 768-d Ollama and 3072-d OpenAI embeddings never floats junk to the top. `reciprocalRankFusion(lists, k=60)` supports per-list weights, ignores repeated ids within a list and breaks ties on best rank. `embed()` batches up to 64 texts through `apiFetch('/api/embeddings')` and never throws. It returns `[]`, and recall falls back to keyword-only.
3. **Bounded hybrid recall with provenance** (P9/P12) — `MemoryRecall.ts:32-186`. Recall is skipped when it is disabled (`localStorage['cloudnine-memory-enabled']==='off'`) or the query is under 3 chars. It takes 12 candidates per retriever. The query embedding is bounded by `embedTimeoutMs = 3000` via `AbortSignal.timeout`, so a busy local model cannot hold the user's message off screen. Vectors have a cosine floor of `0.25`. RRF then keeps `limit = 4`, and each item is labelled `keyword`, `vector` or `keyword + vector`. `fit()` keeps the leading items within `maxChars = 1200`, always keeping the best one, and the disclosure lists exactly what fit. The block header reads "Relevant memories from earlier conversations (may be outdated - use only what is relevant, and never mention this block):". The card id is fresh per turn so retirement never blocks later recalls. Each result is published on `recalled`/`last` for the "memory used" panel.
4. **Debounced, serialized, chunk-first extraction** (P9) — `GraphExtractor.ts:102-203`. Sources are:
   - `listen()`, which subscribes to `context:add` (files and captures, skipping `memory` cards so recall is not re-extracted);
   - `recordExchange()`, which formats `User: …\nAssistant: …`;
   - `remember()`.

   Texts under 12 chars are dropped. The first 200 lowercased chars form a fingerprint deduped over the last 50 records. Jobs are debounced by `debounceMs = 5000` and batched, and passes are serialized so two upserts of one entity cannot race. Chunks are written and embedded **before** any model call, so recall works even when extraction fails. The extraction prompt is capped at 4000 chars with `maxTokens: 900`. The `selection` is empty by default, which means the server's admin defaults are used; this fixed a stale-localStorage bug.
5. **Self-throttling and honest failure reporting** (P9/P12) — `GraphExtractor.ts:219-263`. A `503` from `/api/extractMemory` sets `modelAvailable = false`, which stops model calls until reload while chunks keep being written. `status:'unparsed'` triggers a single toast per session ("Memory extraction could not read the model's answer, so this exchange was only saved as a note."). The client re-parses defensively: it strips `<think>`, unwraps fences, tries the widest `{…}` and `[…]`, and accepts aliases such as `entity/title`, `facts/notes`, `source/target`, `subject/object` and `predicate`.
6. **Graph identity model** (P9) — `MemoryStore.ts:139-160,480-520,674-690`. An entity's identity is `lower(normalizedName)|type` (default type `concept`), and a relation's key is `from>type>to` over entity **keys**, so relations survive display renames. `renameEntity` onto an existing key **merges** the records and moves relations. `deleteEntity` cascades to its relations, because a dangling edge crashes the d3 force layout. Self-relations and nameless relations are refused. Observations are deduped case-insensitively and capped at 400 chars.
7. **Chunking and dedupe** (P9) — `MemoryStore.ts:590-660`. `splitText` cuts at 1200 chars on the last `. `, `! ` or `? ` past the half-window. `addChunk` refuses text under 8 chars, dedupes by text, and upgrades an existing un-embedded chunk when the same text arrives with an embedding. The IndexedDB upgrade is additive and version-agnostic, and writes resolve on transaction `oncomplete`.
8. **One `remember()` entry point** (P9) — `MemoryStore.ts:632-640`. It writes a chunk immediately and queues extraction. This is what the realtime `add_memory` tool resolves at runtime (`test/unit/memory.test.js:232`, `test/e2e/voice.spec.js:372`).
9. **Vision data-URL parser** (P8) — `server/lib/media.ts:9-26`. `parseDataUrl` accepts only `;base64` payloads, strips whitespace, and defaults the media type to `image/png`. It feeds Anthropic's `{source:{type:'base64',media_type,data}}` blocks. `isSupportedImageUrl` gates `/api/describeImage`.
10. **Task records never carry artifact bytes** (P4/P14) — `test/unit/task-store.test.js:792`. Even with 1 MB results for every kind, the stored `task:<id>` record and each `task_update` frame stay under 2048 bytes, and a five-task list stays under 10 KB with no artifact bytes. This invariant keeps reconnect replays cheap, and the full artifact is "one fetch away" (`TASK_INLINE_RESULT_MAX = 4096`, `taskStore.ts:82`).
11. **Log hygiene as a test** (P12) — `test/unit/server-api.test.js:571`. The test drives `describeImage`, `createApplication` and `chat` against a failing upstream and asserts that no API key, signing secret, prompt text or image data appears in captured logs.
12. **Zero-dependency fixture generator** (P14) — `scripts/make-fixtures.mjs`. Using Node built-ins only, it writes a stored-entry zip writer for DOCX/XLSX, a hand-assembled PDF with a real xref table, a deflated 1×1 PNG and a 16-bit PCM sine WAV. The checked-in fixtures (`test/fixtures/sample.{pdf,docx,xlsx,csv,json,txt}`, `pixel.png`, `tone.wav`) can therefore be audited and rebuilt.
13. **Documentation as a product** (P14) — `docs/architecture/*.md`. Each of the eleven documents ends with an "Issues & Technical Debt" table. `test/unit/context-bus.test.js:150` enforces one doc/code contract. Several docs have drifted (see §6), so treat the practice as valuable and the content as secondary to code.
14. **Business positioning** (P13, docs-only) — the README "Consulting Services" section (Cloudflare deployment, Azure and Google Cloud integration, model optimisation, custom development, ongoing support) around an MIT-licensed core. There is no billing, accounts or sharing in code.

---

## 6. Corrections to slice reports, and doc drift

### Slice-report corrections
1. **Memory panel search is not hybrid** (oc2 §2.23 says "using hybrid `store.search`"). `MemoryStore.search` (`MemoryStore.ts:355-364`) ranks only through `FtsIndex` BM25 with prefix expansion. Vector search and RRF run only in `MemoryRecall.recall` (the pre-send injection). `docs/architecture/memory.md` makes the same overclaim ("ranked hybrid search").
2. **`update_persona` "schema marks neither as required" is overstated** (oc2 §7.5). The OpenAI mint schema requires all six top-level fields, `["name","description","message","avatar","voice","appearance"]`, and all 18 appearance fields (`server/api/getSessionToken.ts:336-366`). The client check `if (!args.name || !args.appearance)` (`WorkspaceView.tsx:1053`) matches that contract. The mismatch is only on the xAI WebSocket path: `clientRealtimeToolSchemas()` declares no `required` and types `appearance` as a bare object (`app/Modules/VoiceChat.ts:1270-1282`). The real product defect is that a voice-only or single-feature change is impossible on both transports, and on xAI the model is never told the fields are required.
3. **The memory package was not reviewed by any slice** (oc3 §2.34 says "covered by another slice"). It is covered in §5 of this document.
4. **Minor precision on the avatar set.** `images[]` indexes 0/1 are masculine busts (lighter and darker skin) and 2/3 are feminine (lighter and darker), as seen in `public/img/avatar1-4.png`. So `feminine → 2` is correct, but indexes 1 and 3 are unreachable by the model. The server also labels index 3 as "masculine" in the realtime instructions (`getSessionToken.ts:181`), not only "anything other than 2" in the abstract.

### Verified slice claims (spot-checked against source; all confirmed)
- The MCP/inline operator override is broken: `runBackgroundOperation` ends in `throw providerError('There is no background operation for "${name}"')` after the five built-ins, although `classifyTool` routes `mcp` and `server.*` there (`orchestrator.ts:201-214,496-497`).
- The model ids and preference orders match (`registry.ts:130-217`), as does `ANTHROPIC_SEARCH_TOOL = 'web_search_20260209'` (`:114`) and `OLLAMA_EXTRA_BODY = {reasoning_effort:'none'}` (`providers/ollama.ts:31`).
- The task constants match: `TASK_WALL_CLOCK_MS` is image 300000, document 180000, application 600000 (`taskStore.ts:63-70`), `TASK_MAX_CONCURRENT = 3` (`:40`), the in-isolate `taskListeners` map (`:202`), `taskowner:` hashing (`:277-278`), and the 25 s keep-alive (`api/tasks.ts:33,177`). The `tasks` policy has `subpath:true` (`security.ts:89`).
- The lip-sync envelope reads mean bins `[20, 40%)` and uses thresholds `0.04/0.10/0.22/0.38/0.55` → `closed/bmp/default/aei/o/u` (`FaceAnimation.ts:443-466`). A new `AudioContext` is created per `startSpeakingFromAudio` unless one is passed, and the workspace never passes one (`FaceAnimation.ts:355-369`, `WorkspaceView.tsx:800,859`).
- The gaze bug is real: `currentY += (target-current)*0.3; currentY += 1.2` gives a fixed point of `target+4`, so the `returning` state never satisfies `|currentY|<0.1` (`FaceAnimation.ts:150-196`). The brow bug is also real: `classList.contains('left')` is tested on `.eyeBrow`, while `left` sits on the parent `.eye` (`FaceAnimation.ts:233`, `Persona.tsx:128-136`).
- `query_memory` is dormant in chat: `MEMORY_HOST` is referenced only in `agentRuntime.ts:398-404`, and `/api/chat` never forwards a memory snapshot. The voice `generate_image` handler stores the URL string as a "JPEG" (`WorkspaceView.tsx:1037`). `MAX_VOICE_MCP_TOOLS = 24` (`VoiceChat.ts:348`).
- `ContextBus.emit` returns `handlers.length` read after dispatch (`ContextBus.ts:70-81`). `AudioAnalyzer.onSpeechDetected/NotDetected` have no subscribers anywhere.
- The voice catalogues match: OpenAI has 8, xAI TTS has 26, and xAI realtime has `eve, ara, rex, sal, leo` (`server/api/speech.ts:11-16`, `getSessionToken.ts:28`). The realtime image tool's size enum is the DALL-E set (`getSessionToken.ts:267`).
- The client constants match: `TaskRegistry` uses `reconnectMaxMs 15000`, `streamStableMs 5000`, `finishedRetentionMs 120000` and `sweepIntervalMs 30000` (`TaskRegistry.ts:126-149`); `SpeechOutput` has cache 24 (`SpeechOutput.ts:45`); capture choices are `[5000,10000,30000,60000]` (`CaptureSupport.ts:19`).
- `PersonaSettings.welcome/knowledge/speechDetection*` are never read outside settings and interfaces. The welcome bubble in `docs/img/workspace.png` is legacy UI.

### Documentation drift (docs vs code; the slices mostly got this right)
- `docs/architecture/system-overview.md` says the "Legacy capture stack" (Audio/Camera/Screen/UserMedia managers, recorder) is "not wired". That is **false**. `input/Modules/UserMediaInputHandler.ts:146,218` instantiates `Camera/Screen/AudioInputManager`, and `app/Components/VoicePanel.tsx:545` builds `AudioInputManager` for server dictation.
- The README says "drawers below 600 px". The drawer breakpoint is 768 px (`app/Styles/chat.css:214,920`); 600 px only restores header captions (`:123`).
- The README under-claims providers. It lists "Realtime WebRTC voice ... OpenAI key" and "Audio files transcribed / microphone segments: OpenAI key", but xAI realtime over WebSocket and xAI `/stt` are implemented (`getSessionToken.ts:28-31`, `registry.ts:210-211`).
- `server-api.md` says transcription/speech are "openai" only, that only `mcp` has `subpath:true`, and that `isAdminRequest` accepts the secret in "header or body". The code uses `['openai','xai']`, gives `tasks` `subpath:true` too, and reads only the header (`security.ts:361`).
- Test counts drift across documents: README 852/163, system-overview 815, build doc 460/112. The static count is 840 unit/contract titles plus loops, and 163 e2e.
- `workspace-persona-voice.md` lists "provider switch mid-conversation" under `chat.spec.js`, but no such test exists. Its composition diagram also lists "microphone, folder picker" in the dock toolbar, while the dock actually mounts FileInput, camera, Talk, screen and Tasks (`WorkspaceView.tsx:370-389`).

---

## 7. Top reusable assets for the Agent Workplace (ranked)

1. **Agent loop with three tool dialects and seams** — `server/lib/agentRuntime.ts` (`runAgentLoop`, `agentProviderTurn`, `agentFinishToolCalls`, `AgentRunOptions`).
   - **Why:** one neutral transcript over Anthropic `tool_use`, OpenAI Responses `function_call` and compat `tool_calls`, streamed and buffered; `argsError` is reported back as a tool error; step ceiling with a wrap-up turn; cancellation.
   - **How:** every coworker is a loop configuration (`systemPrompt`, `toolOptions`, `provider`, `model`). The chief-of-staff intercepts `delegate_to(persona, goal)`, `spawn_coworker` and `convene_meeting` through `interceptTool`. Emit step/tool frames to a per-agent channel instead of `() => {}` so the owner can listen in.
2. **Orchestrator routing + summary tables and the chat SSE contract** — `server/lib/orchestrator.ts`, `server/api/chat.ts`, `app/Modules/ChatClient.ts`.
   - **Why:** this is the P1 pattern already. The inline/background classification is data, human copy is enforced, and turns that only start work are valid.
   - **How:** generalise each tool entry to `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}`. Add a CI check that every routed tool has an executor, which fixes the existing bug. Add frames `agent`, `handoff`, `message{from,to}`, `plan`, `approval_request` and `speech{agentId,start/end}`.
3. **Task backbone (server store + client registry + Pending tray + deliver-to-origin)** — `server/lib/taskStore.ts`, `server/api/tasks.ts`, `app/Modules/TaskRegistry.ts`, `app/Components/PendingTray.tsx`, `ChatViewModel.deliverTask`.
   - **Why:** it has a terminal-is-final state machine, per-kind ceilings, real cancel, detached blobs, a delivered marker, a zombie reaper, readable failures and backoff reconciliation.
   - **How:** move it into a Durable Object per project, which gives cross-isolate streaming and true concurrency caps, and put blobs in R2. Add `agentId`, `projectId`, `parentTaskId`/`planStepId`, `dependsOn`, `requiresApproval` and `cost`. The tray becomes the office "Activity" rail grouped by project and agent.
4. **Capability-ordered model registry + dispatch** — `server/providers/registry.ts`, `dispatch.ts`, `lib/http.ts` (deadline-on-signal).
   - **Why:** this is P7's skeleton. Model ids live in one file, capability flags drive the UI, `requireProvider`/`assertProviderSupports` give honest errors, and budgets ride the AbortSignal.
   - **How:** add Google/Gemini, a generic OpenAI-compatible entry, CLI coding agents, pricing, context window and reasoning controls, and per-persona model policy. Carry token/cost budgets on the signal the way deadlines are carried today.
5. **Realtime voice client + minting + mode/coordinator** — `app/Modules/VoiceChat.ts`, `server/api/getSessionToken.ts`, `app/Modules/VoiceMode.ts`.
   - **Why:** it has two transports behind one protocol, GA and beta event aliases, a send queue before open, barge-in that keeps the mic, `canUpdateVoice`, full teardown, bijective MCP names with hijack protection, and a single-session gate.
   - **How:** create one session per agent with its own voice, instructions and tools. Route function calls to the **server orchestrator** so voice and text share one brain. Replace `ScriptProcessorNode` with `AudioWorklet`. Add an office-level floor arbiter for meetings.
6. **Speaking-avatar plumbing** — `shared/Modules/SpeechOutput.ts` (`captureTap`, generation counter, suspend vs enabled) and `persona/Modules/FaceAnimation.ts` (`MouthSystem`, reduced-motion rule, presence scaling).
   - **Why:** every audio source becomes a `MediaStream` that drives a face, which is exactly "listen while their avatars are speaking".
   - **How:** instantiate SpeechOutput per agent, and run all faces from one rAF scheduler with one shared `AudioContext` and teardown. Add a face state machine (idle, listening via VAD, thinking while a run is pending, speaking, handing off), plus sentence-chunked TTS and real visemes where a provider supplies timings. Keep the faceless-bust + CSS-feature trick for cheap many-agent grids.
7. **Workers-native MCP stack** — `server/mcp/{client,manager,schema,net}.ts`, `tools/serve.ts` `createMcpHost`.
   - **Why:** Streamable HTTP, legacy SSE and stdio via bridge without an SDK; SSRF checked per hop; write-only secrets; schema whitelisting.
   - **How:** adopt it wholesale for P10. Add resources/prompts, per-persona tool grants and a local bridge process for stdio and desktop tools.
8. **Memory stack** — `shared/Modules/Memory/*`, `server/api/extractMemory.ts`, `server/lib/lenientJson.ts`, `app/Components/MemoryPanel.tsx`.
   - **Why:** it provides the graph identity model, BM25 + cosine + RRF with provenance, chunk-first never-blocking extraction, tolerant JSON, and visible editable memory.
   - **How:** port the store server-side (D1 for entities/relations/chunks, Vectorize for vectors) scoped by `workspace/project/agent`. Keep the algorithms and the "memory used" disclosure, and add decay, re-embedding and tombstones for undo.
9. **Context pipeline** — `shared/Modules/ContextBus.ts` (ContextCard), `input/Modules/{FileProcessor,FolderContext,CaptureContextPublisher,CaptureSupport}.ts`.
   - **Why:** every modality becomes one envelope with upsert, consume, retire and archive semantics. It includes client-side DOCX/XLSX/PDF/CSV extraction, SingleFlight, the AudioSegmenter header trick, and the folder engine with diff re-sync.
   - **How:** extend `ContextCard` with `scope` (user/project/agent), `provenance`, `visibility` and `costEstimate`. Let the lead agent route cards to coworkers. Add a server/bridge ingestion path and frame-differencing for ambient capture.
10. **Perimeter** — `server/lib/security.ts`, `server/mcp/net.ts`, `shared/Connectors/ApiSession.ts`.
    - **Why:** a protected-by-default policy table, three rate classes, HMAC tokens with 401 refresh, peer-address locality and constant-time admin compare.
    - **How:** keep the policy-table shape and replace browser identity with accounts/RBAC. Put approvals and budgets in the policy table.
11. **Safe rendering of agent output** — `shared/Components/Markdown.tsx` (sanitizer, `aido:` action links), `Document.tsx` `HtmlPreview` (sandbox without `allow-same-origin`).
    - **How:** make it mandatory for all agent and in-app app output. Evolve `aido:` links into `action:` buttons ("Approve plan", "Ask Finance").
12. **Ship-safety tooling** — `tools/deploy.ts` preflight (leaked-config scan, worker parse check, release marker), `/__dev/build-info` + `test/e2e/support/dev-server-guard.mjs`, doc-sync and drift tests, `scripts/make-fixtures.mjs`, the fake-media Playwright harness.
    - **How:** carry these into the new repo's CI. Do not carry over the concatenating bundler or the global-script JSX runtime.

---

## 8. Screens and UX summary

- **`docs/img/workspace.png`** (dark theme, legacy first impression). It has a hamburger menu, a centred "Cloud Nine AI" title and a blue **Connect** dot at top right for realtime voice. A welcome bubble reads "Welcome to Cloud Nine AI. I'm your assistant..." and offers "images, applications, games, documents or presentations". This text is **not** in the current code (`PersonaSettings.welcome` is dead). The centre shows a large illustrated **feminine avatar** (`avatar3.png` bust with CSS-drawn blue irises, brows, nose PNG and lips) as the visual centre of the product. The bottom dock has three verb buttons, **Show** (camera), **Talk** (mic) and **Share** (screen), a "Type your message..." composer with a send glyph, and a magic-wand "..." overflow (`public/img/aido.png` legacy toolbar icon).
- **Avatar assets** (`public/img/avatar1-4.png`) are four faceless 1024×1024 busts in suits and blazers: two masculine and two feminine, in lighter and darker skin. They come with `nose1/2.png` and `photo1/2.png` outline masks. Eyes, brows and mouth are drawn in CSS on top, and skin tone is further adjustable by a CSS filter.
- **Current workspace (from code and e2e):** chat-first. The header has a drawer toggle, theme, admin pop-up and a Connect control that appears only if realtime is possible. The drawer has tabs Chats | Files | Memories | Settings, overlaid under 768 px. The chat stream shows compact one-sentence tool steps with details behind a disclosure, sanitized markdown, inline artifacts (image, video, sandboxed app, document), media/citation cards, and a footer with token counts but **no model name**. The dock holds context chips with a live transcript preview, attach/camera/Talk/screen/Tasks buttons, and a composer whose send button becomes stop while streaming. The Pending tray slides up. The voice panel is a right card on desktop and a bottom sheet on phones. On desktop the avatar sits in a trailing lane; on phones it collapses to a 76 px corner bubble. Tapping the avatar barges in.
- **Admin (`/admin.html`)** carries a banner that it is "not an authentication boundary". Its sections are Defaults (provider, model, system prompt with the server's protection sentence), Providers (key names and capabilities), MCP (http/sse/stdio with the reason stdio is unavailable), Diagnostics (health, session, rate classes, last 12 requests), Memory, Folder defaults, and Advanced (the manual agent-run timeline).
- **UX principles worth inheriting:**
  - Hide what cannot work.
  - Errors are sentences.
  - Dictation lands in the composer and is not auto-sent.
  - Everything attached is a visible chip.
  - Results return to the thread that asked.
  - Every control has a 44 px target and is SVG-iconed (no emoji, test-enforced).
  - There is no horizontal scroll at 375 px (test-enforced).
  - Reduced motion keeps the functional lip-sync.
- **Gap versus the target product:** there is exactly one avatar, one voice session and one conversation surface. There is no office or spatial navigator, no per-agent timelines, and no way to join or listen in on another agent. The Agent Workplace has to multiply every singleton here (`assistant-settings`, `SpeechOutput.instance`, `VoiceSessionCoordinator`, `FaceAnimation`) into per-agent instances, and add a floor arbiter plus an observable agent channel on top of the SSE frame protocol.
