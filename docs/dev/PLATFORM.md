# The platform: organizations, hiring, meetings and files

Five parts turn Headcount into a service that many groups can use at once:
- every business gets its own office;
- an office starts with its Chief of Staff and hires its team;
- the team meets in rooms, with the Chief moderating, and what is asked for or agreed there starts as work;
- the office makes real files: images, videos, Word, PowerPoint and Excel;
- the product's name lives in one constant.

## Organizations (multi-tenant)

An organization is one office. Its id is the workspace id: `local` for the deployment's own home office, or
`org_` + 12 characters for the others.

### Signing up

1. Someone signs in with Google.
2. If they belong to no office yet, they see "Start my office". They name it and say what it is for.
3. The office is created and they become its owner.

`SIGNUP_MODE` decides who may start one: `open`, `invite` (only people already invited somewhere) or `closed`.
`MAX_ORGS` caps the offices on the whole deployment, and `MAX_ORGS_PER_USER` caps how many one person may start.

### Isolation

Each request runs for the signed-in person's current office. `withTenant` sets `WORKSPACE_ID` to the office, then the
office's own settings load over the deployment's. That office's data stays separate in every store:

- **Durable Objects:** each is named for its office (`ws:<org>`, `p:everyday:<org>`, …), so its SQL storage, ledger,
  memory, Handbook, team, meetings and files index belong to that office alone.
- **D1:** rows carry the office id (members, sessions, autonomy, grants, the audit log, usage).
- **R2:** objects sit under `ws/<org>/…` (shared files, made images and videos).

### Settings, roles and switching

- **Settings:** limits and the Mock switches are set once for every office (`PLATFORM_KEYS`). Only the home office's
  Admin page changes them. Other offices see them locked.
- **Roles:** owner, contributor and reader. Each office invites its own people on Admin → People. People in several
  offices switch between them on Admin → General.
- **Platform admins:** the home office's `OWNER_EMAILS`. Admin → Every organization lists every office.

Code: `apps/worker/src/lib/tenant.ts`, `auth/auth.ts`, `auth/orgs.ts`. Migration: `0006_orgs.sql`. Tests:
`apps/worker/test/orgs.test.ts`.

## Hiring

A new office starts with its Chief of Staff alone. The home office keeps the everyday starter team.

### Suggestions and the Hire page

The Chief suggests hires from what the owner says the business does, or from the Handbook. Suggestions come from
`suggestHires` in `apps/worker/src/team/hiring.ts`, which matches against:
- industry words;
- each coworker's title, tags and expertise;
- the everyday roles;
- the Chief's favourite colleagues.

Four are recommended, from four different departments. Each card says:
- why this person;
- what they will do;
- their first job;
- a sample of their voice.

The Hire page is at `/app/team/hire`. On first run (`?first=1`) the recommended four come pre-picked.

### After hiring

- The Chief welcomes each new hire in Talk. Letting someone go can be undone from the audit log.
- In Talk the Chief can hire someone (`hire_coworker`). It hands work only to people on the team.
- The office shows the Chief, the team and anyone working on a project. Projects can still bring in specialists from
  the whole directory.

## Meetings

A meeting is turns between coworkers, one after another, with the Chief of Staff moderating:
- the first person invited chairs: they frame the question and sum up;
- everyone else opens, and debates over later rounds;
- the Chief opens the meeting and closes it.

### Taking part

The owner can:
- listen in, with each line in the speaker's own voice;
- take the floor (whoever they address answers next);
- whisper to one person;
- read the meeting or replay it later.

### Kinds of meeting

