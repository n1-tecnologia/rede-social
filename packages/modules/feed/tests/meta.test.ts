import { describe, expect, it } from 'vitest';
import {
  buildPostMeta,
  type CountTemplates,
  formatCountLabel,
  type PostMetaInput,
} from '../ui/meta';

/**
 * UI-D-21 — the meta row's whole rule, as a table.
 *
 * The cross-product below is `{0,1,2} likes × {0,1,2} comments × {not edited, edited}` = 18 cases,
 * which is every shape the row can take: both counts absent, one absent, both present, with and
 * without the edited marker. The assertion that holds across ALL of them is the one a stray middot
 * would break — no empty segment is ever returned — and it is asserted once, for every case, rather
 * than case by case.
 *
 * Written table-driven on purpose: the rule is one line of policy ("a count below 1 drops out"), so
 * a future change to it must be a one-line diff here, not eighteen edits.
 */

/** Stand-ins for the host catalog's pt-BR templates: the module never sees the real words. */
const LIKES: CountTemplates = { one: '{count} L1', other: '{count} Ln' };
const COMMENTS: CountTemplates = { one: '{count} C1', other: '{count} Cn' };
const RELATIVE = 'REL';
const EDITED = 'ED';
const LOCALE = 'pt-BR';

const COUNTS = [0, 1, 2] as const;
const EDITS = [false, true] as const;

function inputFor(likeCount: number, commentCount: number, edited: boolean): PostMetaInput {
  return {
    likeLabel: formatCountLabel(likeCount, LIKES, LOCALE),
    commentLabel: formatCountLabel(commentCount, COMMENTS, LOCALE),
    relativeTime: RELATIVE,
    editedLabel: edited ? EDITED : null,
  };
}

/** The 18 cases, each with the segments it must produce, in order. */
const CASES = COUNTS.flatMap((likeCount) =>
  COUNTS.flatMap((commentCount) =>
    EDITS.map((edited) => {
      const expected: string[] = [];
      if (likeCount === 1) expected.push('1 L1');
      if (likeCount > 1) expected.push(`${likeCount} Ln`);
      if (commentCount === 1) expected.push('1 C1');
      if (commentCount > 1) expected.push(`${commentCount} Cn`);
      expected.push(RELATIVE);
      if (edited) expected.push(EDITED);
      return { likeCount, commentCount, edited, expected };
    }),
  ),
);

describe('formatCountLabel (UI-D-21: a count below 1 has no segment at all)', () => {
  it('returns null at zero, so the caller has nothing to render rather than a "0" to hide', () => {
    expect(formatCountLabel(0, LIKES, LOCALE)).toBeNull();
    expect(formatCountLabel(0, COMMENTS, LOCALE)).toBeNull();
  });

  it('uses the singular template at exactly one and the plural everywhere above it', () => {
    expect(formatCountLabel(1, LIKES, LOCALE)).toBe('1 L1');
    expect(formatCountLabel(2, LIKES, LOCALE)).toBe('2 Ln');
    expect(formatCountLabel(11, COMMENTS, LOCALE)).toBe('11 Cn');
  });

  it('abbreviates a count past a thousand, so a 12px row cannot be blown open by a big number', () => {
    const label = formatCountLabel(1234, LIKES, LOCALE);
    expect(label).not.toBeNull();
    expect(label).toMatch(/Ln$/);
    // pt-BR compact notation is "1,2 mil" — asserted by SHAPE, so the exact ICU spelling may change
    // without this test becoming a restatement of Intl's output.
    expect((label as string).length).toBeLessThan('1.234 Ln'.length + 4);
    expect(label).not.toContain('1234');
  });

  it('never returns an empty string for a negative or non-finite count', () => {
    expect(formatCountLabel(-1, LIKES, LOCALE)).toBeNull();
    expect(formatCountLabel(Number.NaN, LIKES, LOCALE)).toBeNull();
  });
});

describe('buildPostMeta (UI-D-21: the 18-case zero/one/many cross-product)', () => {
  for (const { likeCount, commentCount, edited, expected } of CASES) {
    it(`likes=${likeCount} comments=${commentCount} edited=${edited} → ${expected.join(' | ')}`, () => {
      expect(buildPostMeta(inputFor(likeCount, commentCount, edited))).toEqual(expected);
    });
  }

  it('never returns an empty or blank segment, in any of the 18 cases', () => {
    for (const { likeCount, commentCount, edited } of CASES) {
      const segments = buildPostMeta(inputFor(likeCount, commentCount, edited));
      expect(segments.length).toBeGreaterThan(0);
      for (const segment of segments) {
        expect(segment.trim()).not.toBe('');
      }
    }
  });

  it('a brand-new post is its relative time and nothing else', () => {
    expect(buildPostMeta(inputFor(0, 0, false))).toEqual([RELATIVE]);
  });

  it('keeps the order counts → time → edited whatever subset is present', () => {
    const segments = buildPostMeta(inputFor(2, 0, true));
    expect(segments).toEqual(['2 Ln', RELATIVE, EDITED]);
  });

  it('drops a blank relative time rather than emitting a separator around nothing', () => {
    expect(
      buildPostMeta({
        likeLabel: '1 L1',
        commentLabel: null,
        relativeTime: '  ',
        editedLabel: null,
      }),
    ).toEqual(['1 L1']);
  });
});
