import { describe, expect, it } from 'vitest';
import { callBudget, REASONING_ALLOWANCE } from './budget';
import { collectEvents } from './collect';
import { MissingProviderError } from './errors';
import { HealthCache } from './health';
import { createRegistry } from './registry';
import { bytesResponse, collect, fakeFetch, jsonResponse, ndjsonResponse, sseResponse, type RecordedRequest } from './testing/fake-fetch';
import type { ProviderEnv, RegistryOptions, RouteNotice } from './types';

const OLLAMA = 'http://127.0.0.1:11434';
const TAGS = { models: [{ name: 'qwen3:32b', capabilities: ['completion', 'tools', 'thinking'] }, { name: 'nomic-embed-text:latest', capabilities: ['embedding'] }] };

function reg(env: ProviderEnv, handler: (req: RecordedRequest, n: number) => Response | Promise<Response> = () => jsonResponse({}), extra: RegistryOptions = {}) {
  const f = fakeFetch(handler);
  const notices: RouteNotice[] = [];
  const health = new HealthCache();
  const r = createRegistry(env, { fetch: f, health, onRoute: (n) => notices.push(n), ...extra });
  return { r, f, notices, health };
}

const refused = () => {
  throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
};

describe('registry resolution', () => {
  it('resolves Mock keylessly; TTS, STT and image are unavailable and name their keys', async () => {
    const { r } = reg({ ENABLE_MOCK: 'true', DEFAULT_CHAT: 'auto' });
    const chat = r.resolve('chat');
    expect(chat).toMatchObject({ providerId: 'mock', model: 'mock-1', tier: 'reason', fallbacks: [] });
    const caps = await r.capabilities();
    expect(caps.modalities.chat).toEqual({ available: true, provider: 'mock', missingKeys: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'OPENAI_COMPATIBLE_BASE_URL', 'OLLAMA_BASE_URL'] });
    expect(caps.modalities.embeddings).toMatchObject({ available: true, provider: 'mock' });
    for (const cap of ['tts', 'stt', 'image'] as const) expect(caps.modalities[cap]).toMatchObject({ available: false, provider: 'mock' });
    expect(caps.modalities.tts.missingKeys).toEqual(['OPENAI_API_KEY', 'XAI_API_KEY']);
    expect(caps.defaultChat).toBe('mock');
  });

  it('throws an error naming the missing keys when nothing is configured', () => {
    const { r } = reg({});
    expect(() => r.resolve('tts')).toThrow(MissingProviderError);
    expect(() => r.resolve('tts')).toThrow('Add OPENAI_API_KEY or XAI_API_KEY to apps/worker/.dev.vars.');
    const err = (() => {
      try {
        r.resolve('image');
      } catch (e) {
        return e as MissingProviderError;
      }
    })();
    expect(err?.missingKeys).toEqual(['OPENAI_API_KEY', 'XAI_API_KEY']);
  });

  it('follows the preference order per capability, and DEFAULT_CHAT / policy.prefer move one to the front', () => {
    const env = { ENABLE_MOCK: 'true', ANTHROPIC_API_KEY: 'a-key-123456', OPENAI_API_KEY: 'o-key-123456', XAI_API_KEY: 'x-key-123456' };
    const { r } = reg(env);
    expect(r.resolve('chat')).toMatchObject({ providerId: 'anthropic', model: 'claude-opus-5', fallbacks: ['openai', 'xai', 'mock'] });
    expect(r.resolve('tts').providerId).toBe('xai');
    expect(r.resolve('stt').providerId).toBe('openai');
    expect(r.resolve('image').providerId).toBe('xai');
    expect(r.resolve('embeddings').providerId).toBe('openai');
    expect(reg({ ...env, DEFAULT_CHAT: 'xai' }).r.resolve('chat').providerId).toBe('xai');
    expect(r.resolve('tts', { prefer: ['openai'] }).providerId).toBe('openai');
    // DEFAULT_CHAT never makes a chat-only provider answer another capability.
    expect(reg({ ...env, DEFAULT_CHAT: 'anthropic' }).r.resolve('tts').providerId).toBe('xai');
  });

  it('picks the model for the tier, and a pinned model only for the first provider', () => {
    const { r } = reg({ OPENAI_API_KEY: 'o-key-123456', XAI_API_KEY: 'x-key-123456' });
    expect(r.resolve('chat', { tier: 'fast' })).toMatchObject({ providerId: 'openai', model: 'gpt-5.6-luna', tier: 'fast' });
    expect(r.resolve('chat', { tier: 'voice', prefer: ['xai'] }).model).toBe('grok-4.20-non-reasoning');
    expect(r.resolve('chat', { tier: 'deep' }).tier).toBe('reason');
    expect(r.resolve('chat', { model: 'gpt-4.1' }).model).toBe('gpt-4.1');
  });

  it('honours localOnly, excludeFamilies, allowMock and needs', () => {
    const { r } = reg({ ENABLE_MOCK: 'true', ANTHROPIC_API_KEY: 'a-key-123456', OLLAMA_BASE_URL: OLLAMA });
    expect(r.resolve('chat', { localOnly: true }).providerId).toBe('ollama');
    expect(r.resolve('chat', { excludeFamilies: ['claude'] }).providerId).toBe('ollama');
    expect(reg({ ENABLE_MOCK: 'true' }).r.tryResolve('chat', { allowMock: false })).toBeNull();
    const vision = r.resolve('chat', { needs: ['vision'], prefer: ['ollama'] });
    expect(vision.providerId).toBe('anthropic');
    expect(vision.skipped).toContainEqual({ id: 'ollama', reason: 'qwen3:32b has no vision' });
  });

  it('never exposes a key in capabilities', async () => {
    const { r } = reg({ OPENAI_API_KEY: 'sk-proj-supersecret-123', XAI_API_KEY: 'xai-supersecret-456', ENABLE_MOCK: 'true' });
    const caps = JSON.stringify(await r.capabilities());
    expect(caps).not.toContain('supersecret');
    expect(caps).toContain('OPENAI_API_KEY');
  });
});

