// While the owner holds to talk: a live caption beside the bubble (text is always available, X11). It names who
// hears it: the Chief of Staff, or the people of a joined huddle ("Kate and Pax").
import { chiefName } from '../chief';
import { ptt, pttPressTarget } from '../voice/ptt';

export function PttCaption() {
  const { phase, partial, level } = ptt.value;
  if (phase === 'idle') return null;
  const target = pttPressTarget.value;
  const to = target?.kind === 'room' ? target.label : chiefName.value;
  const heading = phase === 'transcribing' ? 'Sending…' : phase === 'starting' ? 'Opening the mic…' : `Listening. Release to send to ${to}.`;
  return (
    <div class="ptt-caption" role="status" aria-live="polite">
      <span class="ptt-dot" aria-hidden="true" style={{ '--level': String(Math.min(1, level * 3)) }} />
      <span class="ptt-text">
        <span class="ptt-heading">{heading}</span>
        {partial && <span class="ptt-partial">{partial}</span>}
      </span>
    </div>
  );
}
