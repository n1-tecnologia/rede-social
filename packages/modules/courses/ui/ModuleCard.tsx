import { Card, IconButton } from '@rede-social/ui';
import { Lock, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The module card of the curriculum editor (08.3-08, UI-D-395, D-406, D-414): `Card p-0
 * overflow-hidden` with a header row — the **numeral** in a 32×32 `bg-bg-tertiary rounded-lg`
 * square (the prototype's `ModuleCover` numeral, without art), the title 14/700 clamped to two lines,
 * the `Lock` 12 + "Exige o anterior" caption when the host passes one (never on the first module:
 * the API forces the flag off, D-406), the meta "{N} aulas · {duration}" 12/400 secondary, the two
 * arrow buttons the host's `ReorderList` built, and the `Pencil` "Editar módulo" control — and a
 * body slot under a hairline where the host lists the lessons.
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, formats nothing and ships NO
 * words. The host composes the numeral's name ("Módulo {position}"), the lock caption, the meta and
 * the edit control's name from its catalog. The arrows arrive as a slot so the three protected rules
 * of `ReorderList` (buttons never a drag, focus follows, disabled at the ends) stay the list's.
 */
export interface ModuleCardProps {
  /** The 1-based position the numeral shows. */
  position: number;
  /** The numeral's accessible name — "Módulo {position}". */
  positionLabel: string;
  title: string;
  /** "Exige o anterior" when `requiresPrevious` is on; absent renders no caption. */
  requiresPreviousLabel?: string;
  /** Already formatted by the host ("3 aulas · 42 min"). */
  meta: string;
  /** The two arrow `IconButton`s, built by the host's `ReorderList`. */
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
  position,
  positionLabel,
  title,
  requiresPreviousLabel,
  meta,
  arrows,
  onEdit,
  editLabel,
  id,
  children,
}: ModuleCardProps) {
  return (
    <Card data-testid="module-card" className="p-0">
      <div className="flex min-h-14 items-center gap-3 px-3 py-2">
        <span
          data-testid="module-card-numeral"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-base font-bold tabular-nums text-text"
        >
          <span aria-hidden>{position}</span>
          <span className="sr-only">{positionLabel}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            data-testid="module-card-title"
            className="line-clamp-2 break-words text-sm font-bold leading-tight text-text"
          >
            {title}
          </span>
          {requiresPreviousLabel ? (
            <span
              data-testid="module-card-lock"
              className="mt-0.5 flex items-center gap-1 text-xs font-normal text-text-tertiary"
            >
              <Lock aria-hidden size={12} className="shrink-0" />
              {requiresPreviousLabel}
            </span>
          ) : null}
          <span
            data-testid="module-card-meta"
            className="mt-0.5 text-xs font-normal text-text-secondary tabular-nums"
          >
            {meta}
          </span>
        </span>
        {arrows}
        <IconButton
          icon={Pencil}
          label={editLabel}
          size={20}
          onClick={onEdit}
          data-module-edit={id}
          aria-haspopup="dialog"
          className="shrink-0"
        />
      </div>
      <div className="border-t border-divider">{children}</div>
    </Card>
  );
}
