// Types for `virtual:headcount-landing` (apps/web/landing-data.ts): the landing page's slice of the catalog
// bundle and the marketing image manifest, generated at build/dev time.
declare module 'virtual:headcount-landing' {
  import type { Appearance } from '@headcount/catalog';
  import type { Alignment, VoiceRef } from '@headcount/protocol';

  export interface LandingLead {
    id: string;
    name: string;
    first: string;
    pronouns: string;
    /** Catalog age range, e.g. "35-39" (the landing leads with the younger half of the cast). */
    age: string;
    archetype: string;
    tagline: string;
    /** The backstory's first sentences (character lore). */
    teaser: string;
    bestFor: string[];
    accent: string;
    appearance: Appearance;
    voice: VoiceRef;
  }

  export interface LandingCoworker {
    id: string;
    name: string;
    first: string;
    pronouns: string;
    age: string;
    title: string;
    department: string;
    accent: string;
    appearance: Appearance;
  }

  export interface MarketingImage {
    key: string;
    file: string;
    fallback?: string;
    alt: string;
    aspect: string;
    width: number;
    height: number;
    bytes?: number;
    /** Smaller WebP widths for srcset (the last is `file` at `width`). */
    srcset?: { width: number; file: string }[];
    provider?: string;
    model?: string;
  }

  export const leads: LandingLead[];
  export const coworkers: LandingCoworker[];
  export const counts: { leads: number; coworkers: number; departments: number };
  /** The match quiz's "try before choosing" line, spoken by each lead in their own voice. */
  export const voicePreview: string | null;
  export const images: Record<string, MarketingImage>;

  /** One pre-voiced sentence: static audio (public/marketing/voices); its lip-sync timing is in that folder's manifest.json. */
  export interface VoiceSampleChunk {
    file: string;
    mime: string;
    text: string;
    alignment?: Alignment | null;
  }
  export interface VoiceSample {
    text: string;
    provider: string;
    voice: string;
    chunks: VoiceSampleChunk[];
  }
  /** Pre-voiced samples by lead id: "Hear …" plays these without a key and without spending the TTS budget. */
  export const voiceSamples: Record<string, VoiceSample>;
}
