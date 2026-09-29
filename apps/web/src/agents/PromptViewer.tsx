// The exact system prompt a surface sends, in labelled sections (where each sentence comes from: the catalog, your
// instructions, skills, tools, the platform, live state), with the tools that surface offers and their schemas.
import type { PromptSection, PromptView } from '@headcount/protocol/ext/agents';
import { useState } from 'preact/hooks';

const ORIGIN: Record<PromptSection['origin'], string> = {
  platform: 'Platform',
  persona: 'Catalog',
  owner: 'Your words',
  skills: 'Skills',
  tools: 'Tools',
  project: 'Project',
  state: 'Live state',
};

export function PromptViewer({ views }: { views: readonly PromptView[] }) {
  const [surface, setSurface] = useState(views[0]?.surface);
  const [copied, setCopied] = useState(false);
  const view = views.find((v) => v.surface === surface) ?? views[0];
  if (!view) return null;
  return (
    <div class="prompt-viewer">
      {views.length > 1 && (
        <div class="segmented" role="tablist" aria-label="Where the prompt is used">
          {views.map((v) => (
            <button key={v.surface} type="button" role="tab" aria-selected={v.surface === view.surface} class="segmented-item" onClick={() => setSurface(v.surface)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <p class="prompt-when">
        {view.when}{' '}
        <button
          type="button"
          class="link-button"
          onClick={() => {
            void navigator.clipboard?.writeText(view.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy the whole prompt'}
        </button>
      </p>
      <ol class="prompt-sections">
        {view.sections.map((s) => (
          <li key={s.id} class="prompt-section" data-origin={s.origin}>
            <p class="prompt-section-head">
              <span class="prompt-section-title">{s.title}</span>
              <span class="prompt-origin">{ORIGIN[s.origin]}</span>
            </p>
            <pre class="prompt-text">{s.text}</pre>
          </li>
        ))}
      </ol>
      {view.tools.length > 0 && (
        <>
          <h3 class="profile-sub">Tools on this surface</h3>
          <ul class="tool-list">
            {view.tools.map((t) => (
              <li key={t.name} class="tool-item">
                <details>
                  <summary>
                    <code>{t.name}</code>
                    {t.kind === 'hosted' && <span class="prompt-origin">Provider</span>} <span class="tool-desc">{t.description}</span>
                  </summary>
                  {t.parameters !== undefined && <pre class="prompt-text">{JSON.stringify(t.parameters, null, 2)}</pre>}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
