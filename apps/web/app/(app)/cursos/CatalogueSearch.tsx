import { cn } from '@rede-social/ui';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 2026-10-26 — the catalogue search of the academy reference ("Buscar cursos…", and the Início's
 * "O que você quer aprender agora?"), FRONT ONLY: a plain GET form to the Cursos screen
 * (`?busca=`), which filters the catalogue it already reads by title and category (no new API, no
 * AI). It works with JavaScript off. A manager's preview keeps `ver=aluno`.
 *
 * `variant="panel"` is the Início's large box: the field with a submit square at the right and,
 * under a hairline, the host's `footer` (the "Populares:" category chips). `variant="field"` is the
 * Cursos header's compact field, submitted by Enter.
 */
export function CatalogueSearch({
  action,
  query,
  preview,
  label,
  placeholder,
  submitLabel,
  variant = 'field',
  footer,
  className,
  testId,
}: {
  /** The Cursos screen's path (`/area-membros/cursos`). */
  action: string;
  /** The current `?busca=`, shown in the field. */
  query?: string | null;
  preview: boolean;
  /** The field's accessible name ("Buscar cursos"). */
  label: string;
  placeholder: string;
  /** The submit square's name ("Buscar"); `panel` only. */
  submitLabel: string;
  variant?: 'field' | 'panel';
  /** Under the field, inside the panel: the popular categories. */
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const panel = variant === 'panel';
  // The search landmark is the `<search>` element (its implicit role), around the plain GET form.
  const form = (
    <search className={cn('flex w-full', !panel && className)}>
      <form
        action={action}
        method="get"
        data-testid={testId}
        className="flex w-full items-center gap-2"
      >
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">{label}</span>
          <Search
            aria-hidden
            size={panel ? 18 : 16}
            className={cn(
              'pointer-events-none absolute shrink-0 text-text-tertiary',
              panel ? 'left-4' : 'left-3.5',
            )}
          />
          <input
            type="search"
            name="busca"
            defaultValue={query ?? ''}
            placeholder={placeholder}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="search"
            className={cn(
              'w-full min-w-0 text-base text-text placeholder:text-text-tertiary focus-visible:outline-none md:text-sm',
              panel
                ? 'h-12 bg-transparent pr-2 pl-11 md:text-[15px]'
                : 'ms-chip-surface h-11 rounded-xl border border-border bg-bg-input pr-3 pl-10 focus-visible:ring-2 focus-visible:ring-brand',
            )}
          />
        </label>
        {preview ? <input type="hidden" name="ver" value="aluno" /> : null}
        {panel ? (
          <button
            type="submit"
            aria-label={submitLabel}
            className="ui-btn ui-btn-brand mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand ring-1 ring-brand/30 transition-colors hover:bg-brand/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Search aria-hidden size={18} />
          </button>
        ) : null}
      </form>
    </search>
  );

  if (!panel) return form;
  return (
    <div
      className={cn(
        'ms-panel flex w-full flex-col overflow-hidden rounded-3xl border border-border bg-card focus-within:ring-2 focus-within:ring-brand/40',
        className,
      )}
    >
      <div className="flex items-center py-1.5 pl-1">{form}</div>
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </div>
  );
}
