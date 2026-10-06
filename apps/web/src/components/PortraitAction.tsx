// A quiet "Generate portrait" for someone with none yet (a Chief of Staff in onboarding, a coworker on their profile),
// offered only when an image provider is set up.
import { firstName } from '@headcount/catalog';
import { useEffect, useState } from 'preact/hooks';
import { generatePortrait, painting } from '../lib/generate';
import { portraitEpoch, portraitFor } from '../lib/portraits';
import { can } from '../store';
import { isPlatform } from '../auth/session';

export function PortraitAction({ id, name, class: cls = 'stage-paint' }: { id: string; name: string; class?: string }) {
  const [hasPortrait, setHasPortrait] = useState<boolean | null>(null);
  const epoch = portraitEpoch.value;
  useEffect(() => {
    let alive = true;
    setHasPortrait(null);
    void portraitFor(id).then((p) => alive && setHasPortrait(!!p));
    return () => {
      alive = false;
    };
  }, [id, epoch]);
  const state = painting.value[id];
  // Portraits are shared by every organization: the deployment's owners make them.
  if (!can('image') || !isPlatform.value || hasPortrait !== false) return null;
  if (state?.status === 'painting')
    return (
      <p class={cls} role="status">
        Painting {firstName(name)}…
      </p>
    );
  return (
    <div class={cls}>
      <button type="button" class="link-button" onClick={() => void generatePortrait(id)}>
        Generate portrait
      </button>
      {state?.status === 'failed' && <p class={`${cls}-error`}>{state.message}</p>}
    </div>
  );
}
