# Helpful first: fewer refusals, self-correction, and the team working together

Nobody in the office answers with only a refusal. When something is outside what an agent can do, it does the part it
can, or passes the request to whoever can, and says so plainly.

## Coworkers at their desk (quick chats)

A coworker's desk chat now has tools (`apps/worker/src/desk/desk-tools.ts`):

| Tool | What happens |
|---|---|
| `start_research` | A background job starts (the Chief of Staff tracks it; the result lands in Talk and on Projects). |
| `propose_project` | A team project is proposed; the plan waits for the owner's OK in the Inbox. |
| `ask_colleague` | A colleague, found by name or role ("Maya", "the bookkeeper"), answers in their own voice; the answer is passed on. |
| `remember_this` | The whole team remembers it (Memory, "Told <name>"). |

- **Prompt.** The desk prompt says "helpful first", and offers drafts or research in place of outside actions (send,
  book, pay, publish). It also tells coworkers to self-correct after a failed tool.
- **Reply guard.** Once a tool has really started something, the guard allows the coworker to say so. Until then it
  replaces unfounded work claims with an offer ("I can start that as research or propose it as a project…") rather
  than a refusal.

## The Chief of Staff

- `ask_coworker` asks a coworker in their field and relays their answer.
- `hand_to_coworker` puts the owner's request on the coworker's desk ("Eddie passed this on from Talk: …"). They
  answer there and can start the work. The Chief replies with a link to their desk.
- **Prompt rules:**
  - helpful first (the nearest useful thing now, never only a refusal);
  - self-correct on tool errors (fix and retry, or take another route, before telling the owner);
  - link what you mention (`/app/projects/<id>`, `/app/desk/<persona>/profile`, `/app/canvas/<id>`…).

  Links inside Markdown open in place in the app.

## Project work

The coworker prompt for team project steps adds two rules:

- **Helpful first:** always deliver something usable, say what is missing, and name who could provide it.
- **Self-correct:** fix and retry after a failed tool, and check the draft against the brief before handing it in.

## Finding a colleague

A request can name a colleague in three ways; the first that matches wins:

1. their full name or id;
2. their first name;
3. their role, scored against title, department and one-liner (`findColleague` in the WorkspaceDO).

A consult is one model call with the colleague's own desk prompt and what the workspace knows. It goes through the
reply guard, counts against the daily reply limit, and is metered as desk usage under the colleague.

## Tests

`apps/worker/test/team.test.ts` covers:

- research started from a desk;
- remembered from a desk;
- a colleague asked by role;
- the Chief asking a coworker, and handing to one with a link;
- an unknown name answered with a way forward.
