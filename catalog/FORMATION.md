# Team formation

How the lead turns an owner's request into a team of coworkers and a plan. The lead does this with its lead-only tools `form_team` and `plan_create`, applying the rules in [`formation.json`](formation.json). This document explains those rules in prose, gives the algorithm as pseudocode and walks through three worked examples. `formation.json` is the source of truth: where this document and the JSON disagree, the JSON wins, and this document should be fixed.

Terms: the **lead** is the owner's chief of staff; **coworkers** are catalog personas; a **recipe** is a ready-made team and plan in `teams/*.json`; the **coordinator** is the member who assembles the final deliverable; the **sceptic** is the one member whose job is to find the expensive mistake.

## Where the rules come from

The rules are distilled from two reference systems (see `docs/research/`) and extended for this product.

- **biz-bot team design** (`assemble.js` `PLANNER_SYSTEM`, research note `bb2-orchestration.md` §2.9): every member owns a different discipline, with no two generalists and nobody whose job is to summarise the others; exactly one designated sceptic who speaks for whoever is not in the room; members spread across providers so the perspectives really differ; the strongest reasoning model on the hardest trade-off; a coordinator who is never the sceptic. Its normalizer clamps whatever the model proposes to real providers, tools and skills; formation does the same by only ever choosing catalog ids.
- **biz-bot planning** (`plan.js` `PLAN_SYSTEM`, §2.13): a goal becomes a DAG of at most 8 tasks; each task has a cluster of 1 to 3 owners (the next owner takes over a failed attempt) and 0 to 2 reviewers from another discipline who answer `APPROVED` or `CHANGES`; the challenger sits where being wrong is most expensive; there are no "coordinate" or "summarise" tasks because a finisher assembles the deliverable. Ad-hoc specialists are capped at 4 per project (`swarm.js`). Meetings follow the frame, open, debate, synthesise protocol of `discussionDirective`.
- **personagram casting** (`groups.ts` `inventCast` and `assignVoice`, research note `pg1-worker-backend.md`): distinct people with gender-fitting voices and a subtle pace nudge, and voice uniqueness through a first-claim map. Never clone a voice.
- **Added by this catalog:** recipes first, complexity-based sizing, lead style, industry variants, regulated-domain rules with a human licensed-review task, chemistry and seniority checks, voice capacity and the xAI audition gate, budget caps by autonomy, and a one-sentence explanation to the owner.

## The rules at a glance

| Rule | Value | Where in `formation.json` |
|---|---|---|
| Start from a recipe | when its match score is at least 0.6 | `recipe_first` |
| Team size | lean 2 to 3, balanced 3 to 5, thorough 5 to 8; never more than 8 | `team_size`, `complexity`, `limits.max_team_members` |
| Sceptic | exactly one in any team of 3 or more; never the coordinator; reviews the costliest task | `roles.sceptic`, `sceptic_selection` |
| Coordinator | prefers a member with the `lead` role who owns the final deliverable; falls back to the project manager | `roles.coordinator` |
| Facilitator | needed for debate, decision and workshop meetings; any non-sceptic member with the facilitator role counts | `roles.facilitator` |
| Tasks | one accountable owner, co-owners take over a failed attempt, 0 to 2 reviewers from another discipline, never the owner | `clusters`, `roles.reviewer` |
| Diversity | unique disciplines; at most 3 from one department; 2 distinct first-choice providers for 3 to 5 people, 3 for 6 or more | `diversity` |
| Seniority | at least one lead or principal in teams of 3 or more; a senior or better sceptic; at most half principals unless thorough | `seniority_mix` |
| Chemistry | reward pairs that work well together; at most 2 productive-tension pairs, placed on the same artifact | `chemistry` |
| Models | deep tier on the sceptic, on owner-decision tasks and on meeting synthesis; fast for meeting banter | `model_policy` |
| Voices | unique within a team and meeting; alternates, then fallbacks; the lead's voices reserved | `voice_assignment`, `voice_capacity` |
| Regulated work | the domain's specialist on the team and a human licensed-review task before anything external | `regulated_domain_rules` |
| Plan | at most 8 tasks, 3 running at once, 1 revision, 2 attempts, 6 people per meeting | `limits`, `meetings` |
| Budget | cost cap by the lead's autonomy; ask above it or for regulated work | `budget` |
| Explanation | one plain sentence to the owner | `explain_to_owner` |
| Never | select or exclude anyone by pronouns, age, heritage, look or appearance | `diversity.people_fields_never_used_for_selection` |

---

## The algorithm, step by step

The eight steps follow `formation.json › algorithm`.

### 1. Frame the goal and choose a size

The lead restates the owner's request as an **outcome**, lists the **deliverables** (as artifact types), the **decisions** the owner will have to make, any **regulated domains** those deliverables touch, and the owner's **industry** from the business profile. It also applies the owner's locale: currency, units, holidays and fiscal year (a "Q3" means the owner's third fiscal quarter).

It then scores **complexity** (`complexity.signals`):

| Signal | Points |
|---|---|
| Distinct disciplines needed | 1 for each beyond two |
| A deliverable leaves the workspace (sent, published or given to a third party) | 1 |
| A regulated domain is involved | 2 |
| Two or more owner decisions | 1 |
| An irreversible or money-moving step | 2 |
| More than five calendar days | 1 |
| Little existing data, or a new market | 1 |

0 to 2 points is **lean**, 3 to 5 is **balanced**, 6 or more is **thorough**. Then two adjustments:

