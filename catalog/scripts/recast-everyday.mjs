#!/usr/bin/env node
// The everyday recast: every Chief of Staff and coworker gets a common, easy name (true to their pronouns and heritage,
// so the portraits still fit), a plain job title, a plain personality line (Chiefs), and a fuller work prompt built
// from their own methods, deliverables, quality bar and hand-offs. Ids (and so portraits, voices and every link) do not
// change. Names are replaced in one pass everywhere they appear in the catalog's text (records, taxonomy, recipes,
// expressions, docs), so a name that moves from one person to another is never replaced twice.
//
//   node catalog/scripts/recast-everyday.mjs          # rewrite the catalog (ran once, 2026-09-29; not idempotent:
//                                                     # some new surnames were old first names)
//   node catalog/scripts/recast-everyday.mjs --check  # only check the new names
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Chiefs of Staff: name, plain archetype, plain tagline. */
const LEADS = {
  'lead-big-picture-visionary': ['Hannah Tesfaye', 'Big-picture thinker', "Connects today's to-do list to where you want the business to be next year."],
  'lead-data-analyst': ['Emma Tamm', 'Numbers person', 'Turns your numbers into clear, simple decisions.'],
  'lead-dry-strategist': ['Alex Petrosyan', 'Thoughtful strategist', 'Calm, clear-headed advice, with a dry sense of humour.'],
  'lead-energetic-spark': ['Michelle Juma', 'Upbeat motivator', 'Brings energy and momentum, and keeps things moving.'],
  'lead-gentle-encourager': ['Tom Evans', 'Kind and supportive', 'Patient and reassuring; helps you take one step at a time.'],
  'lead-meticulous-planner': ['Daniel Rivera', 'Organised planner', 'Keeps every task, date and detail on track.'],
  'lead-playful-creative': ['Jordan Morales', 'Creative ideas person', 'Full of fresh ideas, and turns them into things you can use.'],
  'lead-scrappy-hustler': ['Kevin Vang', 'Resourceful doer', 'Gets things done fast, on a small budget.'],
  'lead-seasoned-veteran': ['Linda Gomez', 'Experienced and practical', 'Has seen it all; gives practical, no-fuss advice.'],
  'lead-steady-operator': ['Mike Santos', 'Calm and steady', 'Unflappable and dependable; keeps the day running smoothly.'],
  'lead-straight-shooter': ['Sarah Kim', 'Straight talker', 'Tells you what you need to hear, kindly and clearly.'],
  'lead-warm-mentor': ['James Owusu', 'Patient teacher', 'Explains the why, so you learn as the work gets done.'],
};

