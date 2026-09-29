# Increment 1 · Hire a team in a sentence

Tell your Chief of Staff the outcome, "put together a team to launch our spring menu with a small campaign", and
they staff a named team from the catalog (a lead, specialists, one sceptic), draft a reviewed plan with a forecast,
and raise a hand in the Inbox. You approve it there or just say "go ahead". The team works two steps at a time; every
step is reviewed by a teammate and revised once if the reviewer asks. Their faces show who is working and who is
reviewing, and they sit together in a project pod in the office. The Chief tells you when the team is halfway and when
the deliverable is ready. While they work you can give direction (it reaches the next step, and nobody is stopped),
chat with anyone on the team about their live step, pause, resume, stop the project, or stop everything.

Binding inputs: [MVP-PLAN](../MVP-PLAN.md) Inc 1, [OWNER-DIRECTIVES](../OWNER-DIRECTIVES.md) (D2 communication
first, D3 minimalist, D5 living workforce), [catalog/FORMATION.md](../../catalog/FORMATION.md) (recipes, the sceptic,
voices).

---

## 1. Run it

Nothing new to install. The keyless Mock provider plays every role (placeholder work, reviews that approve), so the
whole flow runs in a few seconds with `pnpm dev --mock`; with keys, the work is real and a plan takes minutes (the
forecast says how many).

| Setting (worker env) | Default | What it caps |
|---|---|---|
| `PROJECT_DAILY_LIMIT` | 10 | New team projects per UTC day (each step is 2–3 model calls, plus the deliverable). |
| `MAX_ACTIVE_PROJECTS` | 2 | Projects proposed, running or paused at once. |
| `INTERRUPTION_BUDGET` | 6 | Unprompted updates the Chief says aloud per day (the halfway point). Past it, a quiet line. 0 = never. |

Storage needs no migration: the tables (`tprojects`, `tsteps`, `tdecisions`, `tnotes` in the Everyday ProjectDO;
`project_milestones` in the WorkspaceDO) are created on first use.

## 2. The flow

