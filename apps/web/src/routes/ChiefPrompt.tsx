// The Chief of Staff's prompt as the next turn will send it (the live work state included) and their tools — the
// same transparency the owner has for every coworker.
import type { PromptView } from '@headcount/protocol/ext/agents';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { PromptViewer } from '../agents/PromptViewer';
import { chiefName } from '../chief';
import { Link } from '../components/Link';
import { paths } from '../router';
import { PageTitle } from '../links/CopyLink';
import './pages.css';

export function ChiefPrompt() {
  const [view, setView] = useState<PromptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .chiefPrompt()
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the prompt. Reload the page to try again.'));
  }, []);
  const name = chiefName.value;
  return (
    <section class="page chief-prompt" aria-labelledby="chief-title">
      <p class="page-crumb">
        <Link href={paths.talk}>Talk</Link>
      </p>
      <header class="page-head">
        <PageTitle id="chief-title">How {name} works</PageTitle>
        <p class="page-lede">The exact instructions {name} answers from in Talk, and the tools {name} can use. The live work state is read fresh at the start of every reply.</p>
      </header>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!view && !error && <p class="page-fine">Loading…</p>}
      {view && <PromptViewer views={[view]} />}
    </section>
  );
}
