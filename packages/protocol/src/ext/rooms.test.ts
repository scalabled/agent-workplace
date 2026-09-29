// Office Phase 2 wire helpers (ext/rooms.ts), the rooms route ids, ownerFirstNameOf and the ephemeral room.turn frame.
import { describe, expect, it } from 'vitest';
import { EPHEMERAL_FRAME_TYPES, PERSISTED_FRAME_TYPES } from '../frames';
import { ownerFirstNameOf } from '../api';
import { ROUTES, matchRoute, routePath } from '../routes';
import { MEETING_ID_RE, ROOM_ID_RE, ROOM_LABEL_RE, ROOM_LIMITS, huddleRoomId, isRoomId, newMeetingId, roomKindOf } from './rooms';

describe('room ids', () => {
  it('accepts the two conference rooms and huddle rooms only', () => {
    for (const id of ['skyline', 'garden', 'huddle:abcd', 'huddle:0123456789abcdef']) expect(isRoomId(id), id).toBe(true);
    for (const id of ['Skyline', 'boardroom', 'huddle:', 'huddle:abc', 'huddle:ABCD', 'huddle:a:b', 'huddle:0123456789abcdefg', 42, null]) expect(isRoomId(id), String(id)).toBe(false);
    expect(roomKindOf('skyline')).toBe('skyline');
    expect(roomKindOf('garden')).toBe('garden');
    expect(roomKindOf('huddle:abcd')).toBe('huddle');
  });

  it('derives a stable, short huddle room id from a life huddle id', () => {
    const a = huddleRoomId('hd:2026-09-29:water_cooler:635');
    expect(a).toMatch(ROOM_ID_RE);
    expect(huddleRoomId('hd:2026-09-29:water_cooler:635')).toBe(a);
    expect(huddleRoomId('hd:2026-09-29:water_cooler:636')).not.toBe(a);
    for (let i = 0; i < 200; i++) expect(huddleRoomId(`hd:x:${i}`)).toMatch(ROOM_ID_RE);
  });

  it('makes meeting ids of the documented shape', () => {
    const m = newMeetingId();
    expect(m).toMatch(MEETING_ID_RE);
    expect(newMeetingId()).not.toBe(m);
  });

  it('keeps the limits of the plan', () => {
    expect(ROOM_LIMITS).toEqual({
      skyline: { participants: 9, responders: 3, chiefWrap: true },
      garden: { participants: 7, responders: 3, chiefWrap: true },
      huddle: { participants: 4, responders: 2, chiefWrap: false },
    });
    expect(ROOM_LABEL_RE.test('water cooler')).toBe(true);
    expect(ROOM_LABEL_RE.test('café')).toBe(true);
    expect(ROOM_LABEL_RE.test('<b>')).toBe(false);
  });
});

describe('routes', () => {
  it('encodes and matches huddle rooms', () => {
    const path = routePath('roomSay', { roomId: 'huddle:k2p9' });
    expect(path).toBe('/api/rooms/huddle%3Ak2p9/say');
    expect(matchRoute('POST', path)).toEqual({ match: { id: 'roomSay', params: { roomId: 'huddle:k2p9' } } });
    expect(matchRoute('POST', '/api/rooms/skyline/cancel')).toEqual({ match: { id: 'roomCancel', params: { roomId: 'skyline' } } });
    expect(matchRoute('GET', '/api/office/people')).toEqual({ match: { id: 'officePeople', params: {} } });
    expect(matchRoute('POST', '/api/expr/huddle/render')).toEqual({ match: { id: 'exprHuddleRender', params: {} } });
    expect(ROUTES.roomSay).toMatchObject({ body: 'json', bodyCap: 16 * 1024 });
    expect(ROUTES.roomCancel).toMatchObject({ body: 'json', bodyCap: 4 * 1024 });
    expect(ROUTES.exprHuddleRender).toMatchObject({ body: 'json', bodyCap: 8 * 1024 });
  });
});

describe('frames', () => {
  it('room.turn is ephemeral', () => {
    expect(EPHEMERAL_FRAME_TYPES.has('room.turn')).toBe(true);
    expect(PERSISTED_FRAME_TYPES.has('room.turn')).toBe(false);
  });
});

describe('ownerFirstNameOf', () => {
  it('is the first word of a set name, and null otherwise', () => {
    expect(ownerFirstNameOf({ ownerName: 'Greg van Dyke' })).toBe('Greg');
    expect(ownerFirstNameOf({ ownerName: '  Zoë ' })).toBe('Zoë');
    expect(ownerFirstNameOf({ ownerName: "O'Neil" })).toBe("O'Neil");
    expect(ownerFirstNameOf({ ownerName: 'Anne-Marie Dupont' })).toBe('Anne-Marie');
    expect(ownerFirstNameOf({ ownerName: 'Dr. Who' })).toBe('Dr');
    expect(ownerFirstNameOf({ ownerName: '' })).toBeNull();
    expect(ownerFirstNameOf({ ownerName: null })).toBeNull();
    expect(ownerFirstNameOf({})).toBeNull();
    expect(ownerFirstNameOf(null)).toBeNull();
    expect(ownerFirstNameOf({ ownerName: '42' })).toBeNull();
    expect(ownerFirstNameOf({ ownerName: 'x'.repeat(25) })).toBeNull();
  });
});
