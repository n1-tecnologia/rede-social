'use client';

import type { ReactNode } from 'react';

/**
 * RED SKELETON (05-08 Task 3) — signature-only and deliberately wrong. The types are the real ones
 * (they are the contract the host composes against); the component renders nothing.
 */

export interface PinStoryCommunityRow {
  id: string;
  name: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
}

export type CommunityPickerSheetBody = (props: {
  open: boolean;
  onClose: () => void;
  title: string;
  helper?: string;
  rows: readonly PinStoryCommunityRow[];
  rowLabel: (row: PinStoryCommunityRow) => string;
  trailing: (row: PinStoryCommunityRow) => ReactNode;
  leadingRow?: ReactNode;
}) => ReactNode;

export interface PinStorySheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  helper?: string;
  rows: readonly PinStoryCommunityRow[];
  pinnedCommunityIds: readonly string[];
  rowLabel: (row: PinStoryCommunityRow) => string;
  onToggle: (communityId: string, next: boolean) => Promise<boolean>;
  empty: ReactNode;
  renderList: CommunityPickerSheetBody;
}

export function PinStorySheet(_props: PinStorySheetProps): ReactNode {
  return null;
}
