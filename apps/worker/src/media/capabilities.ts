import { MODALITIES, type CapabilitiesResponse, type ModalityStatus } from '@headcount/protocol';
import { json, type RouteHandler } from '../lib/http';
import { mockMediaEnabled } from './speech';
import { voiceFrontOf } from '../workspace/voice-front';

// GET /api/capabilities (owned by media): which providers are configured and which modalities are available,
// from the packages/models registry. Names and booleans only — never key values.

/** Env var names look like OPENAI_API_KEY; key values never do (they contain lowercase letters or dashes). */
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const names = (list: readonly string[] | undefined): string[] => (list ?? []).filter((k) => typeof k === 'string' && ENV_NAME.test(k));

/**
 * Whitelist projection of the registry's answer: whatever the registry grows, only these fields reach the
 * browser, and key lists can only carry env var names.
 */
export function publicCapabilities(c: CapabilitiesResponse, opts: { mockMedia?: boolean } = {}): CapabilitiesResponse {
  const modalities = {} as CapabilitiesResponse['modalities'];
  for (const m of MODALITIES) {
    const s: Partial<ModalityStatus> = c.modalities?.[m] ?? {};
    // MOCK_MEDIA=true: Mock speech is the chosen default (tests, keyless demo of the provider path), so it counts.
    const mockSpeech = opts.mockMedia === true && (m === 'tts' || m === 'stt') && s.provider === 'mock';
    modalities[m] = { available: s.available === true || mockSpeech, provider: s.provider ?? null, missingKeys: names(s.missingKeys) };
  }
  return {
    providers: (c.providers ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      configured: p.configured === true,
      ...(typeof p.reachable === 'boolean' ? { reachable: p.reachable } : {}),
      modalities: [...p.modalities],
      keys: names(p.keys),
    })),
    modalities,
    defaultChat: c.defaultChat ?? null,
  };
}

export const handleCapabilities: RouteHandler = async (_req, rc) => {
  const front = voiceFrontOf(rc.env);
  return json<CapabilitiesResponse>({ ...publicCapabilities(await rc.registry().capabilities({ probe: true }), { mockMedia: mockMediaEnabled(rc.env) }), voiceFront: { available: front !== null, provider: front } });
};
