'use client';

import { MediaImage } from '@tria/core/ui';
import { BottomSheet } from '@tria/ui';
import type { ReactNode } from 'react';

/**
 * ONE community row list, over the shipped `BottomSheet` — the body UI-D-45's "Publicar em" picker
 * and UI-D-41's "Fixar em comunidades" sheet both draw.
 *
 * **The trailing control is a PROP, and that is the whole reason this is one component and not
 * two.** UI-D-45 wants a check glyph on the selected row; UI-D-41 wants a `Switch` on every row.
 * Everything else — the 44px row, the 32×32 `rounded-lg` cover thumb with its `--brand-gradient`
 * fallback (D-69/UI-D-35), the 14/400 name that truncates, the tap target, the 80%-height cap the
 * sheet already enforces (UI-D-18) — is identical, and two copies of it would drift on the thumb,
 * the truncation or the row height the first time either sheet changed.
 *
 * Presentational and props-only, the `CommunityCard` posture: it fetches nothing, resolves no URL
 * and **ships no words** (PWA-03). Even the row's accessible name arrives as a function the host
 * supplies, because "Publicar em {community}" and "Fixar em {community}" are different sentences
 * about the same row.
 *
 * **The empty case is the CALLER's.** With zero rows this renders an empty list rather than a
 * message: the "Publicar em" sheet is never empty (its host prepends a "Feed principal" row of its
 * own), while the pin sheet's empty state carries a CTA that only the host can route. A message
 * baked in here would be wrong for one of them.
 *
 * **WITHOUT `onSelect` THE ROW IS NOT A BUTTON, and that is a correctness rule rather than a
 * refinement** (05-08). The "Publicar em" sheet passes `onSelect` and the whole row is its control;
 * the pin sheet does not, because its trailing control is a `Switch` — itself a `<button>`. Wrapping
 * one interactive element in another is invalid HTML, gives the row two tab stops, and lets a tap on
 * the switch bubble into a row handler that should not exist. So the row renders as a plain flex
 * container when nothing selects it, and `trailing` is then the only thing a finger or a keyboard
 * can reach — which is exactly what UI-D-41's drawing shows.
 */
export interface CommunityPickerRow {
  id: string;
  name: string;
  /** Null takes the gradient branch (D-69), exactly as the list card's cover does. */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  coverVariantWidths: readonly number[];
  /** `alt` of the cover thumb, composed by the host from its own catalog. */
  coverAlt: string;
}

export interface CommunityPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading — "Publicar em" here, "Fixar em comunidades" in 05-08. */
  title: string;
  /** Optional line under the heading (UI-D-41's pin helper). The host owns the words. */
  helper?: string;
  rows: readonly CommunityPickerRow[];
  /** The row's accessible name. A function, because the two sheets ask different questions of it. */
  rowLabel: (row: CommunityPickerRow) => string;
  /**
   * THE injected control. A check glyph on the selected row (UI-D-45), a `Switch` on every row
   * (UI-D-41). This component imports neither variant, so neither sheet's dependency leaks into the
   * other's bundle and neither can quietly become "the" control.
   */
  trailing: (row: CommunityPickerRow) => ReactNode;
  /** Fires with the row the member chose. Omitted, the rows are inert and only `trailing` acts. */
  onSelect?: (row: CommunityPickerRow) => void;
  /** Rendered above the community rows — UI-D-45's "Feed principal" entry lives here. */
  leadingRow?: ReactNode;
}

/** The thumb is a fixed 32×32 square in every row, so `sizes` never needs the viewport. */
const THUMB_SIZES = '32px';

/**
 * The row's container: a `<button>` when the host selects on it, a plain `<div>` otherwise.
 *
 * Both branches carry the identical class list, so the two sheets are pixel-identical; the only
 * difference is whether the row itself is focusable. See the docblock above for why the inert
 * branch exists at all.
 */
const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors';
const ROW_INTERACTIVE =
  'hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

function RowShell({
  label,
  onSelect,
  children,
}: {
  label: string;
  onSelect?: () => void;
  children: ReactNode;
}) {
  if (!onSelect) {
    // No accessible name on the container: with nothing to activate, a labelled generic would
    // announce a control that is not there. The trailing `Switch` carries the row's name instead.
    return <div className={ROW}>{children}</div>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onSelect}
      className={`${ROW} ${ROW_INTERACTIVE}`}
    >
      {children}
    </button>
  );
}

export function CommunityPickerSheet({
  open,
  onClose,
  title,
  helper,
  rows,
  rowLabel,
  trailing,
  onSelect,
  leadingRow,
}: CommunityPickerSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {helper ? <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p> : null}
      <ul className="flex flex-col">
        {leadingRow ? <li>{leadingRow}</li> : null}
        {rows.map((row) => (
          <li key={row.id}>
            {/* `min-h-11` is the 44px row UI-D-41/UI-D-45 both specify. With `onSelect` it is also
                the tap target — the whole row is the control, never the glyph at its end; without
                it the row is inert and `trailing` owns the interaction (see the docblock). */}
            <RowShell label={rowLabel(row)} onSelect={onSelect ? () => onSelect(row) : undefined}>
              {row.coverAssetId !== null ? (
                <span
                  data-picker-cover
                  className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
                >
                  <MediaImage
                    assetId={row.coverAssetId}
                    widths={row.coverVariantWidths}
                    alt={row.coverAlt}
                    sizes={THUMB_SIZES}
                    ratio=""
                    className="h-full w-full"
                  />
                </span>
              ) : (
                // D-69 / UI-D-35: a cover-less community is the tenant's own gradient, never a
                // broken-image glyph and never a neutral box. Inline because the gradient is a
                // runtime tenant variable with no Tailwind class of its own.
                <span
                  data-picker-cover-fallback
                  className="h-8 w-8 shrink-0 rounded-lg"
                  style={{ backgroundImage: 'var(--brand-gradient)' }}
                />
              )}
              {/* The only flexible child: at any name length the thumb and the control keep their
                  size and the NAME is what gives way, so the row never wraps to a second line. */}
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                {row.name}
              </span>
              <span className="shrink-0">{trailing(row)}</span>
            </RowShell>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
