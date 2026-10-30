// Landing page copy (PRODUCT.md §1–§3, §7, §9, §10; OWNER-DIRECTIVES D2, D3, D5). Honest by rule: no
// testimonials, customer logos, customer counts or invented metrics. Every capability says whether it works today
// (CORE §4), is in the works, or is planned, and the present tense is kept for what works today. Prices are
// labeled planned. Coworker names never appear here: they come from the catalog at build time. Examples follow one
// business (an online crystal shop) so the page reads as one story. Copy follows the writing standard
// (apps/worker/src/agents/writing.ts): short sentences, plain words, no em dashes.
import { BRAND } from '@headcount/protocol';

export const TAGLINE = ['Hire an AI team.', 'Watch it work.'] as const;

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
  { n: '01', title: 'Hire your team', icon: 'team', status: 'now', body: 'Your office starts with your Chief of Staff. Describe your business, and they suggest who to hire and a first job for each.' },
  { n: '02', title: 'Delegate', icon: 'talk', status: 'now', body: 'Type or say what you need. Your Chief of Staff starts it in the background and keeps talking with you.' },
  { n: '03', title: 'Watch and steer', icon: 'eye', status: 'now', body: 'The Now page shows each job, its step and who is on it. Change direction or stop a job at any time.' },
  { n: '04', title: 'Approve', icon: 'check', status: 'now', body: 'Emails wait for your approval. You see each one word for word, and it goes out once, with a receipt.' },
];

export interface Feature {
  title: string;
  body: string;
  status?: Status;
}

/** D5, the living workforce: reflexes, passing-by chat, side-talk and mood, grounded in real work. */
export const LIVING: Feature[] = [
  { title: 'Reflexes', status: 'now', body: 'Short replies such as “mm-hm” and “one sec” play at once, in the coworker’s own voice.' },
  { title: 'Passing-by chat', status: 'now', body: 'On the Floor, a coworker you pass can tell you what they are working on. Reply in place.' },
  { title: 'Side-talk', status: 'now', body: 'Coworkers trade short notes about real hand-offs and results. You see them as bubbles on the Floor.' },
  { title: 'Mood and ambience', status: 'now', body: 'Finished work lifts the mood, and blockers lower it. Set the office to Quiet, Lively or Buzzing.' },
];

/** An illustration of the Talk screen (labeled as one on the page). */
export const TALK_DEMO: { from: 'you' | 'chief'; text: string; kind?: 'status' | 'job' }[] = [
  { from: 'you', text: 'Find three wholesale suppliers of ethically sourced amethyst.' },
  { from: 'chief', text: 'On it. That runs in the background, so keep talking.' },
  { from: 'you', text: 'How’s it going?' },
  { from: 'chief', text: 'Step 2 of 5: comparing minimum orders and shipping times.', kind: 'status' },
  { from: 'you', text: 'Also check which ones can show where the stones are mined.' },
  { from: 'chief', text: 'Got it. I’ll add that at the next checkpoint.' },
];

export const TALK_POINTS: Feature[] = [
  { title: 'Ask how it is going', status: 'now', body: 'Your Chief of Staff reads the status from the live job. The job keeps running while they answer.' },
  { title: 'Change direction', status: 'now', body: 'Add a detail, change the goal or stop the job. The job takes your note at its next checkpoint.' },
  { title: 'Type or talk', status: 'now', body: 'Type, or tap the mic and talk, on any phone or browser. To interrupt, start talking.' },
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
  { icon: 'voice', title: 'Voice', status: 'now', body: 'Your Chief of Staff speaks in their own voice. Their face moves with the words.' },
  { icon: 'image', title: 'Images', status: 'now', body: 'Ask for a product shot or a banner. To change one, press Edit and say what to change.' },
  { icon: 'eye', title: 'Vision', status: 'now', body: 'Show a product photo, a price list or your screen, and ask about it.' },
  { icon: 'video', title: 'Video', status: 'now', body: 'Clips up to 15 seconds for social posts, made in the background.' },
  { icon: 'doc', title: 'Documents', status: 'now', body: 'Share PDFs and spreadsheets. Download any project document as Word, PowerPoint or Excel.' },
];

export const TRUST: (Feature & { icon: 'hand' | 'receipt' | 'stop' | 'badge'; status: Status })[] = [
  { icon: 'badge', title: 'Honest AI', status: 'now', body: 'Every coworker is labeled as an AI and says so when you sincerely ask. Backstories are fiction.' },
  { icon: 'hand', title: 'Approvals', status: 'now', body: 'Approve emails one at a time, or for the rest of a task, a project or a day. Take back a standing approval at any time. Coworkers cannot spend money.' },
  { icon: 'receipt', title: 'Receipts', status: 'now', body: 'Every sent email has a receipt. The audit log records each change the team makes, with Undo where possible.' },
  { icon: 'stop', title: 'Everyone stop', status: 'now', body: 'One command stops every job and project at once. Unsent emails wait until an owner resumes work.' },
];

