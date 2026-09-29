# Owner directives

Binding requirements from the owner, added after the original brief. They override anything in PRODUCT.md, EXPERIENCE.md or ARCHITECTURE.md that conflicts with them, and they must be reflected in all three documents and in the MVP.

## D1. Useful from minute one: persona, skill and lead catalog

- Ship a comprehensive catalog of coworker personas and skills. The lead uses it to form expert teams in one step, from team recipes and formation rules (`catalog/`).
- Offer several lead personalities for the owner to choose from. Each has a name, an avatar, a distinct voice and a backstory whose history can relate to the owner. A short match quiz helps the owner pick one they get along with, and they can switch leads at any time.
- Backstories are character lore. Agents say they are AI if sincerely asked, and they never claim real-world actions they did not take.

## D2. Communication comes first: agents stay reachable while they work

The owner can text, talk (push-to-talk or voice notes) or hold a live voice conversation with the lead or any coworker at any moment. That includes while the agent is running parallel background work. Talking to an agent must never wait for its work to finish.

- **Two loops per agent.** Each agent runs a conversation loop and one or more work loops.
  - The conversation loop is always on, uses a fast model, and has read access to the agent's live work state: current task, step, progress, partial outputs and blockers.
  - Work loops run in the background (plan tasks, tool loops, media generation, research).
  - The conversation loop never blocks on a work loop.
- **Status comes from state.** Questions like "Where are you with X?" are answered from the run ledger and event stream, not by pausing or re-running the work. Target latency: text acknowledgement under 1 s, first spoken audio under 1.5 s.
- **Steering mid-flight.** While an agent works, the owner can redirect, reprioritize, add context, pause, resume or cancel. Messages are delivered into running work loops at safe checkpoints: between steps or tool calls. Sibling tasks keep running.
- **Voice front, brain back** [PG]. A realtime voice session handles turn-taking and quick acknowledgements such as "one sec, pulling up the draft." Substantive answers stream from the reasoning model as speakable chunks. Barge-in is always allowed.
- **Agents start conversations too.** Working agents can message, call or raise a hand to ask a question, share a milestone or flag a blocker. This is governed by the attention budget and proactivity dial [BB].
  - Decisions go to the Inbox and never block unrelated work.
  - Urgent items can escalate to a spoken ping, within the owner's settings.
- **Every channel on every surface.** Text, push-to-talk, voice notes and live voice work from anywhere in the app, including mobile.
  - The owner can talk to the lead while listening in on a meeting, or whisper to one coworker mid-task.
  - Avatars show "working" and "available" together; presence is never "busy, try later".
- **Concurrency built in.** Every agent has its own mailbox and session. Many conversations and many work loops run at once without head-of-line blocking.

## D3. The interface is minimal, intuitive and sleek

- **One primary surface.** The conversation with the lead sits next to a quiet presence strip of the active team. Everything else appears through progressive disclosure, never a dashboard by default.
- **Few destinations.** Keep top-level navigation to 3–4 places at most, such as Lead, Team/Floor, Projects and Inbox. A command palette and keyboard shortcuts cover everything else.
- **Faces are the status UI.** Avatars and their state (listening, thinking, speaking, working, needs you) replace most badges, spinners and tables. Captions are always available.
- **Calm, premium look.** Generous whitespace, typography first, one accent color per agent, subtle motion, and matching light and dark themes. Nothing is decorative without a job.
- **Dark by default, everywhere.** The app and the landing page share one dark theme, with rich blacks, luminous per-agent accents and subtle glow. A light theme stays available as an option. Inside the app, dark stays calm and minimal.
- **A flashy landing page.** The public marketing page is where bold motion, generated imagery and big typography belong. It uses generated images and shows the real coworker faces. It contains no fabricated testimonials, customer logos or metrics.
- **Modern, hip knowledge workers.** Every lead and coworker has a contemporary name and the look of a modern creative or knowledge professional. The whole cast shares one editorial "staff photo shoot" art direction and stays diverse in gender and heritage.
- **The Floor looks like a real office.** An interactive office view offers two modes:
  - **Desk mode:** coworkers sit in office chairs at desks arranged in a floor plan, grouped by department or project.
  - **Conference room mode:** coworkers sit around a meeting table. The owner can invite people in and talk to the room.

  The office has windows with a city skyline, glass meeting rooms and ordinary office things: plants, a coffee bar, whiteboards, bookshelves, lamps and a lounge.
  - Faces stay live and show each coworker's state.
  - The owner can pan, zoom, hover (for passing-by lines) and click to talk.
  - A list view (the Directory) remains the accessible alternative.
