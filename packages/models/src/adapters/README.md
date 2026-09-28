# adapters

One file per provider, each exporting a `ProviderFactory` registered in `DEFAULT_FACTORIES` (`../registry.ts`):

| File | Dialect | Capabilities |
|---|---|---|
| `anthropic.ts` | Messages API (`tool_use`), adaptive thinking (signatures replayed across tool rounds), `output_config` | chat |
| `openai.ts` | Responses API (`function_call`) via `responses.ts`; `/audio/speech` (gpt-4o-mini-tts), `/audio/transcriptions` (gpt-4o-transcribe → whisper-1), `/images` (gpt-image-2), `/embeddings` | chat, tts, stt, image, embeddings |
| `xai.ts` | Responses API via `responses.ts`; `POST /v1/tts` (mp3, `with_timestamps`), `POST /v1/stt`, grok-imagine-image-2.0 (3:4, edits) | chat, tts, stt, image |
| `gemini.ts` | native `streamGenerateContent` (SSE) with `functionCall`, thought signatures, `-latest` aliases + 404 rediscovery; `batchEmbedContents` | chat, embeddings |
| `ollama.ts` | native `/api/chat` NDJSON with tools and `think`; `/api/embed`; `/api/tags` probe | chat, embeddings (local) |
| `openai-compatible.ts` | `/chat/completions` with `tool_calls` fragments by index; `/embeddings`; `/models` discovery | chat, embeddings |
| `common.ts` | `HttpClient`: base URL, auth headers, `fetchWithRetry` policy, key-free errors | — |

Every chat adapter runs inside `guardStream` (`../lib/stream.ts`): it emits the `ModelEvent` vocabulary and
ends with exactly one `done` or `error`. A cancelled caller gets `done: cancelled`, an expired deadline gets
`error: timeout`, and a stream without its provider's terminal event gets `error: incomplete`, never a short
answer. Upstream reads are cancelled on abort and on early exit. HTTP calls retry 429/5xx/network errors twice
with jitter and a capped Retry-After, and never retry for an aborted caller (`../lib/http.ts`). Keys come only
from `ProviderEnv`, and error messages name the env var but never its value.
