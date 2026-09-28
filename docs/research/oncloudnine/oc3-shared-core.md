# oncloudnine — Shared core: JSX-to-DOM element factory, ECS, ContextBus, ConversationStore, FileStore, SpeechOutput, connector services, UI component library, build/deploy tooling

> Slice reviewed: `oncloudnine/shared/**`, `oncloudnine/tools/**`, `oncloudnine/build.js` (generated from `tools/`), `oncloudnine/build/dev-api.js` (generated), `oncloudnine/package.json`, `oncloudnine/README.md`, `docs/architecture/{client-core,context-bus,ui-components,build-and-deployment}.md`, and the unit tests `context-bus`, `element-children`, `filestore-display`, `build-tools`, `dev-server-harness`, `deploy-check` (plus `icon` and `voice-speech`, which cover shared modules). All paths below are relative to `reference/oncloudnine/` unless stated. Secrets files (`config.json`, `data/kv-dev.json`) were not opened; `config.example.json` was used for key names only.

---

## 1. Purpose & architecture

`shared/` is the framework-free foundation that three micro-frontends (`input/`, `persona/`, `app/`) are built on. It is a **global-script TypeScript project**: no module imports between files (the `Components/*.tsx` files use `export`/`import`, but the build strips those lines), compiled with the classic JSX transform where `jsxFactory: "$element"` and `jsxFragmentFactory: "$children"` (`shared/tsconfig.json`). The build concatenates every compiled shared file into `build/js/shared.js`, puts it first in the final bundle, then the apps in `--apps` order, and wraps the lot as a single ES-module default export IIFE that returns only the `--main` function (`renderWorkspaceView`).

Because the apps cannot import one another, the shared core provides two integration mechanisms:

1. **Compile-time:** generated ambient declarations (`build/types/**` → `<app>/types.d.ts`) so each app sees the others' shapes as globals.
2. **Runtime:** the `ContextBus` singleton (typed pub/sub, published on `globalThis`) — the only sanctioned way for one app to talk to another.

The rest of the core is the plumbing every feature leans on: `ApiSession`/`apiFetch` (session-token HTTP client), `ConversationStore` (IndexedDB), `FileStore`/`FileLibrary` (CacheStorage), `SpeechOutput` (TTS with browser fallback and a MediaStream tap for lip sync), the `ECS` engine that drives the persona's face, the connector services (`/api/chat`, `/api/embeddings`, `/api/describeImage`, `/api/search`), a knowledge-graph memory package (`shared/Modules/Memory/*`, covered by another slice), and a component library (Markdown + sanitizer, DocumentPanel/DOCX, Graph, Table, Tabs, Toast, Icon, …). The toolchain (`tools/*.ts` → `build.js`) is a zero-framework bundler + dev server that emulates Cloudflare Pages + a deploy preflight.

### Main runtime flow (context → conversation → speech → avatar)

```
 input/ (InputViewModel, FolderPicker,           app/ (MediaGenPanel, AgentViewModel)      shared/Memory (MemoryRecall)
         CaptureContextPublisher)                          |                                       |
        | context:add {card}   transcript:*               | context:add {card}                    | recall card (kind:'memory')
        v                                                  v                                       v
 +------------------------------------------------------------------------------------------------------------+
 |                     ContextBus.instance   (shared/Modules/ContextBus.ts, globalThis.ContextBus)            |
 |  context:add | context:remove | chat:send | capture:media | transcript:interim/final | tts:speak/stop | toast |
 |  (+ task:changed via declaration merge in app/Modules/TaskRegistry.ts)                                     |
 +------------------------------------------------------------------------------------------------------------+
        |                        |                         |                      |                    |
        v                        v                         v                      v                    v
 ChatViewModel             FilesHub archives         GraphExtractor        SpeechOutput.attach()   ToastHost
 .addContextCard (upsert)  -> FileLibrary            (memory extraction)   (shared/Modules/        (shared/Components/
 .send(): cards -> ChatMessage.attachments            listens context:add   SpeechOutput.ts)        Toast.tsx)
   emits context:remove per consumed card                                         |
   ConversationStore.save (IndexedDB 'cloudnine')                                 | POST /api/speech via apiFetch
   ChatClient/-> POST /api/chat (SSE)                                             v   (fallback: speechSynthesis)
                                                                           <audio>.play() -> captureStream()
                                                                                  | onStateChanged({speaking,stream,text})
                                                                                  v
                                                                   WorkspaceView.attachSpeechToPersona()
                                                                                  | startSpeakingAudioEvent(stream)
                                                                                  v
                                                           persona/Modules/FaceAnimation.ts (extends ECS)
                                                           MouthSystem: AnalyserNode envelope -> MouthShapeComponent
                                                           -> ECS system tick (30 Hz) -> class "mouth <shape>"
```

### Build/deploy flow

```
tools/{build,serve,tools,deploy}.ts --tsc outFile--> build.js
node build.js --main renderWorkspaceView --apps input,persona,app --services server [--release]
   -> ensure/migrate config.json from config.example.json
   -> tsc shared (once) -> delete JSX.js/interfaces.js -> copy public/ -> gen images.js
   -> tsc input, persona, app, server (parallel) -> gen <app>/types.d.ts -> recompile if types moved
   -> concat CSS -> build/public/css/styles.css
   -> combineJs per project (topological sort by import graph, strip module syntax) -> build/js/*.js
   -> final bundle build/public/js/app.js  = export default (function(){ ...; return renderWorkspaceView; }())
   -> _worker.js = server handlers + worker entry (Pages advanced mode)
   -> [--release] Terser/cssnano once on final artifacts
   -> build/build-info.json written LAST {mode, buildId(source fingerprint), pid, root}
   -> dev: servePublicFolder on 127.0.0.1:8080 + coalesced watchers
npm run deploy = build -> publish -> deploy:check (13-point preflight) -> wrangler pages deploy
```

---

## 2. Feature inventory

### 2.1 JSX-to-DOM element factory (`shared/element.ts`)
- **What:** A ~250-line JSX runtime with no virtual DOM. Every TSX expression compiles to `$element(tagOrFn, props, ...children)` which creates a real DOM node immediately.
- **How:**
  - `$element(component, props, ...children)` (`element.ts:22`): `if` prop skips rendering unless `props.if === true` (literal); function components are called as `component(props, children)`; for tags, each prop is dispatched: function values, camelCase names, and `on*` names are assigned as DOM properties; `IReference` values register async props whose `onLoad` writes attributes and re-renders a function child; `Promise` values resolve into attributes; everything else goes to `setAttribute`. `when` + function-as-first-child waits on `Promise.all(asyncProps)` then renders. `ref` gets `setReference(element)` after children are appended.
  - `$children(parent, children)` (`element.ts:141`): arrays flatten; strings → text nodes (XSS-safe); functions are invoked lazily; `{svg: string}` objects are wrapped in a `<span>` via `innerHTML`; any DOM node is recognized by `typeof nodeType === 'number'` **or** `instanceof Node/HTMLElement` (fix for SVG, Text, DocumentFragment and cross-realm nodes being dropped — see the long comment at `element.ts:178-189`).
  - `$reference<T>()` (`element.ts:210`): `{setReference, onLoad, value}`; `onLoad` fires on `setTimeout(0)`.
  - `$event<T>()` (`element.ts:232`): memoizing pub/sub; `add()` replays the last state; `notify()` awaits handlers sequentially and sets `state` afterwards.
- **Tests:** `test/unit/element-children.test.js` — "an SVG element passed as a JSX child is appended, not dropped", "a Text node…", "a DocumentFragment…", "a node from another realm is appended, not dropped", "an {svg: string} snippet is still wrapped in a span", "an object that is neither… still warns". The test builds a fake DOM with a real class hierarchy and nodeTypes.
- **Maturity:** partial. Known defects (documented in `docs/architecture/client-core.md` and verified in code): fragments crash (`<>…</>` compiles to `$element($children, null, …)`; `$element` calls `$children({}, [...])` and `{}.appendChild` throws), boolean `false` props become set attributes (`disabled="false"`), no unmount/cleanup lifecycle (re-render does `innerHTML = ''`).

### 2.2 Ambient JSX typing (`shared/JSX.ts`)
- **What:** `namespace JSX` with `IReference<T>`, `Component<T>` (`class`, `if`, `when`, `id`, `ref`), `BasicElement` (drag events, onclick), `ValueElement` (input types), and a partial `IntrinsicElements` map (no `video`, `iframe`, `svg`).
- **How:** Types only; the build deletes the compiled `JSX.js` and `interfaces.js` (`tools/build.ts:139-142`).
- **Maturity:** partial (type/runtime drift: `if?: boolean` vs literal-true check; missing tags).

### 2.3 Reactive primitives (`shared/Modules/EventManager.ts`, `ObservableList.ts`, `shared/interfaces.ts`)
- **What:** `EventManager<T>` (add + sequentially awaited notify, no unsubscribe) and `ObservableList<T>` (wraps an array/iterable/async-iterable/loader function into a list with `onItemAdded`, `onItemRemoved`, `add`, `remove(item)` → notifies with index, `clear`, `moveItem`, `count`, iteration).
- **Contracts:** `IList<T> = T[] | Iterable<T> | AsyncIterable<T> | (() => Promise<T[]>)`, `IEvent<T>`, `IObservableList<T>`, `IFileStore extends AsyncIterable<string>`, `IMarkdownOutput`.
- **Maturity:** partial. `ObservableList.load()` is fired unawaited in the constructor (async sources are empty right after construction and initial items never fire `itemAdded`), `moveItem` emits nothing, and a debug `console.log(this.array)` remains (`ObservableList.ts:81`). `EventManager` has no error isolation.

