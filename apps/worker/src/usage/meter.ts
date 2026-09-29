// Token usage (admin): every model call is metered where the providers are handed out. `metered(registry, sink, tag)`
// wraps a Registry so whatever it resolves — chat, embeddings, speech, images — reports each call to the sink with its
// surface (Talk, a desk chat, a project step…), the coworker, the provider and model, tokens in, out and cached, the
// cost the provider reported, the time it took and (chat) the time to the first token. The call itself is untouched:
// events pass through as they arrive, errors are re-thrown.
import type { Capability, ChatProvider, ChatRequest, ModelEvent, Registry, Resolved } from '@headcount/models';
import type { UsageCapability, UsageSurface } from '@headcount/protocol/ext/admin';

export interface MeterTag {
  surface: UsageSurface;
  agentId?: string;
  projectId?: string;
}

export interface CallRecord {
  at: number;
  surface: UsageSurface;
  agentId: string;
  projectId: string;
  provider: string;
  model: string;
  capability: UsageCapability;
  input: number;
  output: number;
  cached: number;
  usd: number | null;
  ms: number;
  firstMs?: number;
  ok: boolean;
  error?: string;
}

export type UsageSink = (record: CallRecord) => void;

const CAPS: Record<Capability, UsageCapability> = { chat: 'chat', embeddings: 'embeddings', tts: 'tts', stt: 'stt', image: 'image' } as Record<Capability, UsageCapability>;
/** About four characters to a token, for calls whose provider reports none (embeddings). */
const estimate = (chars: number) => Math.ceil(chars / 4);
const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

export function metered(registry: Registry, sink: UsageSink, tag: MeterTag, now: () => number = Date.now): Registry {
  const base = { surface: tag.surface, agentId: tag.agentId ?? '', projectId: tag.projectId ?? '' };
  const record = (r: Omit<CallRecord, 'surface' | 'agentId' | 'projectId'>) => {
    try {
      sink({ ...base, ...r });
    } catch {
      /* metering never breaks a call */
    }
  };

  const wrapChat = (p: ChatProvider, resolved: Resolved<'chat'>): ChatProvider =>
    new Proxy(p, {
      get(target, key, receiver) {
        if (key !== 'chat') return Reflect.get(target, key, receiver);
        return (req: ChatRequest): AsyncIterable<ModelEvent> => ({
          async *[Symbol.asyncIterator]() {
            const started = now();
            let firstMs: number | undefined;
            let input = 0;
            let output = 0;
            let cached = 0;
            let usd: number | null = null;
            let reported = false;
            let ok = true;
            let error: string | undefined;
            try {
              for await (const e of target.chat(req)) {
                if (firstMs === undefined && (e.type === 'text' || e.type === 'reasoning' || e.type === 'tool_call')) firstMs = now() - started;
                if (e.type === 'usage') {
                  input += e.input;
                  output += e.output;
                  cached += e.cached ?? 0;
                  if (e.usd !== null) usd = (usd ?? 0) + e.usd;
                  reported = true;
                }
                if (e.type === 'error') {
                  ok = false;
                  error = e.message.slice(0, 200);
                }
                yield e;
              }
            } catch (err) {
              ok = false;
              error = errorOf(err);
              throw err;
            } finally {
              if (!reported && ok) {
                // A provider that reports nothing (or an aborted stream): count the prompt roughly, so it still shows.
                input = estimate((req.system?.length ?? 0) + JSON.stringify(req.messages).length);
              }
              record({ at: started, provider: target.id, model: req.model || resolved.model || target.defaultModel(resolved.tier), capability: 'chat', input, output, cached, usd, ms: now() - started, ...(firstMs !== undefined ? { firstMs } : {}), ok, ...(error ? { error } : {}) });
            }
          },
        });
      },
    });

  const wrapCall = <P extends object>(p: P, method: string, capability: UsageCapability, model: string, size: (args: unknown) => number): P =>
    new Proxy(p, {
      get(target, key, receiver) {
        const v = Reflect.get(target, key, receiver);
        if (key !== method || typeof v !== 'function') return v;
        return async (arg: unknown) => {
          const started = now();
          try {
            const out = await (v as (a: unknown) => Promise<unknown>).call(target, arg);
            const m = (out as { model?: string } | null)?.model || model;
            record({ at: started, provider: (target as { id?: string }).id ?? '', model: m, capability, input: size(arg), output: 0, cached: 0, usd: null, ms: now() - started, ok: true });
            return out;
          } catch (err) {
            record({ at: started, provider: (target as { id?: string }).id ?? '', model, capability, input: size(arg), output: 0, cached: 0, usd: null, ms: now() - started, ok: false, error: errorOf(err) });
            throw err;
          }
        };
      },
    });

  const wrap = <C extends Capability>(r: Resolved<C> | null): Resolved<C> | null => {
    if (!r) return r;
    const cap = CAPS[r.capability];
    let provider: unknown = r.provider;
    if (r.capability === 'chat') provider = wrapChat(r.provider as ChatProvider, r as unknown as Resolved<'chat'>);
    else if (r.capability === 'embeddings') provider = wrapCall(r.provider as object, 'embed', cap, r.model, (a) => estimate(((a as { texts?: string[] }).texts ?? []).join(' ').length));
    else if (r.capability === 'tts') provider = wrapCall(r.provider as object, 'tts', cap, r.model, (a) => ((a as { text?: string }).text ?? '').length);
    else if (r.capability === 'stt') provider = wrapCall(r.provider as object, 'stt', cap, r.model, () => 0);
    else if (r.capability === 'image') provider = wrapCall(r.provider as object, 'generate', cap, r.model, () => 1);
    return { ...r, provider: provider as Resolved<C>['provider'] };
  };

  return new Proxy(registry, {
    get(target, key, receiver) {
      if (key === 'resolve') return <C extends Capability>(c: C, p?: Parameters<Registry['resolve']>[1]) => wrap(target.resolve(c, p))!;
      if (key === 'tryResolve') return <C extends Capability>(c: C, p?: Parameters<Registry['tryResolve']>[1]) => wrap(target.tryResolve(c, p));
      if (key === 'resolveAsync') return async <C extends Capability>(c: C, p?: Parameters<Registry['resolveAsync']>[1]) => wrap(await target.resolveAsync(c, p))!;
      return Reflect.get(target, key, receiver);
    },
  });
}
