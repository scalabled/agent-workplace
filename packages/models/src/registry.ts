// The provider registry (ARCHITECTURE §12.1, §12.3): the oncloudnine registry shape (preference orders per
// capability, key-based availability, errors that name the missing key — server/providers/registry.ts
// requireProvider/assertProviderSupports) over the biz-bot adapters, plus tiers, capability flags,
// cached reachability for local providers and failover.
import type { CapabilitiesResponse, ModalityStatus } from '@headcount/protocol';
import { MODALITIES } from '@headcount/protocol';
import { createAnthropicProvider } from './adapters/anthropic';
import { createGeminiProvider } from './adapters/gemini';
import { createOllamaProvider } from './adapters/ollama';
import { createOpenAIProvider } from './adapters/openai';
import { createOpenAICompatibleProvider } from './adapters/openai-compatible';
import { createXaiProvider } from './adapters/xai';
import { PREFERENCE, PROVIDERS, isLocalProvider, isProviderId, type ProviderDescriptor } from './descriptors';
import { MissingProviderError, ProviderError } from './errors';
import { sharedHealth } from './health';
import { createMockProvider } from './mock';
import { modelFlags } from './model-catalog';
import {
  normalizeTier,
  type Capability,
  type CapabilityProviderMap,
  type ChatProvider,
  type EmbeddingProvider,
  type ImageProvider,
  type ModelEvent,
  type ModelFlag,
  type ModelPolicy,
  type ProviderEnv,
  type ProviderFactory,
  type ProviderId,
  type ProviderInstance,
  type RegistryOptions,
  type Resolved,
  type SpeechProvider,
} from './types';

/** Adapter factories by provider. Each returns null when its keys (or base URL) are missing. */
export const DEFAULT_FACTORIES: Partial<Record<ProviderId, ProviderFactory>> = {
  mock: (env) => (env.ENABLE_MOCK === 'true' ? createMockProvider({ delayMs: Number(env.MOCK_DELAY_MS ?? 0) || 0 }) : null),
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  xai: createXaiProvider,
  gemini: createGeminiProvider,
  'openai-compatible': createOpenAICompatibleProvider,
  ollama: createOllamaProvider,
};

/** Modalities where Mock output is good enough to count as "available" (keyless must work). */
const MOCK_COUNTS_AS_AVAILABLE: ReadonlySet<Capability> = new Set<Capability>(['chat', 'embeddings']);

export interface Registry {
  /**
   * Pick a provider for a capability under a policy. Throws MissingProviderError naming the missing keys.
   * A configured local provider whose reachability is not known yet is chosen and probed on first use; if
   * it is down, the call falls through to the next candidate (see `Resolved.fallbacks`).
   */
  resolve<C extends Capability>(capability: C, policy?: ModelPolicy): Resolved<C>;
  /** Like resolve, but returns null instead of throwing. */
  tryResolve<C extends Capability>(capability: C, policy?: ModelPolicy): Resolved<C> | null;
  /** Probe local providers first (≤ probe timeout, cached), then resolve — the result names who will answer. */
  resolveAsync<C extends Capability>(capability: C, policy?: ModelPolicy): Promise<Resolved<C>>;
  /** Probe every configured local provider (cached ~30 s per isolate). */
  warm(): Promise<void>;
  /** What is configured, for GET /api/capabilities. `probe` pings local providers (≤800 ms, cached). */
  capabilities(opts?: { probe?: boolean }): Promise<CapabilitiesResponse>;
}

function pickCapability<C extends Capability>(inst: ProviderInstance, cap: C): CapabilityProviderMap[C] | null {
  switch (cap) {
    case 'chat':
      return (inst.chat ?? null) as CapabilityProviderMap[C] | null;
    case 'tts':
      return (inst.speech?.tts ? inst.speech : null) as CapabilityProviderMap[C] | null;
    case 'stt':
      return (inst.speech?.stt ? inst.speech : null) as CapabilityProviderMap[C] | null;
    case 'image':
      return (inst.image ?? null) as CapabilityProviderMap[C] | null;
    case 'embeddings':
      return (inst.embeddings ?? null) as CapabilityProviderMap[C] | null;
    default:
      return null;
  }
}

interface Candidate<C extends Capability> {
  id: ProviderId;
  d: ProviderDescriptor;
  local: boolean;
  inst: ProviderInstance;
  provider: CapabilityProviderMap[C];
  model: string;
}

type Skip = { id: ProviderId; reason: string };

/** Errors worth handing to another provider: the provider is overloaded, down or cut the stream. */
function isFailoverError(e: { retryable?: boolean; code?: string }): boolean {
  return Boolean(e.retryable) && e.code !== 'timeout';
}

