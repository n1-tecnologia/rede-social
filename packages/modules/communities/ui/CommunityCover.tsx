'use client';

import type { ReactNode } from 'react';

/**
 * RED-phase skeleton (05-04 Task 1). The signature is the contract
 * `tests/community-page-ui.test.tsx` was written against; the BODY is deliberately empty so the
 * assertions — not the module loader — are what fail. The GREEN commit fills it in.
 */

/** `card` → the list card's `aspect-[16/7]` block · `page` → the community page's `h-36` block. */
export type CommunityCoverGeometry = 'card' | 'page';

export interface CommunityCoverProps {
  geometry: CommunityCoverGeometry;
  /** Null takes the `--brand-gradient` branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06). */
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** Rendered over the PHOTOGRAPH, above the veil. */
  overlay?: ReactNode;
  /** Rendered inside the GRADIENT fallback, in the persisted contrast ink. `card` geometry only. */
  fallbackOverlay?: ReactNode;
  /** A free slot pinned inside the box on BOTH branches (the page's back control). */
  children?: ReactNode;
}

export function CommunityCover(_props: CommunityCoverProps) {
  return null;
}
