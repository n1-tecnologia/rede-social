import { cn } from '@rede-social/ui';
import { ChevronRight, CircleCheck, Lock } from 'lucide-react';
import { MemberLessonThumb, type MemberLessonThumbState } from './MemberLessonThumb';

/**
 * One lesson of the member curriculum (08.5-07, UI-D-430, A-UI-3), ported from the prototype's
 * `LessonRow` as `MemberLessonRow` (the admin `LessonRow` keeps its name, R-Pitfall 12).
 *
 * **Always a link**, locked rows too: the prototype's dead `<div>` becomes an `<a>` to the lesson
 * URL, so a tap on a padlock lands on the lesson's lock page, where the server says why and the buy
 * or "Continuar" door waits (UI-D-431). A lock that changed since render is corrected there too (E07
 * error).
 *
 * In order: the 80px `MemberLessonThumb`, a `min-w-0 flex-1` column with the title (`line-clamp-2`)
 * and the meta (with a leading `Lock` 12 when the host says the meta is a lock reason), and a 20px
 * trailing state — `CircleCheck` (done), `Lock` (locked) or `ChevronRight`. Glyphs are `aria-hidden`;
 * the host's `ariaLabel` says the state in words. **`current`** (the player's list, plan 08) marks
 * the row `aria-current="page"` on the `bg-bg-tertiary rounded-xl` ground, and the host passes
 * "Assistindo agora" as its meta.
 *
 * Props only, no words, no route (MOD-02): the href, the title, the meta and the name come from the
 * host. A plain `<a>` (no framework import).
 */
export type MemberLessonTrailing = 'done' | 'locked' | 'chevron';

export interface MemberLessonRowProps {
  /** Built by the HOST (`/cursos/{courseId}/aulas/{lessonId}`, `?ver=aluno` in preview). */
  href: string;
  /** "{lesson}, {state}", or the title alone when open. */
  ariaLabel: string;
  title: string;
  /** Already formatted: "12:34 · Aula aberta", "Prática", "Libera ao concluir …". */
  meta: string;
  /** The meta is a lock reason: a `Lock` 12 leads it. */
  metaLocked?: boolean;
  trailing: MemberLessonTrailing;
  thumbState: MemberLessonThumbState;
  resumePercent?: number;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The lesson open in the player (plan 08). */
  current?: boolean;
  /** The `data-lesson-id` value, for tests and the host. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

export function MemberLessonRow({
  href,
  ariaLabel,
  title,
  meta,
  metaLocked = false,
  trailing,
  thumbState,
  resumePercent,
  coverAssetId,
  coverWidths,
  current = false,
  id,
}: MemberLessonRowProps) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      aria-current={current ? 'page' : undefined}
      data-testid="member-lesson-row"
      data-lesson-id={id}
      data-trailing={trailing}
      className={cn(
        'flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-bg-hover',
        current && 'rounded-xl bg-bg-tertiary',
        FOCUS,
      )}
    >
      <MemberLessonThumb
        state={thumbState}
        resumePercent={resumePercent}
        coverAssetId={coverAssetId}
        coverWidths={coverWidths}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          data-testid="member-lesson-title"
          className="line-clamp-2 break-words text-sm font-bold leading-tight text-text"
        >
          {title}
        </span>
        {meta ? (
          <span
            data-testid="member-lesson-meta"
            className={cn(
              'mt-1 flex items-center gap-1 text-xs tabular-nums',
              current ? 'font-bold text-text' : 'font-normal text-text-tertiary',
            )}
          >
            {metaLocked ? <Lock aria-hidden size={12} className="shrink-0" /> : null}
            <span className="min-w-0">{meta}</span>
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        data-testid="member-lesson-trailing"
        className="flex h-5 w-5 shrink-0 items-center justify-center"
      >
        {trailing === 'done' ? (
          <CircleCheck size={20} className="text-success" />
        ) : trailing === 'locked' ? (
          <Lock size={18} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={18} className="text-text-tertiary" />
        )}
      </span>
    </a>
  );
}