- **The owner's words.** "Quick", "small" or "just" caps the team at lean (a regulated domain still gets its specialist); "thorough" or "bulletproof" makes it thorough.
- **The lead's style.** Each lead has a default size (`lead_style_overrides`, mirrored from the lead files). When the complexity band is within one band of it, the lead's default wins. So Dominic (lean) turns a balanced job lean, but a thorough job stays thorough.

### 2. Match a recipe

Every recipe is scored (`recipe_first.match_signals`):

| Signal | Weight | Meaning |
|---|---:|---|
| Outcome similarity | 0.45 | Semantic similarity between the goal and the recipe's outcome, name and `recipe_intents` phrases (owner phrasings such as "customers pay late"). |
| Deliverable overlap | 0.25 | Share of the requested deliverables the recipe produces. |
| Industry variant available | 0.10 | 1 if the recipe has a variant for the owner's industry or is industry-neutral. |
| Inputs already known | 0.10 | Share of the recipe's required owner inputs already in memory or connectors. |
| Used before | 0.10 | 1 if the owner ran this recipe before and rated it well. |

If the best score is **0.6 or more** and the owner has not rejected that team, the lead takes the recipe's `lean_variant`, `composition` (balanced) or `full_variant` (thorough) and **adapts** it (`recipe_first.adaptation_rules`):

1. Apply the owner's industry variant: `swap_out` first, then `swap_in`. The sceptic and coordinator are never swapped out without a replacement in the same role.
2. Every task a swapped-out member owned moves to a swapped-in coworker who lists all its skills, or to whoever the variant's `reassign` map names.
3. Each `extra_skill_ids` entry becomes one new task, owned by the swapped-in specialist (or the best-scoring member) and reviewed by the sceptic or the coordinator.
4. If the team is now over 8, drop full-variant extras first.
5. Keep the recipe's regulated domains, and add any domain the new skills carry. (A variant that would change the regulated domains is a separate recipe instead.)

Then go to step 6. Recipes are curated, so steps 3 to 5 are skipped.

### 3. Derive skills (when no recipe fits)

The lead lists the skills whose outputs produce the requested deliverables, plus skills the goal implies, and marks each **must** or **nice**. Any regulated domain those skills carry brings its rules in.

### 4. Pick members

Every coworker gets a **selection score** (`selection_scoring.weights`):

| Signal | Weight |
|---|---:|
| Each required skill they list as primary | +5 |
| Each required skill they list as secondary | +2 |
| Their industries include the owner's | +2 |
| Owner rated their recent work well | +2 |
| Productive tension with a member already chosen (while the team has fewer than 2 such pairs) | +2 |
| Their department is the goal's main discipline | +1 |
| One of the lead's favourites | +1 |
| Each chosen member in their `pairs_well_with` (up to 3) | +1 |
| Their first-choice provider is not yet on the team | +1 |
| They fill a seniority gap | +1 |
| They already have 3 open tasks | −2 |
| Deep-tier coworker while the budget cap is below high | −2 |
| No free voice for them on either provider | −3 |
| Missing a tool or connector an assigned skill needs (baseline tools always count as present) | −10 |

Members are added **greedily by marginal must-skill coverage** (the person who covers the most still-uncovered must-skills next, with the selection score and then the tie-breakers deciding between equals) until every must-skill has a primary or secondary holder or the size cap is reached. Tie-breakers: fewer open tasks, a voice not yet used, a lower model tier, the lead's favourite, then higher seniority for review work and lower for narrow tasks.

Gaps are filled in this order (`gap_filling.order`):

1. A member who lists the skill as secondary, with a primary holder from outside the team reviewing through `ask_coworker`.
2. The department's generalist (for example `fractional-cfo` for finance, `tech-lead` for engineering).
3. Core crew for cross-cutting work: project manager, editor-in-chief, fact-checker, QA verifier, knowledge librarian.
4. One bounded question to a specialist through `ask_coworker`, without adding them.
5. An ad-hoc specialist with `spawn_coworker`: cloned from the closest persona, bounded, marked AI and generated, given a free voice. At most 4 per project and never for regulated work.
6. Tell the owner plainly what is missing (a skill, a connector or information) and offer the closest recipe or a connector to enable.

A regulated-domain gap is never filled by a generalist or a spawned coworker.

### 5. Add the roles every team needs

- **Coordinator:** a member with the `lead` role whose discipline owns the final deliverable; otherwise `project-manager`, then `operations-director`. Never the sceptic. The coordinator assembles the final deliverable, never claims an unfinished task succeeded, and hands owner decisions to the lead.
- **Sceptic** (teams of 3 or more): picked from the discipline of the plan's **highest-cost decision**, not the coordinator's, using `sceptic_selection.by_discipline` (for example `cost-margin-analyst` for pricing, `controls-specialist` for finance, `crisis-comms-advisor` for PR). A candidate in the coordinator's or main owner's `productive_tension_with` is preferred; `red-team-sceptic` is the default. The sceptic must list `sceptic` in their team roles, and steelmans rather than obstructs: every objection names the evidence that would resolve it.
- **Facilitator** when a meeting is a debate, decision or workshop, unless a non-sceptic member already has the facilitator role.
- **Regulated specialist and licensed review:** for each domain, a member from `regulated_domain_rules.<domain>.must_include_one_of`, plus a `human` task titled "Licensed review", prepared by that specialist and arranged by the owner, placed before any send, publish, sign, file, pay or public step.
- **Core-crew triggers** (from scratch, or when the owner picks thorough): editor-in-chief when a deliverable leaves the workspace, fact-checker when an external deliverable carries facts or quotes, project manager when the plan has more than four tasks and nobody holds the project role, minutes scribe when meetings are minuted, QA verifier for checkable final deliverables, knowledge librarian when durable knowledge is created. A trigger that would push the team past 8 becomes an `ask_coworker` consultation instead.