### 2.4 ContextBus — typed integration bus (`shared/Modules/ContextBus.ts`)
- **What:** A singleton typed pub/sub channel shared by all micro-frontends; the documented backbone for moving "context" (files, captures, memories, transcripts) into conversations and for cross-app commands.
- **API:** `ContextBus.instance.on(event, handler)` → unsubscribe closure (idempotent per handler ref); `once`; `off`; `emit(event, payload)` → number of handlers (`ContextBus.ts:70`); `clear(event?)`.
- **Semantics:** dispatch over a **copy** of the handler list (safe subscribe/unsubscribe mid-dispatch); each handler wrapped in try/catch (a throwing handler never breaks others or the emitter); dispatch is **synchronous** and return values (including Promises) are ignored. Published as `globalThis.ContextBus` (`ContextBus.ts:97-99`) — this keeps the class alive through Terser's dead-code elimination in the release bundle and is the hook E2E probes use.
- **Canonical event map (`ContextBusEvents`, `ContextBus.ts:13-23`):**

| Event | Payload | Emitted by (verified by grep) | Consumed by |
|---|---|---|---|
| `context:add` | `{ card: ContextCard }` | `input/ViewModels/InputViewModel.ts:97,138`, `input/Components/FolderPicker.tsx:755,833`, `input/Modules/CaptureContextPublisher.ts:123,165`, `app/Components/MediaGenPanel.tsx:195`, `app/ViewModels/AgentViewModel.ts:470` | `ChatViewModel.addContextCard` (`app/ViewModels/ChatViewModel.ts:210`), `FilesHub` (`app/Components/FilesHub.tsx:154`), `GraphExtractor.listen()` |
| `context:remove` | `{ id }` | `ChatViewModel` (on send / dismiss), `FilesHub` | `InputViewModel` (drops persisted copy), `FolderPicker`, `ChatViewModel`, `FilesHub` refresh |
| `chat:send` | `{ text }` | `ChatComposer.tsx:91`, `InputViewModel.ts:175` | `ChatViewModel.send` |
| `capture:media` | `{ source: 'camera'\|'screen'\|'mic', dataUrl?, blob?, ts }` (only `{source, ts}` is ever sent) | `CaptureContextPublisher` | emit-only telemetry |
| `transcript:interim` / `transcript:final` | `{ text }` | `CaptureContextPublisher`, `InputViewModel.onSpeechInput`, realtime voice | `ChatViewModel` (live preview; final is committed to the composer, **not** auto-sent) |
| `tts:speak` / `tts:stop` | `{ text }` / `{}` | `ChatViewModel.speak`, `VoicePanel`, `WorkspaceView` barge-in | `SpeechOutput` (after `attach()`) |
| `toast` | `{ message, level: 'info'\|'success'\|'warn'\|'error' }` | ~50 call sites | `ToastHost` |
| `task:changed` (extension) | `{ task: TaskJob, reason: 'added'\|'updated'\|'removed' }` | `app/Modules/TaskRegistry.ts:822` | `ChatViewModel`, `PendingTray`, `WorkspaceView` |

- **Fallback idiom:** emitters that can do the work themselves check the count: `if (ContextBus.instance.emit('chat:send', {text}) === 0) vm.send(text)` (`ChatComposer.tsx:91`); `if (emit('tts:speak', …) === 0) SpeechOutput.instance.speak(text)` (`ChatViewModel.ts:487`).
- **Extension by declaration merging:** `app/Modules/TaskRegistry.ts:113` re-declares `interface ContextBusEvents { 'task:changed': … }`, which keeps `emit/on` type-checked without editing the shared file.
- **Tests:** `test/unit/context-bus.test.js` — "emit delivers the payload to every subscriber and reports the count", "on returns an unsubscribe closure and ignores duplicate handlers", "handlers may subscribe and unsubscribe while an event is dispatching", "a throwing handler does not stop the others or the emitter", and "the event map and the architecture doc agree on the canonical events" (a doc-drift test that parses `ContextBusEvents` out of the source and checks `docs/architecture/context-bus.md`).
- **Maturity:** solid (for a single-page, single-tab app).

### 2.5 ContextCard — the unit of context and its lifecycle
- **Shape:** `ContextCard { id, kind: 'file'|'capture'|'memory', title, content, mime?, tokens?, preview?, dataUrl?, vision? }` (`ContextBus.ts:1-11`).
- **Lifecycle (as wired by consumers):**
  1. Producer publishes a card immediately (e.g., a camera frame with placeholder content) and **re-publishes under the same id** when enrichment arrives (vision description) — `context:add` is an upsert (`CaptureContextPublisher.ts:103-170`, `ChatViewModel.addContextCard` at `ChatViewModel.ts:335`).
  2. The chat keeps `contextCards` as visible chips; a `retiredCards` list (bounded) prevents a late description from re-materializing a card that was already sent/removed.
  3. On send, memory recall runs first (`MemoryRecall.instance.card(content)`) and becomes a visible `memory` card; every card is flattened into `ChatMessage.attachments`; cards are **consumed** (cleared) and `context:remove` is emitted per card so the producing app drops its persisted CacheStorage copy (`ChatViewModel.ts:378-445`).
  4. `FilesHub` archives each card into `library-files` so it outlives consumption.
- **Maturity:** solid — this is the most transferable idea in the slice.

### 2.6 ECS engine (`shared/Modules/ECS.ts`)
- **What:** Minimal entity-component-system: `Entity {id, components[], add, remove, removeComponents(type), get(type)}`, `System {id, update(entity)}`; `ECS.createEntity(id, ...components)`, `createSystem(id, update, query?)` (optional component filter), `findEntity/findSystem/findComponent(s)`, `update()` (every system × every entity), `start(interval = 1000/30)` / `stop()` (setInterval), `runDelayed()` (setTimeout + rAF, uncancellable), `saveState(name, fileStore)` / `loadState(name, fileStore, componentMap)`, `createGraph()` (nodes/edges for the Graph component).
- **Usage:** `persona/Modules/FaceAnimation.ts` extends `ECS`: one entity `face` with `FaceComponent(element, 'eye'|'eyeBrow'|'iris'|'mouth')` ×7; systems `BlinkSystem` (every 5 s, 150 ms), `EyeMovementSystem`, `EyeBrowSystem` (all skipped under `prefers-reduced-motion`), and `MouthSystem` which consumes transient `MouthShapeComponent`s and sets `mouth.className = "mouth <shape>"`. The mouth is driven either by text (letter walk, 50–200 ms per char) or by an audio `MediaStream` (AnalyserNode `fftSize 1024`, smoothing 0.55, amplitude bands → shapes `closed/bmp/default/aei/o`).
- **Maturity:** partial. `saveState` writes `<name>-ecs-state.json` but `loadState` reads `<name>ecs-state.json` (`ECS.ts:147` vs `:151`) so persistence never round-trips; lookups are linear scans each tick; `createGraph` duplicates component nodes.

### 2.7 ConversationStore (`shared/Modules/ConversationStore.ts`)
- **What:** IndexedDB persistence for conversations and UI settings with an in-memory `Map` fallback when IndexedDB is unavailable (private mode, blocked storage, insecure context).
- **How:** DB `cloudnine` v1; stores `conversations` (keyPath `id`, index `updated`) and `settings` (keyPath `key`). API: `list()` (sorted by `updated` desc), `get(id)`, `mostRecent()`, `save(conv)` (sets `updated`, stores a `JSON.parse(JSON.stringify())` snapshot), `remove`, `clear`, `getSetting(key, fallback)`, `setSetting(key, value)`, static `id(prefix)` (`crypto.randomUUID` or random fallback), static `create(title='New chat')`. Writes resolve on **transaction `oncomplete`**, not request success (durability before continuing, `ConversationStore.ts:249-253`). `onversionchange` closes and resets the handle so another tab's upgrade doesn't strand this one.
- **Maturity:** solid for single-user chat; no migrations beyond v1, whole-conversation rewrite on every save.

### 2.8 Conversation/message schema (`ConversationStore.ts:1-73`, `shared/conversation.ts`)
- `Conversation { id, title, created, updated, system?, provider?, model?, messages: ChatMessage[] }`
- `ChatMessage { id, role: 'user'|'assistant'|'system', content, ts, provider?, model?, usage?: {inputTokens?, outputTokens?}, error?, code?, stopped?, attachments?: ChatAttachment[], tools?: ChatToolStep[], artifact?: ChatArtifact, taskId? }`
- `ChatToolStep { id, name, status: 'running'|'ok'|'error', summary /* human line, e.g. "Searched the web" */, detail? /* only inside a closed disclosure */ }`
- `ChatArtifact { kind: 'image'|'video'|'application'|'document', title?, content? /* markdown or HTML */, url?, mime? }`
- Legacy contracts in `shared/conversation.ts`: `IConversationMessage`, `IConversationFile {name, type, search(), text(), json()}`, `IConversationContext {Messages, Files, addFiles, clear}`, `ConversationSettings` (enable flags for speech input, file input, multiline, remove, send, copy, speak).
- **Maturity:** solid (the newer schema); legacy interfaces are vestigial.

