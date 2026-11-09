/**
 * 2026-10-22 — the courses area's visual recipes, from the social-igoralves prototype's members area
 * (`components/members/*` and the `app/membros/*` pages), mapped to the design tokens: the
 * prototype's `accent` is `brand`; its cards are `bg-card` with a hairline instead of a shadow; its
 * glass chips and scrims are black alpha over the cover art, which is the ground they sit on, so they
 * hold in both themes and under every tenant tone.
 *
 * A directive-less module on purpose (the `chipBase` lesson, client-boundary.test): these strings
 * must reach Server Components too, and a `'use client'` module would hand them functions instead.
 * No colour literal lives here (`check-ui-literals.sh`): the scrims are `rgba()` black stops.
 */

/** Laid over `Card`: the prototype's cards are outlined, not lifted. */
export const MEMBER_CARD = 'border border-border shadow-none';

/** A section heading of the area ("Meus cursos", "Conteúdo do curso"). */
export const MEMBER_SECTION_TITLE =
  'text-[17px] font-extrabold leading-none tracking-tight text-text';

/** A chip over a cover: category, "Aula aberta", a date. */
export const GLASS_CHIP =
  'inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-sm';

/** The larger chip of a hero or a spotlight. */
export const GLASS_CHIP_LG =
  'inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm';

/**
 * 2026-10-26 — the member skin (packages/ui `member-skin.css`): the glass chip over media with its
 * hook, a deeper glass with a light edge inside `[data-member-skin]` and the very same chip anywhere
 * else. `GLASS_CHIP` itself stays as it is for the admin's rows.
 */
export const MEDIA_CHIP = `${GLASS_CHIP} ms-chip`;

/** The larger chip of a hero or a spotlight, with the member skin's hook. */
export const MEDIA_CHIP_LG = `${GLASS_CHIP_LG} ms-chip`;

/** The small uppercase line above a title, over a cover. */
export const OVERLINE_MEDIA = 'text-[10px] font-bold uppercase tracking-wider text-white/75';

/** The same line on the page ground. */
export const OVERLINE =
  'text-[10px] font-bold uppercase tracking-wider text-text-tertiary tabular-nums';

/**
 * The poster's frame: rounded, outlined and the one lifted surface of the area. `ms-tile` is the
 * member skin's image frame (its edge and its shadow, a deeper one under a hovered card).
 */
export const POSTER_FRAME =
  'ms-tile relative overflow-hidden rounded-2xl border border-border bg-bg-tertiary shadow-[0_6px_18px_rgba(22,35,59,0.14)]';

/** The poster's permanent veil: dark at the top for the chip, clear in the middle, dark at the foot. */
export const SCRIM_POSTER =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.42)_0%,transparent_34%,transparent_44%,rgba(0,0,0,0.88)_100%)]';

/**
 * 2026-10-26 — the reference card's veil (a course, a module, a lesson): the words sit UNDER the
 * art, so it only shades the top for the chips and the foot for the band.
 */
export const SCRIM_CARD =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.38)_0%,transparent_38%,transparent_72%,rgba(0,0,0,0.3)_100%)]';

/**
 * 2026-10-26 — a module card's veil: the cover sinks under a dark wash so the module's name, drawn
 * large and thin over it, reads like the reference's.
 */
export const SCRIM_MODULE =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0.35)_45%,rgba(0,0,0,0.7)_100%)]';

/**
 * 2026-10-26 — a track card's veil, the reference's: dark at the top, where the eyebrow and the big
 * title sit, clearing toward the foot.
 */
export const SCRIM_TRACK_CARD =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.25)_50%,transparent_100%)]';

/** 2026-10-26 — a small track tile's vignette (the reference's stacked tiles). */
export const SCRIM_TRACK_TILE =
  'bg-[radial-gradient(110%_85%_at_55%_42%,transparent_35%,rgba(4,6,10,0.85)_100%)]';

/** 2026-10-26 — the shadow under a track card's hover line, legible over any art. */
export const TRACK_LINE_SHADOW = '[text-shadow:0_1px_8px_rgba(0,0,0,0.9)]';

/** The Início hero's veil (four stops: the chip, the art, the text, the button). */
export const SCRIM_HERO =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.12)_34%,rgba(0,0,0,0.55)_70%,rgba(0,0,0,0.92)_100%)]';

/** The "continue watching" card's veil. */
export const SCRIM_RESUME =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.25)_0%,transparent_42%,rgba(0,0,0,0.88)_100%)]';

/** A live card's veil. */
export const SCRIM_EVENT =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_40%,rgba(0,0,0,0.85)_100%)]';

/** A track card's veil. */
export const SCRIM_TRACK =
  'bg-[linear-gradient(180deg,rgba(0,0,0,0.38)_0%,transparent_36%,rgba(0,0,0,0.9)_100%)]';

/**
 * A horizontal shelf: bleeds to the screen edges on a phone (the last card cut off says "there is
 * more"), snaps card by card and keeps the 16px gutter when it snaps.
 *
 * 2026-10-23 (the wide desktop): from `md`, where there is no swipe, the shelf is a GRID that wraps
 * instead of a row with a scrollbar (the product owner disliked the bar): as many columns as fit,
 * each at least `--rail-item` wide (the host sets it per shelf; 180px when unset), no scroll and no
 * clipping. The items drop their phone width there (`md:w-auto`, the host's).
 */
export const RAIL =
  'flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 scroll-px-4 snap-x snap-mandatory scrollbar-none md:grid md:grid-cols-[repeat(auto-fill,minmax(var(--rail-item,180px),1fr))] md:gap-4 md:overflow-visible md:pb-0';