If the team is over its size cap, drop the non-required member with the lowest marginal coverage.

### 6. Check the team

- **Lead style:** add the lead's `always_includes_roles` (for example reviewer and sceptic) if the size cap allows.
- **Diversity:** unique disciplines, at most 3 from one department, and the minimum distinct first-choice providers.
- **Seniority:** at least one lead or principal; the sceptic or the reviewer of the costliest task is senior or better; at most half principals unless the size is thorough; specialists own narrow tasks and principals take the hardest trade-off.
- **Chemistry:** at most 2 productive-tension pairs, each placed as owner and reviewer on the same artifact or in the same debate, so the friction improves one deliverable instead of spreading across the plan. Never a pair who review each other's work.
- **Team score:** a weighted sum of skill coverage (0.35), chemistry (0.12), seniority mix (0.10), provider diversity (0.10), voice uniqueness (0.10), cost fit (0.10), industry fit (0.08) and size fit (0.05). A swap that raises the score by at least 0.05 is made.
- **Providers and models:** each member starts on the first provider in their `provider_preference`. When two members share a provider and one of them has an unused provider later in their list, the lower-seniority member moves to it. The sceptic, and the owner and reviewer of any task that needs an owner decision (or the costliest task), run on the **deep** tier; meeting banter runs **fast** and meeting synthesis **deep**. A recipe's `model_hints` override tiers for speed, except on those two positions unless the hint names the task. Private data prefers local providers.
- **Voices:** see below.
- **Budget:** compare the plan's cost class with the cap for the lead's autonomy (autonomy 1 or 2: medium; 3 to 5: high). When over, downsize in order: drop full-variant extras, switch to the lean variant, cut media deliverables, move reviewers to `ask_coworker`, and ask the owner if that is not enough.

#### Voices

Every member must sound different from every other member and from the lead, so the owner always knows who is speaking. OpenAI and xAI voices are resolved separately (`voice_assignment`).

1. **Candidates.** A recipe's `voice_override` pins a member's voice for that team. Otherwise the candidates are the member's own voice, then their alternates, in order.
2. **Reserve the lead.** The lead's own voice ids (realtime and playback) are removed from every member's candidates. Resolving once per project with the lead reserved means the lead can join any meeting without anyone being recast, and each coworker sounds the same for the whole project.
3. **Match.** Members claim voices in composition order (the coordinator is listed first, members added later come last). This is a backtracking match, not a greedy one: an earlier member keeps their earliest free candidate unless a later member would be left with nothing, in which case whoever has a free alternate moves.
4. **Fall back only when no match exists:** add cross-surface fallbacks (for example `marin` to `coral`), then every free voice matching the member's presentation (she/her feminine, he/him masculine, they/them neutral or either), and match again.
5. **Capacity.** OpenAI TTS has 5 feminine, 6 masculine and 2 neutral voices; xAI TTS has 7, 13 and 6. A team or meeting with more members of one presentation than a provider has voices cannot be unique on that provider: play it through the other provider, split the meeting, or swap a member.
6. **Audition gate.** Until a person has listened to every xAI voice and confirmed its presentation (`taxonomy.json › voices.audition_gate`, currently pending), playback prefers OpenAI wherever the owner has it, and on xAI only the five characterized voices (`eve`, `ara`, `leo`, `rex`, `sal`) are used. Only two of those are feminine, so any team with three or more she/her members plays through OpenAI until the audition passes.
7. **Never** clone a voice or imitate the owner.

### 7. Plan

`plan_create` drafts a DAG of at most 8 tasks. Each task names one accountable owner (co-owners take over a failed attempt; each member has at most 3 open tasks), 0 to 2 reviewers from other disciplines, its dependencies, an acceptance criterion and whether it needs an owner decision. The sceptic reviews the costliest task and may own a pre-mortem, red-team or test task. Regulated work has its licensed-review task before anything external. There are no "coordinate" or "summarise" tasks. At most 3 tasks run at once, each gets 1 revision and 2 attempts, and delegation goes at most 2 levels deep.

Reviewers run in parallel. The first line of a review is exactly `APPROVED` or `CHANGES`; an incomplete review counts as `CHANGES`; after one revision the owner decides.

**Meetings** (`meetings`): a kickoff for teams of 3 or more, a critique before any external deliverable, and a decision meeting for owner decisions or irreversible steps. Debates need the sceptic and a facilitator (or a coordinator with the facilitator role). The chair frames the question in under 200 words and names the hinge constraint, members open with their discipline's angle and its failure mode, the debate names one disagreement with evidence, and the chair closes with a recommendation, owners, open disagreements and asks of the owner. The owner can listen, join or skip for a summary. The minutes scribe (or the coordinator) records decisions and actions with an owner and a date. At most 6 people per meeting, 2 rounds by default and 4 at most.

### 8. Explain and confirm

The lead tells the owner the team in **one plain sentence** (`explain_to_owner`):

> I've put {coordinator} in charge of {the outcome in the owner's words}, with {owners and their jobs}, and {sceptic} as our sceptic on {the costliest task} because {why that is the risk}.

It must say who leads, who the sceptic is and what they check, anything left out on purpose to keep the team lean, and any licensed-review step. It never uses internal jargon (composition, provider, tier), never suggests the coworkers are human, and never states a cost as a price. One short line per member is added only if the owner asks or hasn't worked with that coworker before.