**Staff it.**
- In Talk, an ask for a multi-discipline outcome routes to `start_team_project` (Mock: "put together / assemble a
  team…", or "plan / run / organise … a launch, campaign, rebrand, pitch deck…"). A question that only *mentions* a
  launch stays a question.
- The fast model picks the playbook from a keyword shortlist of the catalog's 57 team recipes (keyword order is the
  fallback and Mock's pick). The team is the recipe's composition. The Chief explains it in one sentence: "Femi leads,
  with Kavya and Kemar (our launch playbook). Ruth is our sceptic, so we don't fool ourselves."
- **Voices** are resolved once per project (FORMATION §Voices): a matching over each member's recipe override, own
  voice and alternates, never the lead's voices, falling back to free voices of the same presentation. When one
  provider cannot keep a team distinct (more she/her members than OpenAI has free feminine voices), the team is marked
  to play through the other (`voice.prefer`). Checked for all 57 recipes under all 12 leads.

**The plan card.**
- The recipe's skeleton, at most 8 steps, each with an owner, reviewers from the team, dependencies and a "done when".
  The brief carries the owner's goal.
- **Forecast**: rounds of work (the longer of the dependency chain and two at a time), model calls, and minutes on a
  reasoning model. It is shown on the plan, in the Inbox and in the Chief's reply. There are no prices; model rates
  arrive in Inc 5.
- The plan waits as a raised hand: in the Inbox, on the project page, and on the project lead's face ("Waiting on you").
  Approve there, or tell the Chief "yes, go ahead" (`approve_team_project`, only on the owner's explicit OK). "Not now"
  declines it.

**The team works.**
- One alarm tick advances each running project by one unit: up to two ready steps at once, each **work → review →
  one revision if asked → done**, then the lead assembles the deliverable (Markdown, with the team's `(unverified)`
  markers kept).
- Model errors retry with backoff (3 attempts); a cancel fences out late results.
- Faces: the step owner shows *working* (the step title), the reviewer *thinking* ("Reviewing: …"). In the office, the
  team sits together in a **project pod** by the Chief's office while the project runs or is paused. They go back to
  their departments when it ends.
- **Milestones** (the interruption budget): once per project, at the halfway point, the Chief announces "Halfway on
  “…”: … done and reviewed. Kavya is on “…” now." Past the day's budget it is a quiet line in Talk (never voiced,
  never unread). The deliverable, or a failure, is always announced. Each links to the project.

**While they work (D2).**
- **Direction**: "Tell the team" on the project page, "also focus on Instagram" to the Chief (`steer_team_project`,
  to everyone or to one member), or a quick chat at a staffed coworker's desk. Each note is queued and picked up by the
  next step its addressee starts. Work already under way is not interrupted, and every later step of that person sees
  the note. The project page shows each note as *waiting for the next step* or *picked up in “…”*.
- **Quick chats with someone on the team** know their live part: their steps and review duties as they stand, and
  their latest draft. They may say truthfully that they are working on their step. The reply guard still replaces
  any claim or promise of an outside action ("I'll send it tonight") with "I can't send or book anything from here…".
  Direction-like lines ("make sure the offer works for regulars", "can you also cover pricing?") become a note for
  that coworker. Plain questions ("how's it going?") do not.
- **Pause / Resume** on the page or by voice (`pause_team_project`): a step already under way finishes and keeps its
  result, and nothing new starts until resume. **Stop project** ends it. **Everyone stop** on the Projects page, or
  "everyone stop" to the Chief (`stop_all_work`), halts every running job and team project. Plans waiting for an OK
  stay.

## 3. API and frames

| Route | |
|---|---|
| `GET /api/projects` | Projects (newest first) and open decisions (the Inbox). |
| `GET /api/projects/:id` | One project with full step outputs and deliverable (frames carry them clipped to 1,200 characters). |
| `POST /api/projects/:id/approve` · `/cancel` · `/pause` · `/resume` | 202 with the project. |
| `POST /api/projects/:id/note` | `{text, toId?, opId?}` → 202. Idempotent by opId. 409 once the project has ended. |
| `POST /api/stop-all` | `{stoppedJobs, stoppedProjects}`. |

Frames: `project.proposed` (project and decision), `project.updated`, and `decision.resolved`. `talk.message` gains
`projectId`, so a Chief reply or announcement about a project links to it ("See the team and plan", "Read the
deliverable").

Chief tools: `start_team_project`, `approve_team_project`, `team_project_status`, `steer_team_project`,
`pause_team_project`, `cancel_team_project` and `stop_all_work`. They are offered only when they apply: approve only
while a plan waits, steer and pause while one runs.

## 4. Verified

- `pnpm typecheck` is clean and `pnpm test` passes (124 files, 1405 tests). Worker tests cover:
  - staffing, forecast and voices (every recipe under every lead);
  - talk → proposal → Inbox → approve (HTTP and by voice) → parallel reviewed steps → deliverable → announcement;
  - declining, caps and idempotency;
  - notes from the page, the Chief and a desk, and how each reaches the prompts;
  - pause and resume; Everyone stop;
  - the halfway announcement within and past the budget.

  Web tests cover:
  - store frames, the raised hand and clipped-output merging;
  - faces, the lead's hand, and office presence and pods;
  - the Inbox, Projects, project page, direction panel and Everyone stop;
  - the Talk links.
- e2e (Mock, `e2e/projects.spec.ts`): one sentence → Inbox → the plan with its forecast → a note → approve → every
  step done, the note picked up, the deliverable → the announcement in Talk links to it. A second test covers
  declining in the Inbox. The full chromium e2e suite passes (54 passed, 1 skipped). The voice and living-voice
  projects pass (19 passed, 3 skipped); two one-voice timing tests failed under load in the full run and pass alone,
  like before this increment.
- Checked by hand on a separate Mock server:
  - Talk → the plan (title, staffing note, forecast) → approve → the halfway and done announcements, each linked;
  - a paused project's page;
  - the pod in the office: six people seated together, first in the fill order, beside the Chief's office.

## 5. Integration changes (for reviewers)

- `packages/office` `scene.ts`: the stage no longer takes focus 260 ms after entering a room if a picker opened in the
  meantime. Pressing **I** as the stage appeared used to lose the search field's focus.
- `e2e/office.spec.ts`: the roundtable test's "no room lines in side threads" check uses the room's own wording. An
  earlier test in the same file says the first sentence at a desk in the shared workspace.
- `packages/catalog`: the full bundle carries `voices` (TTS voice id → presentation per provider, from the taxonomy)
  for voice assignment.
- The Mock project trigger no longer fires on a bare topic word ("tell me about the launch").

## 6. Known gaps (by design for this increment)

- **Staffing is recipe-first.** Every goal maps to the closest of the 57 recipes. Formation's from-scratch assembly,
  industry variants, provider spread and per-member model tiers are not applied: every step runs on the registry's
  reasoning tier.
- **Regulated work**: personas flag regulated domains in their drafts, but the plan does not yet insert a human
  "Licensed review" task.
- **Evidence**: no web search yet (Inc 4). The deliverable's evidence is the reviewed step work, with `(unverified)`
  markers.
- **Team voices** are resolved and stored now. They are heard from Inc 2 team meetings; a quick chat keeps the
  coworker's own catalog voice, so their pre-voiced reflex clips and replies match.
- **Milestones** are the halfway point only, with no LLM "does this matter now?" judge (EXPERIENCE §8). Blockers are
  announced when a project fails.
