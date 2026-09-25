'use client';

import { Check } from 'lucide-react';

/**
 * The host-built "no community" row at the top of a `CommunityPickerSheet` — the `leadingRow` both
 * composers pass (UI-D-45, UI-D-55).
 *
 * **Both composers render THIS one row, so the two sheets cannot drift.** The post composer's
 * default ("Feed principal") and the story composer's ("Nenhuma comunidade", D-98) are the same
 * concept in two places: a 32×32 `--brand-gradient` thumb, a 14/400 name that truncates, and the
 * brand `Check` when it is the current choice. Only the words differ, and the words are the host's
 * — this component ships none of its own (PWA-03), exactly like the sheet it sits in. It was
 * extracted from `criar/ComposerForm.tsx` verbatim (05.1-04), never forked.
 *
 * The `data-picker-*` marker below is load-bearing: the comunidades e2e locates the post picker's default row
 * by that attribute.
 */
export interface PickerDefaultRowProps {
  /** The row's visible name and its accessible name — the host's catalog words. */
  label: string;
  /** True when no community is chosen: the row carries the trailing `Check`. */
  selected: boolean;
  /** The `Check` glyph's accessible name ("Selecionado"). */
  selectedLabel: string;
  /** The host's select-and-close handler for "no community". */
  onSelect: () => void;
}

export function PickerDefaultRow({
  label,
  selected,
  selectedLabel,
  onSelect,
}: PickerDefaultRowProps) {
  return (
    <button
      type="button"
      data-picker-default
      aria-label={label}
      onClick={onSelect}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <span
        aria-hidden
        className="h-8 w-8 shrink-0 rounded-lg"
        style={{ backgroundImage: 'var(--brand-gradient)' }}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">{label}</span>
      <span className="shrink-0">
        {selected ? <Check aria-label={selectedLabel} size={20} className="text-brand" /> : null}
      </span>
    </button>
  );
}
