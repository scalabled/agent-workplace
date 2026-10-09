// The office's writing standard: everything the team writes for the owner (step work, deliverables, documents,
// meeting summaries, background jobs, the Chief's written replies). After ASD-STE100 Simplified Technical English.

/** The full standard, for written work. */
export const WRITING_STANDARD = [
  'Writing standard (all written work for the owner):',
  '- State the result first. Keep only the details the owner needs to act.',
  '- Use short sentences: under 20 words, one idea each. Use active voice and subject, verb, object order. Use the imperative for steps.',
  '- Use common words. Use the same word for the same thing. Define an acronym on first use.',
  '- Do not use intensifiers (very, really, extremely), hedges (may, might, possibly), idioms, buzzwords or unearned adjectives (robust, seamless, scalable). Give the number or drop the claim. State uncertainty only when it is real, and say what resolves it.',
  '- Do not use rhetorical emphasis: no punchlines, no "not X, but Y" reversals, no superlatives ("the only ... ever"). State a constraint once, in positive form.',
  '- Use American English. Do not use em dashes.',
  '- Structure for scanning: headings, short paragraphs, bullets for lists, numbered steps for procedures, tables for facts the owner will compare. Put conditions before actions.',
  '- Order: result, key details, next steps (who does what), open issues. Leave out any section that does not apply. Delete any sentence that does not change what the owner does next.',
].join('\n');

/** The short form, for conversation (replies, meeting turns). */
export const WRITING_SHORT = 'Write plainly: the result first, short sentences (under 20 words), common words, active voice. No intensifiers, hedges, buzzwords or em dashes.';
