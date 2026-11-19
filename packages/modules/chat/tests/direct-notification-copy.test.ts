import { describe, expect, it } from 'vitest';
import {
  CHAT_PUSH_BODY_MAX,
  directMessagePushCopy,
  directPushTitleText,
  voicePreview,
} from '../server/notification-copy';

/**
 * The lock-screen words of a direct message (Phase 11 plan 13, CHAT-06; D-728, D-860): the body is the start of the
 * message cut on a word at 100 GRAPHEMES with `…` only when it was cut, a recording reads "Mensagem de voz · m:ss", and
 * the title is the writer's display name, absent when blank so the banner falls back to the tenant name.
 */

const graphemes = (text: string): number =>
  [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].length;

describe('directMessagePushCopy', () => {
  it('a short message is the body, untouched and with no ellipsis', () => {
    expect(directMessagePushCopy('Oi, tudo bem?')).toBe('Oi, tudo bem?');
  });

  it('a long message is cut on a word at 100 graphemes with an ellipsis', () => {
    const long = 'palavra '.repeat(40);
    const body = directMessagePushCopy(long);
    expect(graphemes(body)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
    expect(body).not.toMatch(/\s…$/);
    // Cut on a word: the kept text is whole words only.
    expect(
      body
        .slice(0, -1)
        .split(' ')
        .every((word) => word === 'palavra'),
    ).toBe(true);
  });

  it('exactly 100 graphemes is not cut, 101 is', () => {
    expect(directMessagePushCopy('a'.repeat(100))).toBe('a'.repeat(100));
    const cut = directMessagePushCopy('a'.repeat(101));
    expect(graphemes(cut)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('emoji, ZWJ sequences and combining marks are cut by grapheme, never inside a character', () => {
    const family = '👨‍👩‍👧‍👦';
    const accented = 'é'; // e + combining acute: one grapheme
    for (const unit of [family, accented, '🇧🇷']) {
      const body = directMessagePushCopy(unit.repeat(150));
      expect(graphemes(body)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
      expect(body.endsWith('…')).toBe(true);
      const kept = body.slice(0, -1);
      // Whole units only: the kept text is an exact repetition of the unit.
      expect(kept).toBe(unit.repeat(graphemes(kept)));
    }
  });

  it('newlines collapse to one space and an empty message reads as the empty string', () => {
    expect(directMessagePushCopy('linha um\n\nlinha dois')).toBe('linha um linha dois');
    expect(directMessagePushCopy('   ')).toBe('');
  });

  it('a recording reads the fixed words from the stored length', () => {
    expect(directMessagePushCopy(voicePreview(42))).toBe('Mensagem de voz · 0:42');
    expect(directMessagePushCopy(voicePreview(65))).toBe('Mensagem de voz · 1:05');
  });
});

describe('directPushTitleText', () => {
  it('is the trimmed display name', () => {
    expect(directPushTitleText('  Marina Souza  ')).toBe('Marina Souza');
  });

  it('is absent for a blank or missing name, so the banner is titled with the tenant name', () => {
    expect(directPushTitleText(null)).toBeUndefined();
    expect(directPushTitleText(undefined)).toBeUndefined();
    expect(directPushTitleText('')).toBeUndefined();
    expect(directPushTitleText('   \n ')).toBeUndefined();
  });
});
