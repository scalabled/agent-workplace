import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchPath, navigate, paths } from '../router';
import { NotFound, PageBoundary } from './PageBoundary';

let host: HTMLElement;
const mount = (vnode: preact.ComponentChild) => act(() => void render(vnode, host));

function Broken(): never {
  throw new Error('render failed');
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
});

describe('PageBoundary', () => {
  it('shows the recovery view in place of a page that throws, and logs the error', async () => {
    navigate(paths.projects);
    await mount(
      <PageBoundary resetKey="/a">
        <Broken />
      </PageBoundary>,
    );
    expect(host.querySelector('[role="alert"] h1')?.textContent).toBe('This page stopped working');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Reload the page');
    const back = host.querySelector<HTMLAnchorElement>('a[href="/app/talk"]');
    expect(back?.textContent).toBe('Go to Talk');
    expect(console.error).toHaveBeenCalledWith('page failed to render:', expect.objectContaining({ message: 'render failed' }));
  });

  it('reloads the page from the Reload button', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    try {
      await mount(
        <PageBoundary resetKey="/a">
          <Broken />
        </PageBoundary>,
      );
      await act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reload the page')!.click());
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves out the link to Talk when Talk itself failed', async () => {
    navigate(paths.talk);
    await mount(
      <PageBoundary resetKey="/app/talk">
        <Broken />
      </PageBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('a[href="/app/talk"]')).toBeNull();
  });

  it('tries the page again once the address changes', async () => {
    let fail = true;
    const Page = () => {
      if (fail) throw new Error('render failed');
      return <p class="ok">Page</p>;
    };
    await mount(
      <PageBoundary resetKey="/a">
        <Page />
      </PageBoundary>,
    );
    expect(host.querySelector('.ok')).toBeNull();
    fail = false;
    await mount(
      <PageBoundary resetKey="/b">
        <Page />
      </PageBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('.ok')?.textContent).toBe('Page');
  });

  it('renders its page untouched when nothing fails', async () => {
    await mount(
      <PageBoundary resetKey="/a">
        <p class="ok">Page</p>
      </PageBoundary>,
    );
    expect(host.innerHTML).toBe('<p class="ok">Page</p>');
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('NotFound', () => {
  it('is what an unknown app address shows, with a way back to Talk', async () => {
    expect(matchPath('/app/no-such-place').name).toBe('notFound');
    await mount(<NotFound />);
    expect(host.querySelector('h1')?.textContent).toBe('Page not found');
    const back = host.querySelector<HTMLAnchorElement>('a[href="/app/talk"]');
    expect(back?.textContent).toBe('Go to Talk');
    navigate('/app/no-such-place');
    await act(() => back!.click());
    expect(location.pathname).toBe('/app/talk');
  });
});
