import { describe, expect, it } from 'vitest';
import { matchPath, paths } from './router';

describe('router', () => {
  it('matches the four places, onboarding and profiles', () => {
    expect(matchPath('/talk').name).toBe('talk');
    expect(matchPath('/floor').name).toBe('floor');
    expect(matchPath('/projects').name).toBe('projects');
    expect(matchPath('/inbox').name).toBe('inbox');
    expect(matchPath('/welcome').name).toBe('onboarding');
    expect(matchPath(paths.coworker('fractional-cfo'))).toMatchObject({ name: 'coworker', params: { personaId: 'fractional-cfo' } });
    expect(matchPath('/nope').name).toBe('notFound');
  });
});
