import { MODERATION_EXCERPT_MAX } from '@rede-social/contracts/moderation';
import { describe, expect, it } from 'vitest';
import { moderationExcerpt } from '../server/moderation/log';

/**
 * D-337: the snapshot of a removed comment, captured in the removal transaction. The cap is in UTF-16
 * code units (`withinCodeUnits`); the DB CHECK counts code points, which is never larger, so every
 * value asserted here would also pass `moderation_log_excerpt_len_chk`.
 */
const codePoints = (text: string) => Array.from(text).length;

describe('moderationExcerpt', () => {
  it('returns a short body unchanged (trimmed), line breaks kept', () => {
    expect(moderationExcerpt('  Olá, pessoal!\nSegunda linha.  ')).toBe(
      'Olá, pessoal!\nSegunda linha.',
    );
  });

  it('keeps a body of exactly the cap whole, with no ellipsis', () => {
    const body = `${'a'.repeat(139)} ${'b'.repeat(140)}`;
    expect(body.length).toBe(MODERATION_EXCERPT_MAX);
    expect(moderationExcerpt(body)).toBe(body);
  });

  it('cuts a long body on a word and appends the ellipsis inside the cap', () => {
    const word = 'palavra';
    const body = Array.from({ length: 60 }, () => word).join(' ');
    const cut = moderationExcerpt(body);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(MODERATION_EXCERPT_MAX);
    // On a word: what precedes the ellipsis is whole words only.
    expect(
      cut
        .slice(0, -1)
        .split(' ')
        .every((w) => w === word),
    ).toBe(true);
    expect(codePoints(cut)).toBeLessThanOrEqual(MODERATION_EXCERPT_MAX);
  });

  it('keeps an emoji at the boundary whole (never half a surrogate pair)', () => {
    // No whitespace near the cut, so the hard cut decides — and it must not split the pair.
    const body = `${'x'.repeat(278)}😀😀😀`;
    const cut = moderationExcerpt(body);
    expect(cut.length).toBeLessThanOrEqual(MODERATION_EXCERPT_MAX);
    expect(cut.endsWith('…')).toBe(true);
    // No lone surrogate anywhere in the result.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(
      false,
    );
    expect(cut).toBe(`${'x'.repeat(278)}…`);
  });

  it('never splits an emoji ZWJ sequence', () => {
    const family = '👨‍👩‍👧‍👦';
    const body = family.repeat(40);
    const cut = moderationExcerpt(body);
    expect(cut.length).toBeLessThanOrEqual(MODERATION_EXCERPT_MAX);
    expect(cut.slice(0, -1).replaceAll(family, '')).toBe('');
  });

  it('hard-cuts a body with no spaces, with the ellipsis', () => {
    const body = 'y'.repeat(400);
    const cut = moderationExcerpt(body);
    expect(cut).toBe(`${'y'.repeat(MODERATION_EXCERPT_MAX - 1)}…`);
    expect(cut.length).toBe(MODERATION_EXCERPT_MAX);
  });
});
