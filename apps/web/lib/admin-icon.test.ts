import { describe, expect, it } from 'vitest';
import {
  ADMIN_ICON_COOKIE,
  adminIconFor,
  formatAdminIconChoice,
  parseAdminIconChoice,
} from '@/lib/admin-icon';

/**
 * The administrator's icon pick, kept per device in `rede_admin_icon` (2026-10-06, front only):
 * an exact round trip, a malformed value read as no pick, and the pick applied to its owner only.
 */
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('admin icon cookie', () => {
  it('is a per-device cookie named like the theme one', () => {
    expect(ADMIN_ICON_COOKIE).toBe('rede_admin_icon');
  });

  it('round-trips a pick exactly', () => {
    const raw = formatAdminIconChoice({ membershipId: ME, icon: 'flame' });
    expect(raw).toBe(`${ME}.flame`);
    expect(parseAdminIconChoice(raw)).toEqual({ membershipId: ME, icon: 'flame' });
  });

  it('reads an upper-case id as the same membership', () => {
    expect(parseAdminIconChoice(`${ME.toUpperCase()}.star`)).toEqual({
      membershipId: ME,
      icon: 'star',
    });
  });

  it('reads anything malformed as no pick', () => {
    for (const raw of [
      undefined,
      null,
      '',
      'star',
      `${ME}`,
      `${ME}.`,
      `${ME}.unicorn`,
      `not-a-uuid.star`,
      `${ME}.star.extra`,
    ]) {
      expect(parseAdminIconChoice(raw)).toBeNull();
    }
  });

  it('applies the pick to its owner only', () => {
    const choice = { membershipId: ME, icon: 'heart' as const };
    expect(adminIconFor(choice, ME)).toBe('heart');
    expect(adminIconFor(choice, ME.toUpperCase())).toBe('heart');
    expect(adminIconFor(choice, OTHER)).toBeNull();
    expect(adminIconFor(null, ME)).toBeNull();
  });
});
