import { buttonClasses } from '@rede-social/ui';

/**
 * 2026-10-22 — the admin side of the courses area redesign: the class recipes the lists, the course
 * page and the forms share, from the social-igoralves panel (`components/members/editor/estilos.ts`
 * and the `app/membros/admin/*` pages) mapped to the design tokens. A directive-less module on
 * purpose: the Server Components (the list screens) and the client forms read the same strings (a
 * `'use client'` module would hand the server functions instead, the `chipBase` lesson). No colour
 * literal lives here (`check-ui-literals.sh`): the veils are black alpha over the art.
 */

/** An outlined list card: its rows are divided by hairlines and take `bg-card-hover`. */
export const LIST_CARD = 'overflow-hidden rounded-2xl border border-border bg-card';

/**
 * 2026-10-23 (the wide desktop lists, `data-shell-wide`): the `LIST_CARD` on a phone and up to `lg`
 * (one outlined card, hairlines between the rows); from `lg` the rows break out into a GRID of
 * outlined cards, two columns and three from `2xl`, so a 1232px column never stretches one row
 * across it. Each row takes `LIST_GRID_ITEM`. Mobile-only rules ride `max-lg:` so nothing of the
 * list card leaks into the grid.
 */
export const LIST_CARD_GRID =
  'flex flex-col max-lg:divide-y max-lg:divide-divider max-lg:overflow-hidden max-lg:rounded-2xl max-lg:border max-lg:border-border max-lg:bg-card lg:grid lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3';

/** A row of `LIST_CARD_GRID`: a plain row of the card on a phone, its own outlined card from `lg`. */
export const LIST_GRID_ITEM =
  'lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:bg-card';

/** An empty or error card on a wide list: centred at a readable width from `lg`, never 1232px wide. */
export const WIDE_EMPTY = 'lg:mx-auto lg:w-full lg:max-w-2xl';

/**
 * 2026-10-23 — the upcoming lives (the admin's showcase and its placeholder): stacked on a phone; from
 * `lg` a grid with the spotlight on the left (3/5) and the agenda rows on the right (2/5). Here, in
 * the directive-less module, because the Server Component placeholder reads it too.
 */
export const UPCOMING_LIVES_GRID =
  'flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-5';

/** A section heading of the admin screens ("Conteúdo do curso", "O caminho"): 18/800. */
export const SECTION_TITLE = 'text-lg font-extrabold leading-tight tracking-tight text-text';

/** A field-like trigger that opens a choice sheet (Categoria, Replay): the input's own geometry. */
export const FIELD_TRIGGER =
  'flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-bg-input px-3.5 py-2.5 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50';

/** A read-only information block (the forms' "Acesso"): the words are the content, not a control. */
export const INFO_TILE =
  'flex flex-col gap-1.5 rounded-xl border border-border bg-bg-secondary px-3.5 py-3';

/** Laid over a `Button`: the dashed "add" block ("Novo módulo", "Adicionar item"). */
export const DASHED_OVERRIDES =
  'w-full rounded-xl border border-dashed border-border bg-transparent font-semibold text-text-secondary hover:bg-bg-hover hover:text-text';

/** Laid over a `Button`: the danger zone's outlined control ("Arquivar curso", "Cancelar live"). */
export const DANGER_OVERRIDES =
  'w-full rounded-xl border border-danger/30 bg-transparent font-semibold text-danger hover:bg-danger/5 active:bg-danger/10';

/** The brand "Novo …" of a list screen: the screen's ONE brand fill, a 44px link (UI-D-391). */
export const CREATE_LINK = buttonClasses({
  variant: 'brand',
  size: 'sm',
  className: 'h-11 shrink-0 px-4',
});

/** A secondary link in the button geometry (an empty state's action beside the brand create). */
export const OUTLINE_LINK = buttonClasses({ variant: 'outline', size: 'md' });

/** The h1 id of each list screen: the screen's body section is named by it (`aria-labelledby`). */
export const ADMIN_SCREEN_TITLE_ID = {
  cursos: 'courses-screen-title',
  trilhas: 'tracks-screen-title',
  lives: 'lives-screen-title',
} as const;