/** Coworkers: name and plain job title. */
const PEOPLE = {
  'communications-director': ['Karen Browne', 'Communications director'],
  'pr-specialist': ['Lukas Meier', 'PR specialist'],
  'senior-copywriter': ['Andre Campbell', 'Copywriter'],
  'crisis-comms-advisor': ['Eva Johansson', 'Crisis communications advisor'],
  ghostwriter: ['Rahul Das', 'Speechwriter'],
  'newsletter-producer': ['Julia Schmidt', 'Newsletter editor'],
  'localization-lead': ['Esther Mbuyi', 'Translation lead'],
  'podcast-producer': ['Chris Muñoz', 'Podcast producer'],
  'internal-comms-specialist': ['Arun Nair', 'Staff communications specialist'],
  'red-team-sceptic': ['Susan de Jong', 'Second-opinion reviewer'],
  facilitator: ['Jason Hayes', 'Meeting facilitator'],
  'editor-in-chief': ['Helen Pappas', 'Editor'],
  'qa-verifier': ['Tony Nguyen', 'Quality checker'],
  'fact-checker': ['Laura Virtanen', 'Fact-checker'],
  'minutes-scribe': ['Ryan Tan', 'Note taker'],
  'project-manager': ['Anita Gurung', 'Project manager'],
  'knowledge-librarian': ['Casey Hernandez', 'Knowledge manager'],
  'head-of-support': ['Brian Dlamini', 'Head of customer support'],
  'customer-success-manager': ['Klara Novak', 'Customer success manager'],
  'knowledge-base-writer': ['Ashley Cruz', 'Help center writer'],
  'voc-analyst': ['Max Melnyk', 'Customer feedback analyst'],
  'escalations-specialist': ['Rachel Ngata', 'Complaints specialist'],
  'onboarding-specialist': ['Diego Flores', 'Customer onboarding specialist'],
  'community-moderator': ['Kai Ito', 'Community moderator'],
  'retention-specialist': ['Isabelle Tremblay', 'Customer retention specialist'],
  'support-quality-analyst': ['Vijay Pillai', 'Support quality analyst'],
  'head-of-analytics': ['Omar Hassan', 'Head of analytics'],
  'data-analyst': ['Daniela Rodriguez', 'Data analyst'],
  'data-scientist': ['Lisa Santoso', 'Data scientist'],
  'bi-developer': ['Bart Peeters', 'Dashboard developer'],
  'data-engineer': ['Adam Karimov', 'Data engineer'],
  'experimentation-analyst': ['Joyce Chebet', 'Testing & experiments analyst'],
  'location-analyst': ['Jesse Delorme', 'Location analyst'],
  'analytics-storyteller': ['Carlos Salas', 'Reports & insights analyst'],
  'creative-director': ['Nadia Khoury', 'Creative director'],
  'brand-designer': ['Jose Almonte', 'Brand designer'],
  'product-designer': ['Yuki Sato', 'App & website designer'],
  illustrator: ['Riley Marsh', 'Illustrator'],
  'motion-designer': ['Emre Yilmaz', 'Video designer'],
  'image-art-director': ['Jasmine Lane', 'Photo art director'],
  'presentation-designer': ['Ivan Horvat', 'Presentation designer'],
  'packaging-print-designer': ['Anna Kowalska', 'Print & packaging designer'],
  'accessibility-specialist': ['Sami Ben Ali', 'Accessibility specialist'],
  'ux-writer': ['Megan Doyle', 'Website & app writer'],
  'ecommerce-manager': ['Natasha Ivanova', 'Online store manager'],
  'marketplace-specialist': ['Rohan Patil', 'Marketplace specialist'],
  'merchandising-planner': ['Thandi Mabuza', 'Merchandise planner'],
  'retail-operations-lead': ['Isaiah Moore', 'Store operations manager'],
  'product-content-writer': ['Chloe Wilson', 'Product description writer'],
  'pricing-promotions-analyst': ['Karim Bennani', 'Pricing & promotions analyst'],
  'post-purchase-specialist': ['Kris Reyes', 'Returns specialist'],
  'loyalty-strategist': ['Nicolas Fernandez', 'Loyalty program specialist'],
  'tech-lead': ['Nina Petrović', 'Tech lead'],
  'full-stack-engineer': ['Jerome Phillip', 'Software developer'],
  'frontend-engineer': ['Pim Rattana', 'Website developer'],
  'integrations-engineer': ['Moussa Traore', 'Integrations developer'],
  'qa-automation-engineer': ['Irene Garcia', 'Software tester'],
  'devops-engineer': ['Tulga Bold', 'Cloud & hosting engineer'],
  'mobile-engineer': ['Farah Rahman', 'Mobile app developer'],
  'automation-scripter': ['David Park', 'Automation developer'],
  'ai-engineer': ['Anjali Rao', 'AI engineer'],
  'technical-writer': ['Charlie Webb', 'Technical writer'],
  'fractional-cfo': ['Diana Mensah', 'Finance director'],
  'fpa-analyst': ['Layla Haddad', 'Budget & forecast analyst'],
  controller: ['Stefan Braun', 'Financial controller'],
  bookkeeper: ['Trisha Mendoza', 'Bookkeeper'],
  'collections-specialist': ['Jude Pierre', 'Collections specialist'],
  'tax-prep-coordinator': ['Rebecca Cohen', 'Tax prep coordinator'],
  'unit-economics-analyst': ['Kian Ahmadi', 'Profitability analyst'],
  'cost-margin-analyst': ['Tendai Moyo', 'Cost analyst'],
  'startup-finance-analyst': ['Hugo Martin', 'Startup finance analyst'],
  'controls-specialist': ['Dina Akhmetova', 'Audit prep specialist'],
  'hospitality-operator': ['George Khalil', 'Restaurant expert'],
  'real-estate-specialist': ['Monique Batiste', 'Real estate specialist'],
  'construction-estimator': ['Sandra Fortes', 'Construction estimator'],
  'practice-administrator': ['Simran Kaur', 'Clinic practice manager'],
  'law-firm-ops-specialist': ['Patrick Kato', 'Law firm operations expert'],
  'agency-operator': ['Jack Barnes', 'Agency operations expert'],
  'nonprofit-fundraising-lead': ['Maria Lopez', 'Fundraising & grants lead'],
  'saas-operator': ['Neil Patel', 'Startup operations expert'],
  'manufacturing-specialist': ['Craig Walker', 'Manufacturing expert'],
  'fitness-studio-operator': ['Javier Rosado', 'Fitness studio expert'],
  'education-program-designer': ['Nicole Molefe', 'Course & coaching designer'],
  'creator-economy-strategist': ['Sasha Nieminen', 'Creator business strategist'],
  'home-services-operator': ['Carmen Mamani', 'Home services expert'],
  'it-manager': ['Ruth Mutasa', 'IT manager'],
  'security-analyst': ['Amina Jama', 'Security analyst'],
  'automation-specialist': ['Felipe Costa', 'Automation specialist'],
  'security-compliance-specialist': ['Petra Zupan', 'Security compliance specialist'],
  'it-support-specialist': ['Isaac Tuilau', 'IT support specialist'],
  'resilience-engineer': ['Jakub Dvorak', 'Backup & reliability engineer'],
  'ai-governance-advisor': ['Quinn Cheung', 'AI tools advisor'],
  'integration-architect': ['Gabriela Cortez', 'Integration architect'],
  'contracts-analyst': ['Jane Ashby', 'Contracts analyst'],
  'privacy-specialist': ['Bruno Sosa', 'Privacy specialist'],
  'compliance-coordinator': ['Fatou Ndiaye', 'Compliance coordinator'],
  'ip-research-specialist': ['Jenny Choi', 'Trademark researcher'],
  'employment-policy-drafter': ['Nathan Brown', 'HR policy writer'],
  'regulatory-research-analyst': ['Sophie Bakker', 'Regulations researcher'],
  'legal-ops-coordinator': ['Nour Alaoui', 'Legal admin coordinator'],
  'risk-ethics-advisor': ['Aman Singh', 'Risk advisor'],
  'growth-lead': ['Pedro Barros', 'Growth marketer'],
  'brand-strategist': ['Meera Sundar', 'Brand strategist'],
  'seo-specialist': ['Filip Nowak', 'SEO specialist'],
  'paid-media-manager': ['Brianna Coleman', 'Online ads manager'],
  'lifecycle-marketer': ['Callum Munro', 'Email marketer'],
  'social-media-manager': ['Leilani Akana', 'Social media manager'],
  'content-marketing-lead': ['Adrian Popa', 'Content marketing manager'],
  'cro-specialist': ['Amy Lin', 'Website conversion specialist'],
  'product-marketing-manager': ['Samuel Adebayo', 'Product marketing manager'],
  'community-manager': ['Rory Dalisay', 'Community manager'],
  'marketing-analyst': ['Elif Aydin', 'Marketing analyst'],
  'operations-director': ['Denise Whitaker', 'Operations manager'],
  'process-improvement-engineer': ['Oskar Lindqvist', 'Process improvement specialist'],
  'supply-chain-planner': ['Yasmin Fahmy', 'Inventory & supply planner'],
  'procurement-manager': ['Gabor Szabo', 'Purchasing manager'],
  'logistics-coordinator': ['Maya Chavez', 'Shipping & fulfillment coordinator'],
  'quality-manager': ['Solomon Tadesse', 'Quality manager'],
  'facilities-coordinator': ['Paul Leota', 'Office & facilities coordinator'],
  'operations-analyst': ['Valeria Soto', 'Operations analyst'],
  'continuity-planner': ['Gunnar Jonsson', 'Emergency & continuity planner'],
  'workplace-safety-coordinator': ['Nick Beridze', 'Health & safety coordinator'],
  'people-partner': ['Alvaro Ortiz', 'HR manager'],
  'talent-partner': ['Ines Meziane', 'Recruiter'],
  'learning-designer': ['Sione Taufa', 'Training designer'],
  'compensation-analyst': ['Giulia Rossi', 'Pay & benefits analyst'],
  'culture-engagement-lead': ['Eric Mugisha', 'Team culture lead'],
  'payroll-benefits-admin': ['Kayla Charles', 'Payroll administrator'],
  'inclusion-partner': ['Camille Phan', 'Inclusion lead'],
  'org-design-planner': ['Zain Chaudhry', 'Workforce planner'],
  'employee-experience-specialist': ['Beatriz Cossa', 'New hire onboarding specialist'],
  'head-of-product': ['Lily Zhou', 'Head of product'],
  'product-manager': ['Dimitri Karras', 'Product manager'],
  'ux-researcher': ['Nisha Fernando', 'User researcher'],
  'product-analyst': ['Khalid Al Nuaimi', 'Product analyst'],
  'platform-product-manager': ['Mads Jensen', 'Integrations product manager'],
  'product-ops-manager': ['Yara Abboud', 'Product operations manager'],
  'growth-product-manager': ['Shay Yazzie', 'Growth product manager'],
  'prototype-builder': ['Jad Sabbagh', 'Prototype builder'],
  'research-director': ['Miriam Tekle', 'Research director'],
  'market-research-analyst': ['Mateo Cevallos', 'Market research analyst'],
  'competitive-intel-analyst': ['Liam Hughes', 'Competitor research analyst'],
  'survey-researcher': ['Rana Karam', 'Survey researcher'],
  'foresight-researcher': ['Avery Lau', 'Trends researcher'],
  'customer-interviewer': ['Claire Petit', 'Customer interviewer'],
  'evidence-reviewer': ['Ibrahim Lawal', 'Research reviewer'],
  'head-of-sales': ['Claudia Ospina', 'Head of sales'],
  'outbound-specialist': ['Tyler Freeman', 'Sales prospector'],
  'account-executive': ['Mai Tran', 'Sales rep'],
  'solutions-consultant': ['Rita Pires', 'Solutions consultant'],
  'partnerships-manager': ['Kofi Ofori', 'Partnerships manager'],
  'proposal-writer': ['Kate Byrne', 'Proposal writer'],
  'negotiation-strategist': ['Ahmad Noori', 'Negotiation advisor'],
  'revops-analyst': ['Tal Mizrahi', 'Sales operations analyst'],
  'key-account-manager': ['Rafi Chowdhury', 'Key account manager'],
  'sales-enablement-coach': ['Vanessa Montalvo', 'Sales coach'],
  'chief-strategist': ['Stella Okafor', 'Business strategist'],
  'business-model-designer': ['Roberto Garza', 'Business model advisor'],
  'okr-coach': ['Ingrid Haugen', 'Goals coach'],
  'scenario-planner': ['Kenji Takeda', 'Scenario planner'],
  'pricing-strategist': ['Sana Malik', 'Pricing strategist'],
  'investor-relations-advisor': ['Rhys Powell', 'Investor relations advisor'],
  'change-management-lead': ['Kim Visser', 'Change manager'],
  'sustainability-strategist': ['Lucy Mwangi', 'Sustainability advisor'],
};

