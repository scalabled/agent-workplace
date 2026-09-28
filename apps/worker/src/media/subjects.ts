// Catalog lookups for media: whose portrait, whose voice. Reads the catalog only through @headcount/catalog.
import { leadVoiceRef, personaVoiceRef } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { VoiceRef } from '@headcount/protocol';
import { HttpError } from '../lib/http';

export interface PortraitSubject {
  id: string;
  kind: 'lead' | 'persona';
  name: string;
  portraitPrompt: string;
}

/** Catalog ids are lowercase slugs (`lead-warm-mentor`, `chief-strategist`); anything else never reaches R2 or D1. */
const SUBJECT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function subjectIdParam(raw: string | undefined): string {
  const id = (raw ?? '').trim();
  if (!SUBJECT_ID.test(id)) throw new HttpError('bad_request', 'Use a catalog coworker or lead id, for example lead-warm-mentor.');
  return id;
}

/** A lead (`lead-…`) or catalog persona, or null when the catalog has no such id. */
export function findSubject(id: string): PortraitSubject | null {
  const lead = fullIndex.lead(id);
  if (lead) return { id, kind: 'lead', name: lead.name, portraitPrompt: lead.avatar?.portrait_prompt ?? '' };
  const persona = fullIndex.persona(id);
  if (persona) return { id, kind: 'persona', name: persona.name, portraitPrompt: persona.avatar?.portrait_prompt ?? '' };
  return null;
}

/**
 * The catalog voice for a speaker agent id (`cw_<personaId>` or `cw_<leadId>`), used when a TTS request
 * arrives without provider voice ids. The Chief of Staff (`cw_chief`) always sends its lead's voiceRef.
 */
export function catalogVoiceFor(speakerId: string): VoiceRef | null {
  const id = speakerId.startsWith('cw_') ? speakerId.slice(3) : speakerId;
  if (!SUBJECT_ID.test(id)) return null;
  try {
    const lead = fullIndex.lead(id);
    if (lead?.voice) return leadVoiceRef(lead);
    const persona = fullIndex.persona(id);
    if (persona?.voice) return personaVoiceRef(persona);
  } catch {
    // A half-edited catalog record (the catalog is finalised concurrently): no catalog voice.
  }
  return null;
}
