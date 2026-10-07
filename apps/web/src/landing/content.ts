// Landing page copy (PRODUCT.md §1–§3, §7, §9, §10; OWNER-DIRECTIVES D2, D3, D5). Honest by rule: no
// testimonials, customer logos, customer counts or invented metrics. Every capability says whether it works today
// (INC0 §4), is in the works, or is planned, and the present tense is kept for what works today. Prices are
// labelled planned. Coworker names never appear here: they come from the catalog at build time. Examples follow one
// business (an online crystal shop) so the page reads as one story.
import { BRAND } from '@headcount/protocol';

export const TAGLINE = ['Hire a team in a sentence.', 'Watch it work.'] as const;

export type Status = 'now' | 'next' | 'planned';
export const STATUS_LABEL: Record<Status, string> = { now: 'Works today', next: 'In the works', planned: 'Planned' };

export interface Step {
  n: string;
  title: string;
  body: string;
  icon: 'talk' | 'team' | 'eye' | 'check';
  status: Status;
}

export const STEPS: Step[] = [
  { n: '01', title: 'Delegate', icon: 'talk', status: 'now', body: 'Say what you need in one sentence: typed, spoken or held on the mic. Your Chief of Staff takes it and starts it in the background.' },
  { n: '02', title: 'Hire your team', icon: 'team', status: 'now', body: 'Your office starts with your Chief of Staff. Say what your business does and they suggest who to hire, why, and the first job each will do.' },
  { n: '03', title: 'Meet and steer', icon: 'eye', status: 'now', body: 'Put the right people in a room to talk it through, with your Chief moderating. Listen in, take the floor, or ask how the work is going: it never pauses.' },
  { n: '04', title: 'Approve', icon: 'check', status: 'now', body: 'Anything that leaves the building waits for your yes: an email shows on a card, word for word, and goes out once, with a receipt.' },
];

export interface Feature {
  title: string;
  body: string;
  status?: Status;
}

/** D5, the living workforce: reflexes, passing-by chat, side-talk and mood, grounded in real work. */
export const LIVING: Feature[] = [
  { title: 'Reflexes', status: 'now', body: 'A quick “mm-hm”, a “good question, one sec”, a laugh in the right place: short lines pre-voiced in each coworker’s own voice, so they land instantly.' },
  { title: 'Passing-by chat', status: 'now', body: 'Walk past a desk on the Floor and a coworker may look up with a line about what they are really working on. Answer inline, no meeting needed.' },
  { title: 'Side-talk', status: 'now', body: 'Coworkers trade quick notes on real hand-offs, asks and results: bubbles on the Floor, voiced only if you are listening.' },
  { title: 'Mood and ambience', status: 'now', body: 'Wins lift the mood and blockers weigh on it. One setting, Quiet, Lively or Buzzing, decides how chatty the office gets.' },
];

export const SPEEDS: { name: string; body: string; status: Status }[] = [
  { name: 'Reflex', status: 'now', body: 'Instant, pre-voiced micro-lines. No model call.' },
  { name: 'Conversation', status: 'now', body: 'A fast model answers you while work continues.' },
  { name: 'Work', status: 'now', body: 'Background jobs that run for minutes, and keep running.' },
];

/** An illustration of the Talk screen (clearly labelled as one on the page). */
export const TALK_DEMO: { from: 'you' | 'chief'; text: string; kind?: 'status' | 'job' }[] = [
  { from: 'you', text: 'Find three wholesale suppliers of ethically sourced amethyst.' },
  { from: 'chief', text: 'On it. I started that in the background. Keep talking to me meanwhile.' },
  { from: 'you', text: 'How’s it going?' },
  { from: 'chief', text: 'Step 2 of 5: comparing minimum orders and shipping times.', kind: 'status' },
  { from: 'you', text: 'Also check which ones can show where the stones are mined.' },
  { from: 'chief', text: 'Got it. I’ll fold that in at the next checkpoint.' },
];

