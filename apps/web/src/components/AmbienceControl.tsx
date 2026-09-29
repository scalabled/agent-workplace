// Ambience (LIVING-WORKFORCE §9.1): one small control in the Floor header. Quiet keeps the replies and turns the
// rest of the chatter into faces; Lively (the default) says hello and gives short updates softly; Buzzing shortens
// the gaps between hellos (side-talk between coworkers arrives with teams, Inc 1). The same three choices are in ⌘K.
// During quiet hours (22:00–07:00) the chip says so, and "Lively anyway" lifts them for the rest of the night.
import { useEffect, useRef, useState } from 'preact/hooks';
import { AMBIENCES, ambienceOf, type Ambience } from '@headcount/protocol/ext/expressions';
import { livelyAnyway, quietHoursNow, quietUntilLabel, setLivelyAnyway } from '../living/quiet';
import { settings } from '../store';
import { setAmbience } from '../talk/actions';
import { Icon } from './Icon';

export const AMBIENCE_LABEL: Record<Ambience, string> = { quiet: 'Quiet', lively: 'Lively', buzzing: 'Buzzing' };
export const AMBIENCE_LINE: Record<Ambience, string> = {
  quiet: 'Faces only. Replies still speak.',
  lively: 'Hellos and short updates, softly.',
  buzzing: 'Shorter gaps between hellos.',
};
/** In the Office, Ambience is the floor's energy: walkers, huddles and small talk as well as hellos (D3). */
export const AMBIENCE_OFFICE_LINE: Record<Ambience, string> = {
  quiet: 'A calm floor, no small talk.',
  lively: 'People wander and chat now and then.',
  buzzing: 'A busy floor, more chatter.',
};

export function AmbienceControl({ office = false }: { office?: boolean } = {}) {
  const lines = office ? AMBIENCE_OFFICE_LINE : AMBIENCE_LINE;
  const current = ambienceOf(settings.value);
  // Quiet hours matter only when the setting is not Quiet already.
  const quietHours = quietHoursNow.value && !livelyAnyway.value && current !== 'quiet';
  const lively = quietHoursNow.value && livelyAnyway.value && current !== 'quiet';
  const until = quietUntilLabel();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  /** The next change comes from a pointer (it chooses and closes); arrow keys only choose. */
  const byPointer = useRef(false);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside, true);
    // Focus the chosen option so arrow keys move between the three at once.
    root.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div class="ambience" ref={root}>
      <button
        ref={button}
        type="button"
        class="ambience-button"
        data-testid="ambience-control"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Ambience: ${AMBIENCE_LABEL[current]}${quietHours ? `, quiet hours until ${until}` : ''}`}
        title="How much the office chatters"
        data-quiet-hours={quietHours || undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="ambience" size={16} />
        <span>{quietHours ? 'Quiet hours' : AMBIENCE_LABEL[current]}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div
          class="ambience-pop"
          role="dialog"
          aria-label="Ambience"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // the app's Esc (stop, leave the page) is not meant here
              close();
            }
          }}
        >
          <fieldset class="ambience-set">
            <legend class="ambience-legend">Ambience</legend>
            {AMBIENCES.map((a) => (
              <label key={a} class="ambience-option" data-checked={a === current || undefined} onPointerDown={() => (byPointer.current = true)}>
                <input
                  type="radio"
                  name="ambience"
                  value={a}
                  checked={a === current}
                  aria-label={AMBIENCE_LABEL[a]}
                  aria-describedby={`ambience-line-${a}`}
                  onChange={() => {
                    void setAmbience(a);
                    if (byPointer.current) close();
                    byPointer.current = false;
                  }}
                  onClick={() => {
                    // Choosing the current one again with the pointer just closes.
                    if (byPointer.current && a === current) close();
                  }}
                />
                <span class="ambience-name" aria-hidden="true">
                  {AMBIENCE_LABEL[a]}
                </span>
                <span class="ambience-line" id={`ambience-line-${a}`}>
                  {lines[a]}
                </span>
              </label>
            ))}
          </fieldset>
          {(quietHours || lively) && (
            <div class="ambience-quiet" data-testid="ambience-quiet-hours">
              <p class="ambience-quiet-line">
                {quietHours
                  ? `Quiet hours until ${until}: desks answer your hover with a bubble, not a voice.`
                  : `Lively until ${until}, quiet hours or not.`}
              </p>
              <button type="button" class="ambience-quiet-toggle" onClick={() => setLivelyAnyway(quietHours)}>
                {quietHours ? 'Lively anyway' : 'Back to quiet hours'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
