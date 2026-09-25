'use client';

import type { ReactNode } from 'react';
import type { HighlightMembershipRow } from './HighlightSheet';

/**
 * RED STUB (05.2-09 Task 1) — deliberately inert: it renders nothing, so E1-E7 fail on their
 * assertions rather than on an import. The GREEN commit replaces this whole file.
 */

export interface HighlightEditCover {
  assetId: string;
  variantWidths: readonly number[];
}

export interface HighlightEditHighlight {
  id: string;
  title: string;
  cover: HighlightEditCover | null;
  coverChosen: boolean;
  position: number;
  total: number;
  archived: boolean;
}

export interface HighlightEditItem {
  id: string;
  thumb: { assetId: string | null; variantWidths: readonly number[] };
  mediaKind: 'image' | 'video';
  dateLabel: string;
  status?: { tone: 'warning' | 'danger'; label: string };
  isCover: boolean;
}

export type HighlightEditStep = 'main' | 'cover' | 'picker';

export interface HighlightEditSheetLabels {
  title: string;
  cover: string;
  changeCover: string;
  name: string;
  saveName: string;
  savingName: string;
  counter: (count: number, limit: number) => string;
  limit: number;
  position: (position: number, total: number) => string;
  moveUp: string;
  moveDown: string;
  stories: string;
  coverPill: string;
  remove: (item: HighlightEditItem) => string;
  addStories: string;
  delete: string;
  emptyTitle: string;
  emptyBody: string;
  archivedNote: string;
  back: string;
  coverTitle: string;
  coverOption: (item: HighlightEditItem) => string;
  auto: string;
  autoHelper: string;
  noImages: string;
  pickerTitle: string;
  pickerHelper: string;
  pickerRow: (row: HighlightMembershipRow) => string;
  confirmDelete: { title: string; body: string; confirm: string; cancel: string };
}

export interface HighlightEditSheetProps {
  open: boolean;
  onClose: () => void;
  highlight: HighlightEditHighlight;
  items: readonly HighlightEditItem[] | null;
  onRename: (title: string) => Promise<boolean>;
  onMove: (delta: -1 | 1) => void;
  onRemove: (storyId: string) => Promise<boolean>;
  onCover: (cover: { storyId: string } | null) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  uploadTile: ReactNode;
  pickerRows: readonly HighlightMembershipRow[];
  pickerSelectedIds: readonly string[] | null;
  onPickerToggle: (storyId: string, next: boolean) => Promise<boolean>;
  pickerFooter?: ReactNode;
  pickerEmpty?: ReactNode;
  onStepChange?: (step: HighlightEditStep) => void;
  labels: HighlightEditSheetLabels;
}

export function HighlightEditSheet(_props: HighlightEditSheetProps) {
  return null;
}
