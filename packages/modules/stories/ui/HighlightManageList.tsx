'use client';

/**
 * RED STUB (05.2-09 Task 1) — deliberately inert: it renders nothing, so L1-L4 fail on their
 * assertions rather than on an import. The GREEN commit replaces this whole file.
 */

export interface HighlightManageItem {
  id: string;
  title: string;
  meta: string;
  cover: { assetId: string; variantWidths: readonly number[] } | null;
}

export interface HighlightManageListLabels {
  region: string;
  helper: string;
  dragHint: string;
  drag: (title: string) => string;
  edit: (title: string) => string;
  moved: (title: string, position: number, total: number) => string;
}

export interface HighlightManageListProps {
  items: readonly HighlightManageItem[];
  archived?: boolean;
  onReorder: (ids: string[]) => Promise<boolean>;
  onOpen: (id: string) => void;
  labels: HighlightManageListLabels;
}

export function HighlightManageList(_props: HighlightManageListProps) {
  return null;
}
