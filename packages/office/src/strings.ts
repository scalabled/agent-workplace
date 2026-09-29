// Every user-facing string of the office (i18n through `options.labels`). Plain, short, verb-first (EXPERIENCE §10.8).
import type { PresenceState } from './types';

export interface OfficeStrings {
  region: string;
  roleDescription: string;
  skipToDirectory: string;
  seatsGroup: string;
  desks: string;
  conference: string;
  modeGroup: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  walkTo: string;
  find: string;
  findPlaceholder: string;
  noMatches: string;
  invite: string;
  inviteTitle: (room: string) => string;
  inviteN: (n: number) => string;
  inviteSearch: string;
  capacity: (room: string, n: number) => string;
  leave: string;
  captions: string;
  close: string;
  free: string;
  talkingWith: (names: string[]) => string;
  /** A room's door plate in desk mode: seated people waiting for the owner (nothing is happening yet, X3). */
  waitingIn: (names: string[]) => string;
  inRoom: (room: string) => string;
  available: string;
  messageRoom: string;
  send: string;
  emptyStage: string;
  floor: string;
  notVoiced: string;
  backToDesk: string;
  you: string;
  headcount: (n: number) => string;
  states: Record<PresenceState, string>;
  places: { cafe: string; lounge: string; library: string; reception: string; chief: string };
  seatLabel: (name: string, title: string, group: string, state: string) => string;
  minimap: string;
  nightShift: string;
  /** Office life (OFFICE-LIFE §3.5, §4). */
  life: LifeStrings;
}

export interface LifeStrings {
  /** "At Juno's desk". */
  atDesk: (first: string) => string;
  /** "Water cooler · with Pax". */
  withNames: (place: string, names: string[]) => string;
  /** The huddle card title: "Water cooler · Kate, Pax". */
  huddleTitle: (place: string, names: string[]) => string;
  /** The huddle's accessible name: "Water cooler huddle: Kate and Pax". */
  huddleLabel: (place: string, names: string[]) => string;
  join: string;
  listen: string;
  listening: string;
  leave: string;
  openInRoom: string;
  sayTo: (names: string[]) => string;
  quiet: string;
  /** "3 huddles · 21 on a break" (no "0 huddles"): away from the desk reads as available (D2). */
  pill: (huddles: number, away: number) => string;
  /** "Night floor · 3 at the windows". */
  nightPill: (atWindows: number) => string;
  /** The pill's accessible name: "What's happening: 2 huddles · 12 on a break". */
  pillLabel: (text: string) => string;
  quietFloor: string;
  nightFloor: string;
  paused: string;
  whatsHappening: string;
  nothingNow: string;
  autopilot: string;
  autopilotOffRm: string;
  pause: string;
  follow: string;
  following: (first: string) => string;
  wander: string;
  wanderYes: string;
  wanderNo: string;
  send: string;
  /** Ghost plates on an empty desk. */
  walking: string;
  away: string;
  /** A drop-by's card title: "At Jasleen's desk · Nayra visiting". */
  visiting: (first: string) => string;
  /** A habit, on the huddle card: "Their usual 10:40 at the water cooler". */
  usual: (time: string, where: string) => string;
  /** A habit after the place's name in What's happening: "Water cooler · their usual 10:40". */
  usualShort: (time: string) => string;
  /** What's happening: the primary action for a raised hand. */
  talk: string;
  /** A laugh as a caption chip, and appended to the line it answers in the card: "Emilio laughs softly". */
  laughs: (first: string, caption: string) => string;
  /**
   * Passing-by lines for someone on a break, in a huddle or walking (honesty: never a work status; being away from the
   * desk means available). Hosts pick one when the owner hovers such a person.
   */
  availability: readonly string[];
}

