// Sources an agent searched or read (biz-bot parity: the "Sources" box under a message). Links open in a new tab and
// never carry the app's referrer; the first few show, the rest behind "+N more".
import { useState } from 'preact/hooks';

export interface SourceLink {
  url: string;
  title?: string;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function Sources({ sources, max = 3, label = 'Sources' }: { sources: readonly SourceLink[] | undefined; max?: number; label?: string }) {
  const [all, setAll] = useState(false);
  const list = (sources ?? []).filter((s) => /^https?:\/\//i.test(s.url));
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, max);
  return (
    <div class="sources">
      <p class="sources-label">{label}</p>
      <ol class="sources-list">
        {shown.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title || hostOf(s.url)}
            </a>
            {s.title && <span class="sources-host"> · {hostOf(s.url)}</span>}
          </li>
        ))}
      </ol>
      {list.length > max && (
        <button type="button" class="sources-more" onClick={() => setAll(!all)}>
          {all ? 'Fewer' : `+${list.length - max} more`}
        </button>
      )}
    </div>
  );
}
