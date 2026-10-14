// The releases page (/releases): what is new in each release, and a guide to every feature with how to use it.
// Publishing a release (docs/dev/RELEASES.md): add it at the top of RELEASES; add or update the GUIDE entries it
// brings (their `since` is the release's version, so they show as New); every change links to its guide entry.
// Plain, present-tense copy for what works today; nothing that is not built goes here.

export interface Area {
  id: string;
  title: string;
  lede: string;
}

export interface GuideEntry {
  /** The anchor on the page (#guide-<id>) and what changes link to. */
  id: string;
  area: string;
  title: string;
  /** What it does, in a sentence or two. */
  what: string;
  /** How to use it, step by step. */
  steps: string[];
  /** Where it is in the app. */
  open?: { label: string; href: string };
  /** The release that brought it (or changed it most). */
  since: string;
}

export interface Release {
  /** "0.4": the newest is first. */
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  title: string;
  summary: string;
  changes: { text: string; guide?: string }[];
}

export const AREAS: Area[] = [
  { id: 'start', title: 'Getting started', lede: 'Your office, your Chief of Staff and your first hires.' },
  { id: 'talk', title: 'Talk with your Chief of Staff', lede: 'The one agent you talk to. They answer, hand off work and report progress.' },
  { id: 'team', title: 'Your team', lede: 'The coworkers you hired, what they do, and how to give them work.' },
  { id: 'projects', title: 'Projects and meetings', lede: 'Larger work: a team, a plan you approve, and meetings to talk it through.' },
  { id: 'files', title: 'Files and things they make', lede: 'Images, videos, documents, apps and pages.' },
  { id: 'office', title: 'The office', lede: 'See the office at work, and talk to anyone in it.' },
  { id: 'knowledge', title: 'What the office knows', lede: 'Your Handbook, the team’s memory, and the methods they work by.' },
  { id: 'automation', title: 'Automations and connected services', lede: 'Work that starts on its own, and the outside services the team can use.' },
  { id: 'trust', title: 'Trust and control', lede: 'You approve what goes out, and the audit log records every change.' },
  { id: 'admin', title: 'Admin and your organization', lede: 'People, roles, settings and costs.' },
];

