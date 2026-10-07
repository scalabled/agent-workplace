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
  { id: 'talk', title: 'Talk with your Chief of Staff', lede: 'One person to talk to. They answer, hand off and keep you posted.' },
  { id: 'team', title: 'Your team', lede: 'The coworkers you hired, what they do, and how to give them work.' },
  { id: 'projects', title: 'Projects and meetings', lede: 'Bigger work, staffed by a team, planned with you, and talked through in meetings.' },
  { id: 'files', title: 'Files and things they make', lede: 'Images, videos, documents, apps and pages.' },
  { id: 'office', title: 'The office', lede: 'Watch the office at work and drop in on anyone.' },
  { id: 'knowledge', title: 'What the office knows', lede: 'Your Handbook, the team’s memory, and the methods they work by.' },
  { id: 'automation', title: 'Automations and connected services', lede: 'Work that starts by itself, and the services the team can use.' },
  { id: 'trust', title: 'Trust and control', lede: 'Nothing leaves without your yes, and everything is on the record.' },
  { id: 'admin', title: 'Admin and your organization', lede: 'People, roles, settings and costs.' },
];

export const GUIDE: GuideEntry[] = [
  // ── getting started ──
  {
    id: 'start-office',
    area: 'start',
    title: 'Start your office',
    what: 'Every business gets its own office: its own Chief of Staff, team, memory, files and conversations, kept apart from every other office.',
    steps: ['Sign in with Google.', 'If someone invited you, their office is there when you sign in.', 'If you are not in an office yet, name yours and say in a line what it is for. (While sign-up is invite-only, ask someone to invite you first.)', 'To switch offices or start another, click your office’s name at the top of the sidebar. On a phone, use More (or ⌘K) → “Switch to …” or “Start another office”.'],
    open: { label: 'Enter the office', href: '/app' },
    since: '0.4',
  },
  {
    id: 'start-chief',
    area: 'start',
    title: 'Choose your Chief of Staff',
    what: 'The one agent you talk to. Each has a name, a face, a voice and a way of working; you can switch any time without losing anything.',
    steps: ['On first run, take the short match quiz or browse the Chiefs of Staff and hear each one.', 'Pick one; they greet you in Talk.', 'To switch later, press ⌘K (More on a phone) and choose “Switch Chief of Staff”.'],
    open: { label: 'Choose', href: '/app/welcome' },
    since: '0.1',
  },
  {
    id: 'start-hire',
    area: 'start',
    title: 'Hire your team',
    what: 'A new office starts with your Chief of Staff alone. Say what your business does and they suggest who to hire, why, what each will do, and their first job.',
    steps: ['After choosing your Chief of Staff, the Hire page opens with four suggestions picked.', 'Describe your business (for example “an online crystal shop on Shopify and Etsy”) and press “Suggest people for this”.', 'Hear each one, change the picks, or search for a role (“video”, “legal”).', 'Press Hire. Each new coworker is welcomed in Talk with their first job.', 'Hire more any time from the Team page, or ask your Chief: “hire a bookkeeper”.'],
    open: { label: 'Hire someone', href: '/app/team/hire' },
    since: '0.4',
  },

  // ── talk ──
  {
    id: 'talk-basics',
    area: 'talk',
    title: 'Talk by text or voice',
    what: 'Your Chief of Staff answers at once, while work carries on in the background. Replies can be spoken in their own voice, with a face that moves with what is playing.',
    steps: ['Type in the message field and press Enter.', 'To talk, hold Space (with the field empty) or hold the mic button; let go to send.', 'Interrupt any time: start talking, or press Esc, and they stop.', 'Turn spoken replies on or off from ⌘K → “Turn voice on/off”.'],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.1',
  },
  {
    id: 'talk-delegate',
    area: 'talk',
    title: 'Hand off work, ask how it is going, steer it',
    what: 'Anything that takes more than a quick answer runs as a background job: research, comparisons, write-ups.',
    steps: ['Say what you need: “Find three wholesale suppliers of ethically sourced amethyst.”', 'Keep talking about anything else meanwhile.', 'Ask “how’s it going?” for the live step and what was found so far.', 'Add direction (“also check where the stones are mined”); it lands at the next checkpoint.', 'Stop a job from its row above the message field, or say “stop that”.'],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.1',
  },
  {
    id: 'talk-show',
    area: 'talk',
    title: 'Show your Chief what you see',
    what: 'Share a photo, a file, a snapshot of your screen or a picture from your camera with a message, and ask about it.',
    steps: ['Press the attach button beside the message field.', 'Choose a file or photo, a snapshot of your screen, or the camera.', 'Add your question and send. What you share is kept in Memory.'],
    open: { label: 'Open Talk', href: '/app/talk' },
    since: '0.3',
  },
  {
    id: 'talk-web',
    area: 'talk',
    title: 'Research on the web, with sources',
    what: 'Your Chief and the team search the web and read pages when the work needs it, and show the sources they relied on.',
    steps: ['Ask for anything that needs current facts: prices, suppliers, competitors, rules.', 'Open the job or project step to see the sources behind each finding.'],
    since: '0.2',
  },

  // ── team ──
  {
    id: 'team-page',
    area: 'team',
    title: 'Your team and their first jobs',
    what: 'Everyone you hired, what they do, and a first job each can start right away.',
    steps: ['Open the Team page (⌘K → Team).', 'Hear a coworker, or open their desk to talk with them directly.', 'Press Start on a first job to set them to work; follow its link to see it run.', 'Let someone go from their card; you can undo it from the audit log.'],
    open: { label: 'Open the Team page', href: '/app/team' },
    since: '0.2',
  },
  {
    id: 'team-desks',
    area: 'team',
    title: 'Talk to a coworker at their desk',
    what: 'Each coworker has a desk where you can ask them anything in their field. They answer there and can start the work themselves.',
    steps: ['Open a coworker’s profile from the Team page or the Floor and talk at their desk.', 'Or ask your Chief to “ask the bookkeeper about…” or “pass this to the copywriter”: they bring the answer back or hand it over.', 'See and edit how a coworker works on their profile (their instructions and skills).'],
    open: { label: 'Meet the team', href: '/app/team' },
    since: '0.2',
  },

  // ── projects and meetings ──
  {
    id: 'projects-start',
    area: 'projects',
    title: 'Staff a project in a sentence',
    what: 'For bigger work, your Chief puts together a team that drafts a plan; nothing starts until you approve it. Then the team works step by step, reviews each other’s work and delivers a document, a page or a file.',
    steps: ['In Talk, say “put together a team to launch our spring collection with a small campaign”.', 'The plan arrives in your Inbox: see the team and steps, and approve it (or tell your Chief to go ahead).', 'Follow the work on the project page: each step, who did it, the reviews and the team channel.', 'Give direction any time in “Tell the team”; it is picked up at the next step.', 'When it is done, read the deliverable and download it.'],
    open: { label: 'Open Projects', href: '/app/projects' },
    since: '0.2',
  },
  {
    id: 'meetings',
    area: 'projects',
    title: 'Meetings, with your Chief moderating',
    what: 'Put the right people in a room to talk something through. They take turns, the first person invited chairs and sums up, your Chief keeps it moving, and the outcome comes back to you.',
    steps: ['In Talk, say “call a meeting about a monthly crystal subscription box”; your Chief invites the people best placed.', 'Or open Meetings, write the question, pick who comes (the first chairs) and press “Start the meeting”.', 'Press “Listen in” to hear each line in the speaker’s voice; take the floor, or whisper to one person.', 'When it ends, your Chief posts what they agreed in Talk; press “Make it a project” to act on it.', 'Projects hold their own kickoffs and reviews; they are on the Meetings page too.'],
    open: { label: 'Open Meetings', href: '/app/meetings' },
    since: '0.4',
  },
  {
    id: 'inbox',
    area: 'projects',
    title: 'Your Inbox',
    what: 'Everything that needs you in one place: plans to approve, questions from the team, and anything waiting for your OK.',
    steps: ['A number on Inbox means something is waiting.', 'Answer there, or just tell your Chief in Talk.'],
    open: { label: 'Open the Inbox', href: '/app/inbox' },
    since: '0.2',
  },

  // ── files ──
  {
    id: 'files-images',
    area: 'files',
    title: 'Images and short videos',
    what: 'Product shots, social graphics, banners and clips up to 15 seconds, made from a description and kept in Files.',
    steps: ['Ask in Talk: “make an image of our amethyst gift box on white linen” or “make a short video teaser for the spring sale”. It is posted in the thread when ready.', 'Or open Files, choose Image or Video, describe it, pick a shape and press Make.', 'Download or remove anything from Files. Project teams can add images to their deliverables too.'],
    open: { label: 'Open Files', href: '/app/files' },
    since: '0.4',
  },
  {
    id: 'files-documents',
    area: 'files',
    title: 'Word, PowerPoint and Excel',
    what: 'Every project document downloads as Word, as PowerPoint (a slide per section) or as Excel (its tables).',
    steps: ['On a finished project, open “Download” on the deliverable, or find it under Documents in Files.', 'Choose Word, PowerPoint, Excel or Markdown.'],
    open: { label: 'Open Files', href: '/app/files' },
    since: '0.4',
  },
  {
    id: 'files-canvas',
    area: 'files',
    title: 'Apps and pages',
    what: 'Small apps and documents built for you: a calculator, a tracker, a price list, a one-page plan. Each can be downloaded or exported to PDF.',
    steps: ['Ask your Chief: “make me a shipping cost calculator”, or describe it on the Canvas page.', 'Try it right there; ask for changes and a new version is made.'],
    open: { label: 'Open the Canvas', href: '/app/canvas' },
    since: '0.2',
  },

  // ── the office ──
  {
    id: 'office-floor',
    area: 'office',
    title: 'The office floor',
    what: 'Your Chief and your team at their desks, working, taking breaks and chatting about real work. Faces show what each person is doing.',
    steps: ['Open the Floor. Switch between the Office and the Directory with the toggle.', 'Rest on a face to see what they are working on; click to chat in place.', 'People in a meeting gather around your Chief.', 'Choose how lively the office is (Quiet, Lively, Buzzing) in ⌘K.'],
    open: { label: 'Open the Floor', href: '/app/floor' },
    since: '0.1',
  },
  {
    id: 'office-directory',
    area: 'office',
    title: 'The directory of coworkers',
    what: 'Every coworker you can hire or bring into a project, across every department, each with a face, a voice and a craft.',
    steps: ['Open the Floor and choose Directory, or search with ⌘K.', 'Open anyone’s profile to hear them and see what they do; hire them from there.'],
    open: { label: 'Browse the directory', href: '/app/floor?view=directory' },
    since: '0.1',
  },

  // ── knowledge ──
  {
    id: 'handbook',
    area: 'knowledge',
    title: 'The Handbook',
    what: 'Your own description of the business. Your Chief and every coworker work from it, so their work sounds like you and follows your rules.',
    steps: ['Open the Handbook and write each section, or press the button to let your Chief interview you.', 'Your Chief suggests additions as they learn; you approve them.'],
    open: { label: 'Open the Handbook', href: '/app/handbook' },
    since: '0.2',
  },
  {
    id: 'memory',
    area: 'knowledge',
    title: 'Memory and the second brain',
    what: 'What the team remembers from your conversations, meetings and the files you share; it comes back when it bears on the work. A weekly tidy keeps it in order.',
    steps: ['Tell your Chief something to keep: “remember that our supplier delivers on Tuesdays.”', 'Open Memory to change, pin or forget anything.', 'The weekly tidy runs from the Team page (“Tidy now” to run it at once); read its report in Memory.'],
    open: { label: 'Open Memory', href: '/app/memory' },
    since: '0.2',
  },
  {
    id: 'skills',
    area: 'knowledge',
    title: 'Skills',
    what: 'The methods your coworkers work by. Edit one and every coworker who has it uses your version.',
    steps: ['Open Skills from ⌘K, find a method and edit it.'],
    open: { label: 'Open Skills', href: '/app/skills' },
    since: '0.2',
  },

  // ── automation ──
  {
    id: 'automations',
    area: 'automation',
    title: 'Automations',
    what: 'Work that starts by itself: on a schedule, or when a public page changes. Each run is a job or a project, and you hear about it as you choose.',
    steps: ['Ask your Chief: “every Monday morning, check our competitors’ prices.” They set it up once you approve.', 'Switch it off, edit it or remove it on the Automations page.'],
    open: { label: 'Open Automations', href: '/app/automations' },
    since: '0.2',
  },
  {
    id: 'connectors',
    area: 'automation',
    title: 'Connected services',
    what: 'Outside services your Chief and coworkers can use. Keys stay on the server; anything that changes things waits for your OK.',
    steps: ['Open Connectors, add a service and test it.', 'Let every coworker use it, or switch it on for one coworker from their page; say whether your Chief may use it in Talk.'],
    open: { label: 'Open Connectors', href: '/app/connectors' },
    since: '0.2',
  },

  // ── trust ──
  {
    id: 'trust-approvals',
    area: 'trust',
    title: 'Approvals and receipts',
    what: 'Emails never leave without your yes. Each one shows on a card, word for word, and goes out once, with a receipt.',
    steps: ['When your Chief or a coworker wants to send an email, a card appears in Talk (and your Inbox).', 'Approve it once, for the rest of the task or project, or for the day; or say no.', 'Owners turn email on in Admin → Email (the test mailbox lets you try it without sending).'],
    open: { label: 'Autonomy settings', href: '/app/admin/autonomy' },
    since: '0.4',
  },
  {
    id: 'trust-audit',
    area: 'trust',
    title: 'The audit log, with Undo',
    what: 'Everything the team does that changes something is on the record, with Undo where it can be undone.',
    steps: ['Open Admin → Audit log.', 'Open any entry for its receipt or details; press Undo to put it back.'],
    open: { label: 'Open the audit log', href: '/app/admin/audit' },
    since: '0.4',
  },
  {
    id: 'trust-stop',
    area: 'trust',
    title: 'Everyone stop',
    what: 'One command halts every job and project at once and holds any email that has not gone out.',
    steps: ['While work is running, press “Everyone stop” on the Projects page, or say “everyone, stop” in Talk.', 'An owner resumes work in Admin → Autonomy.'],
    open: { label: 'Open Autonomy', href: '/app/admin/autonomy' },
    since: '0.4',
  },
  {
    id: 'trust-autonomy',
    area: 'trust',
    title: 'The autonomy dial',
    what: 'Decide, kind of action by kind of action, what the team may do on its own and what waits for you.',
    steps: ['Open Admin → Autonomy and set each kind of action.', 'Take back a permission you gave at any time.'],
    open: { label: 'Open Autonomy', href: '/app/admin/autonomy' },
    since: '0.4',
  },

  // ── admin ──
  {
    id: 'admin-name',
    area: 'admin',
    title: 'Your office’s own name',
    what: 'The app shows your business’s name at the top and in the browser tab, in place of Headcount.',
    steps: ['Open Admin → General (or click your office’s name at the top of the sidebar → “Rename this office”).', 'Type the name under Organization and press Rename. Owners can rename it any time.'],
    open: { label: 'Name your office', href: '/app/admin' },
    since: '0.5',
  },
  {
    id: 'admin-people',
    area: 'admin',
    title: 'People and roles',
    what: 'Invite people to your office as owners, contributors or readers. Each signs in with Google.',
    steps: ['Open Admin → People and roles and add their email with a role.', 'They will find your office when they sign in.'],
    open: { label: 'Open People', href: '/app/admin/people' },
    since: '0.2',
  },
  {
    id: 'admin-usage',
    area: 'admin',
    title: 'Settings, usage and costs',
    what: 'Every setting in one place, and what the office has used: tokens, calls and their cost.',
    steps: ['Open Admin for settings, provider keys and limits.', 'Open Admin → Usage and costs for the numbers.'],
    open: { label: 'Open Admin', href: '/app/admin' },
    since: '0.2',
  },
  {
    id: 'admin-links',
    area: 'admin',
    title: 'Links to everything, and ⌘K',
    what: 'Every message, project, coworker, setting and document has its own link. ⌘K takes you anywhere.',
    steps: ['Use “Copy link” next to anything to share it.', 'Press ⌘K (More on a phone) to go to a place, a coworker or a setting.'],
    since: '0.2',
  },
];

