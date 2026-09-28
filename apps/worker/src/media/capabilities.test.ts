import type { CapabilitiesResponse } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { FakeD1, FakeR2 } from '../../test/fake-cloud';
import type { Env } from '../env';
import { handle } from '../index';
import { publicCapabilities } from './capabilities';

const offline: ExecutionContext = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const env = (vars: Record<string, string>) => ({ WORKSPACE_ID: 'local', DB: new FakeD1(), BLOBS: new FakeR2(), ...vars }) as unknown as Env;

async function capabilities(vars: Record<string, string>): Promise<{ text: string; body: CapabilitiesResponse }> {
  const res = await handle(new Request('http://localhost/api/capabilities'), env(vars), offline);
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, body: JSON.parse(text) as CapabilitiesResponse };
}

describe('GET /api/capabilities', () => {
  it('keyless: chat and embeddings on Mock; TTS, STT and images unavailable with the keys that would enable them', async () => {
    const { body } = await capabilities({ ENABLE_MOCK: 'true', DEFAULT_CHAT: 'mock' });
    expect(body.modalities.chat).toMatchObject({ available: true, provider: 'mock' });
    for (const m of ['tts', 'stt', 'image'] as const) {
      expect(body.modalities[m].available).toBe(false);
      expect(body.modalities[m].missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
    }
  });

  it('never returns key values, whatever is configured', async () => {
    const secrets = {
      ANTHROPIC_API_KEY: 'sk-ant-secret-1',
      OPENAI_API_KEY: 'sk-proj-secret-2',
      XAI_API_KEY: 'xai-secret-3',
      GEMINI_API_KEY: 'AIzaSecret4',
      OPENAI_COMPATIBLE_API_KEY: 'compat-secret-5',
    };
    const { text, body } = await capabilities({ ...secrets, ENABLE_MOCK: 'true', DEFAULT_CHAT: 'auto', OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:1', OLLAMA_BASE_URL: 'http://127.0.0.1:1' });
    for (const v of Object.values(secrets)) expect(text).not.toContain(v);
    for (const p of body.providers) for (const k of p.keys) expect(k).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });

  it('projects only whitelisted fields and env-var-shaped key names', () => {
    const leaky = {
      providers: [{ id: 'openai', label: 'OpenAI', kind: 'cloud', configured: true, modalities: ['chat'], keys: ['OPENAI_API_KEY', 'sk-live-oops'], apiKey: 'sk-live-oops' }],
      modalities: {
        chat: { available: true, provider: 'openai', missingKeys: [], debug: 'sk-live-oops' },
        tts: { available: false, provider: null, missingKeys: ['XAI_API_KEY', 'xai-oops'] },
      },
      defaultChat: 'openai',
      env: { OPENAI_API_KEY: 'sk-live-oops' },
    } as unknown as CapabilitiesResponse;
    const out = publicCapabilities(leaky);
    expect(JSON.stringify(out)).not.toContain('oops');
    expect(out.providers[0]!.keys).toEqual(['OPENAI_API_KEY']);
    expect(out.modalities.tts.missingKeys).toEqual(['XAI_API_KEY']);
    expect(out.modalities.image).toEqual({ available: false, provider: null, missingKeys: [] });
  });
});
