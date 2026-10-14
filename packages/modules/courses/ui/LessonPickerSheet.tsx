'use client';

import { BottomSheet, cn, EmptyState, SectionTitle } from '@rede-social/ui';
import { Check, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { RowSkeleton } from './RowSkeleton';

/**
 * The live form's replay picker (08.3-11, D-416, UI-D-403): a `BottomSheet` single-select over the
 * tenant's lessons GROUPED BY COURSE — "Sem replay" first, then one `SectionTitle` per course and its
 * lessons as 44px rows with the 16:9 thumb (the lesson's poster, or the `Video` glyph) and the title
 * — where the chosen row carries a `Check` 20 in brand ink, the sheet's ONLY brand ink (UI-D-206).
 * The `CategoryPickerSheet` posture (one tap selects and the host closes the sheet), grouped.
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, resolves no route and ships NO
 * words — the title, the helper, the none label, every row's name ("{lesson}, de {course}") and the
 * empty copy arrive from the host, which also decides WHICH lessons are listed (the page reads the
 * API's picker list only once the live has ended). Choosing a row hands back its id, or `null` for
 * the none row.
 *
 * Three states (E13): `loading` draws 4 wordless row skeletons (UI-D-401), zero lessons draws the
 * none row and the host's empty copy under a `Video` glyph (no action: lessons are created
 * elsewhere), otherwise the groups. The sheet body is the scroll container (the shipped 80%-height
 * cap), so a long list scrolls INSIDE the sheet (E13 overflow).
 *
 * Rows are `<button role="radio" aria-checked>`: one tap selects, so the whole 44px row is the
 * control and the glyph at its end never has to be aimed at.
 */
export interface LessonPickerLesson {
  id: string;
  title: string;
  /** The host's 16:9 thumb (`MediaImage`); absent takes the `Video` glyph (UI-D-403). */
  thumb?: ReactNode;
}

export interface LessonPickerGroup {
  courseId: string;
  courseTitle: string;
  lessons: readonly LessonPickerLesson[];
}

export interface LessonPickerLabels {
  /** The row's accessible name — "{lesson}, de {course}". */
  row: (lesson: string, course: string) => string;
}

export interface LessonPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading ("Replay"). */
  title: string;
  /** Optional line under the heading ("Escolha a aula que guarda a gravação."). */
  helper?: string;
  /** The tenant's lessons grouped by course, in the host's (the API's) order. */
  groups: readonly LessonPickerGroup[];
  /** The chosen lesson id, or `null` for "Sem replay". */
  selectedId: string | null;
  /** The none row's label ("Sem replay"). */
  noneLabel: string;
  /** Fires with the chosen id, or `null` for the none row. */
  onSelect: (id: string | null) => void;
  labels: LessonPickerLabels;
  /** The copy of the no-lesson state (UI-D-401); the host owns the words. */
  empty: { title: string; body: string };
  /** True while the host's lessons load: 4 row skeletons instead of groups. */
  loading?: boolean;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The 16:9 thumb slot of every row: 56px wide, `rounded-lg`, on `bg-bg-tertiary`. */
const THUMB = 'relative block w-14 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary aspect-video';

/** Four row placeholders while the host's lessons load (E13 loading). */
const LOADING_ROWS = [0, 1, 2, 3];

function Trailing({ selected }: { selected: boolean }) {
  return selected ? (
    <Check
      aria-hidden
      size={20}
      strokeWidth={2.5}
      data-testid="lesson-picker-check"
      className="shrink-0 text-brand"
    />
  ) : (
    <span aria-hidden className="block h-5 w-5 shrink-0" />
  );
}

export function LessonPickerSheet({
  open,
  onClose,
  title,
  helper,
  groups,
  selectedId,
  noneLabel,
  onSelect,
  labels,
  empty,
  loading = false,
}: LessonPickerSheetProps) {
  const lessonCount = groups.reduce((sum, group) => sum + group.lessons.length, 0);

  let body: ReactNode;
  if (loading) {
    body = (
      <div aria-busy data-testid="lesson-picker-loading">
        {LOADING_ROWS.map((index) => (
          <RowSkeleton key={index} variant="wide" />
        ))}
      </div>
    );
  } else if (lessonCount === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={Video}
        data-testid="lesson-picker-empty"
        title={empty.title}
        body={empty.body}
      />
    );
  } else {
    body = groups
      .filter((group) => group.lessons.length > 0)
      .map((group) => (
        <section
          key={group.courseId}
          data-testid="lesson-picker-group"
          data-course-id={group.courseId}
          className="flex flex-col pt-2"
        >
          {/* The course's title names the group; the rows below carry it in their own name too. */}
          <SectionTitle as="h3" variant="group" className="px-2 pb-1">
            {group.courseTitle}
          </SectionTitle>
          {group.lessons.map((lesson) => {
            const selected = lesson.id === selectedId;
            const hasThumb = lesson.thumb !== undefined && lesson.thumb !== null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: UI-D-403 / UI-D-206 fix a 44px row BUTTON that selects on one tap and closes the sheet; a native radio input needs a form, a legend and a separate submit
              <button
                key={lesson.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={labels.row(lesson.title, group.courseTitle)}
                data-testid="lesson-picker-row"
                data-lesson-id={lesson.id}
                onClick={() => onSelect(lesson.id)}
                className={ROW}
              >
                <span
                  className={cn(THUMB, hasThumb ? undefined : 'flex items-center justify-center')}
                  data-testid={hasThumb ? 'lesson-picker-thumb' : 'lesson-picker-fallback'}
                >
                  {hasThumb ? (
                    <span className="absolute inset-0 block">{lesson.thumb}</span>
                  ) : (
                    <Video aria-hidden size={18} className="text-text-tertiary" />
                  )}
                </span>
                {/* The only flexible child: a long title clamps to two lines, the thumb and the check keep their size. */}
                <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-normal text-text">
                  {lesson.title}
                </span>
                <Trailing selected={selected} />
              </button>
            );
          })}
        </section>
      ));
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {helper ? <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p> : null}
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {/* The none row comes FIRST (UI-D-403): a live without a replay is the common case. */}
        {/* biome-ignore lint/a11y/useSemanticElements: UI-D-403 / UI-D-206 fix a 44px row BUTTON that selects on one tap and closes the sheet; a native radio input needs a form, a legend and a separate submit */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedId === null}
          data-testid="lesson-picker-none"
          onClick={() => onSelect(null)}
          className={ROW}
        >
          <span className={cn(THUMB, 'flex items-center justify-center')}>
            <Video aria-hidden size={18} className="text-text-tertiary" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">{noneLabel}</span>
          <Trailing selected={selectedId === null} />
        </button>
        {body}
      </div>
    </BottomSheet>
  );
}