export const GUIDE: GuideEntry[] = [
  // ── getting started ──
  {
    id: 'start-office',
    area: 'start',
    title: 'Start your office',
    what: 'Each business gets its own office, with its own Chief of Staff, team, memory, files and conversations. Other offices cannot see it.',
    steps: [
      'While sign-up is invite-only, ask an office owner to invite your email first.',
      'Sign in with Google.',
      'If someone invited you to their office, it opens when you sign in.',
      'If you have no office yet, name yours and say in one line what it is for.',
      'To switch offices, click your office’s name at the top of the sidebar.',
      'To start another office, choose “Start another office” there. Type a name and press Start the office.',
      'On a phone, open More (or ⌘K) and choose “Switch to …” or “Start another office”.',
    ],
    open: { label: 'Enter the office', href: '/app' },
    since: '0.4',
  },
  {
    id: 'start-chief',
    area: 'start',
    title: 'Choose your Chief of Staff',
    what: 'The one agent you talk to. Each has a name, a face, a voice and a way of working. You can switch at any time and keep all your work.',
    steps: [
      'On first run, take the short match quiz, or browse the Chiefs of Staff and hear each one.',
      'Press Choose. If you like, give them another name and say what they should call you.',
      'Press Start. They greet you in Talk.',
      'To switch later, press ⌘K (More on a phone) and choose “Switch Chief of Staff”.',
      'To rename them, or to change what they call you, open Admin → General.',
    ],
    open: { label: 'Choose', href: '/app/welcome' },
    since: '0.1',
  },
  {
    id: 'start-hire',
    area: 'start',
    title: 'Hire your team',
    what: 'A new office starts with your Chief of Staff alone. Describe your business, and they suggest who to hire, why, and a first job for each.',
    steps: [
      'After you choose your Chief of Staff, the Hire page opens with four suggestions picked.',
      'Describe your business, for example “an online crystal shop on Shopify and Etsy”. Press “Suggest people for this”.',
      'Hear each one, change the picks, or search for a role (“video”, “legal”).',
      'Press Hire. Each new coworker appears in Talk with their first job.',
      'To hire more later, open the Team page, or ask your Chief: “hire a bookkeeper”.',
    ],
    open: { label: 'Hire someone', href: '/app/team/hire' },
    since: '0.4',
  },

  // ── talk ──
  {
    id: 'talk-basics',
    area: 'talk',
    title: 'Talk by text or voice',
    what: 'Your Chief of Staff answers at once while work runs in the background. Replies can play in their own voice, with a face that moves with the words.',
    steps: [
      'Type in the message field and press Enter.',
      'To talk, tap the mic, speak, and tap it again to send.',
      'Or hold the mic (or Space, with the field empty), speak, and let go to send.',
      'Voice works on any phone or browser. If no speech service is set up, your device recognizes your speech. The first time, it takes a moment to get ready.',
      'To interrupt, start talking or press Esc. They stop.',
      'To turn spoken replies on or off, use ⌘K → “Turn voice on/off”.',
    ],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.7',
  },
  {
    id: 'talk-delegate',
    area: 'talk',
    title: 'Hand off work and steer it',
    what: 'Work that needs more than a quick answer runs as a background job: research, comparisons, write-ups.',
    steps: [
      'Say what you need: “Find three wholesale suppliers of ethically sourced amethyst.”',
      'Keep talking about other things while it runs.',
      'Ask “how’s it going?” to get the current step and what was found so far.',
      'Add direction, such as “also check where the stones are mined”. The job takes it at the next checkpoint.',
      'To stop a job, use its row above the message field, or say “stop that”.',
    ],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.1',
  },
  {
    id: 'talk-show',
    area: 'talk',
    title: 'Show your Chief what you see',
    what: 'Send a photo, a file, a screen snapshot or a camera picture with a message, and ask about it.',
    steps: ['Press the attach button beside the message field.', 'Choose a file or photo, a snapshot of your screen, or the camera.', 'Add your question and send. Memory keeps what you share.'],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.3',
  },
  {
    id: 'talk-web',
    area: 'talk',
    title: 'Research on the web, with sources',
    what: 'Your Chief and the team search the web and read pages when the work needs it. They show the sources they used.',
    steps: ['Ask for anything that needs current facts: prices, suppliers, competitors, rules.', 'Open the job or project step to see the sources behind each finding.'],
    since: '0.2',
  },

  // ── team ──
  {
    id: 'team-page',
    area: 'team',
    title: 'Your team and their first jobs',
    what: 'Everyone you hired, what they do, and a first job each one can start now.',
    steps: [
      'Open the Team page (⌘K → Team).',
      'Hear a coworker, or open their desk to talk with them.',
      'Press Start on a first job to set them to work. Follow its link to watch it run.',
      'To let someone go, press × in the corner of their card and confirm. You can undo it from the audit log.',
    ],
    open: { label: 'Open the Team page', href: '/app/team' },
    since: '0.2',
  },
  {
    id: 'team-desks',
    area: 'team',
    title: 'Talk to a coworker at their desk',
    what: 'Each coworker has a desk where you can ask them anything in their field. Ask for something, and they start it: research, a write-up, or a project they lead.',
    steps: [
      'Open a coworker’s profile from the Team page or the Floor, and talk at their desk.',
      'Ask for what you need: “Andre, can you write descriptions for our new amethyst clusters?” They start it and tell you where to follow it.',
      'Or ask your Chief to “ask the bookkeeper about…” or “pass this to the copywriter”. They bring back the answer or hand over the work.',
      'To see or edit how a coworker works, open their profile. It shows their instructions and skills.',
    ],
    open: { label: 'Meet the team', href: '/app/team' },
    since: '0.7',
  },

  // ── projects and meetings ──
  {
    id: 'projects-start',
    area: 'projects',
    title: 'Staff a project in a sentence',
    what: 'For larger work, your Chief puts together a team, and the team drafts a plan. Nothing starts until you approve it. The team then works step by step, reviews each other’s work, and delivers a document, a page or a file.',
    steps: [
      'In Talk, say “put together a team to launch our spring collection with a small campaign”.',
      'The plan arrives in your Inbox. Check the team and the steps, then approve it, or tell your Chief to go ahead.',
      'Follow the work on the project page: each step, who did it, the reviews and the team channel.',
      'To give direction, use “Tell the team”. The team takes it at the next step.',
      'When the project is done, read the deliverable and download it.',
      'To see what the work cost, press Model calls. A table shows the calls, tokens and time for each phase.',
    ],
    open: { label: 'Open Projects', href: '/app/projects' },
    since: '0.2',
  },
  {
    id: 'meetings',
    area: 'projects',
    title: 'Meetings, with your Chief moderating',
    what: 'Put the right people in a room to talk something through. They take turns. The first person invited chairs and sums up, and your Chief moderates. Then they start the work.',
    steps: [
      'In Talk, say “call a meeting about a monthly crystal subscription box”. Your Chief invites the right coworkers.',
      'Or open Meetings, write the question, pick who comes and press “Start the meeting”. The first person you pick chairs.',
      'Press “Listen in” to hear each line in the speaker’s voice.',
      'To speak, type or use the mic. To speak to one person only, whisper to them.',
      'When the meeting ends, the people at the table start what they agreed, with the chair leading. Your Chief posts the outcome and a link to the work in Talk.',
      'To only talk it over, untick “When it ends, the chair leads the work they agree on”. To start the work later, press “Start the work” in the meeting’s room.',
      'Projects hold their own kickoffs and reviews. These show on the Meetings page too.',
    ],
    open: { label: 'Open Meetings', href: '/app/meetings' },
    since: '0.7',
  },
  {
    id: 'inbox',
    area: 'projects',
    title: 'Your Inbox',
    what: 'Everything that needs you, in one place: plans to approve, questions from the team, and anything waiting for your OK.',
    steps: ['A number on Inbox means something is waiting.', 'Answer there, or tell your Chief in Talk.'],
    open: { label: 'Open the Inbox', href: '/app/inbox' },
    since: '0.2',
  },

  // ── files ──
  {
    id: 'files-images',
    area: 'files',
    title: 'Images and short videos',
    what: 'Product shots, social graphics, banners and clips up to 15 seconds, made from a description. Files keeps them all.',
    steps: [
      'Ask in Talk: “make an image of our amethyst gift box on white linen”. It appears in the thread when it is ready.',
      'For a video, ask: “make a short video teaser for the spring sale”.',
      'Or open Files, choose Image or Video, describe it, pick a shape and press Make.',
      'To change an image, press Edit on it in Files, or “Edit it” under the image in Talk. Say what should change and press Make the change.',
      'The new version keeps the rest of the design. The original stays.',
      'Download or remove anything from Files. Project teams can add images to their deliverables too.',
    ],
    open: { label: 'Open Files', href: '/app/files' },
    since: '0.10',
  },
  {
    id: 'files-documents',
    area: 'files',
    title: 'Word, PowerPoint and Excel',
    what: 'Every project document downloads as Word, as PowerPoint (one slide per section) or as Excel (its tables).',
    steps: ['On a finished project, open “Download” on the deliverable, or find it under Documents in Files.', 'Choose Word, PowerPoint, Excel or Markdown.'],
    open: { label: 'Open Files', href: '/app/files' },
    since: '0.4',
  },
  {
    id: 'files-canvas',
    area: 'files',
    title: 'Apps and pages',
    what: 'Small apps and documents made for you: a calculator, a tracker, a price list, a one-page plan. Download any of them, or export it to PDF.',
    steps: [
      'Ask your Chief: “make me a shipping cost calculator”, or describe it on the Canvas page.',
      'Try it on the page.',
      'To change it, press Edit at the top and say what should change. A new version is made, and every version is kept.',
    ],
    open: { label: 'Open the Canvas', href: '/app/canvas' },
    since: '0.2',
  },

  // ── the office ──
  {
    id: 'office-floor',
    area: 'office',
    title: 'The office floor',
    what: 'Your Chief and your team at their desks: working, taking breaks and chatting about real work. Each face shows what that person is doing.',
    steps: [
      'Open the Floor. Use the toggle to switch between the Office and the Directory.',
      'Rest on a face to see what they are working on. Click to chat in place.',
      'People in a meeting gather around your Chief.',
      'To set how lively the office is (Quiet, Lively, Buzzing), use ⌘K.',
    ],
    open: { label: 'Open the Floor', href: '/app/floor' },
    since: '0.1',
  },
  {
    id: 'office-rooms',
    area: 'office',
    title: 'Work in a room',
    what: 'Bring people into the Skyline or Garden room, or join a huddle, and talk it through. When you ask for something, it starts at once with the people in the room. If your Chief is there, they hand it out.',
    steps: [
      'On the Floor’s Office view, drag people into a room, your Chief too if you like. Then open the room.',
      'Type, or use the mic: tap it, speak, and tap it again to send.',
      'Ask for what you need: “Nina, can you put together a plan for our new checkout page?” It starts as a project. The person you asked leads, with the others in the room.',
      'To direct work that someone in the room is already doing, say so: “make sure it covers Apple Pay”. It reaches their next step.',
      'Your Chief notes in Talk what started, and the work shows on the Now page.',
    ],
    open: { label: 'Open the Floor', href: '/app/floor' },
    since: '0.7',
  },
  {
    id: 'now',
    area: 'office',
    title: 'The Now page',
    what: 'One page shows what is happening now: what needs you, live meetings, work under way, and what finished lately. Each piece of work shows who is on which step.',
    steps: [
      'Open Now in the sidebar, or in the bottom tabs on a phone.',
      'Follow any line to its project, meeting or person.',
      'When the team is at work, Talk shows a line. Tap “What’s going on” to see the rest.',
      'To ask instead, press “Ask … for an update”. The question goes to your Chief in Talk.',
    ],
    open: { label: 'Open Now', href: '/app/now' },
    since: '0.7',
  },
  {
    id: 'office-directory',
    area: 'office',
    title: 'The directory of coworkers',
    what: 'Every coworker you can hire or add to a project, across every department. Each has a face, a voice and a craft.',
    steps: ['Open the Floor and choose Directory, or search with ⌘K.', 'Open a profile to hear the coworker and see what they do. Hire them from there.'],
    open: { label: 'Browse the directory', href: '/app/floor?view=directory' },
    since: '0.1',
  },

  // ── knowledge ──
  {
    id: 'handbook',
    area: 'knowledge',
    title: 'The Handbook',
    what: 'Your own description of the business. Your Chief and every coworker work from it, so their work sounds like you and follows your rules.',
    steps: ['Open the Handbook and write each section, or press the button to let your Chief interview you.', 'Your Chief suggests additions as they learn. You approve them.'],
    open: { label: 'Open the Handbook', href: '/app/handbook' },
    since: '0.2',
  },
  {
    id: 'memory',
    area: 'knowledge',
    title: 'Memory and the weekly tidy',
    what: 'The team remembers facts from your conversations, meetings and shared files. They use them when the work needs them. A weekly tidy keeps memory in order.',
    steps: [
      'Tell your Chief something to keep: “remember that our supplier delivers on Tuesdays.”',
      'Open Memory to change, pin or forget anything.',
      'The weekly tidy runs from the Team page. Press “Tidy now” to run it at once, and read its report in Memory.',
    ],
    open: { label: 'Open Memory', href: '/app/memory' },
    since: '0.2',
  },
  {
    id: 'skills',
    area: 'knowledge',
    title: 'Skills',
    what: 'The methods your coworkers work by. Edit one, and every coworker who has it uses your version.',
    steps: ['Open Skills from ⌘K, find a method and edit it.'],
    open: { label: 'Open Skills', href: '/app/skills' },
    since: '0.2',
  },

  // ── automation ──
  {
    id: 'automations',
    area: 'automation',
    title: 'Automations',
    what: 'Work that starts on its own: on a schedule, or when a public page changes. Each run is a job or a project, and you choose how you hear about it.',
    steps: ['Ask your Chief: “every Monday morning, check our competitors’ prices.” They set it up once you approve.', 'To switch it off, edit it or remove it, open the Automations page.'],
    open: { label: 'Open Automations', href: '/app/automations' },
    since: '0.2',
  },
  {
    id: 'connectors',
    area: 'automation',
    title: 'Connected services',
    what: 'Outside services your Chief and coworkers can use. Keys stay on the server.',
    steps: [
      'Open Connectors, add a service and test it.',
      'Buffer posts to X, LinkedIn, Facebook and Instagram. Notion, HubSpot, Asana, Canva and others are there too.',
      'Let every coworker use a service, or switch it on for one coworker from their page. Say whether your Chief may use it in Talk.',
      'Anything that changes things in a connected app waits for your OK. To change that, open Admin → Autonomy.',
    ],
    open: { label: 'Open Connectors', href: '/app/connectors' },
    since: '0.2',
  },

  // ── trust ──
  {
    id: 'trust-approvals',
    area: 'trust',
    title: 'Approvals and receipts',
    what: 'Emails go out only with your approval. Each one shows on a card, word for word, and goes out once, with a receipt.',
    steps: [
      'When your Chief or a coworker wants to send an email, a card appears in Talk and in your Inbox.',
      'Approve it once, for the rest of the task or project, or for the day. Or say no.',
      'To turn email on, an owner opens Admin → Email. The test mailbox lets you try it without sending.',
    ],
    open: { label: 'Autonomy settings', href: '/app/admin/autonomy' },
    since: '0.4',
  },
  {
    id: 'trust-audit',
    area: 'trust',
    title: 'The audit log, with Undo',
    what: 'Every change the team makes is on the record, with Undo where it can be undone.',
    steps: ['Open Admin → Audit log.', 'Open any entry for its receipt or details. Press Undo to reverse it.'],
    open: { label: 'Open the audit log', href: '/app/admin/audit' },
    since: '0.4',
  },
  {
    id: 'trust-stop',
    area: 'trust',
    title: 'Everyone stop',
    what: 'One command stops every job and project at once. Emails not yet sent wait.',
    steps: ['While work is running, press “Everyone stop” on the Projects page, or say “everyone, stop” in Talk.', 'To resume work, an owner opens Admin → Autonomy.'],
    open: { label: 'Open Autonomy', href: '/app/admin/autonomy' },
    since: '0.4',
  },
  {
    id: 'trust-autonomy',
    area: 'trust',
    title: 'The autonomy dial',
    what: 'For each kind of action, decide what the team may do alone and what waits for you.',
    steps: ['Open Admin → Autonomy and set each kind of action.', 'Take back a permission at any time.'],
    open: { label: 'Open Autonomy', href: '/app/admin/autonomy' },
    since: '0.4',
  },

  // ── admin ──
  {
    id: 'admin-name',
    area: 'admin',
    title: 'Your office’s own name',
    what: 'The app shows your business’s name at the top and in the browser tab, in place of Headcount. Your Chief of Staff and coworkers use it when they talk about the office.',
    steps: [
      'Click your office’s name at the top of the sidebar and choose “Rename this office”. You can also use ⌘K → “Rename this office”, or Rename under Admin → General → Organization.',
      'Type the name in the dialog and press Rename. Owners can rename the office at any time.',
    ],
    open: { label: 'Name your office', href: '/app/admin' },
    since: '0.8',
  },
  {
    id: 'admin-people',
    area: 'admin',
    title: 'People and roles',
    what: 'Invite people to your office as owners, contributors or readers. Each one signs in with Google.',
    steps: ['Open Admin → People and roles, and add their email with a role.', 'They find your office when they sign in.'],
    open: { label: 'Open People', href: '/app/admin/people' },
    since: '0.2',
  },
  {
    id: 'admin-usage',
    area: 'admin',
    title: 'Settings, usage and costs',
    what: 'Every setting in one place, and what the office used: tokens, calls and their cost.',
    steps: ['Open Admin for settings, provider keys and limits.', 'Open Admin → Usage and costs for the numbers.'],
    open: { label: 'Open Admin', href: '/app/admin' },
    since: '0.2',
  },
  {
    id: 'admin-links',
    area: 'admin',
    title: 'Links to everything, and ⌘K',
    what: 'Every message, project, coworker, setting and document has its own link. ⌘K takes you anywhere.',
    steps: ['To share anything, use “Copy link” next to it.', 'Press ⌘K (More on a phone) to go to a place, a coworker or a setting.'],
    since: '0.2',
  },
];