/** "Juno", "Juno and Walt", "Juno, Walt and Lena", "Juno, Walt and 2 others". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

export const DEFAULT_STRINGS: OfficeStrings = {
  region: 'Office floor plan',
  roleDescription: 'office',
  skipToDirectory: 'Use the Directory (list view)',
  seatsGroup: 'Desks',
  desks: 'Desks',
  conference: 'Conference',
  modeGroup: 'Office mode',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Show the whole floor',
  walkTo: 'Walk to',
  find: 'Find',
  findPlaceholder: 'Find a person, title or team',
  noMatches: 'No one matches.',
  invite: 'Invite',
  inviteTitle: (room) => `Invite to the ${room}`,
  inviteN: (n) => (n ? `Invite ${n}` : 'Invite'),
  inviteSearch: 'Search people, titles, teams',
  capacity: (room, n) => `The ${room} seats ${n} besides you.`,
  leave: 'Leave',
  captions: 'Captions',
  close: 'Close',
  free: 'Free',
  talkingWith: (names) => `Talking with ${listNames(names)}`,
  waitingIn: (names) => `${listNames(names)} · waiting for you`,
  inRoom: (room) => `In the ${room}`,
  available: 'Available',
  messageRoom: 'Message the room…',
  send: 'Send',
  emptyStage: 'Invite people to the table. They answer when you talk to the room.',
  floor: 'Floor',
  notVoiced: 'not voiced',
  backToDesk: 'Back to desk',
  you: 'You',
  headcount: (n) => `${n}`,
  states: {
    idle: 'Idle',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    working: 'Working',
    raised_hand: 'Waiting on you',
    blocked: 'Blocked',
    away: 'Away',
  },
  places: { cafe: 'Coffee bar', lounge: 'Lounge', library: 'Library', reception: 'Reception', chief: 'Chief of Staff' },
  // The group is dropped when it repeats the title ("Eddie Ramos, Chief of Staff, …", not "…, Chief of Staff, Chief of Staff").
  seatLabel: (name, title, group, state) =>
    [name, title, group && group.trim().toLowerCase() === title.trim().toLowerCase() ? '' : group, state].filter(Boolean).join(', '),
  minimap: 'Floor map',
  nightShift: 'Night Shift',
  life: {
    atDesk: (first) => `At ${first}'s desk`,
    withNames: (place, names) => (names.length ? `${place} · with ${listNames(names)}` : place),
    huddleTitle: (place, names) => `${place} · ${names.join(', ')}`,
    huddleLabel: (place, names) => `${place} huddle: ${listNames(names)}`,
    join: 'Join',
    listen: 'Listen',
    listening: 'Listening',
    leave: 'Leave',
    openInRoom: 'Open in a room',
    sayTo: (names) => `Say something to ${listNames(names)}…`,
    quiet: 'Quiet company',
    pill: (huddles, away) =>
      [huddles ? `${huddles} ${huddles === 1 ? 'huddle' : 'huddles'}` : '', away ? `${away} on a break` : ''].filter(Boolean).join(' · '),
    nightPill: (atWindows) => (atWindows ? `Night floor · ${atWindows} at the ${atWindows === 1 ? 'window' : 'windows'}` : 'Night floor'),
    pillLabel: (text) => `What's happening: ${text}`,
    quietFloor: 'Quiet floor',
    nightFloor: 'Night floor',
    paused: 'Office life paused',
    whatsHappening: "What's happening",
    nothingNow: 'Everyone is at their desk.',
    autopilot: 'Autopilot camera',
    autopilotOffRm: 'Off with reduced motion',
    pause: 'Pause office life',
    follow: 'Follow',
    following: (first) => `Following ${first}`,
    wander: 'Let the camera wander?',
    wanderYes: 'Yes',
    wanderNo: 'No thanks',
    send: 'Send',
    walking: 'walking',
    away: 'nearby',
    visiting: (first) => `${first} visiting`,
    usual: (time, where) => `Their usual ${time} ${where}`,
    usualShort: (time) => `their usual ${time}`,
    talk: 'Talk',
    laughs: (first, caption) => `${first} ${caption.replace(/^\(|\)$/g, '').trim()}`,
    availability: [
      'On a little break. What do you need?',
      'Taking five. What can I do for you?',
      "Wandering, but all yours. What's up?",
      'Stepped away for a minute. How can I help?',
      'Free as a bird. What do you need?',
    ],
  },
};

export function resolveStrings(labels?: Partial<OfficeStrings>): OfficeStrings {
  return labels
    ? {
        ...DEFAULT_STRINGS,
        ...labels,
        states: { ...DEFAULT_STRINGS.states, ...(labels.states ?? {}) },
        places: { ...DEFAULT_STRINGS.places, ...(labels.places ?? {}) },
        life: { ...DEFAULT_STRINGS.life, ...(labels.life ?? {}) },
      }
    : DEFAULT_STRINGS;
}