describe('local providers: probe, cache and fall through', () => {
  it('falls through an unreachable Ollama to Mock on first use, then skips it from the cache', async () => {
    const { r, f, notices } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, refused);
    const first = r.resolve('chat');
    expect(first).toMatchObject({ providerId: 'ollama', model: 'qwen3:32b', fallbacks: ['mock'] });
    const out = await collectEvents(first.provider.chat({ model: first.model, messages: [{ role: 'user', content: 'hello' }] }));
    expect(out.text).toContain('hello');
    expect(out.finish).toBe('stop');
    expect(f.calls.map((c) => c.url)).toEqual([`${OLLAMA}/api/tags`]);
    expect(notices[0]).toMatchObject({ capability: 'chat', from: 'ollama', to: 'mock' });
    const second = r.resolve('chat');
    expect(second.providerId).toBe('mock');
    expect(second.skipped.find((s) => s.id === 'ollama')?.reason).toContain('not reachable');
    expect(f.calls).toHaveLength(1);
  });

  it('uses a reachable Ollama for chat and embeddings, probing once', async () => {
    const { r, f } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, (req) => {
      if (req.url.endsWith('/api/tags')) return jsonResponse(TAGS);
      if (req.url.endsWith('/api/embed')) return jsonResponse({ embeddings: [[1, 0]] });
      return ndjsonResponse([{ message: { content: 'Local answer.' } }, { done: true, done_reason: 'stop' }]);
    });
    const chat = await r.resolveAsync('chat');
    expect(chat.providerId).toBe('ollama');
    expect((await collectEvents(chat.provider.chat({ messages: [{ role: 'user', content: 'x' }] }))).text).toBe('Local answer.');
    const emb = r.resolve('embeddings');
    expect(emb.providerId).toBe('ollama');
    expect((await emb.provider.embed({ texts: ['a'] })).provider).toBe('ollama');
    expect(f.calls.filter((c) => c.url.endsWith('/api/tags'))).toHaveLength(1);
    const caps = await r.capabilities({ probe: true });
    expect(caps.providers.find((p) => p.id === 'ollama')).toMatchObject({ configured: true, reachable: true, kind: 'local' });
    expect(caps.modalities.chat).toEqual({ available: true, provider: 'ollama', missingKeys: [] });
  });

  it('treats a missing model as unavailable for that capability only', async () => {
    const { r } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, () => jsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }));
    await r.warm();
    const chat = r.resolve('chat');
    expect(chat.providerId).toBe('mock');
    expect(chat.skipped.find((s) => s.id === 'ollama')?.reason).toContain('ollama pull qwen3:32b');
    expect(r.resolve('embeddings').providerId).toBe('ollama');
  });

  it('reports capabilities after a probe: an unreachable Ollama leaves Mock and names the keys', async () => {
    const { r } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, refused);
    const caps = await r.capabilities({ probe: true });
    expect(caps.providers.find((p) => p.id === 'ollama')).toMatchObject({ configured: true, reachable: false });
    expect(caps.modalities.chat).toMatchObject({ available: true, provider: 'mock' });
    expect(caps.modalities.chat.missingKeys).toContain('ANTHROPIC_API_KEY');
  });

  it('names the local reason when only a local provider was possible', async () => {
    const { r } = reg({ OLLAMA_BASE_URL: OLLAMA }, refused);
    await r.warm();
    expect(() => r.resolve('chat', { localOnly: true })).toThrow(/ollama serve/);
  });

  it('marks Ollama down when a call finds it gone and hands that call over', async () => {
    const { r, health } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, (req) => (req.url.endsWith('/api/tags') ? jsonResponse(TAGS) : refused()));
    await r.warm();
    const res = r.resolve('chat');
    expect(res.providerId).toBe('ollama');
    const out = await collectEvents(res.provider.chat({ messages: [{ role: 'user', content: 'ping' }] }));
    expect(out.text).toContain('ping');
    expect(health.peek(`ollama|${OLLAMA}|qwen3:32b|nomic-embed-text`)?.ok).toBe(false);
  });
});