/** Newest first. Each change links to its guide entry where there is one. */
export const RELEASES: Release[] = [
  {
    version: '0.5',
    date: '2026-10-07',
    title: 'Make it yours',
    summary: 'Your office carries your business’s name, switching between offices is one click, and the Hire, Meetings and Files pages read better, especially on a phone.',
    changes: [
      { text: 'Your office’s own name at the top of the app and in the browser tab.', guide: 'admin-name' },
      { text: 'Switch offices, or start another, from your office’s name at the top of the sidebar (More on a phone).', guide: 'start-office' },
      { text: 'People who are not owners can switch or start offices from the Admin page.' },
      { text: 'A cleaner Hire page: faces, room to breathe, and the Hire button clear of your Chief.', guide: 'start-hire' },
      { text: 'Meetings fits your phone’s screen; Files shows what was made first, and making something new last.', guide: 'files-images' },
      { text: 'This releases page, with how to use every feature.' },
    ],
  },
  {
    version: '0.4',
    date: '2026-10-06',
    title: 'Your own office',
    summary: 'Every business gets its own office. Hire your team deliberately, meet with them, and get images, videos and Office documents out of the work. Nothing leaves without your yes.',
    changes: [
      { text: 'Sign in with Google and start your own office; invite your people. Each office is private.', guide: 'start-office' },
      { text: 'A new office starts with your Chief of Staff, who suggests who to hire, why and their first job.', guide: 'start-hire' },
      { text: 'Meetings: call one from Talk or the Meetings page; your Chief moderates and brings the outcome back.', guide: 'meetings' },
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
    summary: 'Show your Chief of Staff a photo, a file, your screen or your camera, and ask about it. Every coworker’s profile has their portrait.',
    changes: [{ text: 'Share pictures, files, screen snapshots and camera photos in Talk.', guide: 'talk-show' }, { text: 'Portraits on coworker profiles.' }],
  },
  {
    version: '0.2',
    date: '2026-09-29',
    title: 'The team at work',
    summary: 'Teams that plan, work, review and deliver; meetings you can listen in on; the Handbook and memory; automations, connectors and the canvas; and the admin pages.',
    changes: [
      { text: 'Staff a project in a sentence, approve the plan, and follow the team’s work.', guide: 'projects-start' },
      { text: 'Your team, their desks and their first jobs.', guide: 'team-page' },
      { text: 'Research on the web, with sources.', guide: 'talk-web' },
      { text: 'The Handbook, memory and the weekly second-brain tidy.', guide: 'memory' },
      { text: 'Automations and connected services.', guide: 'automations' },
      { text: 'Apps and pages on the canvas.', guide: 'files-canvas' },
      { text: 'People and roles, settings, usage and costs.', guide: 'admin-people' },
      { text: 'Links to everything, and side chats inside documents.', guide: 'admin-links' },
    ],
  },
  {
    version: '0.1',
    date: '2026-09-29',
    title: 'First light',
    summary: 'Your Chief of Staff, talk while they work, faces and voices, and the office floor.',
    changes: [
      { text: 'Choose your Chief of Staff with a short match quiz.', guide: 'start-chief' },
      { text: 'Talk by text or voice; hand off background work, ask how it is going, steer it.', guide: 'talk-delegate' },
      { text: 'The office floor and the directory of coworkers.', guide: 'office-floor' },
    ],
  },
];

export const LATEST = RELEASES[0]!;

/** "October 6, 2026". */
export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
