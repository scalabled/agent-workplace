// Web search for agents (biz-bot parity: public/js/tools.js nativeToolsFor + the /api/search fallback). An agent whose
// provider hosts web search gets it natively (OpenAI, xAI and Anthropic next to function tools); any other agent gets a
// `web_search` function tool answered by a search-capable provider (a short cited summary). biz-bot drops the fallback's
// sources; here they become the agent's sources like native citations. No third-party search API is used.
import { runTurn } from '@headcount/agent-loop';
import type { ChatProvider, HostedTool, ProviderId, Registry } from '@headcount/models';
import { clipText } from '../jobs/job-view';

/** Providers tried for the fallback search, in order (each must host web search). */
const SEARCH_ORDER: ProviderId[] = ['openai', 'xai', 'anthropic', 'gemini'];

export interface Source {
  url: string;
  title?: string;
}

/** Sources an agent cited during one piece of work: first-seen order, one per URL, capped. */
export class SourceCollector {
  private readonly byUrl = new Map<string, Source>();
  constructor(private readonly cap = 40) {}

  add(s: Source): void {
    const url = String(s.url ?? '').trim();
    if (!/^https?:\/\//i.test(url) || this.byUrl.has(url) || this.byUrl.size >= this.cap) return;
    const title = s.title?.replace(/\s+/g, ' ').trim().slice(0, 200);
    this.byUrl.set(url, { url, ...(title && !/^\d+$/.test(title) ? { title } : {}) });
  }

  addAll(list: readonly Source[]): void {
    for (const s of list) this.add(s);
  }

  list(): Source[] {
    return [...this.byUrl.values()];
  }
}

/** Does this provider host web search next to function tools (so the agent can search mid-turn natively)? */
export function hostsSearch(provider: Pick<ChatProvider, 'hosted'>, kind: HostedTool['type'] = 'web_search'): boolean {
  return provider.hosted?.[kind] === 'with_tools';
}

export interface SearchAnswer {
  answer: string;
  sources: Source[];
  provider: ProviderId;
  model: string;
}

/**
 * One cited search on a search-capable provider: a concise factual answer (under 200 words) with its sources. Throws
 * when no configured provider can search (the message says so).
 */
export async function searchWeb(registry: Registry, query: string, opts: { mode?: 'web' | 'x'; signal?: AbortSignal } = {}): Promise<SearchAnswer> {
  const mode = opts.mode ?? 'web';
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!q) throw new Error('Say what to search for.');
  const kind: HostedTool['type'] = mode === 'x' ? 'x_search' : 'web_search';
  const r = registry.tryResolve('chat', { prefer: mode === 'x' ? ['xai'] : SEARCH_ORDER, tier: 'fast' });
  if (!r || !r.provider.hosted?.[kind]) {
    throw new Error(mode === 'x' ? 'X search needs XAI_API_KEY on the worker.' : 'No search-capable provider is configured (OpenAI, xAI, Anthropic or Gemini).');
  }
  const result = await runTurn({
    provider: r.provider,
    model: r.model,
    system:
      'You are a research assistant. Search the web and answer the query with current facts, in under 200 words. Lead with the answer. Give the numbers, dates and names the results contain, and name the source of each. If sources disagree, say where. State only what the results support.',
    messages: [{ role: 'user', content: q }],
    hostedTools: [{ type: kind }],
    maxSteps: 1,
    maxTokens: 2048,
    reasoningEffort: 'low',
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (result.finish === 'error') throw new Error(result.error?.message ?? 'The search failed.');
  return { answer: clipText(result.fullText.trim() || 'No answer came back.', 4000), sources: result.citations, provider: r.providerId, model: r.model };
}

/** Sources as a numbered list for a prompt (the writer cites them as [n]). */
export function sourcesBlock(sources: readonly Source[]): string {
  if (!sources.length) return '';
  return `<sources>\n${sources.map((s, i) => `[${i + 1}] ${s.title ? `${s.title} (${s.url})` : s.url}`).join('\n')}\n</sources>`;
}

/**
 * The deliverable keeps its evidence: a "Sources" section listing every source the work relied on, appended when the
 * writer left it out (the list is the record of what was actually read, not what the model remembers).
 */
export function withSources(markdown: string, sources: readonly Source[]): string {
  if (!sources.length) return markdown;
  const missing = sources.filter((s) => !markdown.includes(s.url));
  if (!missing.length) return markdown;
  const heading = /^#{1,3}\s+sources\b/im.test(markdown) ? '' : '\n\n## Sources\n';
  const list = missing.map((s) => `- [${(s.title ?? new URL(s.url).hostname).replace(/[[\]]/g, '')}](${s.url})`).join('\n');
  return `${markdown.trimEnd()}${heading || '\n'}\n${list}\n`;
}

/** Merge source lists, first-seen order, one per URL. */
export function mergeSources(...lists: readonly (readonly Source[] | undefined)[]): Source[] {
  const c = new SourceCollector(80);
  for (const l of lists) if (l) c.addAll(l);
  return c.list();
}