describe('failover between real providers', () => {
  const env = { ENABLE_MOCK: 'true', ANTHROPIC_API_KEY: 'a-key-123456', OPENAI_API_KEY: 'o-key-123456' };
  const openaiText = () => sseResponse([{ type: 'response.output_text.delta', delta: 'From OpenAI.' }, { type: 'response.completed', response: {} }]);

  it('hands a chat that fails before any output (overloaded after retries) to the next real provider', async () => {
    const { r, f, notices } = reg(env, (req) => (req.url.includes('anthropic') ? jsonResponse({ error: { type: 'overloaded_error', message: 'Overloaded' } }, 529) : openaiText()));
    const res = r.resolve('chat', { tier: 'fast' });
    expect(res.providerId).toBe('anthropic');
    const out = await collectEvents(res.provider.chat({ model: res.model, messages: [{ role: 'user', content: 'x' }] }));
    expect(out.text).toBe('From OpenAI.');
    expect(f.calls.filter((c) => c.url.includes('anthropic'))).toHaveLength(3);
    expect((f.calls.at(-1)!.body as Record<string, unknown>).model).toBe('gpt-5.6-luna');
    expect(notices).toEqual([expect.objectContaining({ capability: 'chat', from: 'anthropic', to: 'openai' })]);
  });

  it('does not fail over on non-retryable errors, to Mock, or from local to cloud', async () => {
    const auth = reg(env, (req) => (req.url.includes('anthropic') ? jsonResponse({ error: { message: 'bad key' } }, 401) : openaiText()));
    const e1 = (await collect(auth.r.resolve('chat').provider.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(e1).toMatchObject({ type: 'error', code: 'auth' });

    const onlyMock = reg({ ENABLE_MOCK: 'true', OPENAI_API_KEY: 'o-key-123456' }, () => jsonResponse({}, 503));
    const e2 = (await collect(onlyMock.r.resolve('chat').provider.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(e2).toMatchObject({ type: 'error', status: 503 });

    const local = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA, OPENAI_API_KEY: 'o-key-123456', DEFAULT_CHAT: 'ollama' }, (req) => (req.url.endsWith('/api/tags') ? jsonResponse(TAGS) : req.url.includes('11434') ? jsonResponse({ error: 'boom' }, 500) : openaiText()));
    await local.r.warm();
    const e3 = (await collect(local.r.resolve('chat').provider.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(e3).toMatchObject({ type: 'error', status: 500 });
    expect(local.f.calls.some((c) => c.url.includes('openai.com'))).toBe(false);
  });

  it('re-sizes a failed-over call for the provider that serves it: a local fallback never gets a cloud thinking budget', async () => {
    const { r, f } = reg({ ...env, OPENAI_API_KEY: '', OLLAMA_BASE_URL: OLLAMA }, (req) => {
      if (req.url.endsWith('/api/tags')) return jsonResponse(TAGS);
      if (req.url.includes('anthropic')) return jsonResponse({ error: { type: 'overloaded_error', message: 'Overloaded' } }, 529);
      return ndjsonResponse([{ message: { content: 'Local answer.' } }, { done: true, done_reason: 'stop' }]);
    });
    await r.warm();
    const res = r.resolve('chat', { tier: 'reason' });
    expect(res.providerId).toBe('anthropic');
    const sized = callBudget(res.provider, res.model, 1500, 'medium');
    expect(sized.reasoningEffort).toBe('medium');
    const out = await collectEvents(res.provider.chat({ model: res.model, messages: [{ role: 'user', content: 'x' }], ...sized }));
    expect(out.text).toBe('Local answer.');
    const body = f.calls.find((c) => c.url.endsWith('/api/chat'))!.body as { think?: unknown; options?: { num_predict?: number } };
    expect(body.think).not.toBe(true);
    expect(body.options?.num_predict).toBe(1500);
  });

  it('gives a reasoning fallback its room to think when the head does not reason', async () => {
    const { r, f } = reg(env, (req) => (req.url.includes('anthropic') ? jsonResponse({ error: { type: 'overloaded_error', message: 'Overloaded' } }, 529) : openaiText()));
    const res = r.resolve('chat', { tier: 'voice' });
    expect(res.model).toBe('claude-haiku-4-5');
    const sized = callBudget(res.provider, res.model, 900, 'low');
    expect(sized).toEqual({ maxTokens: 900, budget: { output: 900, effort: 'low' } });
    const out = await collectEvents(res.provider.chat({ model: res.model, messages: [{ role: 'user', content: 'x' }], ...sized }));
    expect(out.text).toBe('From OpenAI.');
    const body = f.calls.at(-1)!.body as { max_output_tokens?: number; reasoning?: { effort?: string } };
    expect(body.max_output_tokens).toBe(900 + REASONING_ALLOWANCE.low);
    expect(body.reasoning?.effort).toBe('low');
  });

  it('never fails over once output has started', async () => {
    const { r, f } = reg(env, (req) =>
      req.url.includes('anthropic')
        ? sseResponse([['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } }]])
        : openaiText(),
    );
    const events = await collect(r.resolve('chat').provider.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(events.map((e) => e.type)).toEqual(['text', 'error']);
    expect(f.calls.some((c) => c.url.includes('openai.com'))).toBe(false);
  });

  it('fails TTS over from xAI to OpenAI and keeps the voice mapping', async () => {
    const { r } = reg({ XAI_API_KEY: 'x-key-123456', OPENAI_API_KEY: 'o-key-123456' }, (req) => (req.url.includes('x.ai') ? jsonResponse({}, 503) : bytesResponse(new Uint8Array([1]), 'audio/mpeg')));
    const tts = r.resolve('tts');
    expect(tts).toMatchObject({ providerId: 'xai', fallbacks: ['openai'] });
    const out = await tts.provider.tts({ text: 'Hi', voice: { openai: 'coral', xai: 'ara' } });
    expect(out).toMatchObject({ provider: 'openai', voice: 'coral' });
  });
});

describe('registry cancellation', () => {
  it('ends a cancelled wrapped chat with done: cancelled', async () => {
    const { r } = reg({ ENABLE_MOCK: 'true', OLLAMA_BASE_URL: OLLAMA }, refused);
    const ac = new AbortController();
    ac.abort();
    const res = r.resolve('chat');
    expect(await collect(res.provider.chat({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal }))).toEqual([{ type: 'done', finish: 'cancelled' }]);
  });
});
