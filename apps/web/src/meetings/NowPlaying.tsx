// The now-playing bar (Inc 2): the meeting the owner is listening to, wherever they are in the app. Who is speaking
// (their face moves with their voice), the line as a caption, where it is in the meeting, and pause, next line, stop.
import { CHIEF_ID } from '@headcount/protocol';
import { catalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { plainText } from '../lib/markdown';
import { navigate, paths } from '../router';
import { audio } from '../voice/engine';
import { takeVoice } from '../voice/handoff';
import { voiceElsewhere } from '../voice/owner';
import { listen, nowPlaying, pauseListening, resumeListening, skipLine, stopListening } from './listen';

const KIND: Record<string, string> = { kickoff: 'Kickoff', review: 'Review meeting', discussion: 'Team meeting' };

export function NowPlaying() {
  const np = nowPlaying.value;
  if (!np) return null;
  const who = np.line?.agentId;
  const persona = who && who.startsWith('cw_') ? catalog.value?.persona(who.slice(3)) : undefined;
  const lead = currentLead.value;
  const subject = who === CHIEF_ID && lead ? leadSubject(lead, chiefName.value) : persona ? personaSubject(persona) : null;
  const status = np.finished ? 'Finished' : np.paused ? 'Paused' : np.live ? 'Live' : 'Replay';
  return (
    <aside class="now-playing" aria-label="Now playing" data-live={np.live || undefined}>
      <div class="np-face" aria-hidden="true">
        {subject ? <Face subject={subject} tier="token" state={np.line?.voiced ? 'speaking' : 'idle'} sampler={who ? audio().sampler(who) : null} decorative /> : <Icon name="headphones" size={22} />}
      </div>
      <div class="np-main">
        <p class="np-title">
          <span class="np-status" data-status={status.toLowerCase()}>
            {status}
          </span>
          <button type="button" class="link-button np-link" onClick={() => navigate(paths.project(np.projectId))}>
            {KIND[np.kind] ?? 'Meeting'}
            {np.title ? ` · ${np.title}` : ''}
          </button>
          <span class="np-pos tabular">
            {np.total ? `${np.position} / ${np.total}` : ''}
          </span>
        </p>
        <p class="np-caption" aria-live="polite">
          {np.line ? (
            <>
              <strong>{np.line.name}:</strong> {plainText(np.line.text)}
            </>
          ) : np.finished ? (
            'That was the whole meeting.'
          ) : np.live ? (
            'Waiting for the next speaker…'
          ) : (
            '…'
          )}
        </p>
        {np.textOnly && !np.finished && (
          <p class="np-note">
            {voiceElsewhere.value ? (
              <>
                Voice is on another tab.{' '}
                <button type="button" class="link-button" onClick={() => {
                  takeVoice();
                  resumeListening();
                }}>
                  Play here
                </button>
              </>
            ) : (
              'Reading along: no voice is set up here.'
            )}
          </p>
        )}
      </div>
      <div class="np-controls">
        {np.paused || np.finished ? (
          <button type="button" class="icon-button" aria-label={np.finished ? 'Play again from the start' : 'Resume'} onClick={() => (np.finished ? void listen(np.projectId, np.meetingId, { from: 'start', title: np.title }).catch(() => undefined) : resumeListening())}>
            <Icon name="play" size={18} />
          </button>
        ) : (
          <button type="button" class="icon-button" aria-label="Pause" onClick={pauseListening}>
            <Icon name="pause" size={18} />
          </button>
        )}
        {!np.finished && (
          <button type="button" class="icon-button" aria-label="Next line" disabled={np.position >= np.total} onClick={skipLine}>
            <Icon name="skip" size={18} />
          </button>
        )}
        <button type="button" class="icon-button" aria-label="Stop listening" onClick={stopListening}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </aside>
  );
}
