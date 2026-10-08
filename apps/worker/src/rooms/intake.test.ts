// The room's intake (rooms/intake.ts): what the owner's line means for the work, made safe (people kept to the table,
// a project kept to the ones listed), and Mock's keyless rule.
import { describe, expect, it } from 'vitest';
import { decisionOf, mockIntake, type IntakePerson } from './intake';

const people: IntakePerson[] = [
  { personaId: 'tech-lead', firstName: 'Nina', title: 'Tech lead', projects: [{ projectId: 'prj_a', title: 'Checkout' }] },
  { personaId: 'senior-copywriter', firstName: 'Andre', title: 'Copywriter', projects: [] },
];

describe('room intake', () => {
  it('keeps people to the table and falls back to the owner’s words for the goal', () => {
    expect(decisionOf({ action: 'start', goal: '', people: ['andre', 'Zed', 'Andre'] }, { people, ownerText: 'Write the launch email' })).toEqual({ action: 'start', goal: 'Write the launch email', title: '', people: ['senior-copywriter'] });
    expect(decisionOf({ action: 'start', goal: 'hi' }, { people, ownerText: 'hi' })).toEqual({ action: 'none' });
  });

  it('directs only a project someone here is on', () => {
    expect(decisionOf({ action: 'direct', project_id: 'prj_a', direction: 'Cover Apple Pay', to: 'Nina' }, { people, ownerText: '' })).toEqual({ action: 'direct', projectId: 'prj_a', text: 'Cover Apple Pay', toId: 'tech-lead' });
    expect(decisionOf({ action: 'direct', project_id: 'prj_zzz', direction: 'Cover Apple Pay' }, { people, ownerText: '' })).toEqual({ action: 'none' });
    // The one named is not on it: the whole team hears it.
    expect(decisionOf({ action: 'direct', project_id: 'prj_a', direction: 'Cover Apple Pay', to: 'Andre' }, { people, ownerText: '' })).toEqual({ action: 'direct', projectId: 'prj_a', text: 'Cover Apple Pay' });
    expect(decisionOf(null, { people, ownerText: 'x' })).toEqual({ action: 'none' });
  });

  it('Mock: a request starts work, a direction reaches the project, an opinion question starts nothing', () => {
    const line = (t: string) => `Decide what this means for the work.\n\nThe owner's latest line: ${t}`;
    expect(mockIntake(line('Andre, can you draft the launch email?'), { people })).toMatchObject({ action: 'start', people: ['Andre'] });
    expect(mockIntake(line('Go ahead.'), { people })).toMatchObject({ action: 'start' });
    expect(mockIntake(line('Nina, make sure it covers Apple Pay.'), { people })).toMatchObject({ action: 'direct', project_id: 'prj_a', to: 'Nina' });
    expect(mockIntake(line('Where would you start?'), { people })).toEqual({ action: 'none' });
    expect(mockIntake(line('What do you all think?'), { people })).toEqual({ action: 'none' });
  });
});
