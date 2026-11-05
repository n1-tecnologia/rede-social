import { cn } from '@rede-social/ui';
import { Check, ChevronRight, Lock, Play } from 'lucide-react';
import { MemberLessonThumb, type MemberLessonThumbState } from './MemberLessonThumb';

/**
 * One lesson of the member curriculum (08.5-07, UI-D-430, A-UI-3), ported from the prototype's
 * `LessonRow` as `MemberLessonRow` (the admin `LessonRow` keeps its name, R-Pitfall 12).
 *
 * **Always a link**, locked rows too: the prototype's dead `<div>` becomes an `<a>` to the lesson
 * URL, so a tap on a padlock lands on the lesson's lock page, where the server says why and the buy
 * or "Continuar" door waits (UI-D-431).
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The prototype's row
 * again: the 96px `MemberLessonThumb`, the title 14/600 (`line-clamp-2`; a completed lesson's title
 * steps back to the secondary ink), the meta 11px (a leading `Lock` when the host says it is a lock
 * reason) and the trailing state — the success disc with `Check` (done), `Lock` (locked) or
 * `ChevronRight`. **`current`** (the player's list) marks the row `aria-current="page"` with the
 * brand hairline ring, and its meta ("Assistindo agora") becomes a pill on the brand tint, in the
 * dark ink. Glyphs are `aria-hidden`; the host's `ariaLabel` says the state in words.
 *
 * Props only, no words, no route (MOD-02): the href, the title, the meta and the name come from the
 * host. A plain `<a>` (no framework import).
 *
 * **2026-10-26 (the academy reference's lesson list).** Every row is a rounded tile that lights up
 * on hover; the trailing state is a disc: the success disc (done), a quiet glass disc with the
 * padlock (locked), the brand-filled disc with `Play` on the CURRENT row (a faint brand tint under
 * its ring), and otherwise the chevron, which steps 2px forward on hover. The title is 14/500.
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
  /** The meta is a lock reason: a `Lock` leads it. */
  metaLocked?: boolean;
  trailing: MemberLessonTrailing;
  thumbState: MemberLessonThumbState;
  resumePercent?: number;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The lesson open in the player. */
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
      data-current={current ? 'true' : undefined}
      className={cn(
        'group flex min-h-14 items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-bg-hover',
        current && 'bg-brand/[0.06] ring-1 ring-brand/40 ring-inset',
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
          className={cn(
            'line-clamp-2 break-words text-sm font-medium leading-snug',
            trailing === 'done' && !current ? 'text-text-secondary' : 'text-text',
          )}
        >
          {title}
        </span>
        {meta ? (
          current ? (
            <span className="mt-1 flex">
              <span
                data-testid="member-lesson-meta"
                className="inline-flex max-w-full items-center truncate rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text"
              >
                {meta}
              </span>
            </span>
          ) : (
            <span
              data-testid="member-lesson-meta"
              className="mt-1 flex items-center gap-1 text-[11px] font-normal text-text-tertiary tabular-nums"
            >
              {metaLocked ? <Lock aria-hidden size={10} className="shrink-0" /> : null}
              <span className="min-w-0">{meta}</span>
            </span>
          )
        ) : null}
      </span>
      <span
        aria-hidden
        data-testid="member-lesson-trailing"
        className="flex h-7 w-7 shrink-0 items-center justify-center"
      >
        {trailing === 'done' ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
            <Check size={13} strokeWidth={3} />
          </span>
        ) : trailing === 'locked' ? (
          <span className="ms-chip-surface flex h-7 w-7 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary">
            <Lock size={13} />
          </span>
        ) : current ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-on-brand ring-4 ring-brand/20">
            <Play size={12} fill="currentColor" className="ml-0.5" />
          </span>
        ) : (
          <ChevronRight
            size={16}
            className="text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        )}
      </span>
    </a>
  );
}
