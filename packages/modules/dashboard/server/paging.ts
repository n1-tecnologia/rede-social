import type { KeysetCursor } from '@rede-social/core/server/paging';

/**
 * RED STUB (08.7-04 Task 1): the owner lists' paging helper is not written yet. It ignores the
 * limit and the cursor and never continues, so `tests/paging.test.ts` fails on its assertions. The
 * GREEN commit replaces this file.
 */
export const NEVER_ACTIVE = '';

export function pageInput(
  _raw: { limit?: string | number | undefined; cursor?: string | undefined },
  defaultLimit: number,
  _kind: 'instant' | 'date' | 'last-active' = 'instant',
): { limit: number; after: KeysetCursor | null } {
  return { limit: defaultLimit, after: null };
}

export function pageOf<T>(
  rows: readonly T[],
  _limit: number,
  _keyOf: (row: T) => KeysetCursor,
): { rows: T[]; nextCursor: string | null } {
  return { rows: [...rows], nextCursor: null };
}
