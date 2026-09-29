# Everyday people, your team, and the second brain

## The everyday recast

Every Chief of Staff and coworker has a common, easy name. Each name is true to the person's pronouns and heritage,
so the existing portraits still fit. Nobody has a plain job title and an everyday-word first name that clashes:
there are no Hope, Joy, Miles or Mark, which would be mistaken for ordinary words in speech and in @mentions.

- **Chiefs of Staff** have plain styles instead of archetype jargon. The twelve are:
  - Calm and steady, Patient teacher, Straight talker, Organised planner;
  - Numbers person, Big-picture thinker, Thoughtful strategist, Upbeat motivator;
  - Kind and supportive, Creative ideas person, Resourceful doer, Experienced and practical.

  Each also has a one-line tagline in plain words.
- **Coworkers** have plain job titles: "Sales rep", not "Account executive"; "Finance director", not "Fractional
  CFO"; "Online ads manager", not "Paid media manager".
- **Work prompts.** Every coworker's work prompt (`instructions`, up to 6,000 characters) is built from their own
  record, in this order:
  1. who they are, in plain words;
  2. how they work;
  3. what they hand over (deliverables and formats);
  4. their quality bar;
  5. a hand-in checklist;
  6. when to flag or hand on (the owner, a qualified professional, or a teammate);
  7. how they come across.

  The owner can still edit it per coworker.
- **What did not change.** Ids did not change, so portraits, voices, links, staffing and memory all carry over.

The recast ran once with `catalog/scripts/recast-everyday.mjs`.

- The script holds the mapping, checks that names are unique, not reserved and not voice ids, and replaces names in
  one pass everywhere they appear in the catalog: records, taxonomy, recipes, expressions and docs.
- It is **not idempotent**, because some new surnames were old first names. Do not run it again.
- `node catalog/scripts/validate.mjs` passes.
- **Landing voice samples.** The pre-recorded samples on the landing page still say the old names. They now play
  only when their text matches the current sample text; otherwise the page speaks it live. To record them again, run
  `node scripts/voice-samples.mjs --force`, which needs a running worker and a TTS key.

## Your team (`/app/team`, ⌘K "Your team")

The office starts with eight everyday roles (`STARTER_TEAM` in `packages/protocol/src/ext/team.ts`). Each has one
first job.

| Who | First job |
|---|---|
| Knowledge manager | **Tidy the company's second brain**: every week |
| Bookkeeper | A simple monthly money check-in (research) |
| Social media manager | A month of social posts (a team project, for the owner's OK) |
| Copywriter | A clearer website front page (research) |
| Head of customer support | Answers to the questions customers ask most (research) |
| Operations manager | A weekly running-the-business checklist (research) |
| Sales rep | Ten likely new customers (research) |
| Market research analyst | What our competitors are doing (research) |

- **The page.** The Chief of Staff comes first; their first job is writing the Handbook together, which starts the
  interview. Each coworker card has:
  - their voice;
  - "Say hello", which opens their desk;
  - "Start", after which the card links to the job or project;
  - a link of its own.
- **Finding it.** Talk shows a "Meet your team" card when a conversation is new. The Floor has "Your team", and a
  coworker's profile has "Add to your team" (owners).
- **The Chief's prompt** lists the team, so the Chief asks them (`ask_coworker`), hands them work
  (`hand_to_coworker`) and links to their desks.

## The second brain

The knowledge manager tidies the second brain every week. A WorkspaceDO alarm is set once there is a Chief of Staff.
The tidy (`apps/worker/src/memory/tidy.ts`):

1. **Merge duplicates** within each scope. It keeps the pinned memory first, then the owner's own words, then the
   newest.
2. **One review by the fast model** (a forced `second_brain_report` tool) of the memories against the Handbook:
   - memories that contradict each other;
   - memories that look out of date;
   - up to five things the Handbook is missing.

   Nothing is deleted on the model's word. The model call counts against the daily memory cap.
3. **Report and note.** The report is kept, and one quiet line goes to Talk with a link to it
   (`/app/memory?at=second-brain`).

On the Memory page, the report lets you:

- forget one side of a conflict, or a stale memory;
- add a Handbook suggestion to its section with one click;
- "Tidy now";
- turn the weekly tidy on or off (owners).

## API

```
GET  /api/team
PUT  /api/team {members: [personaId]}                       (owner)
POST /api/team/:personaId/start                            → {kind, jobId? | projectId? | report?, say}
PUT  /api/team/second-brain {on}                           (owner)
POST /api/team/second-brain/handbook {section, suggestion}
```

## Tests

- `apps/worker/test/team.test.ts`:
  - the starter team and the Chief's roster;
  - first jobs started;
  - the tidy: a duplicate merged, the note, a Handbook suggestion applied, the alarm off;
  - choosing the team.
- `apps/web/src/routes/team.test.tsx`.
- `e2e/team.spec.ts` covers:
  - meeting the team, then a first job started and followed;
  - tidy now, then reading the report;
  - adding someone from a profile.
