import { describe, expect, it } from 'vitest';
import { maybeReactHintPrefix, parseReactHint, reactionFor, sniffOwnerText } from './affect';
import { intentsFile } from './testing';

const lex = intentsFile.affect_lexicon;
const d = intentsFile.defaults;
const sniff = (t: string) => sniffOwnerText(t, lex);

describe('sniffOwnerText (§3.3)', () => {
  it('flags short thanks, hellos and goodbyes as phatic', () => {
    for (const t of ['Thanks!', 'thank you so much', 'Thanks Samuel', 'cheers, see you tomorrow', 'Morning!', 'hi', 'bye for now', 'Great job, thanks!']) {
      expect(sniff(t).phatic, t).toBe(true);
    }
  });
  it('does not treat content, questions, requests or entities as phatic', () => {
    for (const t of ['thanks, can you also check the invoices?', "I'll do it later", 'Thanks for the Northwind deck', 'hi, what is our margin?', 'thanks for sorting the invoices', 'Thanks but that is wrong']) {
      expect(sniff(t).phatic, t).toBe(false);
    }
  });
  it('scores requests, questions, humour, news, doubt and corrections', () => {
    expect(sniff('Can you draft a follow-up to Kirsten?').request).toBeGreaterThanOrEqual(0.6);
    expect(sniff('Draft the tier pricing page').request).toBeGreaterThanOrEqual(0.6);
    expect(sniff('what do you think about the margins').question).toBe(true);
    expect(sniff('haha the printer is haunted again').humor).toBeGreaterThanOrEqual(0.6);
    expect(sniff('lol').humor).toBeGreaterThanOrEqual(0.6);
    expect(sniff('We closed the deal with Nordic Oat!').goodNews).toBeGreaterThanOrEqual(0.75);
    expect(sniff('They pulled out of the contract').badNews).toBeGreaterThanOrEqual(0.6);
    expect(sniff("I'm not sure this pricing works").doubt).toBeGreaterThanOrEqual(0.6);
    expect(sniff('No, the other supplier').correction).toBeGreaterThanOrEqual(0.7);
    expect(sniff('ugh, long day').frustration).toBeGreaterThanOrEqual(0.5);
    expect(sniff('wait, actually use the March numbers').stopOrSteer).toBeGreaterThanOrEqual(0.6);
  });
  it('handles negation', () => {
    expect(sniff('that is not funny').humor).toBe(0);
    expect(sniff('that is funny').humor).toBeGreaterThan(0);
    expect(sniff('not great news, honestly').goodNews).toBe(0);
  });
  it('raises hard flags for distress and a sincere AI question', () => {
    const c = sniff('haha well my dad is in hospital so this week is a mess');
    expect(c.distress).toBe(true);
    expect(c.humor).toBeGreaterThan(0);
    expect(sniff('wait, are you a bot?').sincereAi).toBe(true);
  });
});

describe('reactionFor', () => {
  it('follows the precedence sympathy > concern > apology > delight > surprise > laugh > encouragement > acknowledge', () => {
    expect(reactionFor(sniff('haha the printer is haunted again'), null, d)).toBe('laugh');
    expect(reactionFor(sniff('We closed the deal with Nordic Oat!'), null, d)).toBe('delight');
    expect(reactionFor(sniff('They pulled out of the contract'), null, d)).toBe('concern');
    expect(reactionFor(sniff("I'm not sure this pricing works, can you check?"), null, d)).toBe('encouragement');
    expect(reactionFor(sniff('Can you draft a follow-up to Kirsten?'), null, d)).toBe('acknowledge');
    expect(reactionFor(sniff('ugh, the client cancelled lol'), null, d)).toBe('sympathy');
  });
  it('distress wins over humour; the sincere AI question gets nothing; phatic turns belong to the host', () => {
    expect(reactionFor(sniff('haha well my dad is in hospital'), 'laugh', d)).toBe('sympathy');
    expect(reactionFor(sniff('are you a real person?'), 'laugh', d)).toBeNull();
    expect(reactionFor(sniff('Thanks!'), null, d)).toBeNull();
  });
  it('never laughs after frustration, corrections, self-doubt or bad news, even when hinted', () => {
    expect(reactionFor(sniff('am I crazy lol'), 'laugh', d)).toBe('encouragement');
    expect(reactionFor(sniff("no, that's wrong haha"), 'laugh', d)).toBe('apology');
    expect(reactionFor(sniff('what should we name it'), 'laugh', d)).toBe('laugh');
    expect(reactionFor(sniff('what should we name it'), 'none', d)).toBeNull();
  });
});

describe('reaction hints', () => {
  it('strips the hint token and validates it', () => {
    expect(parseReactHint('⟦react:laugh⟧ Ha, the printer again.')).toEqual({ hint: 'laugh', rest: 'Ha, the printer again.' });
    expect(parseReactHint('[[react:concern]]Oof.')).toEqual({ hint: 'concern', rest: 'Oof.' });
    expect(parseReactHint('⟦react:party⟧ Hi')).toEqual({ hint: null, rest: 'Hi' });
    expect(parseReactHint('No hint here.')).toEqual({ hint: null, rest: 'No hint here.' });
  });
  it('tells streaming hosts whether to keep buffering', () => {
    expect(maybeReactHintPrefix('')).toBe(true);
    expect(maybeReactHintPrefix('⟦rea')).toBe(true);
    expect(maybeReactHintPrefix('⟦react:lau')).toBe(true);
    expect(maybeReactHintPrefix('⟦react:laugh⟧')).toBe(false);
    expect(maybeReactHintPrefix('Sure')).toBe(false);
  });
});
