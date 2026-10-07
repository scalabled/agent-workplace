# The platform: organizations, hiring, meetings and files

Five parts turn Headcount into a service that many groups can use at once:
- every business gets its own office;
- an office starts with its Chief of Staff and hires its team;
- the team meets in rooms, with the Chief moderating;
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
  - When the meeting ends, the Chief posts the chair's summary in Talk, offering to turn it into a project.
  - Limits: at most two at once. Each counts against the project daily limit. Everyone stop ends them.

### Where meetings show

- **Meetings place** (`/app/meetings`): live and earlier meetings, and Call a meeting.
- **Meeting room** (`/app/meetings/:id`): the table, who has the floor, the lines, the outcome, and Make it a project.
- **Talk:** a "Meeting now" strip.
- **The office:** the people at the table gather at the lounge, round the Chief.

Code:
- `apps/worker/src/projects/team-host.ts`: `callMeeting`, `runDiscussion`. A meeting called on its own is a
  `tprojects` row with `kind = 'meeting'`, never listed as a project.
- `apps/web/src/routes/Meetings.tsx`.

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
  - What it is: the office's own fixed lines, such as "Bring it to me in Talk and it goes on my list.", the figure
    lines and "Thank you, everyone.", plus everyday acknowledgements ("On it.", "Got it.", "One moment.").
  - Its audio is kept under `speech/canned/` the first time any office hears it, and every office reuses it.
  - A shared hit makes no provider call and uses none of the daily voice budget. It is marked `x-tts-cache: shared`.
  - Only text that exactly matches the list is shared: no names, numbers or anything a person wrote.
  - The Mock's placeholder audio is never kept.
- **Replay of meeting lines:** kept per office under `ws/<org>/tts/`, so replaying a meeting is free.
