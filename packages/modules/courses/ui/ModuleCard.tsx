import { cn, IconButton } from '@rede-social/ui';
import { Lock, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { GLASS_CHIP_LG } from './member/recipes';

/**
 * A 44px icon control drawn over a module band: a 32px glass disc (the prototype's `bg-black/55`
 * circle) inside the 44px target, a white glyph, the white focus ring, and the ends of a reorder
 * list faded rather than hidden. The host passes it to `ReorderList` as `arrowClassName`, so the two
 * arrows match the band's edit control; merged by `cn`, it overrides `IconButton`'s page-ground look.
 */
export const MODULE_BAND_CONTROL =
  "isolate text-white before:absolute before:inset-1.5 before:-z-10 before:rounded-full before:bg-black/55 before:backdrop-blur-sm before:transition-colors before:content-[''] hover:bg-transparent hover:before:bg-black/70 active:bg-transparent active:before:bg-black/80 focus-visible:ring-white focus-visible:ring-offset-0 disabled:opacity-35";

/**
 * The module of the curriculum editor (08.3-08, UI-D-395, D-406, D-414) — 2026-10-22, the
 * social-igoralves module band: a 16:6 band of the course's art (the host's `art` slot; the tenant
 * gradient without one) under a veil from the left, the two-digit numeral as a huge translucent
 * watermark at the foot (the module's identity: every band shares the art), the "Módulo 01" glass
 * pill at the top left, the two reorder arrows the host's `ReorderList` built and the `Pencil` "Editar
 * módulo" control as glass discs at the top right (the pencil LAST, away from the thumb that is
 * reordering), and, over the foot, the title (16/700, two lines), the `Lock` 12 + "Exige o anterior"
 * caption when the host passes one (never on the first module: the API forces the flag off, D-406)
 * and the meta "{N} aulas · {duration}". Under the band, ALWAYS open (no accordion: the admin edits
 * what it sees), the body card where the host lists the lessons and the "Nova aula" row.
 *
 * The 16:6 is a minimum: the art fills a clipped layer behind in-flow text, so a long title or a
 * 320px screen grows the band instead of clipping the words. The words over the art are white on the
 * veil in both themes. That in-flow block is positioned AFTER the controls, so on a phone (a band
 * ~134px tall) its box reaches up over them: it takes no pointer events (it holds nothing to press)
 * and the controls sit a layer above it (`z-10`), or a tap on an arrow or the pencil lands on words.
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, formats nothing and ships NO
 * words. The host composes the pill, the numeral's accessible name ("Módulo {position}"), the lock
 * caption, the meta and the edit control's name from its catalog. The arrows arrive as a slot so the
 * three protected rules of `ReorderList` (buttons never a drag, focus follows, disabled at the ends)
 * stay the list's.
 *
 * 2026-10-23 (the wide desktop course page): from `lg` the band is 4:1 (the page's left column is
 * ~740px, where 16:6 made each module a 280px poster); still a minimum, the words grow it.
 */
export interface ModuleCardProps {
  /** The 1-based position (the draft's index + 1). */
  position: number;
  /** The numeral's accessible name — "Módulo {position}". */
  positionLabel: string;
  /** The position as two digits ("01"): the watermark. */
  numeral: string;
  /** "Módulo {nn}" — the glass pill's words. */
  pillLabel: string;
  title: string;
  /** "Exige o anterior" when `requiresPrevious` is on; absent renders no caption. */
  requiresPreviousLabel?: string;
  /** Already formatted by the host ("3 aulas · 42 min"). */
  meta: string;
  /** The host's `MediaImage` of the course cover (object-cover); absent takes the gradient. */
  art?: ReactNode;
  /** The two arrow `IconButton`s, built by the host's `ReorderList` (with `MODULE_BAND_CONTROL`). */
  arrows: ReactNode;
  onEdit: () => void;
  /** The edit control's accessible name — "Editar módulo: {module}". */
  editLabel: string;
  /** The `data-module-edit` value, so a host can return focus to this control after a removal. */
  id: string;
  /** The body: the lesson list and the "Nova aula" row. */
  children: ReactNode;
}

export function ModuleCard({
  positionLabel,
  numeral,
  pillLabel,
  title,
  requiresPreviousLabel,
  meta,
  art,
  arrows,
  onEdit,
  editLabel,
  id,
  children,
}: ModuleCardProps) {
  const hasArt = art !== undefined && art !== null;
  return (
    <div data-testid="module-card" className="flex flex-col gap-2">
      <div
        data-testid="module-card-band"
        className="relative flex aspect-[16/6] w-full flex-col justify-end rounded-2xl bg-bg-tertiary lg:aspect-[4/1]"
      >
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-2xl">
          {hasArt ? (
            <span data-testid="module-card-art" className="absolute inset-0 block">
              {art}
            </span>
          ) : (
            <span
              data-testid="module-card-art-fallback"
              className="absolute inset-0 block"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <span
            data-testid="module-card-watermark"
            className="absolute right-4 bottom-1 text-5xl font-extrabold leading-none text-white/10 tabular-nums"
          >
            {numeral}
          </span>
        </div>

        <span
          data-testid="module-card-numeral"
          className={cn(GLASS_CHIP_LG, 'absolute top-3 left-3 max-w-[45%]')}
        >
          <span aria-hidden>{pillLabel}</span>
          <span className="sr-only">{positionLabel}</span>
        </span>

        <div className="absolute top-1 right-1 z-10 flex items-center">
          {arrows}
          <IconButton
            icon={Pencil}
            label={editLabel}
            size={16}
            onClick={onEdit}
            data-module-edit={id}
            aria-haspopup="dialog"
            className={cn('shrink-0', MODULE_BAND_CONTROL)}
          />
        </div>

        <div className="pointer-events-none relative flex min-w-0 flex-col px-4 pt-14 pb-3 pr-16">
          <span
            data-testid="module-card-title"
            className="line-clamp-2 break-words text-base font-bold leading-snug text-white"
          >
            {title}
          </span>
          {requiresPreviousLabel ? (
            <span
              data-testid="module-card-lock"
              className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-white/75"
            >
              <Lock aria-hidden size={12} className="shrink-0" />
              {requiresPreviousLabel}
            </span>
          ) : null}
          <span
            data-testid="module-card-meta"
            className="mt-0.5 text-[11px] font-semibold text-white/75 tabular-nums"
          >
            {meta}
          </span>
        </div>
      </div>

      <div
        data-testid="module-card-body"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        {children}
      </div>
    </div>
  );
}
