// Where a meeting is, in words: the prompt's place phrase and the leave
// note read naturally for every huddle label the office sends ("water cooler", "by the window", "at Liban's desk").
import { describe, expect, it } from 'vitest';
import { meetingNoteText } from './meeting';
import { placePhrase } from './prompt';

describe('meeting places in words', () => {
  it('puts the place in the prompt without doubling a preposition', () => {
    expect(placePhrase('skyline')).toBe('the Skyline room');
    expect(placePhrase('garden')).toBe('the Garden room');
    expect(placePhrase('huddle:abcd1234', 'water cooler')).toBe('a quick chat at the water cooler');
    expect(placePhrase('huddle:abcd1234', 'by the window')).toBe('a quick chat by the window');
    expect(placePhrase('huddle:abcd1234', "at Liban's desk")).toBe("a quick chat at Liban's desk");
    expect(placePhrase('huddle:abcd1234', null)).toBe('a quick huddle on the office floor');
    expect(placePhrase('huddle:abcd1234', 'lounge')).toBe('a quick chat in the lounge');
    expect(placePhrase('huddle:abcd1234', 'library')).toBe('a quick chat in the library');
    expect(placePhrase('huddle:abcd1234', 'hallway')).toBe('a quick chat in the hallway');
    expect(placePhrase('huddle:abcd1234', 'phone booth')).toBe('a quick chat in a phone booth');
    expect(placePhrase('huddle:abcd1234', 'coffee bar')).toBe('a quick chat at the coffee bar');
  });

  it('names the place in the leave note with names kept as written', () => {
    const t0 = Date.UTC(2026, 8, 29, 10, 0);
    expect(meetingNoteText('huddle:abcd1234', "at Liban's desk", ['Liban', 'Ayu'], t0, t0 + 30_000)).toBe("At Liban's desk with Liban and Ayu · 1 min");
    expect(meetingNoteText('huddle:abcd1234', 'water cooler', ['Kate', 'Pax'], t0, t0 + 61_000)).toBe('Water cooler with Kate and Pax · 2 min');
    expect(meetingNoteText('skyline', null, ['Juno', 'Walt', 'Lena'], t0, t0 + 3 * 60_000 + 1)).toBe('Skyline room with Juno, Walt and Lena · 4 min');
  });
});
