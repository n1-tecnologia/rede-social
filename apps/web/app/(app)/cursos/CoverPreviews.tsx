import { SCRIM_TRACK_CARD } from '@rede-social/module-courses/ui';
import { cn } from '@rede-social/ui';
import { ArrowUpRight, BookOpen } from 'lucide-react';

/**
 * 2026-10-27 — the cover field's previews of a track and a course (the product owner: "adicione os
 * tipos de imagem que podem aparecer na trilha", then "faça o mesmo para cursos"): the SAME image as
 * the member sees it, drawn over the cover field's blocks with the words the admin is typing.
 *
 *  - `TrackCardPreview`: the track card of Início and Trilhas (`MemberTrackCard`): the art on a black
 *    ground under the veil dark at the top, the eyebrow with the book glyph, the title and the
 *    "Acesse ↗" chip at the foot. (A course card carries its title under the picture, so its block
 *    shows the picture alone.)
 *  - `PagePreview`: the wide top of a track's or a course's page (`MemberDetailHero`): the eyebrow,
 *    the title and the line under it over a veil that darkens the left side.
 *
 * Decoration only (`aria-hidden`, no pointer events): the field and its words are the control. Every
 * word arrives from the form's catalog; an empty title or line draws nothing.
 */
export function TrackCardPreview({
  eyebrow,
  title,
  cta,
}: {
  eyebrow: string;
  title: string;
  cta: string;
}) {
  return (
    <span
      aria-hidden
      data-track-cover-card=""
      className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-black/20 p-3.5"
    >
      <span className={cn('absolute inset-0 block', SCRIM_TRACK_CARD)} />
      <span className="relative flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1 text-[9px] font-medium uppercase tracking-wide text-white/60">
          <BookOpen size={10} className="shrink-0" />
          <span className="min-w-0 truncate">{eyebrow}</span>
        </span>
        {title ? (
          <span className="line-clamp-2 break-words text-xl font-medium leading-tight tracking-tight text-white">
            {title}
          </span>
        ) : null}
      </span>
      <span className="relative inline-flex w-fit items-center gap-1 rounded-full border border-white/20 bg-white/[0.05] px-2.5 py-0.5 text-[9px] font-medium text-white/80">
        {cta}
        <ArrowUpRight size={9} className="shrink-0" />
      </span>
    </span>
  );
}

export function PagePreview({
  eyebrow,
  title,
  line,
}: {
  eyebrow?: string | null;
  title: string;
  line?: string | null;
}) {
  return (
    <span
      aria-hidden
      data-cover-page-preview=""
      className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-0.5 bg-gradient-to-r from-black/75 via-black/35 to-black/10 px-4"
    >
      {eyebrow ? (
        <span className="truncate text-[7px] font-bold uppercase tracking-[0.14em] text-white/70">
          {eyebrow}
        </span>
      ) : null}
      {title ? (
        <span className="truncate text-base font-medium leading-tight tracking-tight text-white">
          {title}
        </span>
      ) : null}
      {line ? <span className="truncate text-[9px] text-white/75">{line}</span> : null}
    </span>
  );
}