### 2.9 FileStore — CacheStorage buckets (`shared/Modules/FileStore.ts:2-139`)
- **What:** One CacheStorage "folder" per instance implementing `IFileStore`: `storeFile(name, blob)`, `storeObject(name, obj)` (JSON blob), `fetch(name)` (prefixes `/`), `has`, `removeFile`, `clear`, async iteration over **still-encoded** keys, plus F-10 additions `storeFileWithInfo`/`storeObjectWithInfo` (metadata carried in response headers), `blob`, `json` (tolerates corrupt entries), `names`, `records({format:'card'|'blob', kind})`, static `id(text, length=8)` (SHA-256 hex prefix).
- **Metadata headers:** `x-file-title`, `x-file-kind`, `x-file-conversation`, `x-file-conversation-title`, `x-file-updated`, `x-file-source` — values `encodeURIComponent`-ed because header values must be ISO-8859-1 (`FileStore.ts:293-320`).
- **Key discipline:** keys stay URL-encoded for lookup; `displayFileName()` decodes only for display (the comment at `FileStore.ts:6-16` documents a real bug where decoded names missed on re-lookup).
- **Maturity:** solid; evictable storage, `navigator.storage.persist()` never requested.

### 2.10 FileLibrary — unified files hub (`FileStore.ts:602-737`)
- **What:** The union of four buckets rendered by the files hub, with de-duplication, download and zip export.
- **Sources:** `library-files` (hub's archive of every bus card, kind upload/card), `context-files` (attached uploads), `folder-files` (folder context), `assistant-files` (generated media/documents/apps, blob format).
- **How:** `list()` → records from all sources, `dedupeStoredRecords` (same `cardId` in two buckets: the copy that knows its `conversationId` wins), sorted newest-first; `archive(card, info)` → `library-files/<cardId>.json` with inferred kind (`folder-` prefix → folder, capture, memory, upload); `remove`, `blobFor` (data URL → bytes, prose re-decoded), `textFor`, `exportZip(records)` via vendored JSZip with DEFLATE level 6, `uniqueArchiveNames` (`report (1).md`), `safeArchivePath` (no drive letters, no `..`), `downloadBlob` (revoke on next tick for Safari).
- **Content repair:** `decodeStoredText` undoes one JSON encoding too many (payload that parses as a JSON string, or prose with `\n` escapes and no real newlines — only for `text/plain`/`text/markdown`), applied on the way into the store and on read.
- **Preview routing:** `storedPreviewKind(record)` → `image|audio|video|html|table|markdown|text` by MIME and extension (HTML checked before table/markdown so generated apps render as pages). `visibleStoredRecords(records, scope)` and `storedFileCountLabel(visible, selected)` ("N files · M selected") computed from one source.
- **Tests:** `test/unit/filestore-display.test.js` ("a stored key keeps its encoded spelling and the display name is decoded", "every generated file is listed, whatever punctuation its name carries", "the visible list and the count line are computed from the same records", "html is routed to the page renderer, by mime and by name", "a payload that was JSON-encoded one time too many is decoded once", "a stored page is handed over byte for byte").
- **Maturity:** solid.

### 2.11 SpeechOutput — non-realtime TTS (`shared/Modules/SpeechOutput.ts`)
- **What:** Speaks text via `POST /api/speech` (server voice) with browser `speechSynthesis` as the zero-key fallback; the single subscriber for `tts:speak`/`tts:stop`.
- **How:**
  - Singleton `SpeechOutput.instance`; `attach()` subscribes to the bus (idempotent). Static catalogue: `OPENAI_SPEECH_VOICES` (8: alloy, ash, ballad, coral, echo, sage, shimmer, verse) and `XAI_SPEECH_VOICES` (26: altair … zenith); `voicesFor(provider)`, `defaultVoiceFor` (`echo` / `eve`), `maxChars = 4000`.
  - `speak(text, voice?)` (`SpeechOutput.ts:240`): trims, returns `'none'` if disabled/suspended; stops current output; bumps a **generation counter** (stale-result guard); **truncates** to 4000 chars (no chunking); announces `loading`; `audioUrl()` → in-memory LRU cache (24 object URLs, keyed `sha256(voice + "\n" + text)`, FNV-1a fallback when `crypto.subtle` is absent) or fetch via injected `fetcher`/`apiFetch`; `play()` resolves when playback **starts**; if the server fails or autoplay is refused it falls back to `speakLocally()`. Never rejects; resolves with `'server' | 'browser' | 'none'`.
  - `stop()` halts both paths, releases the tap, bumps generation. `setEnabled(bool)` = user's on/off; `suspend()/resume()` = separate flag held while a realtime session owns the voice (prevents double voices).
  - **State events** via `onStateChanged(handler)` → unsubscribe: `SpeechOutputState { speaking, loading, source: 'server'|'browser'|'none', voice, text /* what is being spoken */, stream? /* MediaStream of the playing clip */, error? }`.
  - **Lip-sync tap** `captureTap(audio)` (`SpeechOutput.ts:432`): tries `audio.captureStream()`/`mozCaptureStream()` first (a copy; playback untouched); otherwise routes through a shared `AudioContext` (`createMediaElementSource` → destination **and** `createMediaStreamDestination`) only if the context is `running` — attaching to a suspended context would silence the reply. Browser synthesis exposes no stream, so the avatar falls back to text timing.
  - Dependency injection (`SpeechOutputDeps`: `fetcher`, `createAudio`, `synthesis`, `createUtterance`, `createAudioContext`, `createObjectUrl`, `revokeObjectUrl`, `cacheLimit`) makes it fully unit-testable.
- **Consumers:** `WorkspaceView.attachSpeechToPersona()` (`app/Views/WorkspaceView.tsx:848`) maps state → `startSpeakingAudioEvent(stream)` or `startSpeakingEvent(text)` or `stopSpeakingEvent`; `MessageActions` spinner closes when `!state.loading`; `VoicePanel` badge "Speaking (server voice)/(browser voice)".
- **Tests:** `test/unit/voice-speech.test.js` (21 tests: cache key is a real sha256 including the voice; client list matches both server catalogues; fetched once then cached; cache bounded and revokes; unconfigured endpoint falls back to browser; autoplay refusal falls back; stop() drops a late clip; suspension separate from on/off; stream published for the mouth; suspended AudioContext left alone).
- **Maturity:** solid for one voice at a time; no sentence chunking/streaming TTS; browser fallback ignores the selected voice; `X-Speech-Voice`/`X-Speech-Provider` response headers are never read by the client.

### 2.12 ApiSession / apiFetch — session-token HTTP client (`shared/Connectors/ApiSession.ts`)
- **What:** Every `/api/*` call carries a short-lived HMAC token; API keys never reach the browser.
- **How:** `ApiSession.token()` POSTs `/api/session` (POST so the browser attaches `Origin`), caches `{token, expiresAt}` (default 10 min if absent), refreshes 5 s early, de-duplicates concurrent requests, and on failure returns `''` (request proceeds unauthenticated and gets the typed error). The token is published three ways: `window.APP_SESSION_TOKEN`, `<meta name="session-token">`, `<meta name="app-session-token">`. `apiFetch(url, init, retryOnUnauthorized=true)` adds `X-Session-Token` and retries once after a 401. `apiError(response, fallback)` unwraps the `{error:{message, code}}` envelope. The token is prefetched at bundle load.
- **Maturity:** solid. (Docs describe `GET /api/session`; the code uses POST — doc drift.)

### 2.13 TextCompletionService (`shared/Connectors/TextCompletionService.ts`)
- **What:** Reusable completion client for `POST /api/chat` with JSON and SSE modes.
- **How:** constructor `(connector: 'chat'|'knowledge'|'tools'|'data'|'image'|'audio'|'search'|'task'|'document', promptExtension, initial_tokens = 250)`; body `{provider?, model?, messages, system, maxTokens: min(4096, …), stream}` where `system = [...context, promptExtension, systemPrompt].join('\n\n')` and every non-assistant message is sent as `user`. `streamCompletion(..., onDelta, max_tokens?, signal?)` parses SSE robustly: partial chunks, CRLF and LF boundaries, multi-line `data:` fields, `:` comments, `[DONE]`, `{type:'delta', text|delta}`, `{type:'done', message}`, `{type:'error', message}` → rejection; unparseable frames become text deltas; non-streamed answers still call `onDelta` once.
- **Maturity:** partial — correct, but no in-app consumer (the workspace uses `app/Modules/ChatClient.ts`), text-only messages (no image blocks), and the `connector` label is never sent.

### 2.14 TextEmbeddingService (`shared/Connectors/TextEmbeddingService.ts`)
- **What:** `getEmbeddings(texts[])` → `POST /api/embeddings {texts, provider?}` → `VectorEmbedding[] {embedding, text}` in input order (empty strings filtered).
- **Maturity:** partial — correct but unused; `shared/Modules/Memory/VectorIndex.ts` calls the endpoint itself (batch 64). Server caps: 128 texts, 32,000 chars each; provider order Ollama (`nomic-embed-text`) → OpenAI (`text-embedding-3-large`).

### 2.15 ImageDescriptionService (`shared/Connectors/ImageDescriptionService.ts`)
- **What:** `getImageDescription(image_url, text, messages, context, max_tokens)` → `POST /api/describeImage {provider?, image_url, text: [...context, text].join('\n'), max_tokens ≤ 4096 (default 1024)}` → `text/plain`.
- **Usage:** `CaptureContextPublisher` describes camera/screen frames and re-publishes the card with the summary.
- **Maturity:** solid. Server accepts only `data:image/*` or http(s) URLs; vision order Anthropic → OpenAI → xAI (Ollama excluded).

### 2.16 SearchService — provider-side web search (`shared/Connectors/SearchService.ts`)
- **What:** `run({query, provider?, model?, maxResults?, system?, messages?, signal?})` → `POST /api/search` → `{answer, citations: [{title, url, snippet, source}], query, provider, model, usage}`; the provider performs search+read+answer in one call. Also implements the legacy `ISearchProvider.search(query, max)`.
- **Capability gating:** `SearchService.available(providers)` / `providerFor(providers)` read the `/api/models` provider list and look for a configured provider with a model advertising the `search` capability — the UI hides the toggle instead of failing after a click (`ChatViewModel.ts:772`).
- **Defensive parsing:** citations without http(s) URLs are dropped.
- **Maturity:** solid.

### 2.17 Connector contracts (`shared/connector.ts`)
- `ConnectorType = 'openai' | 'claude'`, `ITextCompletionService`, `ITextEmbeddingService`, `IImageDescriptionService`, `ISpeechGenerationService {getSpeechGeneration(input, voice, speed): Blob}`, `ISpeechTranscriptionService {getSpeechTranscription(blob, previousTranscript, temperature?)}`, `ISearchResult`, `ISearchProvider`.
- **Maturity:** stub for the speech contracts (declared, never implemented by `SpeechOutput` or `/api/transcribe` callers); others implemented as above.

### 2.18 Markdown renderer + DOM sanitizer (`shared/Components/Markdown.tsx`)
- **What:** The security boundary where model output becomes DOM.
- **How:** `markdownToHtml` lifts fenced code and inline code into NUL-delimited placeholders **before** any other rule (so `__init__`, `*ptr`, `# comment` survive), escapes all text including quotes, parses blocks (headings, rules, blockquotes recursively, pipe tables with header detection and empty-cell preservation, nested ordered/unordered lists by indent, paragraphs with `<br/>`), renders inline (images only with safe URLs, links — external only if `allowExternalLinks`, `target=_blank rel=noopener noreferrer`; `aido:` links become `<a data-send>` that call `sendMessage(text)`), emphasis with lookarounds that protect snake_case. With `streaming: true` an unterminated fence renders as a code block. `sanitizeHtml` parses into an inert `<template>`, drops `DANGEROUS_TAGS` (script, style, iframe, object, embed, link, meta, form, input, textarea, select, base, svg, math, template), unwraps unknown tags, strips any non-allowlisted or `on*` attribute, and filters `href/src` through `isSafeUrl` (allows `#`, relative, http(s), mailto, `data:image/` for images). `renderMarkdownInto(container, text, opts)` re-renders on each streamed delta and wires copy buttons (`Copy` → `Copied`/`Failed`) and `data-send` links as real listeners. `removeMarkdown()` strips markup for TTS (code blocks dropped, not spoken). `copyText()` = Clipboard API with `execCommand` fallback.
- **Maturity:** solid.

### 2.19 HtmlPreview — sandboxed generated apps (`shared/Components/Document.tsx:29-96`)
- **What:** Renders generated HTML inside `<iframe sandbox="allow-scripts" srcdoc=… referrerpolicy="no-referrer">` — deliberately never with `allow-same-origin` — plus a "View source / View page" toggle with `aria-pressed`/`aria-controls`.
- **Used by:** FilesHub (.html files), AgentPanel (`application` deliverables), WorkspaceView (`create_application` voice tool).
- **Maturity:** solid.

### 2.20 DocumentPanel + client-side DOCX round-trip (`shared/Components/Document.tsx:124-358`)
- **What:** Document viewer with modes `HTML | Markdown | DOCX`, Print (blob URL + print CSS + auto `window.print()`), Download (`.html`/`.md`/`.docx`), Close. DOCX mode converts Markdown → `docx.Document` (headings 1–9, bullets, numbered, code, tables, image placeholder `[Image: alt]`, hyperlinks as styled runs), packs to Blob, previews with `DOCX.renderAsync` (docx-preview), and returns the Blob via `ref` for download.
- **Maturity:** partial — `getFileName()` returns `${title}${ext}` with no dot; `lines.shift()` inside `for…of lines` scrambles code blocks; trailing tables never flushed; `numbering` reference undefined; `Object.assign(DOCX.defaultOptions, {debug:true, experimental:true})` mutates library defaults.

### 2.21 Graph (`shared/Components/Graph.tsx`)
- **What:** d3 v7 visualizations: `drawGraphHierarchy` (tree layout, zoom 0.1–4, fit-to-bounds transition, hover highlight of descendants, per-node item boxes, `onNodeClick`) when `data.data` is present; otherwise `drawGraph` (force simulation with link/charge/x/y/center/collide forces, draggable rect/circle nodes with item lists, zoom). Accepts static `GraphData` or an `IReference<GraphData>` for re-render.
- **Used by:** Memory panel graph view (lazily rendered because dimension detection yields NaN when hidden).
- **Maturity:** partial — force-mode edge labels never render (`.filter()` before `.enter()`), hardcoded colors, hover-only interactions.

### 2.22 Data components: Table, Card, Form, List, ListEditor
- `Table({columns?, data: IList, onSelect?})` — rows appended asynchronously; nested objects rendered as `Card`; column inference `Object.keys(data[0])` only works for arrays. Live in FilesHub CSV/JSON previews.
- `List({items: IObservableList}, [template(item, remove)])` — observable list rendering with `--list-index` CSS var and `large`/`empty` classes. Live (conversations, files, memories, pending). Index-based removal drifts because a static `<h6>Empty</h6>` sits among children.
- `Card`, `Form` (two-way binding into a data object from inputs/selects/textareas via `data-name`), `ListEditor` (drag-reorder, up/down, edit/remove) — all use fragments and therefore crash; dead code.
- **Maturity:** partial (Table, List) / stub (Card, Form, ListEditor).

### 2.23 Chrome components: Tabs, Toast, ModalDialog, Tooltip, Menu, Loader, IconButton
- `Tabs({selected?, tabs?: IObservableList<HTMLElement>, onSelect?}, children with data-tab)` — dynamic tab add/remove from an observable list; `<div onclick>` only (no ARIA roles/keyboard). Live (sidebar drawers).
- `ToastHost({timeout=4000, max=4})` — the single `toast` subscriber; `role="status"`, `aria-live="polite"`, `textContent` only, click-to-dismiss, 200 ms `closing` animation; `showToast(message, level)` helper. Solid.
- `ShowModalDialog(title, element, onClose?)` — `<dialog open>` stacked inside a `.modal.open` backdrop; no focus trap/Esc; dead.
- `ShowTooltip(text, element, seconds=2)` — stacking counter drifts; live for input hints.
- `Menu` (passthrough div), `Loader` (spinner div) — dead.
- `IconButton({icon: JSX.SvgImage, label?, title?, onClick?, value?, onToggle?})` — toggle state in `data-value`; toolbar. Partial (no `aria-pressed`, handler can never report false).

### 2.24 Icon system + Disclosure (`shared/Components/Icon.tsx`)
- **What:** Single hand-authored inline-SVG icon set — 42 shapes on a 24×24 grid, stroke-width 2, `currentColor`, round caps; 22 aliases (`mic`→`microphone`, `connect`→`phone`, `x`→`close`, …); unknown names fall back to `help` with `data-icon-requested`. Decorative icons get `aria-hidden`; titled icons get `role="img"` + `<title>`; `focusable="false"`; `spin` class for spinners; the element carries `.svg` markup so it also works as a JSX child. `Disclosure({label, note?, open?, class?, testId?, onToggle?}, children)` → a `<button aria-expanded aria-controls>` + body with `setOpen/isOpen`. Both published on `globalThis` (`Icon`, `Disclosure`, `iconNames`, `hasIcon`).
- **Tests:** `test/unit/icon.test.js` (namespace, a11y semantics, fallback, aliases, sizes, well-formedness, "the set covers every emoji this workspace used as chrome", disclosure state).
- **Maturity:** solid.

### 2.25 Theming and CSS conventions (`shared/Styles/page.css`, `shared/Styles/Components/*.css`, 23 files)
- Palette custom properties on `:root`, light defaults with `body.dark` overrides; `data-theme` on `<html>` driven by `app/Modules/Theme.ts` (`light|dark|system`, persisted as `cloudnine-theme`). A global `[hidden] { display: none !important; }` rule guarantees the attribute, the accessibility tree and the pixels agree (`page.css`, with a long rationale comment). Newer app stylesheets add safe-area insets, 44 px touch targets, `prefers-reduced-motion`, `:focus-visible`.
- **Maturity:** partial (global `button:focus { outline: none }`; several component CSS files hardcode colors or reference undefined variables).

### 2.26 Zero-dependency build system (`tools/build.ts`, `tools/tools.ts` → `build.js`)
- **What:** One committed, deterministic script (`tsc` with `outFile: ../build.js`) that is bundler, asset pipeline, type generator, watcher and dev server.
- **How (key functions):** `execute()`/`runBuild()` (`build.ts:245-336`) — compile `shared/` once, then apps+services in parallel, `generateTypeDeclarations(typesFolder, ...apps)` (concatenate `build/types/**` minus the target app, strip `import`/`export`/`declare`/triple-slash lines, write `<app>/types.d.ts` only when changed; recompile apps if types moved); `combineAndSaveCss`; `combineJs(folder, order?, exclude?)` (`tools.ts:336`) — `getFiles` → `orderFiles` (explicit order wins) → `topologicalSort` (real import graph via `parseImportSpecifiers` + `resolveImport`, DFS, cycles fall back) → strip `import` lines, rewrite `export default` to `const <basename> =`, strip `export `, remove `"use strict";`, truncate at `const onRequest`; `combineAndSaveJs` wraps the final bundle `export default (function(){ … return <main>; }())`; `MINIFYCODE` (Terser: `dead_code`, `drop_console` for client, `mangle.toplevel` with `reserved: [main]`) runs **once in memory** on the finished artifact; `MINIFYCSS` (postcss + autoprefixer + cssnano); `updateImages` generates `$Images` registry (`images.js` + `Images.d.ts`) from `public/Images/*.svg`; `copyPublicFolder`; `imagesFolderName`/`resolveImagesFolder` (case-sensitive filesystems); `removeCompiledOutput` (delete stale `.js/.d.ts` for deleted sources, paths from the project's tsconfig); `runTypeScriptCompile` (resolves the pinned `typescript/bin/tsc`, falls back to shell `tsc`).
- **Watch loop:** `createWatcher` (chokidar on `add`, `change`, `unlink`; polling only for `public/`) + `createTaskQueue(name, action, delay=150)` (coalesce bursts into one trailing run and never overlap runs of the same task) + `writeFileIfChanged` (no-op writes don't wake downstream watchers).
- **Tests:** `test/unit/build-tools.test.js` (import forms parsed, topo sort order/cycles, `combineJs` stripping, "a release bundle is written once, already wrapped and minified", "the real server bundle loads as an ES module, with no name declared twice", config creation/migration, task queue coalescing and non-overlap, `writeFileIfChanged`, stale output removal, `config.example.json` documents every provider key).
- **Maturity:** solid (with heuristic string surgery risk).

### 2.27 Config bootstrap & migration (`tools/build.ts:32-128`)
- `ensureConfigFile` creates `config.json` from `config.example.json` on first run; `migrateConfigFile` adds keys the example gained (empty), refreshes `_comment*` documentation keys, never touches set values, keeps keys the example dropped (at the end), and leaves unparseable files alone. `describeConfig` prints which **key names** are set (never values). `--config <path>` overrides.
- **Maturity:** solid.

### 2.28 Cloudflare Pages worker bundling (`tools/tools.ts:389-417`)
- `combineAndSaveWorker` concatenates compiled `build/server/**` handlers (module syntax stripped, `_worker.js` excluded) and appends `_worker.js` with its `export default` intact → `build/public/_worker.js` (Pages advanced mode). Release: Terser with `module: true`, console kept (the Worker's only observability). Compiled server code stays in `build/server/` outside the published tree.
- **Maturity:** solid.

### 2.29 Dev server with Cloudflare emulation (`tools/serve.ts:148-640`)
- **What:** Node `http` server that serves `build/public` from memory and runs the **same compiled handlers and guard** the Worker runs.
- **How:** `reloadApi()` concatenates server JS into `build/dev-api.js`, exports every top-level function name via `module.exports[...]` guarded by try/catch (413 exports in the current file), clears `require.cache` for hot reload, but only file-name-matched handlers are HTTP-routable (`routable` set) — mirrors the production allowlist. API dispatch: `routeApiEndpoint(path)` + `endpointPolicy(name)` (body cap, sub-resource depth) + `guardApiRequest(request, env, endpoint)` from `server/lib/security.ts`. KV shim `envParams {get, put(expirationTtl), delete, list}`: reads `data/kv-dev.json` then falls back to `config.json` (re-read, 1 s cache); writes go to `data/kv-dev.json`. `readRequestBody(req, maxBytes)` drains over-cap bodies (32 MB / 5 s budget) so clients get a typed `413 payload_too_large` instead of ECONNRESET. `socketAddressOf(req)` attaches a non-enumerable `socketAddress` (strip `::ffff:`, default `'unknown'`) so `isLocalRequest` can't be fooled by the synthesized `http://localhost` URL. SSE responses are piped incrementally with backpressure (`drain`). Binds `127.0.0.1` unless `HOST` is set; `PORT` overrides 8080. Non-API requests are rejected with 400 unless the Referer contains `localhost` or is absent (why the README says use `localhost`, not `127.0.0.1`). Static MIME map; `index.html` read from disk per request.
- **Maturity:** solid.

### 2.30 stdio MCP host bridge (`tools/serve.ts:13-134`)
- **What:** `createMcpHost(root)` publishes `globalThis.MCP_HOST = {stdio: true, request(id, config, message, timeoutMs=30000), close, closeAll, readConfig, writeConfig}`. Spawns `config.command args` with merged env, newline-delimited JSON-RPC framing, request/response correlation by `id`, notifications (no id) fire-and-forget, process replaced when the command fingerprint changes, last 2000 chars of stderr kept for error messages, children killed on server close. Server list lives in `data/mcp-servers.json` locally. A deployed Worker has no `MCP_HOST`, which is how stdio reports itself as local-only.
- **Maturity:** solid (P10 relevance; detailed MCP client is another slice).

### 2.31 Build identity, staleness detection and release takeover
- `sourceFingerprint(root)` — sha1 over `path:size:mtime` of every `.ts/.tsx/.css/.html/.svg/.json` under shared/input/persona/app/server/public/tools (excluding generated `types.d.ts`); `bundleFingerprint(entries)` — sha1 of `/js/app.js` + `/css/styles.css` as held in memory vs on disk; `writeBuildInfo(root, buildFolder, 'dev'|'release')` writes `build/build-info.json {mode, buildId, sourceFiles, builtAt, pid, root}` **last**.
- `GET /__dev/build-info` (dev only) → `{server:'oncloudnine-dev-server', pid, port, root, startedAt, mode, buildId, builtAt, sourceId, sourceFiles, servedId, diskId, restoring, stale:{sources, assets}}`.
- Release takeover: a 2 s poll (`DEV_RELEASE_POLL_MS`) notices a `mode:'release'` marker from another pid, warns, and calls `restoreDevBuild()` → `runBuild()` again.
- E2E guard `test/e2e/support/dev-server-guard.mjs`: `evaluateDevServer(status)` rejects a foreign server name, a different checkout root, release mode, restoring, stale sources, stale assets; `assertFreshDevServer` throws with the pid and `lsof -ti tcp:<port> | xargs kill`. Playwright `reuseExistingServer` is off unless `E2E_REUSE_SERVER=1`; `E2E_PORT`, `E2E_BASE_URL` supported.
- **Tests:** `test/unit/dev-server-harness.test.js` ("the guard rejects every shape a stale server comes in", "a server whose watcher missed a rebuild is reported as stale, not trusted", "a release publish under a running dev server is detected and the dev bundle restored").
- **Maturity:** solid.

### 2.32 Deployment preflight (`tools/deploy.ts`)
- **What:** `node build.js --check-deploy` runs `checkDeployment(root)` → 13 checks, any failure exits non-zero and `npm run deploy` stops before `wrangler pages deploy`.
- **Checks:** wrangler.toml exists; `name`; `compatibility_date`; `pages_build_output_dir` exists; `[[kv_namespaces]]` binding `KV` with a non-placeholder id (`isPlaceholderId` rejects `<…>`, `TODO`, `changeme`, `your-kv…`); `_worker.js` at deploy root with `export default`; `_worker.js` parses (`node --check` on a `.mjs` copy); `index.html` + `js/app.js` present; bundle parses; `build-info.json` mode is `release`; no compiled `server|services|api/` JS in the public tree; **no `config.json` value (≥ 8 chars) appears in any published text file** (`.js .mjs .css .html .json .txt .map`); `APP_SESSION_SECRET` configured (warning only). `parseWranglerToml` is a tiny TOML reader that ignores commented lines ("a commented binding is not a binding").
- **Tests:** `test/unit/deploy-check.test.js` (commented-out KV fails with fix commands, placeholder id fails, unparsable worker fails "however complete it looks", leaked config value fails, a development bundle fails even when everything else passes, missing session secret warns without blocking, `npm run deploy runs the preflight before wrangler`).
- **Maturity:** solid. Note the repo's `wrangler.toml` ships with the KV block commented out (`compatibility_date = "2024-07-01"`), so the preflight fails on a fresh clone by design.

### 2.33 Unit-test harness pattern for global-script TS
- Each test compiles a single shared `.ts` file with the pinned `tsc` into a temp dir using the project's compiler options, then evaluates it with `new Function('globalThis', compiled + 'return {...}')` against stubbed globals or a hand-built fake DOM (see `test/unit/context-bus.test.js:14-35`, `element-children.test.js`). Doc-sync tests assert that code contracts and architecture docs agree. README claims 852 node:test unit+contract tests and 163 Playwright specs across 20 files (the build doc still says 460/112 — drift). Contract tests need a live Ollama; no test exercises a paid key.
- **Maturity:** solid.

### 2.34 Knowledge-graph memory package (pointer only)
- `shared/Modules/Memory/{MemoryStore (IndexedDB 'c9ai-memory' v1: entities, relations, chunks), FtsIndex (BM25 k1=1.2, b=0.75), VectorIndex (/api/embeddings, batch 64), MemoryRecall (RRF hybrid recall → visible 'memory' ContextCard; setting key 'cloudnine-memory-enabled'), GraphExtractor (/api/extractMemory, listens to context:add)}` — lives in shared/ but is reviewed in a separate slice. Relevant here because it is the main consumer of embeddings and a producer of context cards.

### 2.35 README capability tables (complete, restated)
The README asserts every row is implemented and test-covered; features needing a key hide their affordance when unconfigured.

**Chat**
| Capability | Requirement |
|---|---|
| Streamed replies with sanitized markdown, code blocks, tool steps, copy | any one provider |
| Server-side tool orchestration (inline tools + background generation tasks) | a provider with tool use |
| Admin defaults for provider, model, global system prompt (`/admin.html`) | operator; writes need local access or `ADMIN_SECRET` |
| Conversations create/switch/rename/delete, persisted in IndexedDB | none |
| Message actions: copy, speak, regenerate, delete | speak: OpenAI or xAI key, else browser speech synthesis |
| Pending tray for background image/video/app/document/agent work | none |
| Mobile-first layout: drawers < 600 px, safe-area insets, 44 px targets, light/dark/system theme | none |

**Context**
| Capability | Requirement |
|---|---|
| Drag/drop/paste/pick files: DOCX, XLSX, PDF, CSV/TSV, JSON, XML, HTML, Markdown, text (PDF/DOCX/XLSX parsed client-side) | none |
| Images as vision blocks | a provider whose model advertises `vision` (Anthropic, OpenAI, xAI) |
| Audio files transcribed on upload | OpenAI key |
| Local folder context: pick folder, ignore rules, per-file toggles, re-scan diff, persisted handles | none |
| Camera and screen snapshots on an interval, each described into the conversation | a vision provider |
| Microphone segments transcribed | OpenAI key |
| Dictation into the composer | OpenAI or xAI for provider transcription; browser speech recognition fallback (Chrome/Safari) |

**Memory, agents and tools**
| Capability | Requirement |
|---|---|
| Knowledge-graph memory in IndexedDB: entities, relations, embedded chunks | any provider for extraction |
| Hybrid recall (BM25 + vector cosine, reciprocal-rank fusion) injected as a visible, removable context card | Ollama `nomic-embed-text` or OpenAI key for embeddings |
| Memory browser: search, edit, delete, d3 graph, "memory used" disclosure, recall toggle | none |
| Agent runs with live step timeline, tool events, artifacts, guardrails, cancel | a provider with tool use |
| MCP servers: `http`/`sse` anywhere, `stdio` in local development | none |
| Files hub: uploads, captures, generated files, deliverables, with preview/download/zip | none |

**Media, search and voice**
| Capability | Requirement |
|---|---|
| Image generation (`/image`) | OpenAI or xAI key |
| Video generation as a polled job (`/video`) | xAI key |
| Web search with citation cards (`/search` or toggle) | Anthropic or xAI key |
| Realtime WebRTC voice with live transcript, barge-in, five tools | OpenAI key |
| Spoken replies for text chat | OpenAI or xAI key, else browser speech synthesis |
| Animated persona avatar with viseme lip-sync, editable by the model | none |

**Configuration keys** (names from `config.example.json`): `OPENAI_API_KEY`, `OPENAI_ORGANIZATION_ID`, `OPENAI_API_URL`, `OPENAI_MODEL`, `OPENAI_MODEL_RT`, `OPENAI_IMAGE_MODEL`, `OPENAI_INSTRUCTIONS`, `OPENAI_MAX_TOKENS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_API_URL`, `ANTHROPIC_MODEL`, `XAI_API_KEY`, `XAI_API_URL`, `XAI_MODEL`, `XAI_MODEL_RT`, `XAI_IMAGE_MODEL`, `XAI_VIDEO_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `DEFAULT_PROVIDER`, `DEFAULT_MODEL`, `SYSTEM_PROMPT`, `ADMIN_SECRET`, `APP_SESSION_SECRET`, `ALLOWED_ORIGINS`, `API_RATE_LIMIT`, `AGENT_MAX_STEPS`, `AGENT_FETCH_ALLOWLIST`, `TASK_MAX_CONCURRENT`, `TASK_MAX_WALL_CLOCK_MS`, `TASK_RETENTION_MS`, `TASK_BACKGROUND_TOOLS` (plus `MCP_SERVERS` documented in README for deployments).

**npm scripts** (`package.json`): `build` (`cd ./tools && tsc`), `start`/`dev` (`node ./build.js --main renderWorkspaceView --apps input,persona,app --services server`), `publish` (same + `--release`), `deploy:kv`, `deploy:check`, `deploy:local` (`wrangler pages dev ./build/public --kv KV --port 8788`), `deploy` (build → publish → check → `wrangler pages deploy`), `test`, `test:e2e`. Dev deps only: `typescript ~5.5.4`, `terser`, `postcss`, `cssnano`, `autoprefixer`, `chokidar`, `wrangler ^4.118.0`, `@playwright/test`, `@cloudflare/workers-types`, `@types/node`; `overrides` pin `undici ^7.29.0`, `nanoid ^3.3.18` for advisories.

---

## 3. Providers, models & external APIs

### Client-facing endpoints called from shared/
| Endpoint | Caller | Request | Response |
|---|---|---|---|
| `POST /api/session` | `ApiSession.request()` | none (Origin header) | `{token, expiresAt}` (ttl default 600 000 ms client-side) |
| all `/api/*` | `apiFetch` | header `X-Session-Token` | typed error envelope `{error:{message, code}}`; 401 → one refresh + retry |
| `POST /api/chat` | `TextCompletionService` | `{provider?, model?, messages:[{role,content}], system, maxTokens≤4096, stream}` | JSON `{message:{role,content}, usage, model, provider}` or SSE `data:{"type":"delta","text"}` / `{"type":"done",…}` / `{"type":"error","message"}` / `[DONE]` |
| `POST /api/embeddings` | `TextEmbeddingService`, `VectorIndex` | `{texts[], provider?}` (server also accepts bare array or `input`) | `{embeddings:[[…]], model, provider}`; ≤128 texts, ≤32 000 chars each |
| `POST /api/describeImage` | `ImageDescriptionService` | `{provider?, image_url (data:image/* or http[s]), text, max_tokens}` | `text/plain`, header `X-Provider` |
| `POST /api/search` | `SearchService` | `{query, provider?, model?, maxResults?, system?, messages?}` | `{answer, citations[{title,url,snippet,source}], query, provider, model, usage}` |
| `POST /api/speech` | `SpeechOutput` | `{text ≤4000, voice}` (server also takes `provider`) | `audio/mpeg`, headers `X-Speech-Voice`, `X-Speech-Provider`; 503 `not_configured` is a normal keyless state |
| `GET /api/models` | consumers of `SearchService.available` | — | providers with `configured` + `models[].capabilities` |
| `GET /__dev/build-info` | E2E guard | — | dev-only status JSON (§2.31) |

### Models these endpoints resolve to (from `server/providers/registry.ts`, the single model registry)
| Provider | Base URL | Model ids and capability flags |
|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1` | `claude-opus-5` [chat, streaming, vision, tools, search]; search tool `web_search_20260209` |
| `openai` | `https://api.openai.com/v1` | `gpt-5.2` [chat, streaming, vision, tools]; `text-embedding-3-large` [embeddings]; `gpt-4o-mini-transcribe` [transcription]; `gpt-4o-mini-tts` [speech]; `gpt-image-1` [image] (legacy `dall-e-3`, `dall-e-2` only if pinned); `gpt-realtime-2` [realtime] |
| `xai` | `https://api.x.ai/v1` | `grok-4.5`, `grok-4.3` [chat, streaming, vision, tools, search]; `grok-imagine-image`, `grok-imagine-image-quality` [image]; `grok-imagine-video-1.5`, `grok-imagine-video` [video]; `grok-stt` [transcription], `grok-tts` [speech] (advertise-only ids — xAI audio endpoints take no model); `grok-voice-latest` [realtime]; search tool `web_search` (Responses API) |
| `ollama` (devOnly) | `http://localhost:11434` + `/v1` | `qwen3:32b` [chat, streaming, tools]; `nomic-embed-text` [embeddings] |

Provider preference orders: chat `anthropic → openai → xai → ollama`; embeddings `ollama → openai`; vision `anthropic → openai → xai`; transcription and speech `openai → xai`; image `openai → xai`; video `xai`; search `anthropic → xai`. `DEFAULT_PROVIDER` moves a provider to the front.

### TTS voices
OpenAI (8): alloy, ash, ballad, coral, echo, sage, shimmer, verse — default `echo`. xAI (26): altair, ara, atlas, carina, castor, celeste, cosmo, eve, helios, helix, iris, kepler, leo, lumen, luna, lux, naksh, orion, perseus, rex, rigel, sal, sirius, ursa, zagan, zenith — default `eve`. The server substitutes the resolved provider's default for a voice from the other catalogue; an unknown name is a 400.

### Browser APIs used by the core
IndexedDB, CacheStorage (`caches`), `crypto.subtle.digest('SHA-256')`, `crypto.randomUUID`, `speechSynthesis` / `SpeechSynthesisUtterance`, `HTMLMediaElement.captureStream()` / `mozCaptureStream()`, `AudioContext` (`createMediaElementSource`, `createMediaStreamDestination`, `AnalyserNode` in persona), Clipboard API with `execCommand` fallback, `<template>` for inert parsing, sandboxed `<iframe srcdoc>`, `URL.createObjectURL`.

### Vendored libraries (`public/js/`, loaded as globals by `public/index.html` in a load-order-sensitive chain)
`jszip.min.js` (JSZip) → `docx-preview.js` (captured as `window.DOCX`) → `docx.min.js` (generator, `docx`) → `d3.v7.min.js` → module script defining lazy `window.loadPDF` (pdf.js + worker) → `images.js` (`$Images`) → `import start from './js/app.js'; start(document.body)`.

### Cloudflare
Pages advanced mode (`build/public/_worker.js`), KV namespace bound as `KV` (provider keys, session secret, MCP list), `wrangler pages deploy`, `wrangler pages dev ./build/public --kv KV --port 8788` for the real workerd runtime. No Durable Objects, D1 or R2 in this project.

---

## 4. Data model & persistence

| Store | Tech | Name / key | Record shape |
|---|---|---|---|
| Conversations | IndexedDB | DB `cloudnine` v1, store `conversations` (keyPath `id`, index `updated`) | `Conversation {id, title, created, updated, system?, provider?, model?, messages: ChatMessage[]}` (see §2.8) |
| Settings | IndexedDB | DB `cloudnine`, store `settings` (keyPath `key`) | `{key, value}` — per-conversation extras such as generated media records and search citations |
| Memory | IndexedDB | DB `c9ai-memory` v1: `entities`, `relations`, `chunks` | other slice |
| Uploaded context | CacheStorage | bucket `context-files`, names `file-<base36 ts>-<seq>-<slug>` | ContextCard JSON body + `x-file-*` headers |
| Folder context | CacheStorage | bucket `folder-files`, ids `folder-<base36 ts>-…` | ContextCard JSON |
| Generated artifacts | CacheStorage | bucket `assistant-files` | raw Blob (image/video/html/md), `Content-Type` + `x-file-*` headers |
| Hub archive | CacheStorage | bucket `library-files`, key `library-files/<cardId>.json` | normalized ContextCard JSON + `x-file-title/kind/updated/conversation…` |
| ECS state | IFileStore | `<name>-ecs-state.json` (save) / `<name>ecs-state.json` (load — bug) | `{entities:[{id, components:[{type: ctor name, data}]}]}` |
| Speech clips | memory | `Map<sha256(voice\ntext), objectURL>`, LRU 24 | object URLs revoked on eviction |
| Session token | memory + DOM | `window.APP_SESSION_TOKEN`, `meta[name=session-token]`, `meta[name=app-session-token]` | string |
| Theme / persona settings | localStorage | `cloudnine-theme`, persona settings | — |
| Dev KV | file | `data/kv-dev.json` | `{[key]: {value: string, expires: number|null}}` (not opened) |
| MCP servers (dev) | file | `data/mcp-servers.json` | server list incl. stdio command lines |
| Build identity | file | `build/build-info.json` | `{mode:'dev'|'release', buildId, sourceFiles, builtAt, pid, root}` |

Storage caveats: CacheStorage and `crypto.subtle` require a secure context (localhost/HTTPS); CacheStorage is evictable and `persist()` is never requested; "clear my data" must know about two IndexedDB databases and four buckets; nothing is stored server-side (no user store at all).

---

## 5. UX details worth keeping

- **Visible, removable context.** Every piece of context (file, capture, recalled memory) appears as a chip before sending and rides on the sent message as an attachment chip — including recalled memories, which the code comments frame as "instead of an invisible prompt injection". Cards are consumed by the message like mail attachments.
- **Progressive enrichment in place.** A camera frame appears immediately with a placeholder and is silently upgraded when the vision description returns (same id), without a new chip.
- **Transcripts don't auto-send.** Final transcripts land in the composer for editing; auto-sending would fire a request per silent capture segment.
- **Human-readable tool steps.** `ChatToolStep.summary` ("Searched the web") in the transcript; raw `detail` only inside a closed disclosure.
- **Speak affordance states.** The speak button spins during synthesis (`loading`) and closes on any outcome (played, fell back, refused, stopped); a badge reads "Speaking (server voice)" or "(browser voice)". Tapping the avatar emits `tts:stop` (barge-in). Realtime sessions suspend the fallback voice so two voices never overlap.
- **Lip sync follows audio, not text.** The mouth reads the clip's MediaStream envelope; text-timed visemes are only the fallback when there is no stream (browser synthesis).
- **Capability-hidden affordances.** Features without a configured provider hide their controls (search toggle from `/api/models`) rather than error after a click.
- **Toasts.** Bottom stack, max 4, 4 s, click to dismiss, polite live region, text-only.
- **Generated apps are pages.** HTML artifacts render in a sandboxed iframe with a "View source / View page" toggle.
- **Markdown ergonomics.** Code blocks with a language label and Copy → Copied/Failed feedback; unterminated fences render as code while streaming; `aido:<text>` links become one-click "send this" suggestions.
- **Files hub.** Unified list across all buckets, decoded display names, "N files · M selected" count derived from the same records as the list, zip export with de-duplicated names, per-record preview renderer chosen by MIME/extension.
- **Accessible chrome.** Inline SVG icons in `currentColor` (no emoji), `aria-hidden` decoration vs titled icons, Disclosure with `aria-expanded`, `[hidden]` guaranteed by a global `!important` rule, 44 px targets, reduced-motion gating of decorative face animation (lip sync stays on).
- **Screenshot (`docs/img/workspace.png`).** Dark theme; header with hamburger, "Cloud Nine AI" title and a blue "Connect" dot (realtime voice); a welcome bubble; a large illustrated 2D avatar (bust with blazer) centered; bottom bar with **Show** (camera), **Talk** (mic), **Share** (screen) buttons, the message composer with a send glyph, and a wand/"…" menu — the avatar is the visual center of the product, with capture modes as first-class verbs.

---

## 6. Patterns worth reusing (and how to lift them)

1. **Typed event-map bus with declaration merging, count-returning `emit`, and a doc-sync test** (`shared/Modules/ContextBus.ts`, `app/Modules/TaskRegistry.ts:113`, `test/unit/context-bus.test.js:150`). *Lift:* make it the Agent Workplace's client "workspace bus", but namespace events (`agent:*`, `project:*`, `meeting:*`, `run:*`, `context:*`, `speech:*`), add async request/ack variants, bridge to other tabs with `BroadcastChannel`, and mirror a subset to the server via a Durable Object WebSocket so the user can observe agent-to-agent traffic live. Keep the "emit returns handler count → local fallback" idiom and the doc-sync test for the event registry.

2. **ContextCard as the universal context unit, with upsert-by-id and consume-on-send** (`ContextBus.ts:1-11`, `ChatViewModel.ts:335-445`, `CaptureContextPublisher.ts:103-170`). *Lift:* generalize to a `ContextItem {id, kind: file|capture|memory|business|connector|artifact|kpi, title, content, mime, tokens, preview, dataUrl, vision, provenance, scope: user|project|agent, ttl}`. Every agent turn declares which items it consumed; the UI shows them as chips per agent message so the owner sees exactly what business context each coworker used. Progressive enrichment (publish immediately, re-publish with same id when described/embedded) maps naturally onto file ingestion pipelines.

3. **SpeechOutput's state machine** (`SpeechOutput.ts:240-537`): generation counter against stale results, `loading` window announced at both ends, never-throwing `speak()` that reports which source spoke, separate user-enabled vs system-suspended flags, injected dependencies. *Lift:* instantiate **one SpeechOutput per agent** (voice + provider per persona) instead of a singleton, and add a meeting-level "floor" arbiter that queues speakers so several avatars can talk in turn while the owner listens in. Add sentence-level chunking with pipelined fetches (first sentence plays while the rest synthesize) to remove the 4000-char truncation and cut time-to-first-audio.

4. **Audio-stream tap for lip sync** (`captureTap`, `SpeechOutput.ts:432-455`; `MouthSystem.startSpeakingFromAudio` in `persona/Modules/FaceAnimation.ts`). *Lift:* the exact order (captureStream first; AudioContext tap only when `running`; fail soft to text visemes) is the right default for any avatar renderer, including a future 3D/WebGL head: publish `{agentId, stream}` on the bus and let each avatar component attach an AnalyserNode.

5. **ECS for avatar animation with reduced-motion gating** (`shared/Modules/ECS.ts`, `FaceAnimation.ts`). *Lift:* one entity per avatar, systems for blink/gaze/brows/mouth/expression, transient "shape" components consumed each tick. Fix save/load naming, index components by type, and drive all avatars from one rAF loop.

6. **Capability-gated UI from a model registry** (`SearchService.available/providerFor`, `server/providers/registry.ts` capability flags). *Lift:* the workplace's model registry exposes `capabilities[]` per model (chat, vision, tools, search, embeddings, speech, transcription, realtime, image, video) and every affordance (persona voice picker, "generate video" step in a plan) is enabled from that list.

7. **Session-token client with one-shot 401 refresh and typed error envelope** (`ApiSession.ts`). *Lift:* same pattern for the Worker API; extend with per-project scopes and tie tokens to Durable Object sessions.

8. **Artifact storage with metadata in Response headers + unified library + zip export** (`FileStore.ts`). *Lift:* as the local cache layer in front of R2: each artifact keeps `{title, kind, projectId, agentId, runId, updated, source}`; the library view de-dupes by id; project export = zip. Reuse `decodeStoredText`, `safeArchivePath`, `uniqueArchiveNames`, `storedPreviewKind` verbatim.

9. **Allowlist DOM sanitizer + sandboxed HTML preview** (`Markdown.tsx:104-150,450-460`; `Document.tsx:38-51`). *Lift:* mandatory for rendering any agent output; `allow-scripts` without `allow-same-origin` for agent-generated mini-apps.

10. **`aido:` deep links as suggested actions** (`Markdown.tsx:413-416`). *Lift:* let agents emit `action:` links ("Approve plan", "Ask Finance agent") that render as buttons and publish a bus command instead of free text.

11. **Human-summarized tool steps + artifact/taskId on messages** (`ChatToolStep`, `ChatArtifact`, `taskId`). *Lift:* the agent activity timeline for each coworker; background runs deliver artifacts back to the conversation/project they came from.

12. **Zero-dependency build + deploy preflight + fingerprinted dev server** (`tools/*.ts`). *Lift selectively:* the preflight's leaked-secret scan, parse check of the emitted worker, and release-marker check are worth copying into any Cloudflare deploy script; the `/__dev/build-info` fingerprint + E2E guard prevents testing orphaned servers; `createTaskQueue` + `writeFileIfChanged` are good watch-loop hygiene. The custom concatenating bundler itself is **not** worth copying (see §7).

13. **Dev server sharing the production guard** (`serve.ts:505-619`): same `routeApiEndpoint` + `guardApiRequest`, KV shim reading config, socket-address-based locality, over-cap body draining, loopback bind by default. *Lift:* for a local bridge that fronts the Cloudflare API during development.

14. **Config bootstrap/migration from an example file** (`build.ts:32-128`). *Lift:* first-run onboarding for self-hosted installs; never prints values.

15. **Test pattern for global-script modules + injectable deps + doc-sync tests** (`test/unit/*.test.js`). *Lift:* keep contracts (event registry, voice catalogues, model registry) mechanically in sync with docs.

---

## 7. Gaps, debt & risks

**Core runtime**
- `shared/element.ts`: fragments crash (`Card`, `Form`, `ListEditor` unusable); `false` props become attributes; `if` requires literal `true`; no unmount lifecycle (listeners/closures leak on `innerHTML = ''` re-render); `$event.notify` sets state after awaiting handlers; `$reference` fires on `setTimeout(0)`. A JSX runtime without keyed reconciliation will struggle with a live multi-agent dashboard (many streaming panes).
- `ContextBus`: synchronous, fire-and-forget (no async ack/backpressure), no runtime payload validation at the `globalThis` boundary, flat global namespace, single-tab/single-user. Latent edge case: `emit` returns `handlers.length` read **after** dispatch (`ContextBus.ts:81`), so an event whose only subscriber was registered with `once` returns 0 and would trigger a caller's fallback (e.g., a double send via `ChatComposer.tsx:91`) — plausible, not observed in shipped wiring.
- Two event systems (`EventManager` vs `ContextBus`) with opposite semantics.
- `ECS.ts:147/151` save/load key mismatch; linear lookups; `runDelayed` uncancellable; `loadState` pushes entities into the old array during mapping.
- `ObservableList` unawaited load and stray `console.log`.

**Persistence**
- `ConversationStore.save` rewrites the full conversation (JSON clone) on each save — O(n) per streamed update; one flat conversation model with no projects, agents, threads, or participants; schema v1 with no migration ladder.
- `FileStore.fetch` prefixes `/` while `has/storeFile/removeFile` don't (breaks under a subpath); CacheStorage evictable; no quota handling.
- Everything is per-browser-profile: no sync, no sharing, no server-side user store — incompatible as-is with multi-device or team features.

**Speech**
- No TTS chunking: text is truncated at 4000 chars (`SpeechOutput.ts:247`); no streaming TTS; single global voice; browser fallback ignores the chosen voice; utterance has no `onerror` (a synthesiser error can leave `speaking` true until `stop()`); `X-Speech-Voice` never read despite the server comment that the picker can correct itself; in-memory cache only; mp3 only.
- `ISpeechGenerationService` / `ISpeechTranscriptionService` declared but unimplemented.

**Connectors**
- `TextCompletionService` and `TextEmbeddingService` have no app consumers (duplicated by `ChatClient` and `VectorIndex`); completion flattens messages to text, maps `system` role to `user`, caps at 4096 tokens, and ignores its `connector` label; `ConnectorType = 'openai' | 'claude'` is vestigial.

**Components**
- `Document.tsx`: file name missing the dot, `lines.shift()` inside `for…of`, trailing tables dropped, undefined numbering config, fractional bullet levels, global docx-preview defaults mutated with `debug: true`.
- `Graph.tsx`: force-mode edge labels never render; hardcoded colors; touch-unfriendly hover interactions; NaN sizes when hidden.
- `Tabs` lacks ARIA roles/keyboard; `ModalDialog` has no focus trap/Esc and backdrop close skips `onClose`; `Tooltip` stack counter never resets; `List` index drift from the static "Empty" node; `Table` column inference throws for non-arrays; `IconButton` toggle can't report false and has no `aria-pressed`.
- Global `button:focus { outline: none }` in `page.css`; several component CSS files hardcode colors or reference undefined variables.
- `public/index.html` global load order is fragile (DOCX/docx shadowing), no SRI.

**Build/deploy**
- `combineJs` is regex string surgery (truncates at `const onRequest`, only first `"use strict"`, misses multiline/aliased exports); everything lands in one scope, so duplicate top-level names break the worker (mitigated by the "no name declared twice" test).
- `tsc --outFile` concatenation depends on cross-file hoisting (TDZ risk).
- Generated `types.d.ts` live in the source tree.
- The dev server re-implements body reading/response writing (second request path).
- Dev server rejects static requests whose Referer lacks `localhost` (why `127.0.0.1` fails).
- `npm run publish` shadows npm's built-in `publish`.
- Deploy target is Pages + KV only; no Durable Objects/D1/R2 patterns to borrow.

**Documentation drift (verified against code)**
- Docs say `GET /api/session`; code POSTs.
- Build doc test counts (460 unit / 112 e2e) vs README (852 / 163).
- UI doc says `removeMarkdown()` renders and extracts `innerText` and that indented code blocks are extracted; code is regex-based and handles fenced code only.
- Build doc says `runTypeScriptCompile` spawns bare `tsc`; code resolves the pinned `typescript/bin/tsc` first. It says watchers poll across a dozen trees; only the `public/` watcher polls. It says `MINIFYCSS` omits `from/to`; the code passes both. It says `package.json` `"main": "app.js"`; it is `build.js`.

**Risk statement from the README itself:** only Ollama is exercised by live contract tests; the Anthropic/OpenAI/xAI paths are mock-tested only ("nothing … has ever been run against a paid key").

---

## 8. Relevance to the Agent Workplace

| Pillar | What this slice offers | Verdict |
|---|---|---|
| **P1 Lead orchestrator** | `ChatViewModel`'s send path (context cards → recall → attachments → run) and the `chat:send` bus command with count fallback; `ChatToolStep`/`ChatArtifact`/`taskId` on messages. | **Adapt** the send-path structure for the chief-of-staff: assemble context items, recall memory as a visible card, then dispatch. Replace the single chat with a lead thread that owns sub-threads. |
| **P2 Personas** | Voice catalogues per provider (`voicesFor`, defaults), `SpeechOutput.setVoice`; persona settings in localStorage (other slice). | **Adopt** the per-provider voice catalogue + drift test; **adapt** to per-persona voice/provider records stored server-side. |
| **P3 Interactive avatars** | `SpeechOutputState.stream` tap; `ECS` + `FaceAnimation` systems; audio-envelope mouth shapes; reduced-motion gating; barge-in via `tts:stop`. | **Adopt** the stream-tap and envelope lip-sync approach; **adapt** ECS to many avatars with one loop and per-agent speech instances; add a speaking-floor arbiter for "listen while they talk". |
| **P4 Workflow orchestration** | Only indirectly: `task:changed` bus event from `TaskRegistry` (other slice); `createTaskQueue` coalescing (build-time). | **Avoid** relying on this slice for orchestration; borrow the event shape `{task, reason: added|updated|removed}` for run/step updates. |
| **P5 Intra-agent communication** | `ContextBus` typed pub/sub; declaration-merge extension; handler isolation; doc-sync test. | **Adapt**: namespaced, async-ack, cross-tab + server-mirrored bus so the owner can observe/join agent channels. **Avoid** a global singleton as the only transport. |
| **P6 Projects with plans** | `Conversation`/`ChatMessage` schema; FileLibrary with conversation scoping (`x-file-conversation`), dedupe, zip export. | **Adapt**: add `projectId`/`agentId`/`runId` to message and artifact metadata; project export = zip. |
| **P7 LLM providers** | Connector services, SSE parser, capability-gated `SearchService`, registry-resolved endpoints with exact model ids and provider orders. | **Adopt** the SSE parser and capability gating; **adapt** connectors to carry multimodal blocks and agent labels. Registry lives in `server/` (other slice). |
| **P8 Multimodal** | TTS (`/api/speech`, browser fallback), vision description (`/api/describeImage`), embeddings (`/api/embeddings`), capture→context flow, Markdown/DOCX/HTML rendering. | **Adopt** fallbacks and the progressive-enrichment pattern; **add** chunked/streaming TTS and per-agent voices. |
| **P9 Context & memory** | ContextCard contract and lifecycle (the backbone for "contextual business information"); memory recall as a visible card; embeddings client. | **Adopt** ContextCard (extended with provenance/scope); make business context a first-class `kind`. Memory internals: other slice. |
| **P10 Tools/MCP/in-app apps** | stdio MCP host bridge on the dev server; sandboxed HTML preview for generated apps; `aido:` action links. | **Adopt** the sandbox rule and action links; **adapt** the stdio bridge into the local bridge process. |
| **P11 Navigation & UX** | Visible context chips, human tool summaries, capability-hidden affordances, toasts, Icon/Disclosure a11y, mobile-first CSS conventions, avatar-centered layout. | **Adopt** the UX conventions and icon set approach; **avoid** the component library's broken pieces (Tabs a11y, ModalDialog, Card/Form). |
| **P12 Trust & governance** | Session tokens + 401 refresh; sanitizer; iframe sandbox; loopback-only dev server; socket-address locality; body caps; deploy preflight secret-leak scan; config migration that never prints values. | **Adopt** all of these as baseline hygiene. |
| **P13 Business features** | Config bootstrap/onboarding; files hub export; admin defaults (other slice). | **Adapt** first-run config flow for self-hosters. Little else here. |
| **P14 Infrastructure** | Zero-dep build, Pages advanced-mode worker bundling, KV shim, `/__dev/build-info` fingerprinting + E2E guard, 13-check deploy preflight, test harness for global-script TS. | **Adopt** preflight, fingerprint guard, KV-shim idea, test-harness style. **Avoid** the regex concatenation bundler and the global-script architecture for a larger multi-agent codebase; use a real bundler (esbuild/Vite) with Workers + Durable Objects/D1/R2, which this project does not use. |

**Bottom line.** The shared core's most valuable exports for the Agent Workplace are *contracts and behaviors*, not code: the ContextCard lifecycle over a typed bus (the model for business context flowing into agent turns), SpeechOutput's robust state machine and audio-stream tap (the model for avatars that speak with lip sync while the owner listens), capability-gated UI, the sanitizer/sandbox rules, and the deploy/dev-server safety rails. The JSX runtime, component library and concatenating build system are clever and well-commented but carry known defects and would not scale to a multi-agent, multi-pane, multi-device product without replacement.
