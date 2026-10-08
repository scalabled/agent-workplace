import { paths } from '../router';
import { activeJobs, liveMeetings, projectList, raisedHands } from '../store';
import { unread } from '../ui/unread';
import { openPalette } from './Palette';
import { Icon, type IconName } from './Icon';
import { Link } from './Link';
import { OfficeSwitcher } from './OfficeSwitcher';

const PLACES: { href: string; label: string; icon: IconName; prefix?: boolean; wideOnly?: boolean }[] = [
  { href: paths.talk, label: 'Talk', icon: 'talk' },
  { href: paths.now, label: 'Now', icon: 'activity' },
  { href: paths.floor, label: 'Floor', icon: 'floor', prefix: true },
  { href: paths.meetings, label: 'Meetings', icon: 'meetings', prefix: true },
  { href: paths.projects, label: 'Projects', icon: 'projects', prefix: true },
  { href: paths.files, label: 'Files', icon: 'file', prefix: true },
  { href: paths.inbox, label: 'Inbox', icon: 'inbox', prefix: true, wideOnly: true },
];

/**
 * The places (D3): Talk · Now · Floor · Meetings · Projects · Files · Inbox. Everything else via ⌘K, which on phones
 * (no keyboard) is the last tab, More (EXPERIENCE §2.2): switch Chief of Staff, theme, voice, any coworker.
 * Talk shows how many Chief of Staff messages arrived while you were elsewhere; Meetings, when one is live; Now, when
 * the team is at work. Phones have room for seven tabs: there the Inbox is reached from Now (its first section) and
 * More, and Now carries the Inbox's count.
 */
export function Nav() {
  const hands = raisedHands.value;
  const running = activeJobs.value.length + projectList.value.filter((p) => p.status === 'running').length;
  const fresh = unread.value;
  const meeting = liveMeetings.value.length;
  return (
    <nav class="nav" aria-label="Places">
      <OfficeSwitcher />
      {PLACES.map((p) => (
        <Link key={p.href} href={p.href} matchPrefix={p.prefix} class={p.wideOnly ? 'nav-link nav-link-wide' : 'nav-link'} aria-label={navLabel(p.label, hands, fresh)}>
          <Icon name={p.icon} />
          <span class="nav-label">{p.label}</span>
          {p.label === 'Inbox' && hands > 0 && <span class="nav-count tabular">{hands}</span>}
          {p.label === 'Now' && hands > 0 && <span class="nav-count nav-count-phone tabular">{hands}</span>}
          {p.label === 'Now' && running > 0 && <span class="nav-dot nav-dot-wide" title={`${running} under way`} />}
          {p.label === 'Talk' && fresh > 0 && <span class="nav-count tabular">{fresh}</span>}
          {p.label === 'Projects' && running > 0 && <span class="nav-dot" title={`${running} running`} />}
          {p.label === 'Meetings' && meeting > 0 && <span class="nav-dot nav-dot-live" title={`${meeting} live now`} />}
        </Link>
      ))}
      <button type="button" class="nav-search" onClick={() => openPalette()} aria-label="More: go to a place or coworker, switch Chief of Staff, theme (Command K)">
        <Icon name="search" class="nav-search-icon" />
        <Icon name="more" class="nav-more-icon" />
        <span class="nav-label nav-label-wide">Go to</span>
        <span class="nav-label nav-label-phone">More</span>
        <kbd class="nav-kbd">⌘K</kbd>
      </button>
    </nav>
  );
}

function navLabel(label: string, hands: number, fresh: number): string | undefined {
  if (label === 'Inbox' && hands > 0) return `Inbox, ${hands} waiting`;
  if (label === 'Talk' && fresh > 0) return `Talk, ${fresh} new message${fresh === 1 ? '' : 's'}`;
  if (label === 'Meetings' && liveMeetings.peek().length > 0) return `Meetings, ${liveMeetings.peek().length} live now`;
  if (label === 'Now') return hands > 0 ? `Now: what's going on, ${hands} waiting on you` : "Now: what's going on";
  return undefined;
}