export const TALK_POINTS: Feature[] = [
  { title: 'Always reachable', status: 'now', body: 'Talking to your Chief of Staff never waits for the work to finish. Status comes from the live job, not from pausing it.' },
  { title: 'Steer mid-flight', status: 'now', body: 'Redirect, add context or stop. Your note lands at the next safe checkpoint while everything else keeps running.' },
  { title: 'Text, push-to-talk or voice', status: 'now', body: 'Hold Space or the mic and talk. Interrupt any time: they stop mid-sentence.' },
];

export interface Provider {
  name: string;
  caps: string[];
}

/** Compatibility, not endorsement: plain names with what each provider switches on. */
export const PROVIDERS: Provider[] = [
  { name: 'Anthropic', caps: ['Chat'] },
  { name: 'OpenAI', caps: ['Chat', 'Voice', 'Images'] },
  { name: 'xAI', caps: ['Chat', 'Voice', 'Images', 'Video'] },
  { name: 'Google Gemini', caps: ['Chat'] },
  { name: 'OpenAI-compatible', caps: ['Chat'] },
  { name: 'Ollama', caps: ['Chat', 'Local'] },
];

export const MODALITIES: (Feature & { icon: 'voice' | 'image' | 'eye' | 'video' | 'doc'; status: Status })[] = [
  { icon: 'voice', title: 'Voice', status: 'now', body: 'Talk and listen in your Chief of Staff’s own voice, with a face that lip-syncs to what is actually playing.' },
  { icon: 'image', title: 'Images', status: 'now', body: 'Product shots, social graphics and banners from a sentence. Ask in Talk and it lands in the thread, and in Files.' },
  { icon: 'eye', title: 'Vision', status: 'now', body: 'Show a receipt, a shelf or your screen, or take a photo, and ask about it.' },
  { icon: 'video', title: 'Video', status: 'now', body: 'Teasers and social clips up to 15 seconds, made in the background while you keep working.' },
  { icon: 'doc', title: 'Documents', status: 'now', body: 'Show the team PDFs and spreadsheets. Every project’s document downloads as Word, PowerPoint or Excel.' },
];

export const TRUST: (Feature & { icon: 'hand' | 'receipt' | 'stop' | 'badge'; status: Status })[] = [
  { icon: 'badge', title: 'Honest AI', status: 'now', body: 'Every coworker is labeled as AI and says so when sincerely asked. Backstories are character lore, never claimed as real events.' },
  { icon: 'hand', title: 'Approvals', status: 'now', body: 'Emails never leave without your yes: once, for the rest of a task or project, or for a day, and you can take it back. No coworker can spend money.' },
  { icon: 'receipt', title: 'Receipts', status: 'now', body: 'Nothing counts as sent without a receipt, and everything the team does is in an audit log, with Undo where it can be undone.' },
  { icon: 'stop', title: 'Everyone stop', status: 'now', body: 'One control halts every job and project at once, and holds any email that has not gone out until you resume.' },
];

/** Meetings: the team in a room, the Chief of Staff moderating. */
export const MEETINGS: Feature[] = [
  { title: 'Called in a sentence', status: 'now', body: '“Get the team together on a crystal subscription box.” Your Chief invites the people best placed and opens the meeting.' },
  { title: 'Your Chief moderates', status: 'now', body: 'The first person invited chairs. Your Chief opens, keeps the floor moving and closes with the chair’s summary.' },
  { title: 'Listen in, or speak up', status: 'now', body: 'Hear every line in each coworker’s own voice, take the floor, or whisper to one person. Read it later any time.' },
  { title: 'The outcome comes to you', status: 'now', body: 'What they agreed lands in Talk, ready to become a project with one word.' },
];

/** Your own office: multi-tenant from the first sign-in. */
export const OFFICE: Feature[] = [
  { title: 'Start in a minute', status: 'now', body: 'Sign in with Google, name your office, pick your Chief of Staff and hire your first coworkers.' },
  { title: 'Yours alone', status: 'now', body: 'Memory, the Handbook, files, projects and conversations stay in your office, apart from every other.' },
  { title: 'Bring your people', status: 'now', body: 'Invite owners, contributors and readers by email. Everyone works in the same office.' },
];

