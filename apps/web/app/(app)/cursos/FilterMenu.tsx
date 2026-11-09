'use client';

import { buttonClasses, cn } from '@rede-social/ui';
import { Check, ListFilter } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/** One choice of a list's filter: its `?filtro=` page and whether it is the one on screen. */
export interface FilterOption {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';

/** The panel keeps this distance from the screen's left edge when it has to move in. */
const SCREEN_GUTTER = 8;

/**
 * 2026-10-23 — the admin lists' filter (Cursos: Todos · Rascunhos · Publicados · Arquivados;
 * Trilhas: Ativas · Arquivadas; Lives: Próximas · Passadas) as ONE icon button beside "Novo …"
 * that opens a dropdown, in place of the row of chips under the title (the user's call).
 *
 * The kernel `AreaMenu`'s disclosure, and its panel's look: a button with
 * `aria-expanded`/`aria-controls` over a panel of plain links, each a `?filtro=` page load as the
 * chips were, the current one `aria-current="page"` with the brand tint and a check. A tap outside,
 * Escape (focus back on the button) and a pick close it.
 *
 * The closed button still says which filter is on: its name is `buttonLabel` ("Filtrar cursos:
 * Rascunhos"), and any choice but the list's default (the first option) tints it with the brand
 * and adds a dot. 44px, the outline button's look, so "Novo …" stays the screen's one brand fill.
 *
 * The panel opens under the button, right-aligned to it. On a narrow phone the button sits left of
 * "Novo …", so a right-aligned panel would leave the screen on the left: measured before paint, it
 * moves right just enough to keep `SCREEN_GUTTER` from the edge.
 */
export function FilterMenu({
  label,
  buttonLabel,
  options,
  testId,
  text,
}: {
  /** The panel's name ("Filtrar cursos"). */
  label: string;
  /** The button's name, with the current choice ("Filtrar cursos: Todos"). */
  buttonLabel: string;
  options: FilterOption[];
  /** The panel's test id (`courses-filters`, …); the button's is `{testId}-button`. */
  testId: string;
  /**
   * 2026-10-26 (the member catalogue, the academy reference's "Filtros"): a word drawn beside the
   * glyph; without it the button is the 44px icon of the admin lists.
   */
  text?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const filtered = options.findIndex((option) => option.active) > 0;

  // Before paint: a panel that would cross the screen's left edge moves right, by just enough.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const left = panelRef.current?.getBoundingClientRect().left ?? SCREEN_GUTTER;
    setShift(left < SCREEN_GUTTER ? SCREEN_GUTTER - left : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`${testId}-button`}
        data-filtered={filtered ? '' : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          buttonClasses({
            variant: 'outline',
            size: 'sm',
            className: text
              ? 'relative h-11 shrink-0 gap-2 px-4 text-sm font-semibold'
              : 'relative h-11 w-11 shrink-0 px-0',
          }),
          (open || filtered) && 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/15',
        )}
      >
        <ListFilter aria-hidden size={18} />
        {text ? <span aria-hidden>{text}</span> : null}
        {filtered ? (
          <span
            aria-hidden
            data-filter-dot=""
            className="absolute top-2 right-2 h-2 w-2 rounded-full bg-brand ring-2 ring-bg"
          />
        ) : null}
      </button>

      {open ? (
        <nav
          ref={panelRef}
          id={panelId}
          aria-label={label}
          data-testid={testId}
          style={shift > 0 ? { right: -shift } : undefined}
          className="absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-lg"
        >
          <p
            aria-hidden
            className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
          >
            {label}
          </p>
          <ul className="pb-1">
            {options.map((option) => (
              <li key={option.key}>
                <a
                  href={option.href}
                  aria-current={option.active ? 'page' : undefined}
                  data-filter={option.key}
                  onClick={() => setOpen(false)}
                  className={cn(
                    ROW,
                    option.active
                      ? 'bg-brand/10 text-brand'
                      : 'text-text hover:bg-bg-hover active:bg-bg-tertiary',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.active ? <Check aria-hidden size={16} className="shrink-0" /> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
