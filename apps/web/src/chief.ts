// The owner's Chief of Staff as the UI sees it: the chosen catalog lead plus the owner's name for them.
import { computed } from '@preact/signals';
import { chiefDisplayName, leadVoiceRef, type Lead, type Pronouns } from '@headcount/catalog';
import type { BrowserVoiceHint } from '@headcount/audio';
import type { VoiceRef } from '@headcount/protocol';
import { catalog } from './catalog';
import { settings } from './store';

export const currentLead = computed<Lead | undefined>(() => {
  const id = settings.value?.leadId;
  return id ? catalog.value?.lead(id) : undefined;
});

/** "Dominic", or the owner's chosen name. */
export const chiefName = computed(() => chiefDisplayName(currentLead.value, settings.value?.chiefName));

export const chiefVoiceRef = computed<VoiceRef | null>(() => (currentLead.value ? leadVoiceRef(currentLead.value) : null));

/** Browser speechSynthesis hint when no TTS provider is configured (never the lead's real voice). */
export function browserVoiceHint(pronouns: Pronouns | undefined, speed: number | undefined): BrowserVoiceHint {
  const presentation = pronouns === 'she/her' ? 'feminine' : pronouns === 'he/him' ? 'masculine' : 'neutral';
  return { lang: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US', rate: speed ?? 1, presentation };
}

export const chiefVoiceHint = computed(() => browserVoiceHint(currentLead.value?.pronouns, currentLead.value?.voice.speed));
