// The one-line confirmation at the bottom of the screen ("Link to this message copied").
import { toast } from './links';

export function Toast() {
  const t = toast.value;
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {t && (
        <p key={t.id} class="toast">
          {t.text}
        </p>
      )}
    </div>
  );
}
