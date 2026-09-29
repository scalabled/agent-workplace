import { describe, expect, it, vi } from 'vitest';
import { lastNav, legacyRedirect, matchPath, navigate, paths, savedScroll } from './router';

describe('router', () => {
  it('serves the landing page at / and the app under /app', () => {
    expect(matchPath('/').name).toBe('landing');
    expect(matchPath('/app').name).toBe('home');
    expect(matchPath('/app/').name).toBe('home');
    expect(matchPath(paths.talk).name).toBe('talk');
    expect(matchPath(paths.floor).name).toBe('floor');
    expect(matchPath(paths.projects).name).toBe('projects');
    expect(matchPath(paths.inbox).name).toBe('inbox');
    expect(matchPath(paths.onboarding).name).toBe('onboarding');
    expect(paths.talk).toBe('/app/talk');
    expect(matchPath(paths.coworker('fractional-cfo'))).toMatchObject({ name: 'coworker', params: { personaId: 'fractional-cfo' } });
    expect(matchPath('/nope').name).toBe('notFound');
    expect(matchPath('/app/nope').name).toBe('notFound');
  });

  it('redirects pre-landing app paths to their /app equivalents', () => {
    expect(legacyRedirect('/talk')).toBe('/app/talk');
    expect(legacyRedirect('/welcome')).toBe('/app/welcome');
    expect(legacyRedirect('/floor/')).toBe('/app/floor/');
    expect(legacyRedirect('/projects')).toBe('/app/projects');
    expect(legacyRedirect('/inbox')).toBe('/app/inbox');
    expect(legacyRedirect('/desk/fractional-cfo/profile')).toBe('/app/desk/fractional-cfo/profile');
    expect(legacyRedirect('/')).toBeNull();
    expect(legacyRedirect('/app/talk')).toBeNull();
    expect(legacyRedirect('/talking')).toBeNull();
  });

  it('remembers where the owner was on the page they leave, so Back can return there', () => {
    history.replaceState(null, '', '/');
    Object.defineProperty(window, 'scrollY', { value: 1234, configurable: true });
    const spy = vi.spyOn(history, 'replaceState');
    navigate(paths.app);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ scrollY: 1234 }), '');
    spy.mockRestore();
    expect(lastNav()).toBe('push');
    expect(location.pathname).toBe('/app');
    expect(savedScroll()).toBeNull(); // the new entry starts fresh
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(lastNav()).toBe('pop');
    history.replaceState({ scrollY: 99 }, '');
    expect(savedScroll()).toBe(99);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    history.replaceState(null, '', '/');
  });
});