The lead **asks before starting** when the plan's cost class is above its autonomy cap, when the plan touches a regulated domain, when video or long voiced meetings are planned without media approval, or when a thorough team was chosen for a goal the owner called quick. Otherwise it starts and reports.

**Informed owner decision.** For a short list of low-risk items per domain (for example an internal monthly close, or an NDA from a vetted template with no changes), the licensed-review task can be completed by the owner recording "proceed without professional review" after reading a one-paragraph risk summary. The lead offers this once, only when the owner says they have no professional or asks to proceed, and never nudges. It is never available for filings and elections, securities or investor material, terminations and classification, breach notifications, clinical content, or contracts above the owner's threshold.

---

## Pseudocode

```text
formTeam(request, owner, lead):
    frame = frameGoal(request, owner.profile)
        # outcome, deliverables (artifact types), owner decisions, regulated domains, industry, locale
    size  = chooseSize(frame, request.words, lead)

    best = argmax over recipes r of matchScore(r, frame, owner)
    if best.score >= recipe_first.min_match_score (0.6) and not owner.rejected(best):
        team, plan = fromRecipe(best, size, owner.industry)
    else:
        team, plan = fromScratch(frame, size, lead)

    team = checkTeam(team, plan, lead, size)
    assignProviders(team, plan)
    team.voices = resolveVoices(team, reserved = lead.voiceIds)          # stored for the whole project
    if costClass(plan) > budget.cap[lead.autonomy]:
        team, plan = downsize(team, plan)                                  # budget.downsize_order
    say(explain(team, plan))
    if needsApproval(plan, lead): request_owner_decision("Start with this team?")
    else: start(plan)


chooseSize(frame, words, lead):
    points = max(0, frame.disciplines - 2)
           + 1 if frame.leavesWorkspace
           + 2 if frame.regulatedDomains is not empty
           + 1 if frame.ownerDecisions >= 2
           + 2 if frame.irreversibleOrMoneyMoving
           + 1 if frame.calendarDays > 5
           + 1 if frame.littleDataOrNewMarket
    size = lean if points <= 2 else balanced if points <= 5 else thorough
    if words contain "quick" | "small" | "just":     return lean        # regulated specialists still added
    if words contain "thorough" | "bulletproof":     return thorough
    if bandDistance(lead.default_size, size) <= 1:   return lead.default_size
    return size


matchScore(r, frame, owner):
    return 0.45 * similarity(frame.goal, r.outcome + r.name + recipe_intents[r.id])
         + 0.25 * share(frame.deliverables, producedBy = r.deliverables)
         + 0.10 * (1 if r.hasVariant(owner.industry) or r.isIndustryNeutral else 0)
         + 0.10 * share(r.requiredInputs, alreadyKnownFrom = [memory, connectors])
         + 0.10 * (1 if owner.ranBeforeAndRatedWell(r) else 0)


fromRecipe(r, size, industry):
    team = {lean: r.lean_variant, balanced: r.composition, thorough: r.full_variant}[size]
    plan = copy(r.plan_skeleton)
    v = r.variantFor(industry)
    if v:
        team = team - v.swap_out + v.swap_in                                # swap_out first
        for task in plan where task.owner in v.swap_out:
            task.owner = v.reassign[task.id] or swappedInHolderOfAll(task.skill_ids)
        for skill in v.extra_skill_ids:
            plan.add(Task(skill, owner = v.swap_in[0] or bestScorer(skill),
                          reviewer = team.sceptic or team.coordinator))
    while count(team) > limits.max_team_members:
        team.remove(aFullVariantExtra(team, r))            # never the sceptic, coordinator or a regulated specialist
    for task in plan where task.owner not in team:                          # lean variants
        rehome(task, team)                                                  # gap_filling order
    return team, plan


fromScratch(frame, size, lead):
    skills = deriveSkills(frame)                                            # must / nice, plus regulated domains
    team = []
    while uncoveredMust(skills, team) and count(team) < cap(size):
        team.add(argmax over personas p not in team of
                 (marginalMustCoverage(p, skills, team), selectionScore(p, team, skills, lead), tieBreakers))
    fillGaps(team, skills)                                                  # secondary holder, generalist, core crew,
                                                                            # ask_coworker, spawn_coworker, ask owner
    addRequiredRoles(team, frame, size)
    plan = plan_create(team, frame)
    return team, plan


addRequiredRoles(team, frame, size):
    team.coordinator = leadRoleMemberOwningFinalDeliverable(team) or add(project-manager) or add(operations-director)
    if count(team) >= 3 and not team.hasSceptic:
        d = discipline(frame.highestCostDecision)
        team.add(firstFit(sceptic_selection.by_discipline[d],
                          prefer = tensionWith(team.coordinator or team.mainOwner)) or red-team-sceptic)
    if frame.meetings include debate | decision | workshop and no non-sceptic member has "facilitator":
        team.add(facilitator)
    for domain in frame.regulatedDomains:
        ensure team has one of regulated_domain_rules[domain].must_include_one_of
        frame.plan.addBeforeAnyExternalStep(HumanTask("Licensed review", preparedBy = that member))
    if fromScratch or size == thorough:
        for trigger in core_crew_triggers where trigger.applies(frame):
            if count(team) < limits.max_team_members: team.add(trigger.persona, as = trigger.role)
            else: consultViaAskCoworker(trigger.persona)
    while count(team) > cap(size): team.remove(lowestMarginalCoverage(nonRequired(team)))


checkTeam(team, plan, lead, size):
    team.addIfRoom(lead.always_includes_roles)
    enforce uniqueDisciplines, maxSameDepartment = 3, minDistinctPrimaryProviders
    enforce seniorityMix; placeTensionPairs(max = 2, asOwnerAndReviewerOfOneArtifact)
    loop:
        best = bestSwap(team)                 # team_score: coverage .35, chemistry .12, seniority .10,
                                              # providers .10, voices .10, cost .10, industry .08, size .05
        if best.gain < 0.05: break
        apply(best)
    return team


assignProviders(team, plan):
    for m in team: m.provider = m.provider_preference[0]
    for each pair (a, b) sharing a provider, lower seniority first:
        if lower(a, b) has an unused provider later in its preference list: move it there
    deep tier for: the sceptic; owner and reviewers of needs_owner_decision or costliest tasks; meeting synthesis
    fast tier for: meeting banter
    apply recipe.model_hints.by_task except where the rule above names the task


resolveVoices(team, reserved):
    for provider in [openai, xai]:
        cands[m] = [m.voice_override[provider]] if pinned else [m.voice[provider], ...m.alternates[provider]]
        cands[m] -= reserved[provider]
        if provider == xai and auditionPending: cands[m] = cands[m] ∩ {eve, ara, leo, rex, sal}
        match = backtrack(members in claim order, cands)           # earlier members keep earlier candidates
        if not match:
            cands[m] += crossSurfaceFallbacks(cands[m]) + freeVoicesOfPresentation(m.pronouns)
            match = backtrack(members, cands)
        if not match: mark provider not unique for this team (play via the other provider, split, or swap)
        store match per member for the project
```

