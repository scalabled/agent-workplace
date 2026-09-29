import { useEffect, useState } from 'preact/hooks';
import { CHIEF_ID } from '@headcount/protocol';
import { chiefName, currentLead } from '../chief';
import { navigate, paths, route } from '../router';
import { activeJobs, chiefPresence, onboarded } from '../store';
import { news, unread } from '../ui/unread';
import { bargeIn, chiefIsSpeaking, chiefSpeaker } from '../voice/chief-voice';
import { ptt, pttMode } from '../voice/ptt';
import { Face, leadSubject, stateWords } from './Face';
import { useHoldToTalk } from './useHoldToTalk';
import { accentFor } from '../lib/accent';

const PULSE_MS = 2400;
/** Scrolled this far down past the last turn-around before the bubble tucks away (phones only). */
const TUCK_AFTER_PX = 48;

/**
 * Phones: tuck the bubble away while the owner scrolls down to read, show it again on any scroll up, near the
 * end of the page, or after a route change. Wider screens keep it in place (it sits in the margin there).
 */
function useTuckOnScroll(): boolean {
  const [tucked, setTucked] = useState(false);
  const path = route.value.path;
  useEffect(() => setTucked(false), [path]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const phone = matchMedia('(max-width: 767px)');
    let anchor = window.scrollY;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (!phone.matches) return setTucked(false);
      const doc = document.scrollingElement ?? document.documentElement;
      const atEnd = y + window.innerHeight >= doc.scrollHeight - 24;
      if (y < last || atEnd || y < TUCK_AFTER_PX) {
        anchor = y;
        setTucked(false);
      } else if (y - anchor > TUCK_AFTER_PX) setTucked(true);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return tucked;
}

/**
 * The Chief of Staff bubble on every screen but Talk (EXPERIENCE §2.2): the face is the status (its ring shows
 * presence). Background work shows as a lamp arc and a count while they stay available (D2); news that arrived
 * while you were elsewhere shows as a count and one pulse. Tap → Talk. Hold (pointer or Space) → push-to-talk.
 * On Talk the header face takes over these gestures, so nothing covers the thread.
 */
export function ChiefBubble() {
  const lead = currentLead.value;
  const name = chiefName.value;
  const shown = chiefPresence.value;
  const phase = ptt.value.phase;
  const jobs = activeJobs.value.length;
  const fresh = unread.value;
  const canHold = onboarded.value && pttMode() !== null;
  const listening = phase === 'starting' || phase === 'listening';
  const [pulse, setPulse] = useState(false);
  const bump = news.value;
  useEffect(() => {
    if (!bump) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), PULSE_MS);
    return () => clearTimeout(t);
  }, [bump]);
  const tucked = useTuckOnScroll();
  const handlers = useHoldToTalk({
    canHold,
    onTap: () => {
      if (!onboarded.value) return navigate(paths.onboarding);
      if (route.value.name === 'talk' && chiefIsSpeaking()) return bargeIn();
      navigate(paths.talk);
    },
  });

  const parts = [`Talk to ${name}`];
  if (shown.state !== 'idle') parts.push(`(${stateWords(shown.state)})`);
  const extras = [fresh ? `${fresh} new message${fresh === 1 ? '' : 's'}` : '', jobs ? `${jobs} job${jobs === 1 ? '' : 's'} running` : ''].filter(Boolean);
  const label = `${parts.join(' ')}${extras.length ? `, ${extras.join(', ')}` : ''}${canHold ? '. Hold to speak.' : ''}`;

  return (
    <button
      type="button"
      class="chief-bubble"
      data-state={shown.state}
      data-listening={listening || undefined}
      data-jobs={jobs || undefined}
      data-pulse={pulse || undefined}
      data-tucked={tucked || undefined}
      style={lead ? { '--accent': accentFor(lead.avatar.accent_color) } : undefined}
      aria-label={label}
      title={canHold ? `Tap to talk to ${name}. Hold to speak.` : `Talk to ${name}`}
      {...handlers}
    >
      {lead ? <Face subject={leadSubject(lead, name)} tier="tile" state={shown.state} sampler={chiefSpeaker.mouth} agentId={CHIEF_ID} decorative /> : <span class="chief-bubble-empty" aria-hidden="true" />}
      {fresh > 0 ? (
        <span class="bubble-badge tabular" data-kind="unread" aria-hidden="true">
          {fresh}
        </span>
      ) : jobs > 0 ? (
        <span class="bubble-badge tabular" data-kind="jobs" aria-hidden="true">
          {jobs}
        </span>
      ) : null}
    </button>
  );
}
