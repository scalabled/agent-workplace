# Dogfooding: the Headcount Marketing office

We launch Headcount with Headcount. A dedicated office, **Headcount Marketing**, runs the rollout plan
([ROLLOUT.md](ROLLOUT.md)) with an AI marketing team. They:
- plan in meetings;
- make posts, images and videos;
- queue posts in Buffer;
- report every Friday.

A human (you) approves what goes public. How much of that is on autopilot is a dial you turn up as the team earns it.

Setup takes about 30 minutes, most of it done by the Chief of Staff from one message.

## 1. One-time setup (by you, about 10 minutes)

1. **Start the office.** On the live site, click your office's name at the top of the sidebar, then "Start another
   office". Name it **Headcount Marketing**.
2. **Choose a Chief of Staff.** Pick a calm operator type. They will coordinate the team.
3. **Connect Buffer.**
   1. In Buffer, connect the X, LinkedIn, Facebook Page and Instagram Business accounts.
   2. Create an API key (Buffer → developer settings).
   3. In Headcount, open ⌘K → Connectors → Buffer, paste the key and press Test.
   4. Switch on **"Every coworker may use it"** and **"{Chief} may use it in Talk"**. This office only does
      marketing, and the weekly sprint is staffed per project, so everyone who works on it needs Buffer.
4. **Set the autonomy dial** (Admin → Autonomy):
   - **Changes in connected apps:** set to **Propose** for weeks 0 to 2. Every Buffer post the team creates is a card
     you approve.
   - **Sending email:** leave at **Ask first**. Beta invites are sent by a human.
5. Optional connectors:
   - **Canva:** designs and carousel templates.
   - **Notion:** a public changelog or content calendar.

Keys never leave the server, and reading through a connector never needs your OK.

## 2. The kickoff message (paste into Talk)

This one message has the Chief of Staff:
- set up the Handbook;
- hire the team;
- propose the automations;
- call the first meeting.

You'll see an approval card for each automation; approve them as they appear. Handbook changes are made straight away
and listed in Admin → Audit log, with Undo.

> We're the marketing team for Headcount, the AI office for small businesses, and you're going to run our launch.
>
> 1. Update the Handbook. Business: Headcount is an AI office for small businesses: one Chief of Staff the owner
>    talks to, a team of AI coworkers with faces and voices who do real work (documents, images, short videos,
>    plans), meetings where coworkers talk things through, and approvals before anything leaves the building. We're in
>    a private, invite-only beta. Customers: owners of online shops (Shopify, Etsy), local service businesses,
>    consultants and small agencies, and creators. Voice: plain, warm, confident, specific; no hype, no exclamation
>    marks in a row. Rules: every coworker is labelled as AI; no testimonials, customer counts or metrics we don't
>    have; posts made by the AI team say so; feature claims must match the releases page; no automated DMs or replies
>    to strangers; Facebook group posts are made by a human; everything we post goes to Buffer as a draft unless I say
>    otherwise.
> 2. Hire: Samuel Adebayo (product marketing), Leilani Akana (social media), Andre Campbell (copywriter), Adrian Popa
>    (content marketing), Jasmine Lane (photo art director), Emre Yilmaz (video designer), Rory Dalisay (community
>    manager), Elif Aydin (marketing analyst) and Callum Munro (email marketer).
> 3. Set up these automations:
>    - every 10,080 minutes starting now: a team project, "Weekly content sprint": plan next week's posts for X,
>      LinkedIn, Instagram and Facebook from the rollout plan's content pillars; write each post; make the images
>      and short videos they need; create every post in Buffer as a draft for the right channel and day; finish with
>      a one-page summary of the week's posts. Tell me when it's done.
>    - daily at 17:00 UTC: a background job, "Beta pulse": summarise anything new about the beta that the team
>      learned today (from my notes and memory), and list who is waiting for an invite. Quiet unless there's
>      something new.
> 4. Then call a meeting with Samuel, Leilani, Andre and Jasmine about our private beta launch story: the one
>    sentence, the three proof points, and the first week of posts. Samuel chairs.

**On the first Friday,** paste this to add the weekly report (an automation runs every N minutes from when it is
created, so creating it on a Friday afternoon keeps it on Fridays):

