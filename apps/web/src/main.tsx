// Entry: a tiny shell (router, theme, tokens) that lazy-loads either the public landing page ("/") or the app
// ("/app/…"). The landing never downloads the app, its socket, audio engine or catalog until someone walks in.
import { render, type ComponentType } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AuthGate } from './auth/AuthGate';
import { loadApp, loadLanding, type Loader } from './lazy';
import { forcedThemeFor, forceTheme, initTheme } from './lib/theme';
import { lastNav, route, savedScroll } from './router';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

const loaded = new Map<Loader, ComponentType>();

function Lazy({ load }: { load: Loader }) {
  const [Component, setComponent] = useState<ComponentType | undefined>(() => loaded.get(load));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Component) return;
    let alive = true;
    load()
      .then((c) => {
        loaded.set(load, c);
        if (alive) setComponent(() => c);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [load]);
  if (failed)
    return (
      <p class="boot-error" role="alert">
        Headcount could not load. Check your connection and <a href={location.pathname}>reload the page</a>.
      </p>
    );
  return Component ? <Component /> : <div class="boot" aria-busy="true" />;
}

function Root() {
  const name = route.value.name;
  const landing = name === 'landing';
  // The route's theme is pinned before this render paints (the landing is dark even for owners who chose light).
  forceTheme(forcedThemeFor(name));
  const first = useRef(true);
  // A new page starts at the top (navigate() scrolls before the page renders, so Talk can still follow its thread to
  // the end); Back and Forward return to where the owner was, between app pages too. The first render leaves the
  // browser's own position alone (a reload, or a #section link).
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (lastNav() === 'pop') {
      const y = savedScroll();
      if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
      return;
    }
    if (lastNav() === 'push') window.scrollTo(0, 0);
  }, [landing]);
  useLayoutEffect(() => {
    if (lastNav() !== 'pop' || landing) return;
    const y = savedScroll();
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [name]);
  // The app loads only once the owner may be here (signed in, or sign-in off on localhost); the landing is public.
  return landing ? (
    <Lazy key="landing" load={loadLanding} />
  ) : (
    <AuthGate>
      <Lazy key="app" load={loadApp} />
    </AuthGate>
  );
}

initTheme(forcedThemeFor(route.value.name));
render(<Root />, document.getElementById('app')!);
