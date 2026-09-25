'use client';

/**
 * RED STUB (05.2-06 Task 1) — deliberately inert. The shared "Novo destaque" title step is written in
 * the GREEN commit that follows; this file exists only so `tests/highlight-sheet.test.tsx` can import
 * it and fail on its ASSERTIONS rather than on a missing module.
 */
export interface HighlightTitleStepProps {
  heading?: string;
  placeLine?: string;
  label: string;
  placeholder: string;
  helper?: string;
  counter: (count: number, limit: number) => string;
  limit: number;
  submitLabel: string;
  submittingLabel: string;
  backLabel?: string;
  emptyError: string;
  onBack?: () => void;
  onSubmit: (title: string) => Promise<boolean> | boolean;
}

export function HighlightTitleStep(_props: HighlightTitleStepProps) {
  return null;
}
