// Match quiz: the catalog's quiz when catalog/leads/match-quiz.json exists, else a built-in 4-question
// version whose weights are derived from each lead's personality sliders and defaults (so it follows
// catalog edits). Questions are about working style only (catalog/SCHEMA.md §8).
import { firstName, scoreMatchQuiz, type Lead, type MatchQuiz, type QuizAnswers, type Sliders } from '@headcount/catalog';

type Dim = keyof Sliders | 'autonomy';
type Fact = 'bad_news' | 'tagline' | 'cadence' | 'humor';

interface BuiltinOption {
  id: string;
  label: string;
  /** Where on each dimension (0–100) an owner choosing this sits. */
  target: Partial<Record<Dim, number>>;
  /** The owner's side of "why you two will get along". */
  owner: string;
}

interface BuiltinQuestion {
  id: string;
  prompt: string;
  fact: Fact;
  options: BuiltinOption[];
}

export const BUILTIN_QUESTIONS: BuiltinQuestion[] = [
  {
    id: 'bad-news',
    prompt: 'When something goes wrong, you want to hear it…',
    fact: 'bad_news',
    options: [
      { id: 'straight', label: 'Straight away, no cushioning', target: { directness: 92 }, owner: 'You want bad news straight.' },
      { id: 'gently', label: 'Gently, with a way forward', target: { warmth: 90, directness: 42 }, owner: 'You want bad news gently, with a way forward.' },
      { id: 'numbers', label: 'With the numbers and the why', target: { detail: 92 }, owner: 'You want the numbers behind the news.' },
    ],
  },
  {
    id: 'pace',
    prompt: 'The pace that suits you is…',
    fact: 'tagline',
    options: [
      { id: 'fast', label: 'Fast. Try things and fix as we go', target: { pace: 90, risk_appetite: 76 }, owner: 'You like to move fast.' },
      { id: 'steady', label: 'Steady and predictable', target: { pace: 38, risk_appetite: 30 }, owner: 'You like a steady, predictable week.' },
      { id: 'big-picture', label: 'Big picture first, details later', target: { detail: 30, risk_appetite: 68 }, owner: 'You start from the big picture.' },
    ],
  },
  {
    id: 'check-ins',
    prompt: 'How often should they check in?',
    fact: 'cadence',
    options: [
      { id: 'rarely', label: 'Only when it matters', target: { autonomy: 80 }, owner: 'You want to hear only what matters.' },
      { id: 'daily', label: 'A short daily rhythm', target: { autonomy: 60 }, owner: 'You like a short daily rhythm.' },
      { id: 'often', label: 'Often. Keep me close', target: { autonomy: 40 }, owner: 'You like to stay close to the work.' },
    ],
  },
  {
    id: 'humour',
    prompt: 'At work, a little humour is…',
    fact: 'humor',
    options: [
      { id: 'welcome', label: 'Welcome. Keep it light', target: { humor: 85, formality: 15 }, owner: 'You like it light.' },
      { id: 'sometimes', label: 'Fine now and then', target: { humor: 52 }, owner: 'You like some humour now and then.' },
      { id: 'businesslike', label: 'Best kept businesslike', target: { humor: 32, formality: 58 }, owner: 'You like it businesslike.' },
    ],
  },
];

function dim(lead: Lead, d: Dim): number {
  return d === 'autonomy' ? (lead.defaults?.autonomy ?? 3) * 20 : (lead.personality?.sliders?.[d] ?? 50);
}

/** Integer weight in −3…3: 3 when the lead sits on the target, falling by one per 15 points of distance. */
export function closeness(lead: Lead, target: Partial<Record<Dim, number>>): number {
  const dims = Object.entries(target) as [Dim, number][];
  if (!dims.length) return 0;
  const avg = dims.reduce((s, [d, t]) => s + Math.abs(dim(lead, d) - t), 0) / dims.length;
  return Math.max(-3, Math.min(3, Math.round(3 - avg / 15)));
}

export const BUILTIN_INTRO = 'Four quick questions about how you like to work. You can still pick anyone.';

export function builtinQuiz(leads: Lead[]): MatchQuiz {
  return {
    version: 1,
    intro: BUILTIN_INTRO,
    questions: BUILTIN_QUESTIONS.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: 'single' as const,
      options: q.options.map((o) => ({ id: o.id, label: o.label, weights: Object.fromEntries(leads.map((l) => [l.id, closeness(l, o.target)])) })),
    })),
    scoring: { method: 'weighted_sum', normalize_by_max_possible: false, show_top: 3, tie_breaker: 'lower autonomy default first' },
    results: {},
  };
}

export interface Match {
  lead: Lead;
  rank: number;
  headline: string;
  why: string;
}

const CADENCE: Record<string, string> = {
  daily_morning: 'a short check-in each morning',
  twice_daily: 'check-ins twice a day',
  milestones: 'check-ins at milestones, quiet in between',
  weekly: 'a weekly check-in and room to run',
};

/** First sentence, trimmed to about `max` characters at a word boundary. */
export function firstSentence(text: string, max = 150): string {
  const t = (text ?? '').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  let s = m ? m[1]! : t;
  if (s.length > max) s = `${s.slice(0, s.lastIndexOf(' ', max)).replace(/[,;:—–]$/, '')}…`;
  return s;
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

function possessive(lead: Lead): string {
  return lead.pronouns === 'she/her' ? 'Her way' : lead.pronouns === 'he/him' ? 'His way' : 'Their way';
}

function fact(lead: Lead, f: Fact): string {
  switch (f) {
    case 'bad_news':
      return firstSentence(lead.personality?.bad_news_style ?? '');
    case 'tagline':
      return firstSentence(lead.tagline ?? '');
    case 'cadence':
      return `${CADENCE[lead.defaults?.check_in_cadence] ?? 'a steady check-in rhythm'}.`;
    case 'humor':
      return firstSentence(lead.personality?.humor ?? '');
  }
}

/** "You want bad news straight. Her way: real answer first, no cushioning paragraph." */
export function builtinWhy(lead: Lead, answers: QuizAnswers): string {
  let best: { w: number; q: BuiltinQuestion; o: BuiltinOption } | null = null;
  for (const q of BUILTIN_QUESTIONS) {
    const o = q.options.find((x) => x.id === answers[q.id]);
    if (!o) continue;
    const w = closeness(lead, o.target);
    if (!best || w > best.w) best = { w, q, o };
  }
  if (!best) return lead.tagline;
  // One colon per sentence reads better: the fact's own colon becomes a dash.
  const f = fact(lead, best.q.fact).replace(/:\s/, ' — ');
  return f ? `${best.o.owner} ${possessive(lead)}: ${lowerFirst(f)}` : best.o.owner;
}

/** Top matches for the answers, best first. Uses the catalog's result copy when the quiz has it. */
export function topMatches(quiz: MatchQuiz, answers: QuizAnswers, leads: Lead[], builtin: boolean, n = quiz.scoring?.show_top ?? 3): Match[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  return scoreMatchQuiz(quiz, answers, leads)
    .slice(0, n)
    .map((r, i) => {
      const lead = byId.get(r.leadId)!;
      const copy = quiz.results?.[r.leadId];
      return {
        lead,
        rank: i + 1,
        headline: copy?.headline ?? lead.archetype,
        why: copy?.why_you_match ?? (builtin ? builtinWhy(lead, answers) : firstSentence(lead.tagline)),
      };
    });
}

/** Name the owner sees in buttons: "Choose <first name>". */
export const leadFirst = (lead: Lead) => firstName(lead.name);
