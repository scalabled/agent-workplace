# Link-first

Everything in the office has an address people can share with a teammate or paste to an agent. Copying one is always
one click, and opening one takes you to that exact thing.

## Addresses

- **Places** have paths: `/app/talk`, `/app/memory`, `/app/admin/limits`, `/app/desk/<persona>/profile?tab=work`.
- **Items** on a page are `?at=<anchor>`. A query survives the Google sign-in round trip; a hash would not.

| Item | Link |
|---|---|
| A Talk message | `/app/talk?at=msg_…` |
| A desk chat line | `/app/desk/<persona>/profile?at=msg_…` |
| A project step, meeting, channel line | `/app/projects/prj_…?at=step-s2` · `?at=mtg_…` · `?at=ch-<seq>` |
| A raised hand | `/app/inbox?at=dec_…` |
| A background job | `/app/projects?at=job_…` |
| A memory, a file | `/app/memory?at=mem_…` · `?at=card_…` (a project's or coworker's file links to their page) |
| A Handbook section | `/app/handbook?at=hb-<section>` |
| A setting | `/app/admin/<group>?at=setting-<KEY>` |
| A connector, an automation | `/app/connectors?at=cn-…` · `/app/automations?at=aut-…` |
| A spot in a document | the document's page `?at=<block anchor>` |
| A side chat in a document | the document's page `?thread=thr_…&at=<block anchor>` |

- **Copy link** sits next to every page title and on each item: messages show it on hover, and it is always visible
  on touch screens. ⌘K also has "Copy link to this page".
  - It puts the full address on the clipboard and confirms with a toast.
  - A modifier-click opens the link like any other.
- **Opening a link.** `revealLinked()` (`apps/web/src/links/links.ts`) waits up to 12 s for the page to load the item.
  Talk, for example, replays its history first. Then it:
  - opens any `<details>` around the item, and components open their own folded items (a step, a meeting, a job)
    when `linkTarget` names them;
  - scrolls the item to the middle of the screen;
  - highlights it for 4 s.

  If the item is gone, a toast says so.
  - Talk stops following the conversation to the end while a link points at an older message.
  - A link to a memory the list would not show (a file excerpt) fetches that one item (`GET /api/memory/:id`).
- **The router.** `apps/web/src/router.ts` keeps the query in a `search` signal (`linkTarget`, `queryParam`,
  `setQuery`, `linkTo`). Moving to another item on the same page neither opens a new page nor jumps to the top.

## Working inside documents

**Anchors.** Every block of a document has a stable anchor. `anchorBlocks()` in `packages/protocol/src/ext/threads.ts`
gives headings `h-<slug>` and other blocks `b-<n>`, behind a per-document prefix in the app. It is shared by:

- the canvas's document pages (worker);
- the app's Markdown, for project deliverables (`dl-`), job write-ups (`<jobId>-`) and Handbook sections
  (`hb-<section>-`).

**Selecting a passage** shows a small bar:

- **Ask <agent>** opens the document's side chat with the passage quoted.
- **Copy link to here** copies a link to that spot.
- Inside a canvas document the selection comes from the sandboxed frame. One script of ours posts the selected text
  and its block to the page. It is allowed by its SHA-256 in the CSP, and never included in a download or print.
  The frame gets `allow-scripts` but never our origin.
- A link to a spot in a canvas document opens the frame at `#anchor`, where `:target` highlights it.

**Side chats** (`ext/threads.ts`; `apps/worker/src/threads`; WorkspaceDO tables `doc_threads` and `doc_messages`):

- Each thread is pinned to a passage, and answered by whoever wrote or keeps the document:
  - the Chief of Staff for a canvas, a job's write-up and the Handbook;
  - the project's finisher or lead for a deliverable.
- The agent answers about that exact passage, in its own voice, with the document and what the workspace knows. It
  never answers with only a refusal: it offers what it can do instead, or who would handle it.
- Asked for a change:
  - a canvas gets a new version, with the instruction naming the passage;
  - the Handbook section is rewritten.
- A deliverable or write-up answer gives the improved passage to paste.
- Threads can be resolved and reopened. Each has its own link.
- Replies count against the daily reply limit and are metered as desk usage.

```
GET  /api/threads?doc=canvas:cnv_…|deliverable:prj_…|job:job_…|handbook
POST /api/threads {doc, anchor, quote, text}   → the thread with the agent's answer
POST /api/threads/:id {text}
PUT  /api/threads/:id {status: 'open' | 'resolved'}
```

## Tests

- `packages/protocol/src/ext/threads.test.ts` covers anchors.
- `apps/worker/test/threads.test.ts` covers side chats on a canvas document (answered, then revised), the Handbook
  (rewritten) and a deliverable (the finisher answers). `apps/worker/test/canvas.test.ts` covers anchors and the
  hashed script.
- `apps/web/src/links/links.test.tsx` covers links, reveal, Copy link, and a selection asked about.
- `e2e/links.spec.ts` covers:
  - a message link opened in a new tab;
  - memory and setting links;
  - a canvas passage asked about, and its conversation link;
  - the Handbook rewritten from a side chat.