- **The office runs itself.** Coworkers move around on their own, following stable, familiar daily rhythms:
  - focus time at their desk,
  - coffee bar and water-cooler huddles,
  - lounge breaks,
  - library visits,
  - phone-booth calls,
  - dropping by a teammate's desk.

  Behaviour rules:
  - Real work always overrides ambient behaviour.
  - Huddles show small talk as bubbles, and voice plays only when the owner listens in.
  - The owner can join a huddle, follow anyone, or let an optional autopilot camera drift to where life is happening.
  - It must feel familiar, meaningful and delightful, never arduous. Nothing requires effort to enjoy it.
  - Ambience sets the energy.
  - Reduced motion replaces walking with fades.
- **Zero-config start.** Onboarding is a conversation with the chosen lead plus the match quiz. The app works keyless with the mock provider or local Ollama, and adding a provider key is one step.
- **Obvious next action.** Every screen has one clear primary action. Advanced controls (grants, budgets, model policy) sit behind "More" or Settings.

## D5. A living workforce: asynchronous, multitasking, full of small talk

Agents should feel like real people who multitask, not request/response bots. Processing is asynchronous everywhere, and the workforce feels alive: the owner can engage with their Headcount casually, not only through tasks.

- **Three speeds of thought per agent, all running at once:**
  - **Reflex (under 200 ms):** retrieved micro-utterances, no LLM needed. These are backchannels ("mm-hm", "right"), fillers ("ooh, good question, give me a sec"), canned expressions, laughs and chuckles, sighs, reactions and quips.
  - **Conversation (about 1 s):** fast-model replies.
  - **Work (minutes):** background loops.

  A reflex covers the latency of the conversation layer, and the conversation layer never waits on the work layer.
- **Expression library per persona.** It builds on shared archetype packs and has short, personality-true lines in about 30 intents: greetings, passing-by hellos, acknowledgements, thinking fillers, backchannels, laughs, surprise, delight, concern, sympathy, encouragement, celebration, apology, hand-offs, micro status updates, "wrapping a thought, back in a sec", sign-offs, side-talk openers and replies, and quips about their work.
  - Lines carry slots filled from live state (owner name, project, coworker, progress) and expressive delivery tags (for example `[laugh]`, `[sigh]`, `<whisper>`).
  - Selection is fast, anti-repetitive and weighted by mood.
- **Pre-voiced for instant playback.** Each line is rendered once in the persona's own voice, then cached (R2 plus the browser cache) along with its lip-sync timing. Reflexes therefore play instantly, with lip sync.
- **Passing-by conversation.** When the owner moves past or hovers over a desk on the Floor, the coworker may look up and say a short line grounded in what they are actually doing. The owner can answer inline in a quick side thread without opening a full conversation.
- **Side-talk.** Brief coworker-to-coworker banter appears on the Floor as bubbles. It is derived from real hand-offs, asks and results, and is voiced only if someone is listening.
- **Human-like multitasking.** An agent can hold several attention threads at once: a 1:1 with the owner, a meeting and its background work. It says so naturally ("hang on, finishing a thought in the review — back in ten seconds"). Each agent is an actor with prioritized mailboxes, and communication with the owner always has the highest priority.
- **Mood.** A light mood model (energy, valence) changes with real events: wins lift it, blockers weigh on it. Mood shapes both expression choice and the avatar's expression palette.
- **Water-cooler small talk.** Casual chat in huddles is allowed and encouraged. It is persona-true banter about their craft, friendly debates and self-aware AI humour that plays with the office metaphor (for example "I'd grab an espresso if I had hands"). It never claims facts, work or human experiences such as drinking coffee or a commute. Anything that mentions real work must be grounded in a real event.
- **Honest and never annoying.**
  - Micro-talk never claims work that was not done. Side-talk is grounded in real events. Laughter never mocks the owner.
  - One Ambience setting (Quiet, Lively or Buzzing) and the interruption budget govern chatter volume. Owner-directed replies are always exempt from the budget.

## D4. Deliver an MVP early and iterate

- Build a runnable MVP quickly and show it early. Then integrate the remaining features in small, demoable increments, each one runnable and reviewed with the owner.
