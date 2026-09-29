// One voice per workspace: in a tab without the voice (while voice is on), one small, calm chip says where the voice
// is and takes it on a click ("Speaking on another tab · Play here"). Any other real gesture in this tab takes it
// too, so the chip is only ever seen in a tab the owner has not touched since the voice moved.
import { settings } from '../store';
import { armAudio } from '../voice/engine';
import { takeVoice } from '../voice/handoff';
import { voiceElsewhere } from '../voice/owner';
import { Icon } from './Icon';

export function VoiceElsewhere() {
  if (!settings.value?.voiceOn || !voiceElsewhere.value) return null;
  return (
    <button
      type="button"
      class="voice-elsewhere"
      data-testid="voice-elsewhere"
      aria-label="Speaking on another tab. Play here."
      title="Voice plays in one tab at a time"
      onClick={() => {
        armAudio();
        takeVoice();
      }}
    >
      <Icon name="voiceOff" size={14} />
      <span class="voice-elsewhere-where">Speaking on another tab</span>
      <span class="voice-elsewhere-sep" aria-hidden="true">
        ·
      </span>
      <span class="voice-elsewhere-action">Play here</span>
    </button>
  );
}
