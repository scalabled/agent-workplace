// The research tools an agent gets for a piece of work (biz-bot parity: web_search, x_search, fetch_page): hosted
// search when the agent's provider runs it, else the `web_search` function fallback; `fetch_page` always through the
// worker. Every result reaches the model framed as external data, and every source lands in the work's SourceCollector.
import type { AgentTool } from '@headcount/agent-loop';
import type { ChatProvider, HostedTool, Registry } from '@headcount/models';
import { wrapExternal } from './external';
import { FetchPageError, fetchPage, type Resolver } from './fetch-page';
import { hostsSearch, searchWeb, type SourceCollector } from './web-search';

export interface ResearchGrants {
  webSearch: boolean;
  xSearch?: boolean;
  fetchPage: boolean;
}

export interface ResearchContext {
  /** The provider the agent's own turn runs on (decides native vs fallback search). */
  provider: Pick<ChatProvider, 'hosted'>;
  registry: Registry;
  grants: ResearchGrants;
  sources: SourceCollector;
  /** Daily caps; false refuses the call with the limit sentence. */
  take(kind: 'search' | 'fetch'): { allowed: true } | { allowed: false; message: string };
  fetchImpl?: typeof fetch;
  resolve?: Resolver | null;
}

export interface ResearchKit {
  tools: AgentTool<any>[];
  hosted: HostedTool[];
  /** One line for the prompt: what the agent can use to find things out. */
  describe: string;
}

const ok = (payload: unknown, summary: string) => ({ ok: true as const, content: typeof payload === 'string' ? payload : JSON.stringify(payload), summary });
const fail = (error: string) => ({ ok: false as const, error });

export function researchTools(ctx: ResearchContext): ResearchKit {
  const tools: AgentTool<any>[] = [];
  const hosted: HostedTool[] = [];
  const can: string[] = [];

  if (ctx.grants.webSearch) {
    if (hostsSearch(ctx.provider)) {
      hosted.push({ type: 'web_search' });
      can.push('search the web (your built-in web search)');
    } else {
      tools.push({
        spec: {
          name: 'web_search',
          description: 'Search the web for current information. Returns a short cited answer and its source URLs.',
          parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for, specific and self-contained' } }, required: ['query'], additionalProperties: false },
        },
        async execute(args: { query?: unknown }, tc) {
          const query = typeof args.query === 'string' ? args.query : '';
          if (!query.trim()) return fail('Say what to search for.');
          const cap = ctx.take('search');
          if (!cap.allowed) return fail(cap.message);
          try {
            const r = await searchWeb(ctx.registry, query, { signal: tc.signal });
            ctx.sources.addAll(r.sources);
            return ok({ answer: wrapExternal(`web search: ${query}`, r.answer), sources: r.sources }, `Searched: ${query.slice(0, 80)}`);
          } catch (err) {
            return fail(err instanceof Error ? err.message : 'The search failed.');
          }
        },
      });
      can.push('search the web (web_search)');
    }
    if (ctx.grants.xSearch && hostsSearch(ctx.provider, 'x_search')) {
      hosted.push({ type: 'x_search' });
      can.push('search posts on X');
    }
  }

  if (ctx.grants.fetchPage) {
    tools.push({
      spec: {
        name: 'fetch_page',
        description: 'Read a public web page as text (title and main content). Use it for a known URL, for example one a search returned.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The http(s) URL to read' },
            max_chars: { type: 'integer', description: 'Most characters to return (default 20000, at most 60000)' },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
      async execute(args: { url?: unknown; max_chars?: unknown }, tc) {
        const url = typeof args.url === 'string' ? args.url : '';
        if (!url) return fail('Give the URL to read.');
        const cap = ctx.take('fetch');
        if (!cap.allowed) return fail(cap.message);
        try {
          const page = await fetchPage(url, {
            maxChars: typeof args.max_chars === 'number' ? args.max_chars : 20_000,
            signal: tc.signal,
            ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
            ...(ctx.resolve !== undefined ? { resolve: ctx.resolve } : {}),
          });
          ctx.sources.add({ url: page.finalUrl, ...(page.title ? { title: page.title } : {}) });
          return ok({ title: page.title, url: page.finalUrl, truncated: page.truncated, text: wrapExternal(page.finalUrl, page.text) }, `Read ${new URL(page.finalUrl).hostname}`);
        } catch (err) {
          return fail(err instanceof FetchPageError ? err.message : 'Could not read that page.');
        }
      },
    });
    can.push('read a web page (fetch_page)');
  }

  const describe = can.length ? `You can ${can.join(', ')}. Cite the sources you rely on by name, and mark anything you could not confirm as (unverified).` : '';
  return { tools, hosted, describe };
}