/** Newest first. Each change links to its guide entry where there is one. */
export const RELEASES: Release[] = [
  {
    version: '0.11',
    date: '2026-10-13',
    title: 'Ready for work',
    summary: 'The team answers in plain words, with the result first. Pages recover when something goes wrong. Phones get larger controls.',
    changes: [
      { text: 'Your Chief of Staff and every coworker answer first, in plain words, with no filler. Spoken replies stay short.', guide: 'talk-basics' },
      { text: 'Step work, reviews and deliverables give numbers and sources, use tables to compare, and end with next steps and an owner.', guide: 'projects-start' },
      { text: 'In meetings, each coworker answers the chair, takes a position and proposes how to settle open points.', guide: 'meetings' },
      { text: 'Project work keeps its headings, lists and tables from step to step. In long meetings, each speaker hears the opening and the latest lines.', guide: 'meetings' },
      { text: 'A project’s Model calls show the calls, tokens and time for each phase.', guide: 'projects-start' },
      { text: 'If a page fails, it says so and offers Reload the page and Go to Talk. An unknown page or project says it was not found and links back.' },
      { text: 'Letting a coworker go now asks first, on the Team page and on their profile.', guide: 'team-page' },
      { text: 'On phones, panels open above the bottom tabs, every button and field is at least 44 pixels tall, and the ⌘K menu has a Close button.' },
      { text: 'The home page is shorter, and every line says what Headcount does today.' },
    ],
  },
  {
    version: '0.10',
    date: '2026-10-10',
    title: 'Edit in place',
    summary: 'Change an image, a flyer, a document or an app where it is. Press Edit and say what should change.',
    changes: [
      { text: 'Images in Files have an Edit button. Say what should change. The new version keeps the rest of the design, and the original stays.', guide: 'files-images' },
      { text: 'Images your Chief posts in Talk have an “Edit it” link that opens the same Edit.', guide: 'files-images' },
      { text: 'Documents and apps on the Canvas have an Edit button at the top.', guide: 'files-canvas' },
    ],
  },
  {
    version: '0.9',
    date: '2026-10-09',
    title: 'Clear writing',
    summary: 'The team writes shorter, clearer work, with the result first. Briefs and meeting notes show as formatted text. Wide content stays inside a phone screen.',
    changes: [
      { text: 'Your Chief, every coworker and background jobs follow one writing standard: the result first, short sentences, plain words.' },
      { text: 'Deliverables are shorter: the result, the key outputs, and next steps with an owner for each.', guide: 'projects-start' },
      { text: 'Meeting summaries list the decision, who does what, and what is still open.', guide: 'meetings' },
      { text: 'Project briefs, meeting notes, the team channel and Inbox requests show as formatted text. A long brief shows two lines until you open it.' },
      { text: 'On a phone, a wide table or a long code word no longer pushes the bottom tabs off the screen.' },
    ],
  },
  {
    version: '0.8',
    date: '2026-10-09',
    title: 'One thing at a time',
    summary: 'Office and name changes open a short dialog. Settings show as clear rows. A meeting’s chair keeps their job title.',
    changes: [
      { text: 'Rename this office and Start another office open a short dialog where you are: in the sidebar, ⌘K or Admin.', guide: 'admin-name' },
      { text: 'Admin → General shows each setting as a row, with its value and one button to change it.', guide: 'admin-name' },
      { text: 'To choose your Chief of Staff, press Choose, then fill in the two optional names in a short dialog.', guide: 'start-chief' },
      { text: 'When you call a meeting, the chair keeps their job title, with a “Chairs” tag beside it.', guide: 'meetings' },
      { text: 'Form fields have a clearer outline, so they stand out from the cards around them.' },
    ],
  },
  {
    version: '0.7',
    date: '2026-10-08',
    title: 'Working together',
    summary: 'Ask anyone for something, and it starts: in a room, at a desk or after a meeting. The new Now page shows who is doing what. Voice works on any phone or browser.',
    changes: [
      { text: 'Rooms are working meetings. Ask for something, and it starts at once with the people in the room. If your Chief is there, they hand it out.', guide: 'office-rooms' },
      { text: 'When a meeting ends, the people at the table start what they agreed, with the chair leading.', guide: 'meetings' },
      { text: 'Coworkers take on work themselves. Ask at their desk, and they start the research or a project they lead.', guide: 'team-desks' },
      { text: 'The Now page shows what needs you, the work under way, who is doing what and what finished lately.', guide: 'now' },
      { text: 'Talk by voice on any phone or browser. Tap the mic to start and again to send, or hold it. If no speech service is set up, your device recognizes your speech.', guide: 'talk-basics' },
      { text: 'Meetings have a mic, next to “Say it”.', guide: 'meetings' },
      { text: 'On a phone, your Chief’s button no longer covers the room’s mic and Send.' },
      { text: 'Fixed a rare stall that could stop the office from answering for a while.' },
    ],
  },
  {
    version: '0.6',
    date: '2026-10-07',
    title: 'In your words',
    summary: 'Your Chief of Staff and coworkers use your office’s name. Everyday phrases play at once. The team can post to social media through Buffer.',
    changes: [
      { text: 'Your Chief of Staff and coworkers call the office by its own name.', guide: 'admin-name' },
      { text: 'Everyday phrases (“On it.”, “Thank you, everyone.”) play at once. Each voice records them once, for every office.' },
      { text: 'Buffer in Connectors: your team can draft and schedule posts for X, LinkedIn, Facebook and Instagram.', guide: 'connectors' },
    ],
  },
  {
    version: '0.5',
    date: '2026-10-07',
    title: 'Make it yours',
    summary: 'Your office shows your business’s name, and switching offices takes one click. The Hire, Meetings and Files pages are clearer, most of all on a phone.',
    changes: [
      { text: 'Your office’s own name shows at the top of the app and in the browser tab.', guide: 'admin-name' },
      { text: 'Switch offices, or start another, from your office’s name at the top of the sidebar (More on a phone).', guide: 'start-office' },
      { text: 'People who are not owners can switch or start offices from the Admin page.' },
      { text: 'A cleaner Hire page: faces, more space, and the Hire button clear of your Chief.', guide: 'start-hire' },
      { text: 'Meetings fits a phone screen. Files shows what was made first, and the form to make something new last.', guide: 'files-images' },
      { text: 'This releases page, with how to use every feature.' },
    ],
  },
  {
    version: '0.4',
    date: '2026-10-06',
    title: 'Your own office',
    summary: 'Each business gets its own office. Hire your team, meet with them, and get images, videos and Office documents from the work. Emails wait for your approval.',
    changes: [
      { text: 'Sign in with Google, start your own office and invite your people. Each office is private.', guide: 'start-office' },
      { text: 'A new office starts with your Chief of Staff. They suggest who to hire, why, and a first job for each.', guide: 'start-hire' },
      { text: 'Meetings: call one from Talk or the Meetings page. Your Chief moderates and brings back the outcome.', guide: 'meetings' },
      { text: 'Files: images and short videos from a description, kept in one place.', guide: 'files-images' },
      { text: 'Download any project document as Word, PowerPoint or Excel.', guide: 'files-documents' },
      { text: 'Emails wait for your approval and go out once, with a receipt.', guide: 'trust-approvals' },
      { text: 'The audit log, with Undo.', guide: 'trust-audit' },
      { text: 'Everyone stop, and the autonomy dial.', guide: 'trust-stop' },
    ],
  },
  {
    version: '0.3',
    date: '2026-09-29',
    title: 'Show and tell',
    summary: 'Show your Chief of Staff a photo, a file, your screen or your camera, and ask about it. Coworker profiles show portraits.',
    changes: [{ text: 'Share pictures, files, screen snapshots and camera photos in Talk.', guide: 'talk-show' }, { text: 'Portraits on coworker profiles.' }],
  },
  {
    version: '0.2',
    date: '2026-09-29',
    title: 'The team at work',
    summary: 'Teams plan, work, review and deliver, and you can listen in on their meetings. This release adds the Handbook, memory, automations, connectors, the Canvas and the admin pages.',
    changes: [
      { text: 'Staff a project in a sentence, approve the plan, and follow the team’s work.', guide: 'projects-start' },
      { text: 'Your team, their desks and their first jobs.', guide: 'team-page' },
      { text: 'Research on the web, with sources.', guide: 'talk-web' },
      { text: 'The Handbook, memory and the weekly memory tidy.', guide: 'memory' },
      { text: 'Automations and connected services.', guide: 'automations' },
      { text: 'Apps and pages on the Canvas.', guide: 'files-canvas' },
      { text: 'People and roles, settings, usage and costs.', guide: 'admin-people' },
      { text: 'Links to everything, and side chats inside documents.', guide: 'admin-links' },
    ],
  },
  {
    version: '0.1',
    date: '2026-09-29',
    title: 'First light',
    summary: 'Choose your Chief of Staff and talk with them while they work. Coworkers have faces and voices, and the office floor shows them at work.',
    changes: [
      { text: 'Choose your Chief of Staff with a short match quiz.', guide: 'start-chief' },
      { text: 'Talk by text or voice. Hand off background work, ask how it is going, and steer it.', guide: 'talk-delegate' },
      { text: 'The office floor and the directory of coworkers.', guide: 'office-floor' },
    ],
  },
];

export const LATEST = RELEASES[0]!;

/** "October 6, 2026". */
export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
