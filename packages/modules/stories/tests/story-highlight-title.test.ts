import { describe, expect, it } from 'vitest';
import {
  createStoryHighlightSchema,
  STORY_HIGHLIGHT_MAX_TITLE,
  storyHighlightTitleSchema,
} from '../contracts/index';

/**
 * PEND-09 (D-559): the highlight name cap is 50, read from ONE constant by the contract, the
 * service check and (mirrored by its literal) the database CHECK. These are the pure boundary cases
 * of the contract; the database and the API are pinned by pgTAP 120 and the stories integration suite.
 */

const REFUSED = 'title_invalid';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('storyHighlightTitleSchema — the 50 character cap (PEND-09, D-559)', () => {
  it('1. the constant is 50', () => {
    expect(STORY_HIGHLIGHT_MAX_TITLE).toBe(50);
  });

  it('2. one character and exactly the cap are accepted', () => {
    expect(storyHighlightTitleSchema.safeParse('a').success).toBe(true);
    const name = 'a'.repeat(STORY_HIGHLIGHT_MAX_TITLE);
    const parsed = storyHighlightTitleSchema.safeParse(name);
    expect(parsed.success && parsed.data).toBe(name);
  });

  it('3. one over the cap is refused with the machine code', () => {
    const parsed = storyHighlightTitleSchema.safeParse('a'.repeat(STORY_HIGHLIGHT_MAX_TITLE + 1));
    expect(parsed.success).toBe(false);
    expect(messages(parsed)).toEqual([REFUSED]);
  });

  it('4. it trims before counting: 50 with surrounding spaces is accepted and stored trimmed', () => {
    const name = 'b'.repeat(STORY_HIGHLIGHT_MAX_TITLE);
    const parsed = storyHighlightTitleSchema.safeParse(`  ${name}  `);
    expect(parsed.success && parsed.data).toBe(name);
  });

  it('5. 51 after trimming is refused even when spaces surround it', () => {
    const parsed = storyHighlightTitleSchema.safeParse(
      ` ${'b'.repeat(STORY_HIGHLIGHT_MAX_TITLE + 1)} `,
    );
    expect(parsed.success).toBe(false);
    expect(messages(parsed)).toEqual([REFUSED]);
  });

  it('6. an empty, whitespace-only or empty-after-trim name is refused', () => {
    for (const value of ['', ' ', '   ', '\t\n']) {
      const parsed = storyHighlightTitleSchema.safeParse(value);
      expect(parsed.success, JSON.stringify(value)).toBe(false);
      expect(messages(parsed)).toEqual([REFUSED]);
    }
  });

  it('7. the contract counts code points like the CHECK: 50 emoji are accepted, 51 are refused', () => {
    // Zod 4 `.max()` counts code points, not UTF-16 units. The input's `maxLength` counts units and
    // is therefore the stricter of the three, so a name the field takes is never refused downstream.
    const emoji = '😀';
    expect(emoji).toHaveLength(2);
    expect(storyHighlightTitleSchema.safeParse(emoji.repeat(25)).success).toBe(true);
    expect(
      storyHighlightTitleSchema.safeParse(emoji.repeat(STORY_HIGHLIGHT_MAX_TITLE)).success,
    ).toBe(true);
    const over = storyHighlightTitleSchema.safeParse(emoji.repeat(STORY_HIGHLIGHT_MAX_TITLE + 1));
    expect(over.success).toBe(false);
    expect(messages(over)).toEqual([REFUSED]);
  });
});

describe('createStoryHighlightSchema — the same rule on the create body', () => {
  it('8. a 50 character title is accepted and a 51 character one is refused', () => {
    expect(
      createStoryHighlightSchema.safeParse({ title: 'c'.repeat(STORY_HIGHLIGHT_MAX_TITLE) })
        .success,
    ).toBe(true);
    const over = createStoryHighlightSchema.safeParse({
      title: 'c'.repeat(STORY_HIGHLIGHT_MAX_TITLE + 1),
    });
    expect(over.success).toBe(false);
    expect(messages(over)).toEqual([REFUSED]);
  });

  it('9. an empty title is refused on the body as well', () => {
    expect(createStoryHighlightSchema.safeParse({ title: '  ' }).success).toBe(false);
  });
});
