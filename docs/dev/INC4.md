# Inc 4 · Context and memory

What the workspace knows about the business, three ways. All of it lives in the WorkspaceDO (`apps/worker/src/memory`).

- **The Handbook** (`/app/handbook`, ⌘K "Handbook") is the owner's own description of the business in eight sections:
  - the business, customers, products and services, key clients and partners, people and roles, standing rules, voice
    and brand, goals.
  - The owner writes a section directly, or asks the Chief of Staff to interview them ("interview me", or the button).
  - During the interview the Chief asks about one missing section at a time and writes each answer up
    (`update_handbook`); "finish the interview" stops it.
  - It is in the Chief's prompt (compacted to 2,600 characters) and every coworker's work prompt (2,000), as reference,
    never instructions.
  - It downloads as `company.md`.
- **Memories** (`/app/memory`, ⌘K "Memory") are short, durable items: facts, preferences, decisions, people, clients
  and rules. They get there three ways:
  - Told: "remember that…" → `remember_this`, in the owner's own words.
  - Distilled after each Talk turn, desk chat and meeting by the fast model, with a forced `remember` tool, at most 5
    per exchange. Anything already known is skipped, and secrets are refused.
  - Added on the Memory page.

  A near-duplicate in the same scope (word overlap ≥ 0.8) refreshes the old item instead of adding another. A
  distillation never rewords something the owner said. Items can be edited, pinned (always recalled) or forgotten.
- **Files** (context cards): PDF, Word (.docx), Excel (.xlsx), CSV and text files, up to 10 MB.
  - Where a file is dropped sets its scope:
    - Talk (the paperclip, or a drop anywhere on Talk) and the Memory page: the whole workspace.
    - A project page: that project.
    - A coworker's profile ("How they work"): that coworker.
  - Each file is read to text (`unpdf`; the document XML inside a .docx or .xlsx via `fflate`) and kept in R2 at
    `ws/<ws>/cards/<id>.txt`. The text is cut into ~900-character excerpts, which are stored as searchable memories
    (kind `excerpt`).
  - A summary is written in the background.
  - Removing a file forgets its excerpts.

## Recall

Search is hybrid (`recall.ts`):

- BM25 over the words: stop words dropped, accents folded, a light stem.
- Cosine over embeddings, when an embeddings provider is set up. Items are embedded lazily, up to 256 per search, and
  a match by meaning alone must reach 0.35.
- The two rankings are fused by reciprocal rank (k = 60).

Who recalls what:

- **The Chief's turn** recalls against the owner's last message: pinned items plus the best matches, at most 10. They
  appear in the prompt as WHAT YOU REMEMBER. Those that actually matched (at most 4) are sent with the reply
  (`talk.message.recalled`) and shown as chips under it.
- **A coworker's step** recalls against the step's title and brief across three scopes: the workspace, the project,
  and that coworker.
- **Desk chats** recall against the owner's message across two scopes: the workspace and that coworker.

The figures recalled are allowed through the reply guard.

## Limits and safety

- Memory model calls (distillation, summaries) share a daily cap: `MEMORY_DAILY_LIMIT`, 400 by default.
- Distillation is skipped while the interview runs, since the answers go to the Handbook instead.
- Memory text is capped at 600 characters, excerpts at 1,200 and a Handbook section at 4,000. There are at most 200
  files.
- Nothing recalled is an instruction: blocks are labelled as reference, and the text of files and conversations is
  data.
- Passwords, keys and card numbers are refused by `remember_this` and filtered from distillation.

## API

```
GET    /api/memory?q=&scope=&kind=
POST   /api/memory {text, kind?, scope?}
PUT    /api/memory/:id {text?, kind?, pinned?}
DELETE /api/memory/:id
GET    /api/handbook
PUT    /api/handbook/:section {content}
POST   /api/handbook/interview
DELETE /api/handbook/interview
GET    /api/cards?scope=
POST   /api/cards?scope=      (raw bytes; X-File-Name)
GET    /api/cards/:id         (with the start of its text)
DELETE /api/cards/:id
```

Without `scope`, a memory search on the Memory page covers every scope.

## Tests

- `apps/worker/test/memory.test.ts` covers:
  - recall and file reading as pure functions;
  - told and recalled with chips;
  - distilled and merged;
  - the interview;
  - files: read, searched, removed;
  - knowledge in a coworker's step, and a kickoff meeting distilled.
- `apps/web/src/memory/memory.test.tsx` covers the Memory page, the Handbook, shared files, and chips.
- `e2e/memory.spec.ts` covers remembered then forgotten, the interview then editing and download, and a file shared
  in Talk and searched.

## Not in this increment

Vision snapshots (a camera or screen described by a vision model) came next; see [VISION.md](VISION.md).
