import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import {
  avatarSrcSet,
  bioSchema,
  displayNameSchema,
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  memberProfileSchema,
  normaliseBio,
  PROFILE_ISSUES,
  updateProfileBodySchema,
} from '@rede-social/contracts/profiles';
import { describe, expect, it } from 'vitest';

/**
 * PROF-01 — the PURE half of the member profile: normalisation, the caps and their UNIT, and the
 * two `.strict()` guards. No database, no `env`, no service import: this file exercises only
 * `@rede-social/contracts/profiles`, which is the same module the browser's edit form imports, so what it
 * pins is literally what both sides of the wire agree on.
 */

const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';

describe('normaliseBio — normalise BEFORE measuring (R-09)', () => {
  it('1. trims, and an empty result is SQL NULL rather than an empty string', () => {
    expect(normaliseBio('  oi  ')).toBe('oi');
    expect(normaliseBio('')).toBeNull();
    expect(normaliseBio('   ')).toBeNull();
    expect(normaliseBio('\n\n\n')).toBeNull();
  });

  it('2. a non-string — including null and undefined — is null, never a coerced value', () => {
    expect(normaliseBio(null)).toBeNull();
    expect(normaliseBio(undefined)).toBeNull();
    expect(normaliseBio(42)).toBeNull();
    expect(normaliseBio({ bio: 'x' })).toBeNull();
  });

  it('3. CRLF becomes LF and runs of three or more newlines collapse to exactly two', () => {
    expect(normaliseBio('a\r\nb')).toBe('a\nb');
    expect(normaliseBio('a\n\n\n\n\nb')).toBe('a\n\nb');
    // Two newlines are a paragraph break and survive untouched.
    expect(normaliseBio('a\n\nb')).toBe('a\n\nb');
  });

  it('4. a 160-character value whose last 12 characters are spaces is ACCEPTED at 148', () => {
    const raw = `${'x'.repeat(148)}            `;
    expect(raw.length).toBe(160);
    expect(normaliseBio(raw)?.length).toBe(148);
    // The ordering trap 02-03 recorded: a format check that ran BEFORE the trim would refuse this.
    const parsed = bioSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('x'.repeat(148));
  });

  it('5. a genuine 151-character value is refused with a too_big issue; 150 is accepted', () => {
    const tooLong = bioSchema.safeParse('x'.repeat(151));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.code).toBe('too_big');
    expect(bioSchema.safeParse('x'.repeat(MAX_BIO_LENGTH)).success).toBe(true);
  });

  it('6. `null` clears the bio and parses cleanly', () => {
    const parsed = bioSchema.safeParse(null);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeNull();
  });
});

describe('displayNameSchema — free rename, never empty (D-46, PROF-01)', () => {
  it('7. an empty or whitespace-only name is refused with the `required` message', () => {
    for (const value of ['', '   ', '\n\t ']) {
      const parsed = displayNameSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe('required');
    }
  });

  it('8. surrounding whitespace is trimmed before the value is stored or measured', () => {
    const parsed = displayNameSchema.safeParse('  Ana  ');
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('Ana');
  });

  it('9. the cap is 60: 60 passes, 61 is refused', () => {
    expect(displayNameSchema.safeParse('x'.repeat(MAX_DISPLAY_NAME_LENGTH)).success).toBe(true);
    const tooLong = displayNameSchema.safeParse('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.code).toBe('too_big');
  });
});

describe('the cap unit is UTF-16 code units — the SAME unit the browser counter uses', () => {
  it('10. 75 astral-plane emoji are 150 code units and pass; 76 are 152 and fail', () => {
    // `String.length`, `<textarea maxLength>` and the client-side `value.length` counter all count
    // UTF-16 code units. An astral-plane emoji is a surrogate PAIR, so it counts as 2 on both
    // sides: a value the counter accepts can never be refused by the server, and vice versa.
    // zod's own `.max()` counts CODE POINTS (verified against 4.6.2), which is why the contract
    // carries an explicit code-unit refinement next to it — this case is what pins that.
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2);

    const atCap = emoji.repeat(75);
    expect(atCap.length).toBe(MAX_BIO_LENGTH);
    expect(bioSchema.safeParse(atCap).success).toBe(true);

    const overCap = emoji.repeat(76);
    expect(overCap.length).toBe(152);
    expect(bioSchema.safeParse(overCap).success).toBe(false);
  });

  it('11. the same unit governs the display name: 31 emoji are 62 code units and are refused', () => {
    const emoji = '\u{1F600}';
    // 31 CODE POINTS — under zod's own `.max(60)`, which counts code points — but 62 CODE UNITS,
    // which is what a `maxLength={60}` field would have stopped. Removing the code-unit refinement
    // from the contract makes this assertion fail, which is the point of having it.
    expect(emoji.repeat(31).length).toBe(62);
    expect(displayNameSchema.safeParse(emoji.repeat(31)).success).toBe(false);
    expect(displayNameSchema.safeParse(emoji.repeat(30)).success).toBe(true);
  });
});

describe('updateProfileBodySchema — at least one key, and nothing unknown', () => {
  it('12. an empty body is refused: a PATCH must say what it changes', () => {
    expect(updateProfileBodySchema.safeParse({}).success).toBe(false);
  });

  it('13. an unknown key is refused even alongside a valid one (.strict())', () => {
    expect(updateProfileBodySchema.safeParse({ displayName: 'Ana', unknown: 1 }).success).toBe(
      false,
    );
  });

  it('14. `{ avatarAssetId: null }` is a valid body — that is how a photo is removed', () => {
    const parsed = updateProfileBodySchema.safeParse({ avatarAssetId: null });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ avatarAssetId: null });
  });

  it('15. the refusal vocabulary is closed and exactly the three codes 03-04 switches on', () => {
    expect(PROFILE_ISSUES).toEqual(['required', 'too_long', 'invalid']);
  });
});

describe('memberProfileSchema — D-45 is enforced by .strict(), not by convention', () => {
  const valid = {
    membershipId: UUID,
    displayName: 'Ana Paula Ferreira',
    bio: null,
    avatarAssetId: null,
    avatarUrl: null,
  };

  it('16. photo, display name and bio only — a `role` key makes the parse FAIL', () => {
    expect(memberProfileSchema.safeParse(valid).success).toBe(true);
    // If a later phase adds a column and someone spreads the row into this shape, this fails loudly
    // instead of quietly putting an admin badge on every profile screen (D-45).
    expect(memberProfileSchema.safeParse({ ...valid, role: 'admin_tenant' }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...valid, email: 'a@b.local' }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...valid, joinedAt: '2026-01-01' }).success).toBe(false);
  });
});

describe('avatarSrcSet — the srcset and the derived ladder cannot drift', () => {
  it('17. names exactly the widths the worker produces for `avatar`', () => {
    expect(avatarSrcSet(UUID)).toBe(`/v1/media/${UUID}/w128 128w, /v1/media/${UUID}/w320 320w`);

    const widths = avatarSrcSet(UUID)
      .split(', ')
      .map((entry) => Number(entry.split(' ')[1]?.replace('w', '')));
    expect(widths).toEqual([...PURPOSE_WIDTHS.avatar]);
    for (const width of widths) expect(PURPOSE_WIDTHS.avatar).toContain(width);
  });
});
