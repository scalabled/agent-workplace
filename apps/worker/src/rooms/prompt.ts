// Room prompts and the room projection (docs/dev/OFFICE-PHASE2.md §4.2.5). A responder in a conference room or a joined
// huddle speaks from its persona's expertise in at most two short sentences, sees the last lines of this meeting only,
// and never states figures, results or past events the owner did not give.
import { chiefDisplayName, firstName, type Lead, type Persona } from '@headcount/catalog';
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import type { ChatMessage } from '@headcount/models';
import { CHIEF_ID, personaIdFromAgentId, type Frame, type WorkspaceSettings } from '@headcount/protocol';
import { ROOM_PROJECTION_LINES, roomKindOf, type RoomId } from '@headcount/protocol/ext/rooms';
import { ownerNameLine, personaBlock } from '../desk/desk';
import { chiefPersonaBlock, honestyPolicyText } from '../workspace/chief-prompt';
import { officeLabel } from '@headcount/protocol/ext/orgs';
import { BRAND } from '@headcount/protocol';

/** Who is in the meeting, as prompts and notes name them. */
export interface RoomMember {
  agentId: string;
  firstName: string;
  fullName: string;
  /** "Copy lead"; "Chief of Staff" for the Chief. */
  title: string;
  isChief: boolean;
  persona?: Persona;
  lead?: Lead;
}

/** A participant id → its member record (null for an unknown persona, or the Chief before a lead is chosen). */
export function roomMember(agentId: string, settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): RoomMember | null {
  if (agentId === CHIEF_ID) {
    const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
    if (!lead) return null;
    const name = chiefDisplayName(lead, settings.chiefName);
    const renamed = name !== firstName(lead.name);
    return { agentId, firstName: name, fullName: renamed ? name : lead.name, title: 'Chief of Staff', isChief: true, lead };
  }
  const personaId = personaIdFromAgentId(agentId);
  const persona = personaId ? fullIndex.persona(personaId) : undefined;
  if (!persona) return null;
  return { agentId, firstName: firstName(persona.name), fullName: persona.name, title: persona.title, isChief: false, persona };
}

/** "Juno", "Juno and Walt", "Juno, Walt and Lena", "Juno, Walt and 2 others" (packages/office listNames). */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * Where the meeting is, as a phrase: "the Skyline room", "a quick chat at the water cooler". A label that is already
 * a place phrase ("at Liban's desk", "by the window") is used as it is.
 */
export function placePhrase(roomId: RoomId, label?: string | null): string {
  const kind = roomKindOf(roomId);
  if (kind === 'skyline') return 'the Skyline room';
  if (kind === 'garden') return 'the Garden room';
  if (!label) return 'a quick huddle on the office floor';
  if (/^(?:at|by|in|on|near)\s/i.test(label)) return `a quick chat ${label}`;
  const inside = IN_PLACES[label.trim().toLowerCase()];
  return inside ? `a quick chat ${inside}` : `a quick chat at the ${label}`;
}

/** Office places that take "in" (packages/office SPOT_PHRASE): "in the lounge", "in a phone booth". */
const IN_PLACES: Record<string, string> = {
  lounge: 'in the lounge',
  library: 'in the library',
  hallway: 'in the hallway',
  'phone booth': 'in a phone booth',
};

export interface RoomPromptInput {
  /** The office's own name (cleaned). */
  office?: string;
  roomId: RoomId;
  label?: string | null;
  self: RoomMember;
  /** Everyone else present (the owner excluded). */
  others: readonly RoomMember[];
  ownerFirst: string | null;
  /** The Chief's display name (for a coworker's status line). */
  chiefName: string;
  /** This responder is the Chief's wrap-up. */
  wrapUp?: boolean;
}

