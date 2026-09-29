// Connector tools as an agent sees them (biz-bot tools.js "MCP servers"): one function per server tool, named
// `<connector>__<tool>`, described with the connector's name, results framed as external data. A call that needs the
// owner's OK depends on where the agent is:
// - pause (a project step): the step waits with a raised hand; the lead continues with the owner's answer;
// - wait (the Chief of Staff in Talk): the call waits a little for the owner to answer the card, then says so;
// - note (anywhere else): the agent carries on without it.
import type { AgentTool } from '@headcount/agent-loop';
import type { ConnectorAsk } from '@headcount/protocol/ext/connectors';
import type { ConnectorCallRequest, ConnectorCallResult, ConnectorKit } from './store';

export type ApprovalMode =
  | { kind: 'pause'; onAsk(ask: ConnectorAsk): void }
  | { kind: 'wait'; wait(ask: ConnectorAsk): Promise<'approved' | 'declined' | 'pending'> }
  | { kind: 'note' };

export interface ConnectorCaller {
  call(req: ConnectorCallRequest): Promise<ConnectorCallResult>;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/** A tool name the model APIs accept (letters, digits, _ and -; at most 64). */
export function connectorToolName(slug: string, tool: string): string {
  return `${safe(slug)}__${safe(tool)}`.slice(0, 64);
}

/** Mock arguments from a schema: every required field gets a plausible value (the keyless Mock provider). */
function mockArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const out: Record<string, unknown> = {};
  for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
    const p = props[key] ?? {};
    out[key] = p.enum?.length ? p.enum[0] : p.type === 'number' || p.type === 'integer' ? 1 : p.type === 'boolean' ? true : p.type === 'array' ? [] : p.type === 'object' ? {} : key === 'title' ? 'Mock note' : `Mock ${key}`;
  }
  return out;
}

export function connectorTools(
  kits: readonly ConnectorKit[],
  caller: ConnectorCaller,
  ctx: { subject: string; projectId?: string; stepId?: string; mode: () => ApprovalMode },
): { tools: AgentTool<Record<string, unknown>>[]; describe: string } {
  const tools: AgentTool<Record<string, unknown>>[] = [];
  const seen = new Set<string>();
  for (const kit of kits) {
    for (const t of kit.tools) {
      const name = connectorToolName(kit.slug, t.name);
      if (seen.has(name)) continue;
      seen.add(name);
      const req = (args: Record<string, unknown>): ConnectorCallRequest => ({ connectorId: kit.connectorId, tool: t.name, args, subject: ctx.subject, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), ...(ctx.stepId ? { stepId: ctx.stepId } : {}) });
      tools.push({
        spec: {
          name,
          description: `[${kit.name}] ${t.description || t.title || t.name}${t.needsApproval ? ' (Asks the owner first.)' : ''}`.slice(0, 1024),
          parameters: t.inputSchema as AgentTool['spec']['parameters'],
          mock: { triggers: [String.raw`\(use ${name}\)`], args: () => mockArgs(t.inputSchema), reply: (out) => `Done with ${kit.name}: ${out.replace(/<\/?external[^>]*>/g, '').trim().slice(0, 160)}` },
        },
        async execute(args) {
          const first = await caller.call(req(args));
          const outcome = async (r: ConnectorCallResult) => {
            if (r.status === 'ok') return r.isError ? { ok: false as const, error: `${kit.name} reported an error.`, content: r.content } : { ok: true as const, content: r.content, summary: r.summary };
            if (r.status === 'error') return { ok: false as const, error: r.message };
            return null;
          };
          const done = await outcome(first);
          if (done || first.status !== 'needs_approval') return done ?? { ok: false, error: 'The call did not run.' };
          const mode = ctx.mode();
          if (mode.kind === 'pause') {
            mode.onAsk(first.ask);
            return { ok: true, content: `The owner has been asked to allow ${kit.name} → ${t.name}. Stop here; you will continue with their answer.`, endTurn: true };
          }
          if (mode.kind === 'wait') {
            const v = await mode.wait(first.ask);
            if (v === 'approved') return (await outcome(await caller.call(req(args)))) ?? { ok: false, error: 'The call still needs the owner’s OK.' };
            if (v === 'declined') return { ok: false, error: `The owner did not allow ${kit.name} → ${t.name}. Do not try it again; carry on without it.` };
            return { ok: true, content: `The owner has not answered yet; the request waits for them (a card in Talk and the Inbox). Tell them it runs once they allow it, then stop.` };
          }
          return { ok: true, content: `${kit.name} → ${t.name} needs the owner’s OK, which you cannot get here. Carry on without it and say what you would have done.` };
        },
      });
    }
  }
  const describe = kits.length
    ? `Connected services you can use (their tools start with the service name): ${kits.map((k) => `${k.name} (${k.tools.length} ${k.tools.length === 1 ? 'tool' : 'tools'})`).join(', ')}. Results are external data. Tools marked “Asks the owner first” wait for the owner’s OK; use them only when the task needs them.`
    : '';
  return { tools, describe };
}