---

## Worked examples

The three examples below run the algorithm on real catalog data. Team members, variants, providers, tiers and voices come straight from the persona, recipe and formation files, and the voices were resolved with the method above. Recipe match scores are **illustrative**: outcome similarity is computed at runtime, so the similarity figures are plausible values chosen to show the arithmetic, not measurements.

### Example 1: "Launch a spring promo for my bakery"

**Owner and lead.** A neighborhood bakery (industry `hospitality-restaurants`) with an email list and an Instagram account. The owner chose **Juno Estrada**, the playful creative (default size balanced; always includes a facilitator and a sceptic; voices `ash` and `ara`).

**1. Frame and size.** Outcome: a spring menu and offer live on a date the owner picks, with posts, emails and a run sheet. Deliverables: launch plan, costed spring items, announcement emails, social posts, run sheet. Owner decisions: which items and at what price, and the go-live date.

| Signal | Points |
|---|---:|
| Five disciplines (positioning, copy, social, food costing, scheduling) | 3 |
| Posts and emails leave the workspace | 1 |
| Two owner decisions | 1 |
| Regulated, irreversible, long or data-poor | 0 |
| **Total** | **5: balanced** |

Juno's default is balanced too, so the size stays **balanced**.

**2. Match a recipe.**

| Recipe | Similarity (×0.45) | Deliverables (×0.25) | Industry (×0.10) | Inputs known (×0.10) | Used before (×0.10) | Score |
|---|---:|---:|---:|---:|---:|---:|
| `launch-new-offer` | 0.75 | 0.8 | 1 | 0 | 0 | **0.64** |
| `social-kickstart` | 0.40 | 0.4 | 1 | 0 | 0 | 0.38 |
| `ecommerce-growth-sprint` | 0.45 | 0.2 | 1 | 0 | 0 | 0.35 |
| `restaurant-profit-tuneup` | 0.30 | 0.2 | 1 | 0 | 0 | 0.29 |

`launch-new-offer` clears 0.6. Its hospitality variant fits a new menu exactly: "Nabil costs the new items to the plate, and the run sheet covers a staff tasting, training and a soft-opening night."

**Adapt.** Balanced means the six-person composition. The hospitality variant swaps in `hospitality-operator` (Nabil) and swaps nobody out, and its extra skill `menu-engineering` becomes one new task, *Cost the spring items to the plate*, owned by Nabil. The lead makes it feed the tier-and-price decision and has Ruth review it, because a promo that sells out at a loss is the costliest way to be wrong here. Seven people is above the balanced band (size fit 0.5) but well under the cap of 8, and no swap improves the team score by 0.05, so the team stands. The full variant's motion designer and QA verifier are left out.

