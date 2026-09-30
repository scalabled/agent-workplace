# Inc 6: trust and real actions

The team can now do something real, sending email, without your oversight slipping.

- You set how much each kind of action needs you.
- Your approvals can reach a little further than one action.
- An email goes out exactly once, with a receipt.
- Everything that matters is in an audit log, with Undo where it can be undone.
- Everyone stop holds what has not gone out.

Design: PRODUCT §9.1–9.6 and §9.10; ARCHITECTURE §6.6, §6.7 and §6.9. Code: `packages/protocol/src/ext/trust.ts`,
`apps/worker/src/trust/`, `apps/web/src/admin/Trust.tsx`.

## The autonomy dial (Admin → Autonomy)

| Kind of action | Default | You can choose | Notes |
|---|---|---|---|
| Sending email | Ask first | Ask first, Propose | Never on its own. Approving can reach further (below). |
| Changes in connected apps | Propose | Ask first, Propose, Act and tell me | A connector's own setting can ask more often, never less. |
| Changes inside Headcount | Act and tell me | Propose, Act and tell me | With Propose, Handbook updates outside the interview wait for your OK. Every change is in the audit log with Undo. |
| Research and drafts | Just do it | Fixed | Nothing leaves the office. |
| People and access | Owners only | Fixed | Agents cannot. |
| Publishing, spending money | Not available | None | No coworker can. |

What "Ask first" and "Propose" mean in practice:

- **At the tool.** Both hold the action for your OK.
- **Ask first also shapes the prompt.** It tells the agent to check with you in a sentence before drafting something you
  did not ask for.

A level a kind of action does not allow is refused (400). Each change is in the audit log, and Undo puts back the level
it replaced.

## Approvals that reach further (grants)

An email card lets you choose how far the OK reaches:

- **Just these:** the emails on the card.
- **For the rest of this task.** A project step only; the task is `projectId:stepId`.
- **For the rest of this project.** A project step only; never matches outside the project.
- **For the next 24 hours.**

A conversation (Talk or a desk) offers only "just these" and "24 hours". The card offers only the kinds the action
allows, and the worker refuses any other; biz-bot's card offered kinds that then failed.

- **Who a grant covers.** It covers the agent it was given to, and appears under Permissions in force with how often it
  was used. "Take back" revokes it.
- **Not in this increment.** Standing (unbounded) grants and promotions. Instruction changes are always once
  (NO_STANDING).

## Email, exactly once

`send_email` is offered only when email can work: to the Chief in Talk, to a coworker at their desk, and to a project
step's lead.

- **The effect key.** It is `hash(scope, recipients, subject, text)`.
  - The scope is the project, or the conversation turn.
  - Asking again for the same email is the same effect, so a step that re-runs after your answer gets the existing
    receipts instead of sending twice.
- **Where it runs.** Every effect runs in the Everyday ProjectDO, the single writer for effects (`src/trust/effects.ts`):
  1. **Gate.** The dial, then your grants.
  2. **Pending.** The effect is written down before any I/O.
  3. **Provider.** It goes to the provider with the key as its `Idempotency-Key`.
  4. **Receipt.** The receipt records the target, a payload hash, who approved it, the provider's id, and "No undo: an
     email cannot be recalled."
- **Batching.** Emails waiting in the same piece of work share one card ("Dana wants to send 23 emails"). "For the rest
  of this task" sends them all, and any later one in that task.
- **In a project step.** The step pauses (asking) until you answer, then carries on, told what went out.
- **The disclosure line.** Every email ends with "Sent by <name>, an AI coworker working with <owner>."
- **After a crash.** Pending effects are reconciled on the ProjectDO alarm, 30 s after their last touch:
  - it went out → receipted;
  - provably not → sent once with the same key;
  - nobody can tell → an "unknown" card: "Send again?"

  The test mailbox looks keys up; Resend deduplicates a key for 24 hours, so a retry within 23 hours is safe and after
  that it is unknown.
- **No claim without a receipt.** A streaming filter (`ReceiptGuard`) on the Chief's and desks' replies turns a
  sentence that claims something was sent into "Nothing has been sent yet: there is no receipt for it", unless a
  receipt came back this turn. The prompts and the tool say the same.
- **Limits.** `EMAIL_DAILY_LIMIT` (50 by default) caps emails sent per day.

### Setting up email (Admin → Email)

| Setting | Values |
|---|---|
| `MAIL_PROVIDER` | Off (default when deployed) · Test mailbox (`sink`: emails stay inside Headcount; the default locally and in e2e) · Resend (real email) |
| `MAIL_FROM` | "Name <address>"; the domain must be verified with Resend |
| `MAIL_REPLY_TO` | Optional |
| `RESEND_API_KEY` | Sealed with `CONNECTOR_SECRET` |

