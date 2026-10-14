// The routed page's safety net. A render error shows a recovery view inside the shell, so the places and the Chief of
// Staff stay usable. A move to another address clears the error and tries the new page.
import { Component, type ComponentChildren } from 'preact';
import { paths, route } from '../router';
import { Icon } from './Icon';
import { Link } from './Link';

type Props = { resetKey: string; children?: ComponentChildren };

export class PageBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static override getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('page failed to render:', error);
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  override render() {
    return this.state.failed ? <PageFailed /> : this.props.children;
  }
}

/** What the owner sees in place of a page that failed to render. */
export function PageFailed() {
  const onTalk = route.value.name === 'talk';
  return (
    <section class="page" aria-labelledby="page-failed-title">
      <div class="empty" role="alert">
        <Icon name="retry" size={28} class="empty-icon" />
        <h1 id="page-failed-title" class="empty-title">
          This page stopped working
        </h1>
        <p class="empty-text">An error stopped this page from showing. Reload the page to try again.{onTalk ? '' : ' You can also go to Talk.'}</p>
        <div class="empty-actions">
          <button type="button" class="button-primary" onClick={() => location.reload()}>
            Reload the page
          </button>
          {!onTalk && (
            <Link href={paths.talk} class="button-quiet">
              Go to Talk
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/** An address with no page: say so and offer a way back. */
export function NotFound() {
  return (
    <section class="page" aria-labelledby="nf-title">
      <div class="empty">
        <Icon name="search" size={28} class="empty-icon" />
        <h1 id="nf-title" class="empty-title">
          Page not found
        </h1>
        <p class="empty-text">Nothing is at this address. Check the link, or go to Talk.</p>
        <div class="empty-actions">
          <Link href={paths.talk} class="button-primary">
            Go to Talk
          </Link>
        </div>
      </div>
    </section>
  );
}