/** Old first names that are also everyday words: these phrases keep the word. */
const WORD_PHRASES = [/^Hope (I|I'm|I've|we|we're|your|you|backed|this|that|it|so|everyone)\b/, /^Joy,? (clarity|of)\b/, /^Miles (away|of|per)\b/];

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const first = (name) => name.split(/\s+/)[0];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── the cast as it is now ───────────────────────────────────────────────────────
const personaFiles = readdirSync(join(ROOT, 'personas')).filter((f) => f.endsWith('.json')).map((f) => join(ROOT, 'personas', f));
const leadFiles = readdirSync(join(ROOT, 'leads')).filter((f) => /^lead-.*\.json$/.test(f)).map((f) => join(ROOT, 'leads', f));
const old = new Map();
for (const f of personaFiles) for (const p of readJson(f).personas) old.set(p.id, { name: p.name, handle: p.handle, kind: 'persona' });
for (const f of leadFiles) {
  const l = readJson(f);
  old.set(l.id, { name: l.name, handle: l.handle, kind: 'lead' });
}

// ── check the new names ────────────────────────────────────────────────────────
const taxonomy = readJson(join(ROOT, 'taxonomy.json'));
const reserved = new Set((taxonomy.reserved_first_names?.names ?? []).map(fold));
const voiceIds = new Set();
for (const k of Object.keys(taxonomy.voices ?? {})) {
  const v = taxonomy.voices[k]?.voices;
  if (Array.isArray(v)) for (const x of v) voiceIds.add(fold(typeof x === 'string' ? x : (x.id ?? '')));
  else if (v && typeof v === 'object') for (const id of Object.keys(v)) voiceIds.add(fold(id));
}
const cast = new Map([...Object.entries(PEOPLE).map(([id, [name, title]]) => [id, { name, title }]), ...Object.entries(LEADS).map(([id, [name, archetype, tagline]]) => [id, { name, archetype, tagline }])]);
const problems = [];
const firsts = new Map();
for (const id of old.keys()) if (!cast.has(id)) problems.push(`${id}: no new name`);
for (const [id, c] of cast) {
  if (!old.has(id)) problems.push(`${id}: not in the catalog`);
  const f = fold(first(c.name));
  if (firsts.has(f)) problems.push(`${c.name}: first name also used by ${firsts.get(f)}`);
  firsts.set(f, c.name);
  if (reserved.has(f)) problems.push(`${c.name}: reserved first name`);
  if (voiceIds.has(f)) problems.push(`${c.name}: first name is a voice id`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`${cast.size} names OK`);
  process.exit(0);
}

// ── the one-pass replacement ──────────────────────────────────────────────────
const handleOf = (name) => fold(first(name)).replace(/[^a-z0-9-]/g, '');
const pairs = new Map();
for (const [id, o] of old) {
  const n = cast.get(id).name;
  if (o.name !== n) {
    pairs.set(o.name, n);
    if (first(o.name) !== first(n)) pairs.set(first(o.name), first(n));
  }
  if (o.handle && o.handle !== handleOf(n)) pairs.set(`@${o.handle}`, `@${handleOf(n)}`);
}
const keys = [...pairs.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`(?<![\\p{L}\\p{N}@])(?:${keys.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
let replaced = 0;
function recastText(s) {
  return s.replace(RE, (m, offset, all) => {
    if (WORD_PHRASES.some((re) => re.test(all.slice(offset)))) return m;
    replaced++;
    return pairs.get(m);
  });
}
function recastValue(v) {
  if (typeof v === 'string') return recastText(v);
  if (Array.isArray(v)) return v.map(recastValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [pairs.has(k) && /^[\p{Lu}]/u.test(k) ? pairs.get(k) : k, recastValue(x)]));
  return v;
}

// ── a fuller work prompt from each coworker's own record ───────────────────────
const nameOf = (id) => (cast.has(id) ? `${cast.get(id).name} (${cast.get(id).title ?? 'Chief of Staff'})` : null);
const TO = { owner: 'the owner', licensed_professional: 'a qualified professional (the owner arranges one)', coworker: 'the right teammate (the Chief of Staff can bring them in)', chief: 'the Chief of Staff' };
function workPrompt(p) {
  const title = cast.get(p.id).title;
  const body = String(p.instructions ?? '')
    .replace(/^You are [^.]*\.\s*/, '')
    .trim();
  const lines = [`You are ${p.name}, the ${title.toLowerCase()} on the owner's team (an AI coworker). ${p.one_liner}`];
  if (body) lines.push('', body);
  if (p.deliverables?.length) {
    lines.push('', 'What you hand over (make each one usable as it is):');
    for (const d of p.deliverables.slice(0, 6)) lines.push(`- ${d.name}${d.format ? ` (${d.format})` : ''}${d.description ? `: ${d.description}` : ''}`);
  }
  if (p.quality_bar) lines.push('', `Your quality bar: ${p.quality_bar}`);
  lines.push(
    '',
    'Before you hand anything in:',
    "1. Re-read the brief and check every part of it is answered, in the owner's own terms.",
    '2. Check names, numbers, dates and prices against the inputs; mark anything you could not confirm as (unverified).',
    '3. Lead with the answer, then the detail; end with concrete next steps (who does what, by when).',
  );
  const flags = (p.escalates_when ?? []).slice(0, 5).map((e) => `- ${e.when}: ${TO[e.to] ?? nameOf(e.to) ?? e.to}.`);
  lines.push('', 'Flag it or hand it on when:', ...flags, "- Something must be sent, paid, booked, signed or published: prepare it and ask for the owner's OK.");
  if (p.personality?.communication_style) lines.push('', `How you come across: ${p.personality.communication_style}`);
  return lines.join('\n');
}

// ── apply ─────────────────────────────────────────────────────────────────────
const SKIP = new Set([join(ROOT, 'renames.json'), join(ROOT, 'index.json')]);
const files = walk(ROOT).filter((f) => !SKIP.has(f) && !f.includes(`${join(ROOT, 'schema')}`) && !f.includes(`${join(ROOT, 'scripts')}`) && (f.endsWith('.json') || f.endsWith('.md')));
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  if (f.endsWith('.md')) {
    const next = recastText(raw);
    if (next !== raw) writeFileSync(f, next);
    continue;
  }
  let v = recastValue(JSON.parse(raw));
  if (personaFiles.includes(f)) {
    v.personas = v.personas.map((p) => {
      const c = cast.get(p.id);
      const q = { ...p, name: c.name, handle: handleOf(c.name), title: c.title };
      q.instructions = workPrompt(q);
      return q;
    });
  } else if (leadFiles.includes(f)) {
    const c = cast.get(v.id);
    v = { ...v, name: c.name, handle: handleOf(c.name), archetype: c.archetype, tagline: c.tagline };
  } else if (f === join(ROOT, 'taxonomy.json')) {
    for (const d of v.departments ?? []) for (const p of d.personas ?? []) if (cast.has(p.id)) Object.assign(p, { name: cast.get(p.id).name, handle: handleOf(cast.get(p.id).name), title: cast.get(p.id).title });
    for (const l of v.leads ?? []) {
      if (!cast.has(l.id)) continue;
      const c = cast.get(l.id);
      Object.assign(l, { name: c.name, handle: handleOf(c.name), archetype: c.archetype });
      if ('name_note' in l) l.name_note = 'An everyday name: easy to say, spell and remember.';
    }
    v.rebalancing_log = [...(v.rebalancing_log ?? []), { date: '2026-09-29', change: 'Everyday recast: every Chief of Staff and coworker renamed to a common, easy name (true to their pronouns and heritage; ids and portraits unchanged), plain job titles, plain Chief of Staff styles.' }];
  }
  // Only files whose content changed are written (formatting stays as it is elsewhere).
  if (JSON.stringify(v) !== JSON.stringify(JSON.parse(raw))) writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
}
console.log(`Recast ${cast.size} people; ${replaced} name mentions replaced in ${files.length} files.`);
console.log(relative(process.cwd(), ROOT));
