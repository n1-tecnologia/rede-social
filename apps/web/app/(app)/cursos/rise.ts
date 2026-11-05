import type { CSSProperties } from 'react';

/**
 * 2026-10-26 (the academy reference's motion, the product owner's "quero motion nos cards"): a list's
 * cards rise into place one after the other. The item carries `ms-rise` (inert outside the member
 * skin and under "reduzir movimento") and this style, its place in the list; past the ninth card the
 * delay stops growing, so a long page or the next page of a grid never waits.
 */
export function riseStyle(index: number): CSSProperties {
  return { '--ms-i': Math.min(Math.max(0, index), 8) } as CSSProperties;
}
