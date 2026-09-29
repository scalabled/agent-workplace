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
};

export function resolveStrings(labels?: Partial<OfficeStrings>): OfficeStrings {
  return labels ? { ...DEFAULT_STRINGS, ...labels, states: { ...DEFAULT_STRINGS.states, ...(labels.states ?? {}) }, places: { ...DEFAULT_STRINGS.places, ...(labels.places ?? {}) } } : DEFAULT_STRINGS;
}