/** The system prompt of one responder (§4.2.5). */
export function buildRoomSystemPrompt(i: RoomPromptInput): string {
  const policy = honestyPolicyText(catalogFull.honestyPolicy);
  const owner = i.ownerFirst ? `the owner, ${i.ownerFirst},` : 'the owner';
  const people = i.others.map((m) => `${m.fullName} (${m.title})`);
  const everyone = people.length <= 1 ? people.join('') : `${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}`;
  const where = `${placePhrase(i.roomId, i.label)} with ${people.length ? `${owner} and ${everyone}` : owner.replace(/,$/, '')}`;
  const platform = [
    '## Platform rules (these override everything below)',
    `- You are an AI coworker at ${officeLabel(i.office, BRAND.name)}. Your backstory is character lore, not a record of real events. If the owner sincerely asks whether you are an AI, answer plainly.`,
    '- You have no tools here: you cannot send, book, pay, publish, browse or change anything, and you never say you did.',
    `- You are in ${where}.`,
    '- Speak from your expertise: opinions, principles, questions, trade-offs. Never state a figure, percentage, date, result, study or past event unless the owner said it in this meeting. Never say you did, tested, measured, saw or finished anything, and never promise work.',
    '- If a colleague already made your point, add something new, disagree politely, or agree in a few words.',
    '- Lines in brackets, like [Juno (Copy lead)]: …, are what colleagues said in this meeting.',
    policy ? `- Catalog honesty policy: ${policy}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const who = i.self.isChief ? chiefPersonaBlock(i.self.lead, i.self.firstName, i.office) : i.self.persona ? personaBlock(i.self.persona) : `## Who you are\nYou are ${i.self.fullName}, ${i.self.title}.`;
  const status = i.self.isChief
    ? ['## Your status', 'You can start work only from Talk; in a room you advise.'].join('\n')
    : [
        '## Your status',
        `You are not on any project yet: no tasks, no tools, no files. Never say you are working on, starting, finishing or will deliver anything; if the owner asks for work, say ${i.chiefName} can bring you onto a project.`,
      ].join('\n');
  const style = [
    '## Style',
    '- At most two short sentences.',
    '- Spoken style: plain words, no Markdown, no lists, no emoji, no exclamation marks.',
    '- Talk to the owner; you may address colleagues by first name.',
    i.ownerFirst ? `- ${ownerNameLine(i.ownerFirst)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const chairing = i.wrapUp ? ['## Chairing', 'In one or two sentences, pull together what was said and suggest the next step. Add no new facts.'].join('\n') : '';
  return [platform, who, status, style, chairing].filter(Boolean).join('\n\n');
}

type MeetingLine = { role: 'owner' | 'agent'; agentId: string | null; text: string };

export type MeetingFrame = Extract<Frame, { type: 'talk.owner' | 'talk.message' }>;

/** The persisted lines of one meeting (owner lines and replies, notes excluded), oldest first. */
export function meetingLines(frames: readonly Frame[], meetingId: string): MeetingFrame[] {
  const out: MeetingFrame[] = [];
  for (const f of frames) {
    if (f.type === 'talk.owner' && f.data.surface === 'room' && f.data.meetingId === meetingId) out.push(f);
    else if (f.type === 'talk.message' && f.data.surface === 'room' && f.data.meetingId === meetingId && f.data.kind !== 'note' && f.data.text.trim()) out.push(f);
  }
  return out;
}

/**
 * The room projection for one responder (§4.2.5): the last ROOM_PROJECTION_LINES lines of this meeting, oldest first;
 * the owner's lines as `user`, this responder's own lines as `assistant`, everyone else's as `[Juno (Copy lead)]: …`
 * merged into the adjacent `user` message. Starts with `user`; ends with the owner's current line and any earlier
 * responders' lines of this turn. Deterministic.
 */
export function roomProjection(frames: readonly Frame[], meetingId: string, selfId: string, nameOf: (agentId: string) => string, limit = ROOM_PROJECTION_LINES): ChatMessage[] {
  const lines: MeetingLine[] = meetingLines(frames, meetingId).map((f) =>
    f.type === 'talk.owner' ? { role: 'owner', agentId: null, text: f.data.text } : { role: 'agent', agentId: f.data.agentId, text: f.data.text },
  );
  const merged: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const l of lines.slice(-limit)) {
    const own = l.role === 'agent' && l.agentId === selfId;
    const role = own ? 'assistant' : 'user';
    const content = l.role === 'owner' || own ? l.text : `[${nameOf(l.agentId!)}]: ${l.text}`;
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else merged.push({ role, content });
  }
  while (merged.length && merged[0]!.role !== 'user') merged.shift();
  while (merged.length && merged[merged.length - 1]!.role !== 'user') merged.pop();
  return merged;
}

/** "Juno (Copy lead)" for the projection. */
export function projectionName(m: Pick<RoomMember, 'firstName' | 'title'>): string {
  return `${m.firstName} (${m.title})`;
}

/** The owner's own lines in a meeting (the figures a reply may repeat). */
export function ownerLinesOf(frames: readonly Frame[], meetingId: string, limit = ROOM_PROJECTION_LINES): string[] {
  return meetingLines(frames, meetingId)
    .slice(-limit)
    .filter((f): f is Extract<Frame, { type: 'talk.owner' }> => f.type === 'talk.owner')
    .map((f) => f.data.text);
}
