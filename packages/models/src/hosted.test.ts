// Provider-hosted web search (biz-bot parity): each adapter sends its native search tool only when asked, next to
// function tools where the provider allows it (Gemini grounding only alone), and parses sources as citations.
import { describe, expect, it } from 'vitest';
import { collectEvents } from './collect';
import { createAnthropicProvider, WEB_SEARCH_TOOL, WEB_SEARCH_TOOL_STABLE } from './adapters/anthropic';
import { createGeminiProvider } from './adapters/gemini';
import { createOpenAIProvider } from './adapters/openai';
import { createXaiProvider } from './adapters/xai';
import { hostedFor } from './lib/hosted';
import { createMockProvider, MOCK_SOURCE } from './mock';
import { collect, fakeFetch, jsonResponse, sseResponse } from './testing/fake-fetch';
import type { ChatProvider, ChatRequest, ToolSpec } from './types';

const tools: ToolSpec[] = [{ name: 'submit_work', description: 'Submit', parameters: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] } }];
const ask = (over: Partial<ChatRequest> = {}): ChatRequest => ({ messages: [{ role: 'user', content: 'What is the latest on solar tariffs?' }], hostedTools: [{ type: 'web_search' }], ...over });
const responsesDone = [{ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 3 } } }];

describe('hostedFor', () => {
  it('sends only what the provider hosts, and solo tools only without function tools', () => {
    const req = ask({ hostedTools: [{ type: 'web_search' }, { type: 'x_search' }] });
    expect(hostedFor(req, { web_search: 'with_tools' }, true).map((t) => t.type)).toEqual(['web_search']);
    expect(hostedFor(req, { web_search: 'solo' }, true)).toEqual([]);
    expect(hostedFor(req, { web_search: 'solo' }, false).map((t) => t.type)).toEqual(['web_search']);
    expect(hostedFor({ ...req, toolChoice: 'none' }, { web_search: 'with_tools' }, false)).toEqual([]);
    expect(hostedFor(req, undefined, false)).toEqual([]);
  });
});

describe('OpenAI and xAI (Responses API)', () => {
  it('OpenAI adds web_search next to function tools and asks for sources; parses them as citations', async () => {
    const f = fakeFetch(() =>
      sseResponse([
        { type: 'response.output_item.done', item: { type: 'web_search_call', action: { sources: [{ url: 'https://news.example.org/a', title: 'Tariffs' }] } } },
        { type: 'response.output_text.delta', item_id: 'm', delta: 'They rose.' },
        ...responsesDone,
      ]),
    );
    const chat = createOpenAIProvider({ OPENAI_API_KEY: 'sk-test-0123456789' }, { fetch: f })!.chat as ChatProvider;
    expect(chat.hosted).toEqual({ web_search: 'with_tools' });
    const out = await collectEvents(chat.chat(ask({ tools, toolChoice: 'auto' })));
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.tools.map((t: { type: string }) => t.type)).toEqual(['function', 'web_search']);
    expect(body.include).toEqual(['web_search_call.action.sources']);
    expect(out.citations).toEqual([{ url: 'https://news.example.org/a', title: 'Tariffs' }]);
    // Not asked: no search tool, no include.
    await collect(chat.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect((f.calls[1]!.body as Record<string, any>).tools).toBeUndefined();
  });

  it('xAI sends web and X search and suppresses inline citation markers', async () => {
    const f = fakeFetch(() => sseResponse([{ type: 'response.output_text.delta', item_id: 'm', delta: 'ok' }, ...responsesDone]));
    const chat = createXaiProvider({ XAI_API_KEY: 'xai-test-0123456789' }, { fetch: f })!.chat as ChatProvider;
    await collect(chat.chat(ask({ hostedTools: [{ type: 'web_search', allowedDomains: ['a.com'] }, { type: 'x_search' }] })));
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.tools).toEqual([{ type: 'web_search', filters: { allowed_domains: ['a.com'] } }, { type: 'x_search' }]);
    expect(body.include).toEqual(['web_search_call.action.sources', 'no_inline_citations']);
  });
});

describe('Anthropic', () => {
  const done = () =>
    sseResponse([
      ['message_start', { type: 'message_start', message: {} }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://gov.example.org/t', title: 'Gov' }] } }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }],
      ['message_stop', { type: 'message_stop' }],
    ]);

  it('adds the web search server tool and parses its results as citations', async () => {
    const f = fakeFetch(() => done());
    const chat = createAnthropicProvider({ ANTHROPIC_API_KEY: 'sk-ant-test-0123456789' }, { fetch: f })!.chat as ChatProvider;
    const out = await collectEvents(chat.chat(ask({ tools, toolChoice: 'auto', hostedTools: [{ type: 'web_search', maxUses: 3 }] })));
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.tools.at(-1)).toEqual({ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: 3 });
    expect(out.citations).toEqual([{ url: 'https://gov.example.org/t', title: 'Gov' }]);
  });

  it('falls back to the stable search tool once when the newest one is refused', async () => {
    const f = fakeFetch((_req, n) => (n === 0 ? jsonResponse({ error: { type: 'invalid_request_error', message: 'tools.1: unknown tool type web_search_20260209' } }, 400) : done()));
    const chat = createAnthropicProvider({ ANTHROPIC_API_KEY: 'sk-ant-test-0123456789' }, { fetch: f })!.chat as ChatProvider;
    const out = await collectEvents(chat.chat(ask()));
    expect(out.error).toBeNull();
    expect((f.calls[1]!.body as Record<string, any>).tools[0].type).toBe(WEB_SEARCH_TOOL_STABLE);
  });
});

describe('Gemini', () => {
  it('grounds with Google Search only in a call without function tools', async () => {
    const f = fakeFetch(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]));
    const chat = createGeminiProvider({ GEMINI_API_KEY: 'gm-test-0123456789' }, { fetch: f })!.chat as ChatProvider;
    await collect(chat.chat(ask()));
    expect((f.calls[0]!.body as Record<string, any>).tools).toEqual([{ google_search: {} }]);
    await collect(chat.chat(ask({ tools })));
    expect(JSON.stringify((f.calls[1]!.body as Record<string, any>).tools)).not.toContain('google_search');
  });
});

describe('Mock', () => {
  it('"finds" one labelled source for a lookup, and none for small talk', async () => {
    const chat = createMockProvider({}).chat!;
    const lookup = await collectEvents(chat.chat(ask()));
    expect(lookup.citations).toEqual([MOCK_SOURCE]);
    const chatty = await collectEvents(chat.chat(ask({ messages: [{ role: 'user', content: 'Thanks, that helps.' }] })));
    expect(chatty.citations).toEqual([]);
  });
});
