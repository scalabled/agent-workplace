import type { FinishReason, ModelEvent, ToolCall } from './types';

export interface CollectedTurn {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  citations: { url: string; title?: string }[];
  usage: { input: number; output: number; usd: number | null };
  finish: FinishReason | null;
  error: { message: string; code?: string; status?: number; retryable?: boolean } | null;
}

/** Reduce a provider stream to one result (biz-bot util.js collectEvents) for non-streaming callers. */
export async function collectEvents(stream: AsyncIterable<ModelEvent>, onEvent?: (e: ModelEvent) => void): Promise<CollectedTurn> {
  const out: CollectedTurn = { text: '', reasoning: '', toolCalls: [], citations: [], usage: { input: 0, output: 0, usd: 0 }, finish: null, error: null };
  for await (const e of stream) {
    onEvent?.(e);
    switch (e.type) {
      case 'text':
        out.text += e.delta;
        break;
      case 'reasoning':
        out.reasoning += e.delta;
        break;
      case 'tool_call':
        out.toolCalls.push({ id: e.id, name: e.name, arguments: e.arguments });
        break;
      case 'citation':
        out.citations.push({ url: e.url, ...(e.title !== undefined ? { title: e.title } : {}) });
        break;
      case 'usage':
        out.usage.input += e.input;
        out.usage.output += e.output;
        out.usage.usd = out.usage.usd === null || e.usd === null ? null : out.usage.usd + e.usd;
        break;
      case 'done':
        out.finish = e.finish;
        break;
      case 'error':
        out.error = { message: e.message, ...(e.code !== undefined ? { code: e.code } : {}), ...(e.status !== undefined ? { status: e.status } : {}), ...(e.retryable !== undefined ? { retryable: e.retryable } : {}) };
        break;
    }
  }
  return out;
}