/** Meetings: the team in a room, the Chief of Staff moderating. */
export const MEETINGS: Feature[] = [
  { title: 'Call a meeting', status: 'now', body: 'Say “Call a meeting about a monthly crystal box.” Your Chief of Staff invites the right coworkers.' },
  { title: 'A chair and a moderator', status: 'now', body: 'The first coworker invited chairs and sums up. Your Chief of Staff moderates.' },
  { title: 'Listen and speak', status: 'now', body: 'Press Listen in to hear each line in the speaker’s voice. To speak, type or use the mic.' },
  { title: 'Then the work starts', status: 'now', body: 'When the meeting ends, the coworkers start what they agreed. In a room on the Floor, work starts when you ask.' },
];

/** Your own office: multi-tenant from the first sign-in. */
export const OFFICE: Feature[] = [
  { title: 'Sign in with Google', status: 'now', body: 'Name your office, choose your Chief of Staff and hire your first coworkers.' },
  { title: 'Private to your office', status: 'now', body: 'Memory, the Handbook, files, projects and conversations stay in your office. Only the people you invite can see them.' },
  { title: 'Bring your people', status: 'now', body: 'Invite people by email as owners, contributors or readers.' },
];

export interface Pack {
  name: string;
  roles: string;
  skeptic: string;
}

/** Industry packs, in the order they are planned. None is built yet. */
export const PACKS: Pack[] = [
  { name: 'Agency', roles: 'Account strategist, performance analyst, copywriter, deck designer', skeptic: 'the client’s finance chief' },
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
  /** An honest label for the emphasized card (never "most popular": there are no customers to count). */
  note?: string;
}

export const TIERS: Tier[] = [
  { name: 'Solo', price: '$49', for: 'For an owner who works alone', rows: ['You, the owner', '6 active coworkers', '3 active projects', '$20 of usage included', 'Emails sent with your approval', '1 guest link for your customers'] },
  { name: 'Team', price: '$199', for: 'For a small team', note: 'Built for small teams', rows: ['Owner + 2 seats (+$29 each)', '20 active coworkers', 'Unlimited projects', '$100 of usage included', 'Standing approvals; calendar, customer records, publishing', '10 guest links · removable branding'] },
  { name: 'Business', price: '$799', for: 'For a studio with client work', rows: ['Owner + 9 seats, single sign-on', '60 active coworkers', 'Unlimited projects', '$400 of usage included', 'Audit log export, custom data retention', 'Unlimited guest links on your domain'] },
];

export const PRICING_PRINCIPLES = ['Only people need seats.', 'Usage comes from one balance, in dollars.', 'Voice costs money only when someone listens.'];

export interface Answer {
  q: string;
  a: string;
  /** Bullet points after the answer. */
  list?: string[];
  /** A closing sentence after the list. */
  more?: string;
}

export const FAQ: Answer[] = [
  {
    q: 'Are the coworkers real people?',
    a: 'No. Every coworker is an AI and is labeled as one. They say so when you sincerely ask. Their backstories are fiction, and they report only work they did.',
  },
  {
    q: 'What works today?',
    a: `${BRAND.name} is in early access. These features work today:`,
    list: [
      'Your own office, Chief of Staff and coworkers',
      'Talk by text or voice, on any phone or browser',
      'Background jobs you can check, steer and stop',
      'Projects with a plan you approve',
      'Meetings you can listen to and join',
      'Images, short videos, documents and small apps, each with Edit',
      'Your approval for every email, with a receipt',
    ],
    more: 'Industry packs and public pricing are planned. The Releases page lists every feature and how to use it.',
  },
  {
    q: 'How do I get in?',
    a: 'Early access is invite-only. Sign in with Google, using the email address that was invited.',
  },
  {
    q: 'Is my office private?',
    a: 'Yes. Each office keeps its own memory, Handbook, files, projects and conversations. Only the people you invite can see it, and you set the role of each one.',
  },
  {
    q: 'Do I need my own AI keys?',
    a: 'No. You can start without keys. To use your own AI provider, an owner adds its key in Admin. Keys are stored encrypted and never reach the browser, logs or error messages.',
  },
  {
    q: 'Can I switch my Chief of Staff later?',
    a: 'Yes, at any time. Switching changes the personality, face and voice. Your work, projects and coworkers stay.',
  },
  {
    q: 'What will it cost?',
    a: 'Early access is free, with daily usage limits for each office. The prices above are planned. Real usage will set the final prices before public launch.',
  },
];

/** "Twelve" for small counts (headlines read better in words), digits otherwise. */
export function countWord(n: number, capital = false): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const w = n >= 0 && n < words.length && Number.isInteger(n) ? words[n]! : String(n);
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}