**Checks.** Coordinator: Olumide (the recipe's). Sceptic: Ruth. The go/no-go meeting is a decision, and Sabina has the facilitator role, which also satisfies Juno's always-included facilitator. Marketing has exactly 3 members, the limit. Leads and principals: Ananya, Sabina, Ruth and Nabil; principals are 2 of 7. First-choice providers: OpenAI, Anthropic and xAI, so 3 distinct; nobody moves because no one has an unused provider left in their list.

**Final team**

| Member | Title | Role | Provider, tier | OpenAI voice | xAI voice |
|---|---|---|---|---|---|
| Olumide Adeyemi | Product marketing manager | coordinator | OpenAI, balanced | `echo` | `rigel` |
| Ananya Iyer | Brand strategist | co-owner | Anthropic, deep | `marin` | `ursa` |
| Marlon Reid | Senior copywriter | specialist | xAI, balanced | `verse` | `zagan` |
| Luana Kealoha | Social media manager | specialist | xAI, balanced | `nova` | `carina` |
| Sabina Gurung | Project manager | co-owner, facilitator | Anthropic, balanced | `coral` (pinned) | `eve` (pinned) |
| Ruth Hollander | Sceptic & red-team lead | sceptic | xAI, deep | `sage` | `luna` |
| Nabil Saade | Restaurant & hospitality operator | specialist | Anthropic, balanced | `cedar` | `orion` |

**Voices.** Juno's `ash` and `ara` are reserved. The recipe pins Sabina to `coral` and `eve` so she doesn't collide with Ananya. Nabil's own first choice, `echo`, is already Olumide's, so he takes his alternate `cedar`. Four she/her members fit OpenAI's five feminine voices. On xAI only two characterized feminine voices exist and Juno holds one of them, so until the audition passes this team plays through OpenAI.

**Plan (7 tasks).** Cost the spring items (Nabil, reviewed by Ruth) and sharpen the positioning (Ananya, reviewed by Ruth) run first. Then tier the launch and set the price and date (Olumide, reviewed by Sabina; owner decision, deep tier). Then the launch emails (Marlon, reviewed by Ananya), posts and short videos (Luana, reviewed by Marlon), the run sheet with the staff tasting and soft opening (Sabina, reviewed by Olumide) and the pre-mortem (Ruth, reviewed by Olumide). Ruth holds 3 tasks, the limit. The owner can listen to the kickoff, the "does the promise survive a sceptic?" critique and the go/no-go.

**Budget and approval.** Medium cost against a high cap (Juno's autonomy is 3), and no regulated domain, so Juno starts and reports; the first owner decision arrives at the tier-and-price task. Copy never tells a customer a pastry is free of an allergen (`workplace_safety` never-list). If the owner wants an allergen card, that adds the workplace-safety domain: Nabil prepares it and the site's competent person reviews it.

**What the owner hears (Juno):**

> I've put Olumide in charge of your spring promo, with Nabil costing the new pastries to the plate, Ananya on the one-line promise, Marlon on the emails, Luana on the posts and Sabina on the run sheet, and Ruth as our sceptic on the promise and the plate costs, because a promo that sells out at a loss is the expensive mistake here; I've skipped video and a separate QA pass to keep it tight.

### Example 2: "Close the books for Q3"

**Owner and lead.** A six-person design studio (`professional-services`) with its accounting system connected; its fiscal year is the calendar year, so Q3 is July to September. The owner chose **Dominic Reyes**, the calm, steady operator (default size lean; always includes a reviewer and a sceptic; voices `echo` and `leo`).

**1. Frame and size.** Outcome: Q3 closed, reconciled and summarised on one page. Deliverables: close checklist, reconciliations with exceptions, a one-page quarter pack. The close carries `tax_accounting` (from the `month-end-close` skill).

| Signal | Points |
|---|---:|
| Three disciplines (bookkeeping, controllership, controls) | 1 |
| Regulated domain (`tax_accounting`) | 2 |
| Internal only, one owner decision, three days, data available | 0 |
| **Total** | **3: balanced** |

Dominic's default, lean, is one band away, so the size becomes **lean**.

**2. Match a recipe.**

| Recipe | Similarity (×0.45) | Deliverables (×0.25) | Industry (×0.10) | Inputs known (×0.10) | Used before (×0.10) | Score |
|---|---:|---:|---:|---:|---:|---:|
| `monthly-close-pack` | 0.85 | 1.0 | 1 | 1.0 | 0 | **0.83** |
| `year-end-and-tax-prep` | 0.50 | 0.4 | 1 | 0.5 | 0 | 0.48 |
| `kpi-dashboard` | 0.25 | 0.3 | 1 | 0.5 | 0 | 0.34 |

Both required inputs are known: the period comes from the request and the accounting system is connected. There is no professional-services variant, and the base recipe is industry-neutral. The lead runs the recipe's checklist for each month of the quarter and makes the pack cover the quarter.

**Adapt.** The lean variant is Thomas (controller) and Imelda (bookkeeper). Dominic always adds a reviewer and a sceptic, and a third member fits the lean band, so the recipe's sceptic Gulnara (controls specialist) joins. At three people a sceptic is required anyway. Guillermo (analytics storyteller) is not on the lean team, so his work is re-homed through `gap_filling`. Nobody on the team lists `data-story` or `executive-summary`, and a department generalist or core crew would make four, over the lean cap. So Thomas owns the one-page pack (it summarises his own variance review) and Guillermo reviews it through a single bounded `ask_coworker` call, which also restores a reviewer from outside finance. The variance review, which Guillermo would have reviewed, goes to Gulnara.

**Checks.** Coordinator: Thomas. Sceptic: Gulnara, senior; the finance discipline map lists `controls-specialist`. All three are from finance, which is the limit of 3. The validator warns that Gulnara reviewing Thomas's close checklist keeps the review in one discipline. The recipe accepts that on purpose, because she speaks for a future auditor or lender. Principal: Thomas. Providers: Thomas and Gulnara both prefer Anthropic, and Gulnara (senior, below Thomas's principal) has xAI unused later in her list, so she moves there. The team runs on three providers, with Gulnara on the deep tier as the sceptic.

**Final team**

| Member | Title | Role | Provider, tier | OpenAI voice | xAI voice (before the audition) |
|---|---|---|---|---|---|
| Thomas Becker | Controller | coordinator | Anthropic, deep | `cedar` | `kepler` (`rex`) |
| Imelda Santos | Bookkeeper | co-owner | OpenAI, balanced | `marin` | `ara` (`eve`) |
| Gulnara Akhmetova | Internal controls & audit-readiness specialist | sceptic | xAI (moved from Anthropic), deep | `sage` | `ursa` (`ara`) |
| *Guillermo Vargas* | *Analytics storyteller* | *consulted through `ask_coworker`, not on the team* | | | |

**Voices.** Dominic's `echo` and `leo` are reserved, so Thomas takes his alternate `cedar` on OpenAI. Before the audition, xAI uses characterized voices only: Gulnara's only characterized option is `ara`, so the backtracking match moves Imelda to her next one, `eve`, and Thomas takes `rex`. This small team is unique on both providers even before the audition.

**Plan (7 tasks).** Categorize the quarter's transactions (Imelda, reviewed by Thomas), then reconcile bank, card and payout accounts (Imelda, reviewed by Gulnara), then the close checklist and proposed adjustments (Thomas, reviewed by Gulnara). Three tasks then run in parallel, the concurrency limit: the controls spot-check (Gulnara), the variance review (Thomas, reviewed by Gulnara) and the **licensed review of adjusting and tax-sensitive entries** (a human task: Thomas prepares it and the owner arranges it with their accountant). Last comes the one-page quarter pack (Thomas, reviewed by Guillermo). The owner can listen to the kickoff, the exceptions critique and a two-minute briefing on the quarter.

**Budget and approval.** Medium cost is within the cap for Dominic's autonomy of 3, but the plan touches a regulated domain, so Dominic asks before starting. If the owner has no accountant, an internal close is on the informed-owner-decision list: after a one-paragraph risk summary the owner may record "proceed without professional review", and the pack keeps its DRAFT label. If the Q3 figures feed a quarterly sales-tax or VAT return or an estimated tax payment, review is mandatory.

**What the owner hears (Dominic):**

> It's a quarter-end close, so I'm keeping it lean: Thomas runs the close, Imelda categorizes and reconciles every account, and Gulnara is our sceptic on the reconciliations and adjusting entries, because a number that doesn't tie is exactly what your accountant or a lender would catch; Guillermo checks the one-page summary without joining, and your accountant reviews the adjusting entries before anything is filed.

### Example 3: "Prepare for a Series A"

**Owner and lead.** A B2B SaaS startup (`saas-startup`) with billing and accounting connected. The owner chose **Kadri Tamm**, the data-driven analyst (default size thorough; always includes a reviewer and a sceptic; voices `shimmer` for realtime, `marin` for gpt-live-1 and playback, and `ara`).

**1. Frame and size.** Outcome: an investor-ready pack for the raise. Deliverables: pitch deck, three-statement model, SaaS metrics, data-room index. Owner decisions: the raise amount and use of funds, and when to hand the pack to advisers. Regulated: `investment_financial_advice` and `legal` (securities material).

| Signal | Points |
|---|---:|
| Seven disciplines (finance model, investor narrative, cap table, deck design, market sizing, SaaS metrics, legal review) | 5 |
| The pack goes to investors | 1 |
| Regulated domains | 2 |
| Two or more owner decisions | 1 |
| About ten calendar days | 1 |
| **Total** | **10: thorough** |

Kadri's default is thorough as well.

**2. Match a recipe.**

| Recipe | Similarity (×0.45) | Deliverables (×0.25) | Industry (×0.10) | Inputs known (×0.10) | Used before (×0.10) | Score |
|---|---:|---:|---:|---:|---:|---:|
| `investor-pitch-pack` | 0.85 | 0.75 | 1 | 0.67 | 0 | **0.74** |
| `business-plan-for-lender` | 0.40 | 0.25 | 1 | 0.5 | 0 | 0.39 |
| `cash-runway-rescue` | 0.30 | 0.25 | 1 | 0.67 | 0 | 0.36 |

Financials and traction are known from the connectors; the raise goal is not.

**Adapt.** Thorough means the full variant: the seven-person composition plus Oona (fact-checker). The SaaS variant swaps in Arjun (SaaS & startup operator), which makes nine, over the cap of 8. Full-variant extras go first, so Oona drops. Kadri still wants every figure verified, so Oona checks the deck's numbers through `ask_coworker` before the licensed review. The variant's extra skill, `saas-metrics-pack`, would add a ninth task to an eight-task plan, over `limits.max_plan_tasks`. The lead folds it into the model task instead, with Arjun as co-owner, which is what the variant describes: "Arjun makes the SaaS metrics consistent with the model." (`formation.json` does not yet say how to resolve this; see the open issues below.)

**Checks.** Coordinator: Harriet (fractional CFO). Sceptic: Ruth, principal, placed on the investment narrative. Regulated coverage: Harriet, Lucas, Rhys and Arjun all satisfy `investment_financial_advice`, and Eleanor satisfies `legal`. The recipe's meetings include a workshop and a decision, but no member other than the sceptic has the facilitator role. On the recipe path the curated team stands, the coordinator chairs, and the team is at 8 in any case (see the open issues). Chemistry: two productive-tension pairs, the maximum, both with Rhys: Lucas, whose data room Rhys reviews, and Arturo, whose market size feeds Rhys's narrative. Principals are 3 of 8. First-choice providers: Anthropic ×5, OpenAI ×2 and xAI ×1, so 3 distinct; no moves.

**Final team**

| Member | Title | Role | Provider, tier | OpenAI voice | xAI voice |
|---|---|---|---|---|---|
| Harriet Osei | Fractional CFO | coordinator | Anthropic, deep | `sage` | `celeste` |
| Rhys Llewellyn | Board & investor communications advisor | co-owner | Anthropic, balanced | `ballad` | `perseus` |
| Lucas Moreau | Startup finance & cap table analyst | co-owner | Anthropic, balanced | `verse` | `rigel` |
| Ivan Horvat | Presentation designer | specialist | Anthropic, balanced | `echo` | `leo` (pinned) |
| Arturo Andrade | Market research analyst | specialist | OpenAI, balanced | `cedar` (pinned) | `castor` (pinned) |
| Ruth Hollander | Sceptic & red-team lead | sceptic | xAI, deep | `coral` (fallback) | `luna` |
| Eleanor Whitfield | Contracts analyst | reviewer, licensed-review prep | Anthropic, deep | `nova` (fallback) | `carina` |
| Arjun Mehta | SaaS & startup operator | co-owner (added by the SaaS variant) | OpenAI, balanced | `ash` | `rex` |

**Voices: the interesting case.** Kadri holds two OpenAI voices, `shimmer` and `marin`. Harriet, Ruth and Eleanor each list only `shimmer`, `sage` and `marin`, and the recipe pins Eleanor to `marin`, which is Kadri's own voice. The lead's reservation wins over the pin, because the lead is the one voice the owner must always recognise. That leaves only `sage` for three people, so no match exists. The fallback stage adds cross-surface fallbacks (`marin` to `coral`) and then the free feminine voices: Harriet keeps `sage`, Ruth gets `coral` and Eleanor gets `nova`. OpenAI has five feminine voices, and with Kadri holding two, exactly three remain for three she/her members. On xAI, with only `eve` left among the characterized feminine voices, the team plays through OpenAI until the audition passes.

**Plan (8 tasks).** In parallel: the three-statement model with the SaaS metrics pack (Harriet, co-owned by Arjun, reviewed by Lucas), sizing the market (Arturo, reviewed by Harriet) and ownership scenarios (Lucas, reviewed by Harriet). Then the investment narrative (Rhys, reviewed by Ruth) and the pitch deck (Ivan, reviewed by Rhys), with the data-room index alongside (Lucas, reviewed by Rhys and Eleanor). Then the diligence drill, a mock investor meeting (Ruth, reviewed by Harriet). Last, the **licensed review before any investor sees it** (a human task that Eleanor prepares; owner decision, deep tier). The owner hears the kickoff interview, the mock investor meeting and the "ready for your advisers" decision.

**Budget and approval.** High cost is within the cap for Kadri's autonomy of 3, but the plan is regulated, so Kadri asks before starting. Informed owner decision is not available: investor and securities material always needs a securities lawyer and a licensed adviser. The team models the owner's own scenarios and never recommends a valuation, instrument or deal term.

**What the owner hears (Kadri):**

> Because this is investor material, Harriet leads, with Arjun making your SaaS metrics match the model, Rhys on the story, Lucas on the cap table and data room, Arturo on market size, Ivan on the deck and Eleanor keeping the wording clear of anything that reads as a securities promise, and Ruth is our sceptic, playing the toughest investor in the room on the narrative, because an unsupported number is what sinks diligence; Oona checks every figure from outside the team to keep it at eight, and nothing reaches an investor until your securities lawyer and a licensed adviser have reviewed it.

---

## Open issues found while writing this

These are gaps between the rules and the data. None of them fails validation today.

1. **Recipes without a facilitator.** 16 of the 34 recipes whose meetings include a debate, decision or workshop have no non-sceptic member with the facilitator role: `positioning-sprint`, `seo-growth-sprint`, `paid-ads-launch`, `email-lifecycle-program`, `website-conversion-overhaul`, `social-kickstart`, `outbound-pipeline`, `win-a-deal`, `partner-program`, `pricing-refresh`, `investor-pitch-pack`, `market-entry-study`, `ecommerce-growth-sprint`, `product-roadmap-reset`, `ai-adoption-plan` and `margin-rescue`. On the recipe path step 5 is skipped, so the coordinator chairs. Either `formation.json` should say so explicitly, or these recipes should gain a facilitator-capable member (or a validator check).
2. **Adaptation can exceed the task limit.** An extra skill becomes a new task, which can push a plan past `limits.max_plan_tasks` (Example 3). Proposed rule: fold the extra skill into the closest existing task, with the swapped-in specialist as co-owner.
3. **The lead's voice against a recipe pin.** `reserve_lead_voice` and `voice_override` don't state which wins. The examples treat the lead's reservation as stronger (Example 3). Proposed: say so in `voice_assignment`.
4. **Variant prose that disagrees with its swap lists.** Nine industry variants say a member "steps out" while `swap_out` is empty, so the runtime (which reads the lists) keeps that member: `content-engine`/saas-startup (Luana), `sales-playbook`/manufacturing and /real-estate (Beatriz), `win-a-deal`/construction-trades and /real-estate (Beatriz, who is not in that recipe), `investor-pitch-pack`/hospitality-restaurants (Arturo), `fundraising-campaign`/general (Rohan), `pr-push`/healthcare-practice (Rohan) and `ecommerce-growth-sprint`/ecommerce-retail (Hamish). Each needs either `swap_out` plus a `reassign` for the member's tasks, or corrected prose.
5. **Lean variants and orphaned tasks.** A lean variant usually drops members who own tasks in `plan_skeleton` (Example 2). `rehome` through `gap_filling` handles it, but `formation.json` doesn't spell this out.
6. **xAI capacity before the audition.** With only two characterized feminine voices on xAI, any team with three or more she/her members, or two plus a lead holding `ara` or `eve`, must play through OpenAI until `voices.audition_gate` passes. An owner with only xAI enabled gets split meetings.
7. **Duplicated lead style.** `lead_style_overrides` copies each lead file's `staffing_style`. The validator flags drift, but formation should read the lead files directly.
8. **Curated exceptions.** The validator's 4 warnings (a same-discipline reviewer in `monthly-close-pack`, and four or five people from one department in `security-hardening`, `year-end-and-tax-prep` and `team-pulse-and-retention`) are recipes bending from-scratch heuristics. Decide whether to keep them as documented exceptions or rebalance them.
