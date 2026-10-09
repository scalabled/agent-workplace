// The writing standard reaches everything the team writes for the owner: project work and reviews, background jobs,
// and the chair's close of a meeting.
import { fullIndex } from '@headcount/catalog/full';
import { describe, expect, it } from 'vitest';
import { workSystemPrompt } from '../jobs/work-loop';
import { DISCUSSION_DIRECTIVE } from '../projects/team-work';
import { coworkerSections } from './prompt';
import { WRITING_SHORT, WRITING_STANDARD } from './writing';

describe('the writing standard', () => {
  const persona = fullIndex.catalog.personas[0]!;
  const input = { persona, instructions: '', edited: false, skills: [], research: '' };

  it('is in every coworker prompt: in full for work, short for reviews', () => {
    const work = coworkerSections(input, 'work').find((s) => s.id === 'writing');
    expect(work?.text).toBe(WRITING_STANDARD);
    expect(coworkerSections(input, 'review').find((s) => s.id === 'writing')?.text).toContain(WRITING_SHORT);
  });

  it('says result first, short sentences and no em dashes', () => {
    expect(WRITING_STANDARD).toMatch(/State the result first/);
    expect(WRITING_STANDARD).toMatch(/under 20 words/);
    expect(WRITING_STANDARD).toMatch(/Do not use em dashes/);
    expect(WRITING_STANDARD).not.toContain('—');
  });

  it('binds background jobs and the chair’s close', () => {
    expect(workSystemPrompt({ chiefName: 'Rosa', lead: undefined })).toContain(WRITING_STANDARD);
    expect(DISCUSSION_DIRECTIVE.synthesis).toMatch(/\*\*Decision\*\*.*\*\*Who does what\*\*/);
    expect(DISCUSSION_DIRECTIVE.synthesis).toMatch(/under 150 words/);
  });
});
