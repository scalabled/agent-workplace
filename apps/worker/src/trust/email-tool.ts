// send_email (Inc 6): one tool for the Chief of Staff, a coworker at their desk, and a project step's lead. The email
// is asked for, not sent directly: it goes out exactly once when the owner's autonomy setting and grants allow, and the
// tool says truthfully what happened (sent with a receipt id, waiting for the OK, held, declined, or not sent).
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { EmailMessage } from '@headcount/protocol/ext/trust';
import { EffectError, effectGuidance, effectSay, type EffectResult } from './effects';

export interface EmailToolPort {
  request(email: EmailMessage): Promise<EffectResult>;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,;]/) : []).map((x) => x.trim()).filter(Boolean);
const sayOf = (out: string) => {
  try {
    return String((JSON.parse(out) as { say?: unknown }).say ?? 'Done.');
  } catch {
    return out;
  }
};

/** Mock hint (keyless tests): "email jo@example.com about …" sends to the address with the rest as the message. */
const EMAIL_ADDRESS = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;
export const EMAIL_TRIGGERS = [String.raw`\b(e-?mail|send (an )?e-?mail to|write to)\b[^@]*` + EMAIL_ADDRESS];

function mockArgs(text: string): Record<string, unknown> {
  const to = [...text.matchAll(new RegExp(EMAIL_ADDRESS, 'g'))].map((m) => m[0]);
  const about = /\babout ([^.?!]+)/i.exec(text)?.[1]?.trim();
  return { to, subject: about ? about[0]!.toUpperCase() + about.slice(1, 80) : 'A quick note', text: `Hello,\n\n${text.replace(new RegExp(EMAIL_ADDRESS, 'g'), '').replace(/\s+/g, ' ').trim()}\n\nBest wishes` };
}

/**
 * `onResult` lets the host react (a project step pauses while emails wait; a desk reply may then say "sent").
 * `owner`: how the owner is named in what the tool says.
 */
export function sendEmailTool(port: EmailToolPort, opts: { owner?: string; test?: boolean; onResult?(r: EffectResult): void; endTurnWhenWaiting?: boolean } = {}): AgentTool<{ to?: unknown; cc?: unknown; subject?: unknown; text?: unknown }> {
  const owner = opts.owner ?? 'the owner';
  return {
    spec: {
      name: 'send_email',
      description: [
        `Send an email for the business (to a customer, supplier or anyone outside). It goes out only with ${owner}'s OK unless they allowed more, and exactly once: asking again for the same email does not send it twice.`,
        'Write the whole email: a clear subject, and plain text a busy person reads in 20 seconds, signed as yourself. A line saying you are an AI coworker is added.',
        `Use it when ${owner} asks you to email someone, or when the work plainly needs it and you have the address. Never guess an address: ask for it.`,
        `The result says what happened. Say "sent" only with a receipt id; otherwise say it is waiting for ${owner}'s OK.`,
        ...(opts.test ? ['Email is in test mode: it goes to a test mailbox inside Headcount and nothing leaves.'] : []),
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'array', items: { type: 'string' }, description: 'Email addresses.' },
          cc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          text: { type: 'string', description: 'The email in plain text, greeting to sign-off.' },
        },
        required: ['to', 'subject', 'text'],
        additionalProperties: false,
      },
      mock: { triggers: EMAIL_TRIGGERS, args: mockArgs, reply: sayOf },
    },
    async execute(args): Promise<ToolOutcome> {
      let r: EffectResult;
      try {
        r = await port.request({ to: list(args.to), ...(list(args.cc).length ? { cc: list(args.cc) } : {}), subject: str(args.subject), text: str(args.text) });
      } catch (err) {
        if (err instanceof EffectError) return { ok: false, error: JSON.stringify({ error: err.message, fix: 'Fix it and call send_email again, or ask the owner.', say: err.message }) };
        throw err;
      }
      opts.onResult?.(r);
      const say = effectSay(r);
      if (r.status === 'failed') return { ok: false, error: JSON.stringify({ error: say, fix: effectGuidance(r), say }) };
      const payload = { status: r.status, ...(r.status === 'done' ? { receiptId: r.receipt.receiptId, to: r.receipt.target } : {}), say, guidance: effectGuidance(r) };
      return { ok: true, content: JSON.stringify(payload), summary: r.status === 'done' ? `Sent (receipt ${r.receipt.receiptId})` : r.status === 'awaiting' ? 'Waiting for the OK to send' : `Email ${r.status}`, ...(opts.endTurnWhenWaiting && r.status === 'awaiting' ? { endTurn: true } : {}) };
    },
  };
}

/** A streaming filter for replies that may talk about email: a sentence claiming something was sent, without a receipt this turn, becomes the truth. */
const SENT_CLAIM_RE = /\b(I|I've|I have|we|we've|we have|it's|it has|it was|they've|that's|email (?:has been|was|is))\b[^.?!\n]{0,60}\b(sent|emailed|e-mailed|delivered|gone out|went out)\b/i;
const NEGATED_RE = /\b(not|never|yet to|waiting|once|when|after|if|until|before|will|would|can|could|should)\b|n't\b/i;

export function claimsSent(sentence: string): boolean {
  return SENT_CLAIM_RE.test(sentence) && !NEGATED_RE.test(sentence) && !/\brcp_[a-f0-9]+/i.test(sentence);
}

export class ReceiptGuard {
  private buf = '';
  constructor(
    private readonly receipts: () => number,
    private readonly line = 'Nothing has been sent yet: there is no receipt for it.',
  ) {}

  push(delta: string): string {
    this.buf += delta;
    let out = '';
    for (;;) {
      const m = /[.!?](?=\s)|\n/.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      out += this.check(this.buf.slice(0, end));
      this.buf = this.buf.slice(end);
    }
    return out;
  }

  flush(): string {
    const rest = this.buf;
    this.buf = '';
    return rest ? this.check(rest) : '';
  }

  private check(sentence: string): string {
    if (this.receipts() > 0 || !claimsSent(sentence)) return sentence;
    const lead = /^\s*/.exec(sentence)?.[0] ?? '';
    return `${lead}${this.line}`;
  }
}
