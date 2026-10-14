'use client';

import { BottomSheet, Button, cn, EmptyState } from '@rede-social/ui';
import { Check, GraduationCap } from 'lucide-react';
import type { ReactNode } from 'react';
import { RowSkeleton } from './RowSkeleton';

/**
 * The checklist sheet of the track form's courses (08.3-10, D-415, UI-D-402) and, since 08.4
 * (D-418, UI-D-415), of the product form's "Cursos liberados" and "Lives liberadas": a `BottomSheet`
 * over the host's items — each a 44px row with the thumb (3:4 `w-8`, the catalogue's crop), the title
 * truncating, an optional meta line under it, and a `Check` 20 in brand ink on an included row — with
 * a sticky "Concluir" footer. One tap toggles: the whole row is the control (`aria-pressed`, the
 * host's "{course}, incluído" / "{course}, não incluído" name), never the glyph at its end. The
 * `CommunityPickerSheet` posture, multi-select.
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, resolves no route and ships NO
 * words — the title, the helper, every row's name, meta and label, the footer's label and the empty
 * copy arrive from the host. The host also decides WHICH items are listed (the track form reads the
 * published catalogue, the product form the draft and published courses or the non-cancelled lives),
 * so the server's `course_invalid` is explained before it can happen.
 *
 * Every 08.4 prop is optional: with no `meta` on an item the row renders exactly as in 08.3, so the
 * track form is untouched.
 *
 * Three states (E12): `loading` draws 4 wordless row skeletons (UI-D-401), zero items draws the
 * host's empty copy under a `GraduationCap` with no action (publishing happens elsewhere), otherwise
 * the rows. The sheet body is the scroll container (the shipped 80%-height cap), so a long list
 * scrolls INSIDE the sheet while the footer stays pinned (E12 overflow).
 */
export interface CoursePickerItem {
  id: string;
  title: string;
  /** The host's 3:4 thumb (`MediaImage`); absent takes the gradient branch (D-69). */
  thumb?: ReactNode;
  /**
   * An optional 12/400 secondary line under the title (08.4, UI-D-415): "Rascunho" on a draft
   * course, "{date}, {time} · {status}" on a live. Absent, the row is the 08.3 row.
   */
  meta?: string;
}

export interface CoursePickerLabels {
  /** The row's accessible name while included — "{course}, incluído". */
  rowOn: (title: string) => string;
  /** The row's accessible name while not included — "{course}, não incluído". */
  rowOff: (title: string) => string;
  /** The footer button — "Concluir". */
  done: string;
}

export interface CoursePickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading ("Cursos da trilha"). */
  title: string;
  /** Optional line under the heading ("Toque para incluir ou tirar. Só cursos publicados aparecem."). */
  helper?: string;
  /** The tenant's PUBLISHED courses, in the host's (the API's) order. */
  items: readonly CoursePickerItem[];
  /** The ids currently included (the track's list plus the admin's edits). */
  selectedIds: readonly string[];
  /** One tap on a row: include it or take it out. */
  onToggle: (id: string) => void;
  /** The footer's "Concluir": the host closes the sheet. */
  onDone: () => void;
  labels: CoursePickerLabels;
  /** The copy of the no-published-course state (UI-D-401); the host owns the words. */
  empty: { title: string; body: string };
  /** True while the host's courses load: 4 row skeletons instead of rows. */
  loading?: boolean;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The 3:4 thumb slot of every row: 32px wide, `rounded-lg`, on `bg-bg-tertiary`. */
const THUMB = 'relative block w-8 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary aspect-[3/4]';

/** Four row placeholders while the host's courses load (E12 loading). */
const LOADING_ROWS = [0, 1, 2, 3];

export function CoursePickerSheet({
  open,
  onClose,
  title,
  helper,
  items,
  selectedIds,
  onToggle,
  onDone,
  labels,
  empty,
  loading = false,
}: CoursePickerSheetProps) {
  let body: ReactNode;
  if (loading) {
    body = (
      <div aria-busy data-testid="course-picker-loading">
        {LOADING_ROWS.map((index) => (
          <RowSkeleton key={index} variant="poster" />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={GraduationCap}
        data-testid="course-picker-empty"
        title={empty.title}
        body={empty.body}
      />
    );
  } else {
    body = (
      <ul className="flex flex-col" data-testid="course-picker-list">
        {items.map((item) => {
          const on = selectedIds.includes(item.id);
          const hasThumb = item.thumb !== undefined && item.thumb !== null;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-label={on ? labels.rowOn(item.title) : labels.rowOff(item.title)}
                aria-pressed={on}
                data-testid="course-picker-row"
                data-course-id={item.id}
                onClick={() => onToggle(item.id)}
                className={ROW}
              >
                <span
                  className={THUMB}
                  data-testid={hasThumb ? 'course-picker-thumb' : 'course-picker-fallback'}
                  style={hasThumb ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
                >
                  {hasThumb ? <span className="absolute inset-0 block">{item.thumb}</span> : null}
                </span>
                {/* The only flexible child: a long title (and meta) truncates, the thumb and the check keep their size. */}
                {item.meta ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-normal text-text">{item.title}</span>
                    <span
                      data-testid="course-picker-meta"
                      className="truncate text-xs font-normal text-text-secondary"
                    >
                      {item.meta}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                    {item.title}
                  </span>
                )}
                <span className="shrink-0">
                  {on ? (
                    <Check
                      aria-hidden
                      size={20}
                      strokeWidth={2.5}
                      data-testid="course-picker-check"
                      className="text-brand"
                    />
                  ) : (
                    <span aria-hidden className="block h-5 w-5" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {helper ? <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p> : null}
      {body}
      {/* Pinned to the panel's real bottom edge over the body's 16px padding (the picker footer rule). */}
      <div
        data-picker-footer
        className={cn('sticky -bottom-4 z-10 -mx-4 -mb-4 mt-2 bg-bg-secondary px-4 pt-3 pb-4')}
      >
        <Button
          type="button"
          variant="secondary"
          size="md"
          fullWidth
          data-testid="course-picker-done"
          onClick={onDone}
        >
          {labels.done}
        </Button>
      </div>
    </BottomSheet>
  );
}
