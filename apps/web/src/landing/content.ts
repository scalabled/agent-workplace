// Landing page copy (PRODUCT.md §1–§3, §7, §9, §10; OWNER-DIRECTIVES D2, D3, D5). Honest by rule: no
// testimonials, customer logos, customer counts or invented metrics. Every capability says whether it works today
// (INC0 §4), is in the works, or is planned, and the present tense is kept for what works today. Prices are
// labelled planned. Coworker names never appear here: they come from the catalog at build time.

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
  { n: '02', title: 'Staff it', icon: 'team', status: 'planned', body: 'Your Chief of Staff brings in coworkers who already know your business, and a specialist only when a skill is missing.' },
  { n: '03', title: 'Ask and steer', icon: 'eye', status: 'now', body: 'Ask how it is going at any moment: the answer comes from the live job, and the work never pauses. Add a note and it lands at the next checkpoint.' },
  { n: '04', title: 'Approve', icon: 'check', status: 'planned', body: 'Anything that spends money or leaves the building will wait for your yes, with its evidence attached.' },
];

export interface Feature {
  title: string;
  body: string;
  status?: Status;
}

/** D5, the living workforce. The engine (reflexes, mood, side-talk) is being built; none of it is in the app yet. */
export const LIVING: Feature[] = [
  { title: 'Reflexes', status: 'next', body: 'A quick “mm-hm”, a “good question, one sec”, a laugh in the right place: short lines pre-voiced in each coworker’s own voice, so they land instantly.' },
  { title: 'Passing-by chat', status: 'planned', body: 'Walk past a desk on the Floor and a coworker may look up with a line about what they are really working on. Answer inline, no meeting needed.' },
  { title: 'Side-talk', status: 'next', body: 'Coworkers trade quick notes on real hand-offs, asks and results: bubbles on the Floor, voiced only if you are listening.' },
  { title: 'Mood and ambience', status: 'next', body: 'Wins lift the mood and blockers weigh on it. One setting, Quiet, Lively or Buzzing, decides how chatty the office gets.' },
];

export const SPEEDS: { name: string; body: string; status: Status }[] = [
  { name: 'Reflex', status: 'next', body: 'Instant, pre-voiced micro-lines. No model call.' },
  { name: 'Conversation', status: 'now', body: 'A fast model answers you while work continues.' },
  { name: 'Work', status: 'now', body: 'Background jobs that run for minutes, and keep running.' },
];

/** An illustration of the Talk screen (clearly labelled as one on the page). */
export const TALK_DEMO: { from: 'you' | 'chief'; text: string; kind?: 'status' | 'job' }[] = [
  { from: 'you', text: 'Look into coffee suppliers in Portland for me.' },
  { from: 'chief', text: 'On it. I started that in the background. Keep talking to me meanwhile.' },
  { from: 'you', text: 'How’s it going?' },
  { from: 'chief', text: 'Step 2 of 5: gathering options and the facts on each.', kind: 'status' },
  { from: 'you', text: 'Also check which ones are fair trade certified.' },
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
  { name: 'xAI', caps: ['Chat', 'Voice', 'Images'] },
  { name: 'Google Gemini', caps: ['Chat'] },
  { name: 'OpenAI-compatible', caps: ['Chat'] },
  { name: 'Ollama', caps: ['Chat', 'Local'] },
];

export const MODALITIES: (Feature & { icon: 'voice' | 'image' | 'eye' | 'video' | 'doc'; status: Status })[] = [
  { icon: 'voice', title: 'Voice', status: 'now', body: 'Talk and listen in your Chief of Staff’s own voice, with a face that lip-syncs to what is actually playing.' },
  { icon: 'image', title: 'Images', status: 'now', body: 'A portrait for every coworker today. Designs and mock-ups are next.' },
  { icon: 'eye', title: 'Vision', status: 'planned', body: 'Show a receipt, a shelf or a screen and ask about it.' },
  { icon: 'video', title: 'Video', status: 'planned', body: 'Launch cuts and social clips, made as background jobs.' },
  { icon: 'doc', title: 'Documents', status: 'planned', body: 'Drop in PDFs, spreadsheets and decks. Get Word, Excel and PowerPoint back.' },
];

export const TRUST: (Feature & { icon: 'hand' | 'receipt' | 'stop' | 'badge'; status: Status })[] = [
  { icon: 'badge', title: 'Honest AI', status: 'now', body: 'Every coworker is labeled as AI and says so when sincerely asked. Backstories are character lore, never claimed as real events.' },
  { icon: 'hand', title: 'Approvals', status: 'planned', body: 'Money and messages will never leave without your yes: once, for this task, or as a standing rule you set and can take back.' },
  { icon: 'receipt', title: 'Receipts', status: 'planned', body: 'Nothing will count as sent without a receipt. Claims carry a citation or an “unverified” badge.' },
  { icon: 'stop', title: 'Everyone stop', status: 'planned', body: 'One control will pause every coworker at once. Today you can stop any single job from Talk.' },
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
    a: 'Headcount is in early development. Today you can pick your Chief of Staff with a match quiz, talk by text or voice with a lip-synced face, hand off background jobs, ask how they are going, steer or stop them mid-flight, and browse the whole coworker directory. Staffed projects, meetings you can listen in on, the living-workforce small talk, approvals, receipts and industry packs are on the roadmap, and the page marks each one.',
  },
  {
    q: 'Do I need API keys to try it?',
    a: 'No. Headcount runs keyless on a built-in demo provider (its answers are clearly labeled placeholders) or on your local Ollama. Add a provider key when you want real answers: each key switches on one capability, and anything without a provider is hidden rather than shown broken.',
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
    a: 'The tiers above are planned pricing. They will be calibrated against real usage before public launch; until then, Headcount runs on design-partner plans.',
  },
];

/** "Twelve" for small counts (headlines read better in words), digits otherwise. */
export function countWord(n: number, capital = false): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const w = n >= 0 && n < words.length && Number.isInteger(n) ? words[n]! : String(n);
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}