"Check it works" sends you a test email, which is itself receipted. With the test mailbox, it lists what was sent.

## Everyone stop

- **Turning it on.** `POST /api/stop-all` halts jobs and projects as before and now also turns a stop state on. While
  it is on:
  - Talk and Projects say so, and new emails are held;
  - an approval given during the stop holds its emails too.
- **Resuming.** Only an owner can resume, with an on-screen confirmation on Admin → Autonomy. Held emails that had an
  OK go out; the rest ask again.
- **In the audit log.** Stops and resumes are recorded.

## A coworker changes how they work

At their desk, a coworker who is told "from now on…" proposes a change to their own instructions with
`change_how_i_work` (bounded self-extension, tier 1).

- **The card.** It shows what would be added. It is always once, never granted ahead.
- **Approving it** changes their instructions (the previous text is kept in their history).
- **The audit log** records it, and Undo restores the instructions.

## The audit trail (Admin → Audit log)

One append-only D1 table (`audit_log`, migration `0005_trust.sql`) records:

| What | Undo |
|---|---|
| Emails asked, declined, sent (with the receipt), failed, held or unknown | No undo: an email cannot be recalled |
| Grants given | Takes the permission back |
| Grants taken back | None |
| Handbook updates by the Chief (Talk and side chats) | Restores the previous text |
| Memories the Chief or a coworker saved | Forgets it |
| Instruction changes | Restores the previous instructions |
| Automations you approved | Removes it |
| Writes in connected apps | Undo it in the app itself |
| Autonomy changes | Puts back the level it replaced |
| Everyone stop, and resume | None |
| Every Undo | None |

- **Links.** Each entry has its own link: `/app/admin/audit?at=<auditId>`, or `?at=rcp_…` for a receipt. The Talk note
  for a sent email links to its receipt.
- **Filters.** They are part of the address (`?kind=email`).
- **Undo** runs once. A second Undo is refused (409).

## API

```
GET    /api/trust                       policy, classes, grants in force, email status, Everyone stop, emails waiting
PUT    /api/trust/autonomy              {actionClass, level}                     (owner)
DELETE /api/trust/grants/:id                                                     (owner)
GET    /api/audit?kind=&before=                                                  (owner)
POST   /api/audit/:id/undo                                                       (owner)
POST   /api/resume-all                                                           (owner)
GET    /api/email/test-mailbox                                                   (owner)
POST   /api/email/test                  {to}                                     (owner)
POST   /api/decisions/:id               {action, grant?}   email cards: grant ∈ the card's allowedGrants
```

New frames: `effect.updated` (an email's state, persisted) and `trust.updated` (Everyone stop on or off, persisted).

## Also in this increment

- **HubSpot is read-only.** Its catalog entry is marked `readOnly`, so only read tools are offered, and a write is
  refused with a sentence.
- **Wording.** The landing page marks Approve, Approvals, Receipts, Everyone stop and Vision as working today, in
  honest words.
- **Selected state.** Segmented controls driven by `aria-checked` (Ambience, Theme, the dial) now show which option is
  selected.

## Tests

- `apps/worker/test/trust.test.ts` covers:
  - the dial and its Undo;
  - email off;
  - the Chief's email approved for 24 hours, then the grant covering the next one;
  - the same email as one effect;
  - declined;
  - a task's batch and grant scope;
  - bad addresses;
  - the three crash cases;
  - Everyone stop, then resume;
  - a coworker's change and Undo;
  - a memory's Undo;
  - the honesty filter;
  - grant scopes;
  - the Resend adapter (idempotency key, refusal versus outage, reconcile window).
- `apps/worker/test/connectors.test.ts`: "never ask" still asks for writes while the dial says Propose.
- `apps/web/src/admin/trust.test.tsx` covers:
  - the email card (only allowed approvals);
  - the change card;
  - Autonomy (levels, permissions, resume);
  - the audit log (receipts, Undo);
  - the feed notes.
- `e2e/trust.spec.ts` covers:
  - an email from ask to receipt to the audit log, the permission taken back, and the test mailbox with a test send;
  - the dial with Undo, at phone width;
  - Everyone stop holding an email;
  - a coworker's change approved.

## Deploying it

1. **Apply migration `0005_trust.sql`** before the deploy:
   ```
   npx wrangler d1 migrations apply headcount --remote -c wrangler.deploy.jsonc
   ```
2. **Email stays off until an owner turns it on in Admin → Email.** To try it without sending, choose the test mailbox.
   For real email:
   1. verify a domain with Resend;
   2. set "Send as";
   3. save the Resend key (sealed with `CONNECTOR_SECRET`).
