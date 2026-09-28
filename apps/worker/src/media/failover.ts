// Run a media call on the registry's choice and fail over to the next real provider on a provider error.
import { PROVIDERS, ProviderError, type Capability, type ModelPolicy, type Registry, type Resolved } from '@headcount/models';
import type { ProviderId } from '@headcount/protocol';

const familyOf = (id: ProviderId): string | undefined => PROVIDERS.find((p) => p.id === id)?.family;

/**
 * Resolve `capability` under `policy` (throws MissingProviderError → 503 naming the missing keys) and run `call`.
 * On a ProviderError the next configured real provider is tried (ARCHITECTURE §12.3) — including after
 * non-retryable errors such as a voice id one provider rejects. Providers the registry already fell through for
 * a retryable error (`resolved.fallbacks`) are not tried again. Mock is never a fallback after a real provider
 * failed: silent audio or a placeholder would look like success. An aborted caller is never retried.
 */
export async function withFailover<C extends Capability, T>(
  registry: Registry,
  capability: C,
  policy: ModelPolicy,
  call: (resolved: Resolved<C>) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ value: T; resolved: Resolved<C> }> {
  let resolved = registry.resolve(capability, policy);
  const excluded = new Set(policy.excludeFamilies ?? []);
  for (;;) {
    try {
      return { value: await call(resolved), resolved };
    } catch (err) {
      if (!(err instanceof ProviderError) || signal?.aborted || resolved.providerId === 'mock') throw err;
      const tried: ProviderId[] = [resolved.providerId, err.provider, ...(err.retryable ? (resolved.fallbacks ?? []) : [])];
      for (const id of tried) {
        const family = familyOf(id);
        if (family) excluded.add(family);
      }
      const next = registry.tryResolve(capability, { ...policy, allowMock: false, excludeFamilies: [...excluded] });
      if (!next) throw err;
      resolved = next;
    }
  }
}