> Set up an automation every 10,080 minutes starting now: a background job, "Friday results": read last week's post
> analytics from Buffer, compare against the week before, say what worked and what didn't, and recommend three changes
> for next week. Tell me always.

What happens next:
- The meeting runs with your Chief moderating. Listen in or take the floor.
- The summary lands in Talk. Say "make it a project" to turn the launch week into a project. Its kickoff meeting runs
  automatically, and the team makes the posts, images and videos.
- Each Buffer draft waits for your OK (Propose): a card in Talk, or in the Inbox when it comes from project work.
  Approve it, or say what to change.

## 3. The weekly rhythm (mostly automatic)

| When | What runs | Who | Your part |
|---|---|---|---|
| Monday morning | **Weekly content sprint** (team project, starts without waiting for a plan approval): a kickoff meeting, the week's posts written, images and clips made, Buffer drafts created | A marketing team staffed for the project, led by its lead | Approve the drafts (cards in weeks 0 to 2; in Buffer afterwards) |
| Daily, 17:00 UTC | **Beta pulse** (background job) | Your Chief | Read it when it says something new |
| Friday | **Friday results** (background job): Buffer analytics, what worked, three changes | Your Chief (ask Elif in a meeting to dig deeper) | Read it; say "do it" to the changes you like |
| As needed | Use-case stories, demo scripts, launch emails (projects) | Adrian, Andre, Callum | Approve; record the screen demos yourself |
| Each release | Release notes into posts | Samuel, Andre | Paste the new releases-page entry into Talk: "turn this into a post for each channel" |

## 4. Turning up the autopilot

| Stage | When | Setting | What you do |
|---|---|---|---|
| **Drafts** | Weeks 0 to 2 | Connected apps: **Propose** | Approve every Buffer draft as a card. Note what you change in Talk so the team learns. |
| **Batch** | Weeks 3 to 4, once your edits are rare | Connected apps: **Act and tell me**. The Handbook says "drafts only". | The team writes straight to Buffer as drafts; you review the queue in Buffer once a week. |
| **Autopilot** | Week 5 onward, if the drafts rarely need edits | Connected apps: **Act and tell me**; the Handbook says "schedule directly" | The team schedules posts itself. You read the Friday report, and spot-check in Buffer. |

At every stage:
- **Off switches:** say "everyone, stop" in Talk, or turn the dial back to Propose.
- **Records:** every change the team makes in a connected app is in Admin → Audit log.
- **Never automated:** emails to people (always Ask first), DMs, replies to strangers, Facebook group posts, ad spend.

"Drafts only" and "schedule directly" are instructions in the Handbook, which the team follows. The hard guarantees
are the autonomy dial (whether a write needs your OK) and the off switches.

## 5. What the team uses

| Need | How |
|---|---|
| Plan and decide | Meetings (`call_meeting`) and team projects with kickoffs |
| Write | Coworkers' own work; deliverables download as Word or PowerPoint (carousels from PowerPoint exports) |
| Images | `make_image` (the briefs in ROLLOUT.md section 8), kept in Files |
| Short videos | `make_video` (xAI, up to 15 s, 9:16 for Reels and Stories), kept in Files |
| Publish | Buffer through MCP: create drafts or schedule posts, per channel |
| Measure | Buffer analytics through MCP; the Friday results job |
| Remember | The Handbook (voice and rules) and memory (what we approved or rejected) |

Media still needs one manual step: images and videos made in Headcount are attached in Buffer by a human, unless
the team gives Buffer a public link. Buffer cannot fetch Headcount's private files. A "share publicly" option for a
file would close this gap (to build).

## 6. Limits to know

- **Daily limits per office:** images (10), videos (10), projects and jobs. These are set for every office on the
  platform; raise them from the home office's Admin if the sprint needs more.
- **Automations:** they run daily at a set time (UTC) or every N minutes. Weekly means every 10,080 minutes from when
  you create it, so create the sprint on a Monday morning.
- **The Chief's view:** the Chief and the team see what Buffer's MCP tools return. If a channel isn't connected in
  Buffer, they can't post there.
