// Hiring (a new organization starts with its Chief of Staff alone): who the Chief suggests for this business, what each
// would do, and their first job. Deterministic and instant: the business's own words (what the owner said, else the
// Handbook) matched against each coworker's industries, title, tags and expertise, plus the everyday roles a small
// business recognises and the Chief's own favourite colleagues. The recommended few span different departments.
import { fullIndex } from '@headcount/catalog/full';
import type { Lead, Persona } from '@headcount/catalog';
import { STARTER_TEAM, type Candidate, type FirstTask } from '@headcount/protocol/ext/team';

const INDUSTRY_WORDS: Record<string, { re: RegExp; label: string }> = {
  'hospitality-restaurants': { re: /\b(caf[eé]s?|coffee|restaurants?|bakery|bakeries|bars?|pubs?|hotels?|catering|food|kitchens?|bistro|brewery|wine|menu)\b/i, label: 'hospitality' },
  'ecommerce-retail': { re: /\b(shops?|stores?|e-?commerce|online store|retail|boutique|products?|shopify|etsy|amazon|merch)\b/i, label: 'retail and online shops' },
  'saas-startup': { re: /\b(saas|software|apps?|startup|platform|tech|api|subscription)\b/i, label: 'software and startups' },
  'professional-services': { re: /\b(agency|consult\w*|accounting|firm|studio|freelanc\w*|clients?)\b/i, label: 'professional services' },
  'local-services': { re: /\b(cleaning|plumb\w*|salons?|repairs?|landscap\w*|garage|local|neighbou?rhood)\b/i, label: 'local services' },
  'education-coaching': { re: /\b(coach\w*|tutor\w*|courses?|schools?|training|education|teach\w*|students?)\b/i, label: 'education and coaching' },
  manufacturing: { re: /\b(manufactur\w*|factory|workshop|production|makers?|handmade)\b/i, label: 'makers and manufacturers' },
  'fitness-wellness': { re: /\b(gyms?|fitness|yoga|wellness|spa|pilates|trainers?)\b/i, label: 'fitness and wellness' },
  'healthcare-practice': { re: /\b(clinics?|dental|dentists?|therap\w*|physio\w*|medical|patients?)\b/i, label: 'health practices' },
  nonprofit: { re: /\b(non-?profit|charity|charities|foundation|ngo|donors?)\b/i, label: 'nonprofits' },
  'creator-economy': { re: /\b(creators?|youtube|podcasts?|newsletters?|influencers?|audience)\b/i, label: 'creators' },
  'construction-trades': { re: /\b(construction|builders?|contractors?|electricians?|roofing|renovat\w*|trades?)\b/i, label: 'the trades' },
  'legal-practice': { re: /\b(law|legal|attorneys?|solicitors?|lawyers?)\b/i, label: 'legal practices' },
  'real-estate': { re: /\b(real estate|property|properties|realtors?|lettings?)\b/i, label: 'real estate' },
};

const STOP = new Set(
  'about after also and are around because been being both business but can could company did does doing done each every from have help into just like make more most much need needs our out over own people some than that their them then there these they this those through very want what when where which while who will with work would your yours small sell sells selling run runs'.split(' '),
);

/** Words worth matching (lower-case, 4+ letters, a light plural/verb trim). */
export function wordsOf(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(s|ing|ed)$/, '')))];
}

/** Internal roles a project brings in (fact-checker, scribe…): never a first hire. */
const NOT_FIRST_HIRES = new Set(['core-crew']);

export function industriesOf(about: string): string[] {
  return Object.entries(INDUSTRY_WORDS)
    .filter(([, v]) => v.re.test(about))
    .map(([k]) => k);
}

function firstTaskOf(p: Persona): FirstTask {
  const starter = STARTER_TEAM.find((m) => m.personaId === p.id);
  if (starter) return starter.firstTask;
  const first = p.name.split(' ')[0];
  return {
    kind: 'research',
    title: `${first}'s first week`,
    brief: `As the ${p.title.toLowerCase()}, suggest the three most useful things you could do for this business in your first week, with why each matters, and do the first one. Use what the Handbook and shared files say about the business.`,
  };
}

/** What someone does for a business, in a few plain lines (their deliverables, else their expertise). */
const deliverablesOf = (p: Persona): string[] => ((p.deliverables as { name?: string }[] | undefined) ?? []).map((x) => x.name ?? '').filter(Boolean);

export function doesOf(p: Persona, n = 3): string[] {
  const d = deliverablesOf(p);
  return (d.length ? d : (p.expertise ?? [])).slice(0, n);
}

export function whyOf(p: Persona): string {
  return STARTER_TEAM.find((m) => m.personaId === p.id)?.why ?? p.one_liner;
}

/** The Chief's suggestions for this business: the best dozen, the first four (different departments) recommended. */
export function suggestHires(about: string, opts: { lead?: Lead; exclude?: readonly string[]; limit?: number } = {}): Candidate[] {
  const words = wordsOf(about);
  const industries = industriesOf(about);
  const favourites = new Set(opts.lead?.staffing_style?.favourite_persona_ids ?? []);
  const starters = new Set(STARTER_TEAM.map((m) => m.personaId));
  const exclude = new Set(opts.exclude ?? []);
  const scored = (fullIndex.catalog.personas as Persona[])
    .filter((p) => !exclude.has(p.id) && !NOT_FIRST_HIRES.has(p.department))
    .map((p) => {
      const head = `${p.title} ${(p.tags ?? []).join(' ')} ${p.department}`.toLowerCase();
      const body = `${p.one_liner} ${(p.expertise ?? []).join(' ')} ${deliverablesOf(p).join(' ')}`.toLowerCase();
      const hits = words.filter((w) => head.includes(w));
      const soft = words.filter((w) => !hits.includes(w) && body.includes(w));
      const inIndustry = industries.filter((i) => (p.industries ?? []).includes(i));
      // Specialists for one industry only make sense when the business is in it.
      if (p.department === 'industry-specialists' && !inIndustry.length) return null;
      let score = 0;
      if (starters.has(p.id)) score += 3;
      if (favourites.has(p.id)) score += 1.5;
      score += Math.min(hits.length, 3) * 2 + Math.min(soft.length, 4) * 0.5;
      score += inIndustry.length ? 2 : (p.industries ?? []).includes('general') ? 0.5 : 0;
      if (p.seniority === 'principal') score -= 0.5; // a first hire does the work
      const fit = hits[0] ?? soft[0];
      const why = `${whyOf(p)}${inIndustry.length ? ` Used to working with ${INDUSTRY_WORDS[inIndustry[0]!]!.label}.` : fit ? ` Fits what you said about “${fit}”.` : ''}`;
      return { p, score, why };
    })
    .filter((x): x is { p: Persona; score: number; why: string } => !!x)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  const top = scored.slice(0, opts.limit ?? 12);
  // The recommended few: the best of each department, four departments.
  const seen = new Set<string>();
  const recommended = new Set<string>();
  for (const x of top) {
    if (recommended.size >= 4) break;
    if (seen.has(x.p.department)) continue;
    seen.add(x.p.department);
    recommended.add(x.p.id);
  }
  return top.map((x) => ({ personaId: x.p.id, why: x.why, does: doesOf(x.p), firstTask: firstTaskOf(x.p), recommended: recommended.has(x.p.id) }));
}

export { firstTaskOf };