export interface Pack {
  name: string;
  roles: string;
  skeptic: string;
}

/** Industry packs, in the order they are planned. None is built yet. */
export const PACKS: Pack[] = [
  { name: 'Agency', roles: 'Account strategist, performance analyst, copywriter, deck designer', skeptic: 'the client’s CFO' },
  { name: 'Practice', roles: 'Intake, close coordinator, reviewer, client liaison', skeptic: 'the auditor' },
  { name: 'E-commerce', roles: 'Merchandiser, ads analyst, operations, content maker', skeptic: 'the returning customer' },
  { name: 'Home services', roles: 'Lead concierge, scheduler, listing writer', skeptic: 'the first-time buyer' },
  { name: 'Software studio', roles: 'CLI builder, reviewer, tester', skeptic: 'the on-call engineer' },
];

export interface Tier {
  name: string;
  price: string;
  for: string;
  rows: string[];
  /** An honest label for the emphasised card (never "most popular": there are no customers to count). */
  note?: string;
}

export const TIERS: Tier[] = [
  { name: 'Solo', price: '$49', for: 'The owner, running lean', rows: ['You, the owner', '6 active coworkers', '3 active projects', '$20 of usage included', 'Email sends with approval', '1 front door'] },
  { name: 'Team', price: '$199', for: 'A small team that delegates daily', note: 'Built for small teams', rows: ['Owner + 2 seats (+$29 each)', '20 active coworkers', 'Unlimited projects', '$100 of usage included', 'Standing grants; calendar, CRM, publish', '10 front doors · removable branding'] },
  { name: 'Business', price: '$799', for: 'A studio with clients to protect', rows: ['Owner + 9 seats, SSO', '60 active coworkers', 'Unlimited projects', '$400 of usage included', 'Audit export, custom retention', 'Unlimited front doors on your domain'] },
];

export const PRICING_PRINCIPLES = ['Humans pay for seats. Coworkers are not seats.', 'One usage balance, in dollars. No credits.', 'Voice costs money only when someone listens.'];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Are the coworkers real people?',
    a: 'No. Every coworker is an AI, labeled as one, and says so when sincerely asked. Their backstories are character lore that keeps each personality consistent; they never claim real-world actions they did not take.',
  },
  {
    q: 'What works today?',
    a: `${BRAND.name} is in early access. Today you can start your own office, pick your Chief of Staff, hire coworkers, talk by text or voice, hand off background work, run team projects with a plan you approve, call meetings and listen in, make images, short videos and documents (Word, PowerPoint, Excel), and approve every email before it goes out. Industry packs and public pricing are still planned, and the page marks them.`,
  },
  {
    q: 'Is my office private?',
    a: 'Yes. Each office keeps its own memory, Handbook, files, projects and conversations, apart from every other office here. Only the people you invite can see it, and you choose what each of them can do.',
  },
  {
    q: 'Do I need API keys to try it?',
    a: `No. Without a provider, ${BRAND.name} runs on a built-in demo provider (its answers are clearly labeled placeholders) or on your local Ollama. With keys set up, each one switches on a capability, and anything without a provider is hidden rather than shown broken.`,
  },
  {
    q: 'Where do my keys live?',
    a: 'Only on the server, in the worker’s environment. They never reach the browser, logs or error messages, and a local-only run never fails over to a cloud provider.',
  },
  {
    q: 'Can I switch my Chief of Staff later?',
    a: 'Any time. Switching changes the personality, face and voice, never your work, projects or coworkers.',
  },
  {
    q: 'What will it cost?',
    a: `The tiers above are planned pricing. They will be calibrated against real usage before public launch; until then, ${BRAND.name} runs on design-partner plans.`,
  },
];

/** "Twelve" for small counts (headlines read better in words), digits otherwise. */
export function countWord(n: number, capital = false): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const w = n >= 0 && n < words.length && Number.isInteger(n) ? words[n]! : String(n);
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}
