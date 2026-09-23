'use client';

import type { ReactNode } from 'react';

/**
 * RED-phase skeleton (05-04 Task 1). The signature is the contract
 * `tests/community-page-ui.test.tsx` was written against; the BODY is deliberately empty so the
 * assertions — not the module loader — are what fail. The GREEN commit fills it in.
 */
export interface CommunityHeaderProps {
  name: string;
  description: string;
  /** Built by the HOST; the module knows no route table (MOD-02). */
  backHref: string;
  backLabel: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** Optional slot BESIDE the name (the neutral "Arquivada" pill, UI-D-37). */
  statusPill?: ReactNode;
  /** Optional slot UNDER the description (the archived note). */
  note?: ReactNode;
}

export function CommunityHeader(_props: CommunityHeaderProps) {
  return null;
}