export function createRegistry(env: ProviderEnv, opts: RegistryOptions = {}): Registry {
  const doFetch: typeof fetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const factories: Partial<Record<ProviderId, ProviderFactory>> = { ...DEFAULT_FACTORIES, ...opts.providers };
  const health = opts.health ?? sharedHealth;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 800;
  const instances = new Map<ProviderId, ProviderInstance | null>();
  const instance = (id: ProviderId): ProviderInstance | null => {
    if (!instances.has(id)) instances.set(id, factories[id]?.(env, { fetch: doFetch }) ?? null);
    return instances.get(id) ?? null;
  };
  const notify = (capability: Capability, from: ProviderId, to: ProviderId | null, reason: string) => {
    try {
      opts.onRoute?.({ capability, from, to, reason });
    } catch {
      /* logging must never break a call */
    }
  };

  function order(cap: Capability, policy: ModelPolicy): ProviderId[] {
    const base = [...PREFERENCE[cap]];
    let first: ProviderId[] = [];
    if (policy.prefer?.length) first = policy.prefer;
    else if (cap === 'chat' && env.DEFAULT_CHAT && env.DEFAULT_CHAT !== 'auto' && isProviderId(env.DEFAULT_CHAT)) first = [env.DEFAULT_CHAT];
    return [...new Set([...first, ...base])].filter(isProviderId);
  }

  function healthState(c: { local: boolean; inst: ProviderInstance }, cap: Capability): { state: 'ok' | 'down' | 'unknown'; reason?: string } {
    if (!c.local || !c.inst.health) return { state: 'ok' };
    const h = health.peek(c.inst.health.key);
    if (!h) return { state: 'unknown' };
    if (!h.ok) return { state: 'down', ...(h.reason ? { reason: h.reason } : {}) };
    const per = h.capabilities?.[cap];
    if (per && !per.ok) return { state: 'down', ...(per.reason ? { reason: per.reason } : {}) };
    return { state: 'ok' };
  }

  function flagsFor(c: { id: ProviderId; local: boolean; inst: ProviderInstance }, model: string): ModelFlag[] | null {
    if (c.local && c.inst.health) {
      const models = health.peek(c.inst.health.key)?.models;
      const hit = models && Object.entries(models).find(([name]) => name === model || name === `${model}:latest`);
      if (hit?.[1].length) return hit[1];
    }
    return modelFlags(c.id, model);
  }

  function candidates<C extends Capability>(cap: C, policy: ModelPolicy): { list: Candidate<C>[]; skipped: Skip[] } {
    const list: Candidate<C>[] = [];
    const skipped: Skip[] = [];
    const tier = normalizeTier(policy.tier);
    for (const id of order(cap, policy)) {
      const d = PROVIDERS.find((p) => p.id === id);
      if (!d || !d.modalities.includes(cap)) continue;
      if (!d.configured(env)) {
        skipped.push({ id, reason: id === 'mock' ? 'ENABLE_MOCK is not "true"' : `missing ${d.keys[0]}` });
        continue;
      }
      const local = isLocalProvider(d, env);
      if (policy.localOnly && !local && d.kind !== 'mock') {
        skipped.push({ id, reason: 'policy is local-only' });
        continue;
      }
      if (policy.excludeFamilies?.includes(d.family)) {
        skipped.push({ id, reason: `family ${d.family} excluded` });
        continue;
      }
      if (id === 'mock' && policy.allowMock === false) {
        skipped.push({ id, reason: 'mock not allowed by policy' });
        continue;
      }
      const inst = instance(id);
      const provider = inst ? pickCapability(inst, cap) : null;
      if (!inst || !provider) {
        skipped.push({ id, reason: 'adapter not available yet' });
        continue;
      }
      const h = healthState({ local, inst }, cap);
      if (h.state === 'down') {
        skipped.push({ id, reason: h.reason ?? 'not reachable' });
        continue;
      }
      // A pinned model applies to the provider that would answer first; fallbacks use their tier default.
      const model = cap === 'chat' ? ((!list.length && policy.model) || (provider as ChatProvider).defaultModel(tier)) : ((!list.length && policy.model) || '');
      if (cap === 'chat' && policy.needs?.length) {
        const flags = flagsFor({ id, local, inst }, model);
        const lacking = flags ? policy.needs.filter((f) => !flags.includes(f)) : [];
        if (lacking.length) {
          skipped.push({ id, reason: `${model} has no ${lacking.join(', ')}` });
          continue;
        }
      }
      list.push({ id, d, local, inst, provider, model });
    }
    return { list, skipped };
  }

  async function ensureHealthy(c: Candidate<Capability>, cap: Capability): Promise<{ ok: boolean; reason?: string }> {
    if (!c.local || !c.inst.health) return { ok: true };
    const probe = c.inst.health;
    await health.check(probe.key, () => probe.check(AbortSignal.timeout(probeTimeoutMs)));
    const h = healthState(c, cap);
    return h.state === 'down' ? { ok: false, reason: h.reason ?? `${c.d.label} is not reachable.` } : { ok: true };
  }

  function markDown(c: Candidate<Capability>, reason: string) {
    if (c.inst.health) health.set(c.inst.health.key, { ok: false, reason });
  }

  /** Index of the next provider a failed call may hand over to: real, and never local → cloud. */
  function nextFailover(list: Candidate<Capability>[], from: number): number {
    const failed = list[from]!;
    for (let j = from + 1; j < list.length; j++) {
      const c = list[j]!;
      if (c.id === 'mock') continue;
      if (failed.local && !c.local) continue;
      return j;
    }
    return -1;
  }

  function wrapChat(list: Candidate<'chat'>[]): ChatProvider {
    const first = list[0]!.provider;
    const chain = list as unknown as Candidate<Capability>[];
    return {
      id: first.id,
      kind: first.kind,
      family: first.family,
      defaultModel: (tier) => first.defaultModel(tier),
      async *chat(req) {
        let lastReason = 'No provider is available for chat.';
        for (let i = 0; i < list.length; ) {
          const c = list[i]!;
          const hc = await ensureHealthy(chain[i]!, 'chat');
          if (req.signal?.aborted) return yield { type: 'done', finish: 'cancelled' } satisfies ModelEvent;
          if (!hc.ok) {
            lastReason = hc.reason ?? lastReason;
            notify('chat', c.id, list[i + 1]?.id ?? null, lastReason);
            i++;
            continue;
          }
          const model = i === 0 ? req.model || c.model : c.model;
          let started = false;
          let failure: Extract<ModelEvent, { type: 'error' }> | null = null;
          for await (const ev of c.provider.chat({ ...req, model })) {
            if (!started && ev.type === 'error' && !req.signal?.aborted) {
              if (c.local && ev.code === 'unreachable') {
                failure = ev;
                break;
              }
              if (isFailoverError(ev) && nextFailover(chain, i) !== -1) {
                failure = ev;
                break;
              }
            }
            started = true;
            yield ev;
          }
          if (!failure) return;
          lastReason = failure.message;
          if (c.local && failure.code === 'unreachable') {
            markDown(chain[i]!, failure.message);
            notify('chat', c.id, list[i + 1]?.id ?? null, failure.message);
            i++;
          } else {
            const j = nextFailover(chain, i);
            notify('chat', c.id, list[j]?.id ?? null, failure.message);
            i = j;
          }
        }
        yield { type: 'error', message: lastReason, code: 'unavailable', retryable: false };
      },
    };
  }

  /** Same fall-through rules for one-shot calls (TTS, STT, images; embeddings select only, no error failover). */
  async function withFallback<C extends Capability, T>(cap: C, list: Candidate<C>[], signal: AbortSignal | undefined, failover: boolean, run: (c: Candidate<C>) => Promise<T>): Promise<T> {
    const chain = list as unknown as Candidate<Capability>[];
    let lastError: unknown = null;
    for (let i = 0; i < list.length; ) {
      const c = list[i]!;
      const hc = await ensureHealthy(chain[i]!, cap);
      if (!hc.ok) {
        lastError = new ProviderError(c.id, hc.reason ?? `${c.d.label} is not reachable.`, undefined, true, 'unreachable');
        notify(cap, c.id, list[i + 1]?.id ?? null, hc.reason ?? 'not reachable');
        i++;
        continue;
      }
      try {
        return await run(c);
      } catch (e) {
        if (signal?.aborted || !(e instanceof ProviderError)) throw e;
        lastError = e;
        if (c.local && e.kind === 'unreachable') {
          markDown(chain[i]!, e.message);
          notify(cap, c.id, list[i + 1]?.id ?? null, e.message);
          i++;
          continue;
        }
        const j = failover && e.retryable && e.kind !== 'timeout' ? nextFailover(chain, i) : -1;
        if (j === -1) throw e;
        notify(cap, c.id, list[j]!.id, e.message);
        i = j;
      }
    }
    throw lastError ?? new MissingProviderError(cap, missingKeysFor(cap));
  }

  function wrap<C extends Capability>(cap: C, list: Candidate<C>[]): CapabilityProviderMap[C] {
    const first = list[0]!.provider as ProviderIdentity;
    const ident = { id: first.id, kind: first.kind, family: first.family };
    switch (cap) {
      case 'chat':
        return wrapChat(list as unknown as Candidate<'chat'>[]) as CapabilityProviderMap[C];
      case 'tts': {
        const l = list as unknown as Candidate<'tts'>[];
        const p: SpeechProvider = { ...ident, tts: (req) => withFallback('tts', l, req.signal, true, (c) => c.provider.tts(req)) };
        return p as CapabilityProviderMap[C];
      }
      case 'stt': {
        const l = list as unknown as Candidate<'stt'>[];
        const p: SpeechProvider = { ...ident, stt: (req) => withFallback('stt', l, req.signal, true, (c) => c.provider.stt(req)) };
        return p as CapabilityProviderMap[C];
      }
      case 'image': {
        const l = list as unknown as Candidate<'image'>[];
        // A pinned image model belongs to the first provider; fallbacks use their own default.
        const p: ImageProvider = { ...ident, generate: (req) => withFallback('image', l, req.signal, true, (c) => c.provider.generate(c === l[0] ? req : withoutModel(req))) };
        return p as CapabilityProviderMap[C];
      }
      case 'embeddings': {
        const l = list as unknown as Candidate<'embeddings'>[];
        const p: EmbeddingProvider = { ...ident, embed: (req) => withFallback('embeddings', l, req.signal, false, (c) => c.provider.embed(c === l[0] ? req : withoutModel(req))) };
        return p as CapabilityProviderMap[C];
      }
      default:
        return list[0]!.provider;
    }
  }

  function tryResolve<C extends Capability>(cap: C, policy: ModelPolicy = {}): Resolved<C> | null {
    const { list, skipped } = candidates(cap, policy);
    const first = list[0];
    if (!first) return null;
    const tier = normalizeTier(policy.tier);
    const unknownLocal = healthState(first, cap).state === 'unknown';
    const fallbacks = list.slice(1).map((c) => c.id);
    const provider = list.length === 1 && !unknownLocal ? first.provider : wrap(cap, list);
    const reason = skipped.length ? `first available after skipping ${skipped.map((s) => s.id).join(', ')}` : 'first in preference order';
    return { capability: cap, provider, providerId: first.id, model: first.model, reason, skipped, tier, fallbacks };
  }

  function missingKeysFor(cap: Capability): string[] {
    return PROVIDERS.filter((d) => d.id !== 'mock' && d.modalities.includes(cap) && !d.configured(env)).map((d) => d.keys[0] as string);
  }

  function localHint(skipped: Skip[]): string | undefined {
    const local = skipped.filter((s) => {
      const d = PROVIDERS.find((p) => p.id === s.id);
      return d && isLocalProvider(d, env) && d.configured(env);
    });
    return local.length ? local.map((s) => s.reason).join(' ') : undefined;
  }

  async function warm(): Promise<void> {
    await Promise.all(
      PROVIDERS.filter((d) => d.configured(env) && isLocalProvider(d, env)).map(async (d) => {
        const probe = instance(d.id)?.health;
        if (probe) await health.check(probe.key, () => probe.check(AbortSignal.timeout(probeTimeoutMs)));
      }),
    );
  }

  return {
    tryResolve,
    resolve<C extends Capability>(cap: C, policy: ModelPolicy = {}): Resolved<C> {
      const r = tryResolve(cap, policy);
      if (!r) {
        const { skipped } = candidates(cap, policy);
        throw new MissingProviderError(cap, missingKeysFor(cap), skipped, localHint(skipped));
      }
      return r;
    },
    async resolveAsync<C extends Capability>(cap: C, policy: ModelPolicy = {}): Promise<Resolved<C>> {
      await warm();
      return this.resolve(cap, policy);
    },
    warm,
    async capabilities({ probe = false } = {}): Promise<CapabilitiesResponse> {
      if (probe) await warm();
      const providers = PROVIDERS.map((d) => {
        const configured = d.configured(env);
        const status: CapabilitiesResponse['providers'][number] = { id: d.id, label: d.label, kind: isLocalProvider(d, env) ? 'local' : d.kind, configured, modalities: [...d.modalities], keys: d.keys.map(String) };
        const key = configured && isLocalProvider(d, env) ? instance(d.id)?.health?.key : undefined;
        const h = key ? health.peek(key) : undefined;
        if (h) status.reachable = h.ok;
        return status;
      });
      const modalities = {} as Record<Capability, ModalityStatus>;
      for (const cap of MODALITIES) {
        const r = tryResolve(cap);
        const real = r && r.providerId !== 'mock';
        modalities[cap] = {
          available: Boolean(real || (r && MOCK_COUNTS_AS_AVAILABLE.has(cap))),
          provider: r?.providerId ?? null,
          missingKeys: real ? [] : missingKeysFor(cap),
        };
      }
      return { providers, modalities, defaultChat: modalities.chat.provider };
    },
  };
}

type ProviderIdentity = { id: ProviderId; kind: ChatProvider['kind']; family: string };

function withoutModel<T extends { model?: string }>(req: T): T {
  const { model: _model, ...rest } = req;
  return rest as T;
}