- **A project's meetings:** its kickoff, reviews and discussions. Their outcome becomes direction for the team.
- **Meetings called on their own:** from Talk ("call a meeting about…", the Chief's `call_meeting` tool) or the
  Meetings page.
  - The people come from the team. When nobody is named, the Chief invites those best placed for the topic.
  - When the meeting ends, the people at the table start on what they agreed: a team project they staff, the chair
    leading, started as soon as its plan is drafted (`meetingWork`, once per meeting). The Chief posts the summary in
    Talk with a link to the work. `followUp: false` on the call (the form's checkbox) leaves it to the room's
    "Start the work" (`POST /api/meetings/:id/work`).
  - Limits: at most two at once. Each counts against the project daily limit. Everyone stop ends them.

### Where meetings show

- **Meetings place** (`/app/meetings`): live and earlier meetings, and Call a meeting.
- **Meeting room** (`/app/meetings/:id`): the table, who has the floor, the lines (type, or use the mic), the
  outcome, and the work it started (or Start the work).
- **Talk:** a "Meeting now" strip.
- **The office:** the people at the table gather at the lounge, round the Chief.

Code:
- `apps/worker/src/projects/team-host.ts`: `callMeeting`, `runDiscussion`. A meeting called on its own is a
  `tprojects` row with `kind = 'meeting'`, never listed as a project.
- `apps/web/src/routes/Meetings.tsx`.

## Rooms are working meetings

Office rooms (Skyline, Garden) and joined huddles are where the owner talks with the people they brought together.
Nobody there says they are "not on a project" or that "the Chief can bring them in":

1. **Intake.** Before anyone answers, one fast call (`rooms/intake.ts`, a forced `room_decision` tool) reads the
   owner's line with the meeting so far and decides:
   - `start`: the owner asked for something. It starts at once as a team project staffed with the people in the room
     (those the owner asked first, the first leading; someone alone gets the playbook's people so the work is
     reviewed), with no plan approval (`startNow`). The Chief notes it in Talk with a link.
   - `direct`: direction for a project someone in the room is on; it reaches their next step (a note, `via: 'room'`).
   - `none`: talk.
2. **Replies.** Once work started, the Chief (when present) answers first and hands it out, then the lead says what
   they will tackle. Every responder's prompt carries their live work ("Your status") and what just started
   ("Just now"); a promise of work nothing started is replaced with an offer ("Want me to get started on that?").

The same "the owner asked, so it starts" rule covers a coworker's desk (`start_project`, they lead) and a hired
coworker's first job. Talk keeps its plan approval for projects the Chief staffs.

Code: `apps/worker/src/rooms/intake.ts`, `rooms/room-turn.ts` (`takeWork`, `workOrder`), `rooms/prompt.ts`
(`workBlock`), `projects/staffing.ts` (`teamWith`), `projects/team-host.ts` (`people`, `startNow`, `meetingWork`).

## Now: what is going on

`/app/now` shows, at a glance: what needs the owner (the Inbox's raised hands), meetings going on, the work under way
(each project's steps in progress and who is on them, and background jobs), what everyone on the team is doing (or
that they are free), and what finished in the last day. Talk shows one line when the team is at work, linking there.
On phones, Now takes the Inbox's tab (and its count); the Inbox is its first section and in More.

Code: `apps/web/src/routes/Now.tsx`.

## Talking by voice

Mic buttons (Talk, a room's dock, a meeting's Take the floor) share `components/useMicButton.ts`: tap to start and tap
again to send, or hold and let go. An interrupted press (the browser's microphone prompt takes the touch) keeps the
mic open instead of discarding it. Speech to text, most robust first:
1. the office's provider STT (`POST /api/speech/stt`) when a key is set;
2. Whisper tiny on the device (`voice/local-stt.ts`, Transformers.js in a worker), which also steps in when the
   provider fails. The model (about 40 MB) downloads once from the Hugging Face hub and stays in the browser cache;
   the audio never leaves the device;
3. the browser's own speech recognition, only when neither can run.

The onnxruntime WebAssembly the model runs on comes from jsDelivr at run time (the CSP allows it, with the Hugging
Face hosts); the build leaves out the copy Vite would bundle (`dropOnnxWasm` in `apps/web/vite.config.ts`), which is
over the 25 MiB per-file limit of Workers Static Assets.

While a room or a joined huddle is open, the Chief's bubble steps aside (on phones it covered the room's mic and Send).

## Writing standard

Everything the team writes for the owner follows one standard, after ASD-STE100 Simplified Technical English:
`apps/worker/src/agents/writing.ts`.

- `WRITING_STANDARD` (the full rules) is in every coworker's work prompt (section `writing`), background jobs and
  canvas documents.
- `WRITING_SHORT` is in review prompts and the Chief's replies.
- `CHAT_VOICE` sets the coworker voice in chat: the answer first, no filler openers, sign-offs or restating.
- `SPOKEN_STYLE` is in every prompt whose reply is spoken aloud: the Chief in voice mode, desks and rooms.
- `agents/prompt-text.test.ts` fails if a prompt constant, a built prompt or a tool description has an em dash.
- Size limits: a step is under 300 words; a project deliverable is under 700; a job write-up is under 500; a meeting's
  close is under 150, as Decision, Who does what, Open, From the owner.

The web renders model text as Markdown (`components/Markdown.tsx`); list rows use `plainText` (`lib/markdown.ts`).
`.main` clips horizontal overflow, so wide content never widens the page on a phone.

## Agent loop safeguards

`packages/agent-loop/src/run-turn.ts` runs every model turn with tools. These limits keep a turn from looping or
overflowing:

| Constant | Value | Effect |
|---|---|---|
| `IDENTICAL_CALL_LIMIT` | 2 | The third identical call (same tool, same arguments) does not run. The model gets the earlier result and a note. |
| `IDENTICAL_FAILURE_LIMIT` | 2 | A call that failed twice is blocked. |
| `STUCK_ROUND_LIMIT` | 4 | After 4 rounds in which every call failed, one tool-free wrap-up call runs and the turn ends with finish `stuck`. |
| `TOOL_OUTPUT_LIMIT` | 20,000 chars | `clipToolOutput` keeps 70% from the start and 30% from the end, with a stub line between them. |

Clipping in the worker (`apps/worker/src/jobs/job-view.ts`):

- `clipText`: one line. Use it for titles, previews and one-line notes.
- `clipBlock`: keeps line breaks and cuts at a line or sentence end. Use it for Markdown: step work, drafts,
  deliverables, summaries, decision bodies, and project frames.
- `clipMiddle`: keeps the start and the end and drops whole lines from the middle. Meeting transcripts use it, so each
  speaker hears the opening and the latest lines.

Talk history (`apps/worker/src/workspace/talk.ts`): the last 40 messages, up to 24,000 characters. The last
`HISTORY_VERBATIM` (6) messages stay word for word. Over budget, older messages over 800 characters are cut to their
first 400 and a stub, oldest first, before any message is dropped.

The project run inspector (Model calls on a project page) shows calls, tokens and time for each phase.

## Files

- **Images:** OpenAI or xAI. Ask the Chief in Talk (`make_image`), or describe one on the Files page.
  - Images are made in the background. One made for Talk is posted there by the Chief when it is ready.
  - Project leads can make images for their work, and these are kept in the deliverable.
- **Videos:** xAI `grok-imagine-video-1.5`, up to 15 s (`make_video`).
  - A video is started at xAI, checked on the WorkspaceDO alarm, then copied into R2, because xAI's link is
    temporary.
- **Where they live:** both are kept per office (WorkspaceDO `files` table and R2 `ws/<org>/files/`). They are served
  at `/api/files/fil_….ext` (private and immutable; videos support Range requests).
- **Markdown:** shows only the office's own images and videos. Remote images never load.
- **Office documents:** any Markdown document downloads as Word, PowerPoint (a slide per section) or Excel (its
  tables) through `POST /api/export`. Project deliverables and the Files page offer it.
- **Without a provider:** with Mock on (development, tests), a placeholder image and clip stand in, marked as
  placeholders.

Code: `apps/worker/src/files/` (`store.ts`, `video.ts`, `export.ts`, `routes.ts`) and `apps/web/src/routes/Files.tsx`.

## The name

`packages/protocol/src/brand.ts` holds `BRAND`. See `docs/dev/NAMING.md`.

## Voice caching (shared, no personal data)

Voice audio is kept in R2 in three ways. Only text that is the same for every office is shared.

- **Pre-voiced reflex clips** (`apps/worker/src/expr/clips.ts`, `prevoice.ts`):
  - What they are: short lines from the expressions catalog ("mm-hm", "good question, one sec", laughs).
  - Each is rendered once per voice and keyed by its content.
  - Lines with nothing office-specific are kept under `expr/clips/` and shared by every office.
  - Lines carrying an office's details stay under `ws/<org>/expr/`. Those details are the owner's name, a renamed Chief,
    a coworker, project, client or blocker.
- **Canned speech** (`apps/worker/src/media/canned.ts`):
  - What it is: the office's own fixed lines, such as "Want me to get started on that?", the figure
    lines and "Thank you, everyone.", plus everyday acknowledgements ("On it.", "Got it.", "One moment.").
  - Its audio is kept under `speech/canned/` the first time any office hears it, and every office reuses it.
  - A shared hit makes no provider call and uses none of the daily voice budget. It is marked `x-tts-cache: shared`.
  - Only text that exactly matches the list is shared: no names, numbers or anything a person wrote.
  - The Mock's placeholder audio is never kept.
- **Replay of meeting lines:** kept per office under `ws/<org>/tts/`, so replaying a meeting is free.
