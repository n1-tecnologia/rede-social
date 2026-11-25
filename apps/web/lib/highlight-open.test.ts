import { describe, expect, it } from 'vitest';
import {
  highlightOpenSectionVisible,
  highlightOpenState,
  openToBuyersToastKey,
} from '@/lib/highlight-open';

/**
 * 11.1-10 (UI-D-886, UI-D-887): the highlight switch facts as pure functions over finished facts. A
 * highlight read that predates the field reads as closed, the switch section exists only for an
 * organization community that is not archived, and the two toasts are the two catalog keys.
 */
describe('highlightOpenState', () => {
  it('reads the curator flag, and an absent one reads as closed', () => {
    expect(highlightOpenState({ openToBuyers: true })).toBe(true);
    expect(highlightOpenState({ openToBuyers: false })).toBe(false);
    expect(highlightOpenState({})).toBe(false);
  });
});

describe('highlightOpenSectionVisible', () => {
  const org = { communityId: 'c1' };

  it('is true only for an organization community that is not archived', () => {
    expect(highlightOpenSectionVisible({ place: org, archived: false })).toBe(true);
  });

  it('is false for a member-created community', () => {
    expect(highlightOpenSectionVisible({ place: org, archived: false, member: true })).toBe(false);
  });

  it('is false for an Início highlight (no community)', () => {
    expect(highlightOpenSectionVisible({ place: { communityId: null }, archived: false })).toBe(
      false,
    );
  });

  it('is false for an archived community', () => {
    expect(highlightOpenSectionVisible({ place: org, archived: true })).toBe(false);
  });
});

describe('openToBuyersToastKey', () => {
  it('names the toast for the value the switch moved to', () => {
    expect(openToBuyersToastKey(true)).toBe('highlights.edit.openToBuyers.toastOn');
    expect(openToBuyersToastKey(false)).toBe('highlights.edit.openToBuyers.toastOff');
  });
});
