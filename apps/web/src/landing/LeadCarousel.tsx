// Meet your Chief of Staff: the catalog's leads (names, faces, taglines and backstory teasers from the catalog
// bundle, never hard-coded) in a scroll-snap carousel. ▶ plays each lead's own voice: a pre-voiced sample when
// one ships with the page (no key, no TTS spend), else the TTS route when a provider is configured; with neither
// the control is absent (a browser voice is not their voice).
import { useEffect, useRef, useState } from 'preact/hooks';
import { leads, voicePreview, voiceSamples, type LandingLead } from 'virtual:headcount-landing';
import { nightAccent } from '../lib/accent';
import type { FaceView } from './face-engine';
import { LpFace } from './LpFace';
import { LpIcon } from './LpIcon';
import { reducedMotion } from './motion';

/** What a lead says in their sample (the same words the pre-voiced files carry). */
export function sampleText(first: string, preview: string | null): string {
  const intro = `Hi, I'm ${first}.`;
  if (!preview) return intro;
  return `${intro} ${preview.replace(/^Hi,\s*/i, '').replace(/^./, (c) => c.toUpperCase())}`;
}

function LeadCard({ lead, canHear, index, total }: { lead: LandingLead; canHear: boolean; index: number; total: number }) {
  const view = useRef<FaceView | null>(null);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopRef.current?.();
    },
    [],
  );

  const toggle = async () => {
    if (playing) {
      stopRef.current?.();
      return;
    }
    setPlaying(true);
    try {
      const { playSample } = await import('./voice');
      const handle = playSample({
        speakerId: `landing:${lead.id}`,
        text: sampleText(lead.first, voicePreview),
        voiceRef: lead.voice,
        sample: voiceSamples[lead.id] ?? null,
        onSpeaking: (on) => view.current?.setState(on ? 'speaking' : 'idle'),
        onEnd: () => {
          view.current?.attachSampler(null);
          stopRef.current = null;
          setPlaying(false);
        },
      });
      view.current?.attachSampler(handle.sampler);
      stopRef.current = handle.stop;
    } catch {
      setPlaying(false);
    }
  };

  return (
    <article class="lp-lead" data-lead={lead.id} style={{ '--accent': nightAccent(lead.accent) }} aria-roledescription="slide" aria-label={`${index + 1} of ${total}: ${lead.name}`}>
      <div class="lp-lead-face-wrap">
        <LpFace subject={lead} tier="tile" chrome label={`${lead.name}, ${lead.archetype}`} class="lp-lead-face" onView={(v) => (view.current = v)} />
        {canHear && (
          <button type="button" class="lp-voice" data-playing={playing || undefined} onClick={() => void toggle()} aria-label={playing ? `Stop ${lead.first}'s voice sample` : `Hear ${lead.first}'s voice`}>
            <LpIcon name={playing ? 'pause' : 'play'} size={14} />
            <span>{playing ? 'Stop' : `Hear ${lead.first}`}</span>
          </button>
        )}
      </div>
      <div class="lp-lead-body">
        <p class="lp-lead-arch">{lead.archetype}</p>
        <h3 class="lp-lead-name">{lead.name}</h3>
        <p class="lp-lead-tagline">{lead.tagline}</p>
        <p class="lp-lead-story">{lead.teaser}</p>
        {lead.bestFor.length > 0 && (
          <div class="lp-lead-fit">
            <p class="lp-lead-fit-h">Best for owners who</p>
            <ul>
              {lead.bestFor.map((b) => (
                <li key={b}>{b.replace(/^[A-Z]/, (ch) => ch.toLowerCase())}</li>
              ))}
            </ul>
          </div>
        )}
        <p class="lp-lead-honesty">{lead.first} is an AI coworker. The backstory is character lore, not real events.</p>
      </div>
    </article>
  );
}

export function LeadCarousel({ canHear }: { canHear: (leadId: string) => boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>('.lp-lead');
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0;
    el.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div class="lp-carousel" role="region" aria-roledescription="carousel" aria-label="Chiefs of Staff" data-at-start={edge.start || undefined} data-at-end={edge.end || undefined}>
      <div class="lp-track" ref={track} tabIndex={0}>
        {leads.map((l, i) => (
          <LeadCard key={l.id} lead={l} canHear={canHear(l.id)} index={i} total={leads.length} />
        ))}
      </div>
      <div class="lp-carousel-controls">
        <button type="button" class="lp-round" aria-label="Previous Chief of Staff" disabled={edge.start} onClick={() => step(-1)}>
          <LpIcon name="chevronLeft" />
        </button>
        <button type="button" class="lp-round" aria-label="Next Chief of Staff" disabled={edge.end} onClick={() => step(1)}>
          <LpIcon name="chevronRight" />
        </button>
      </div>
    </div>
  );
}
