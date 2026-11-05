/**
 * 2026-10-24 — the Loja's shared class strings (the store redesign on the "área de membros"). No
 * `'use client'` on purpose: server components read these as strings (a client module would hand
 * them a client reference instead, the `chipBase` lesson).
 */

/**
 * The product cards' frame on Produtos and Comprados: the 16px gutter, and the `@container` the grid
 * reads its columns from (the room the grid really has, rail or no rail).
 */
export const PRODUCT_GRID_FRAME = '@container px-4';

/**
 * The product cards' grid (2026-10-24, the e-commerce card): two columns on a phone, three from 600px
 * of room, four from 880px and five from 1200px, so a card stays between ~140px (a 320px phone) and
 * ~300px; each tile carries its name and price on its own glass panel.
 */
export const PRODUCT_GRID =
  'grid grid-cols-2 gap-3 @min-[600px]:grid-cols-3 @min-[600px]:gap-4 @min-[880px]:grid-cols-4 @min-[1200px]:grid-cols-5';

/** The card image's `sizes`: up to ~300px a column in the wide frame, a third of the screen from 640px, half below. */
export const CARD_SIZES =
  '(min-width: 1024px) 300px, (min-width: 768px) 340px, (min-width: 640px) 33vw, 50vw';

/** The h1 of every store screen, so a list region can name itself after it. */
export const STORE_SCREEN_TITLE_ID = 'store-screen-title';

/** A back row's link above a `ScreenHeader` (the courses `ManageBackLink` look). */
export const BACK_ROW_LINK =
  'inline-flex min-h-11 items-center gap-1 rounded-md pr-3 text-[13px] font-semibold text-text-secondary transition-colors hover:text-text active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * 2026-10-27 — the storefront at the member area's full width (`data-shell-full`): four columns from
 * 768px, five from 1500px and six from 1850px of the band's own width, so a card stays about 280 to
 * 340px wide on any desktop (four columns on the full width of a wide screen would be over 400px).
 */
// The three thresholds are written the same way (`@min-[...px]`) on purpose: a named size beside an
// arbitrary one is not ordered by value in the CSS, and `@3xl` came out AFTER `@min-[1500px]`.
export const STORE_COLUMNS =
  '@min-[768px]:grid-cols-4 @min-[1500px]:grid-cols-5 @min-[1850px]:grid-cols-6';

/** The fifth and sixth card of a ONE-row band (a shelf, the hero): shown once the row has room. */
export const ROW_FIFTH = '@min-[768px]:hidden @min-[1500px]:block';
export const ROW_SIXTH = '@min-[768px]:hidden @min-[1850px]:block';
