'use client';

import type { ReactNode } from 'react';

/**
 * RED STUB (05.2-06 Task 1) — deliberately inert. The shared highlight sheet (D-110) and its toggle
 * machine are written in the GREEN commit that follows; this file only declares the public types so
 * `tests/highlight-sheet.test.tsx` fails on its ASSERTIONS rather than on a missing module.
 */
export interface HighlightMembershipRow {
  id: string;
  leading: ReactNode;
  title: string;
  meta?: ReactNode;
}

export interface HighlightMembershipListProps {
  rows: readonly HighlightMembershipRow[];
  selectedIds: readonly string[] | null;
  onToggle: (id: string, next: boolean) => Promise<boolean>;
  rowLabel: (row: HighlightMembershipRow) => string;
}

export function HighlightMembershipList(_props: HighlightMembershipListProps) {
  return null;
}

export interface HighlightSheetRow {
  id: string;
  title: string;
  cover: { assetId: string; variantWidths: readonly number[] } | null;
}

export interface HighlightSheetPlace {
  key: string;
  label: string;
  communityId: string | null;
  rows: readonly HighlightSheetRow[];
}

export type HighlightSelection =
  | { kind: 'none' }
  | { kind: 'highlight'; highlightId: string }
  | { kind: 'pending'; communityId: string | null; title: string };

export interface HighlightSheetTitleStepLabels {
  heading: string;
  placeLine: (place: string) => string;
  label: string;
  placeholder: string;
  helper?: string;
  counter: (count: number, limit: number) => string;
  limit: number;
  submitLabel: string;
  submittingLabel: string;
  backLabel: string;
  emptyError: string;
}

interface HighlightSheetBaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  helper?: string;
  places: readonly HighlightSheetPlace[];
  rowLabel: (row: HighlightSheetRow, place: HighlightSheetPlace) => string;
}

export interface HighlightSheetChecklistProps extends HighlightSheetBaseProps {
  mode: 'checklist';
  selectedIds: readonly string[] | null;
  onToggle: (highlightId: string, next: boolean, place: HighlightSheetPlace) => Promise<boolean>;
  empty: ReactNode;
}

export interface HighlightSheetSingleProps extends HighlightSheetBaseProps {
  mode: 'single';
  selection: HighlightSelection;
  onSelect: (selection: HighlightSelection) => void;
  noneLabel: string;
  createLabel: string;
  selectedLabel: string;
  originCommunityId?: string | null;
  titleStep: HighlightSheetTitleStepLabels;
  focusCreateFor?: string | null;
}

export type HighlightSheetProps = HighlightSheetChecklistProps | HighlightSheetSingleProps;

export function HighlightSheet(_props: HighlightSheetProps) {
  return null;
}
