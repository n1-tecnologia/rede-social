/**
 * The module's published contract surface (`@rede-social/module-reels/contracts`): the tuning constants the
 * Reels player, pager and host read (plans 05-08). Constants only — Reels owns no request or response
 * shape of its own, because it reads feed's `GET /v1/feed?media=video` and reuses feed's contracts.
 */

/**
 * Posts per `?media=video` page. It must stay at or below feed's `FEED_MAX_PAGE_SIZE` (25), or the
 * `.strict()` feed query would refuse the page request (asserted in plan 07's web test).
 */
export const REELS_PAGE_SIZE = 10;

/**
 * Pages with `|k − index| ≤ REELS_MOUNT_RADIUS` render their media (the active one and its two
 * neighbours); every other page is an empty black box (UI-D-97).
 */
export const REELS_MOUNT_RADIUS = 1;

/**
 * Width of the position indicator: at most this many `aria-hidden` ticks, drawn from the loaded range
 * around the active reel and shifted to stay this wide at either end (UI-D-89).
 */
export const REELS_TICK_WINDOW = 7;

/** Vertical drag, in CSS pixels, past which a release advances to the neighbouring reel. */
export const REELS_SWIPE_THRESHOLD_PX = 60;

/** Multiplier applied to the finger's drag offset while dragging: the rubber-band feel (0..1). */
export const REELS_RUBBER_BAND = 0.35;

/** Movement, in CSS pixels, under which a pointer-down/up pair still counts as a tap. */
export const REELS_TAP_SLOP_PX = 10;

/** Accumulated wheel delta, in pixels, that advances one reel on desktop. */
export const REELS_WHEEL_THRESHOLD_PX = 50;

/** After a wheel-driven advance, further wheel input is ignored for this long (trackpad inertia). */
export const REELS_WHEEL_LOCK_MS = 600;

/** A stall shorter than this shows no spinner, so a brief rebuffer never flashes one. */
export const REELS_BUFFERING_DELAY_MS = 500;

/**
 * After `canplay` on the current page, no `playing` within this window reports autoplay as silently
 * blocked — the Low Power Mode case where `play()` stays pending instead of rejecting (UI-D-86).
 */
export const REELS_AUTOPLAY_CHECK_MS = 400;

/** The next `?media=video` page is requested once `index ≥ loaded − REELS_PREFETCH_DISTANCE`. */
export const REELS_PREFETCH_DISTANCE = 2;

/** Asset ids per batched playback-token mint: the ±1 window (the active reel and its neighbours). */
export const REELS_MINT_MAX_IDS = 3;

/** A cached playback token is re-minted when it expires within this margin (10 minutes). */
export const REELS_TOKEN_REMINT_MARGIN_MS = 600000;

/**
 * `width / height` at or below which a video fills the stage (`--media-object-fit: cover`, UI-D-83);
 * anything wider is shown whole (`contain`) over its own blurred poster, so a landscape clip is never
 * cropped to a sliver. A video whose proportion is not known yet fills the stage too (2026-10-09:
 * Reels is vertical-first, and a video's size is never stored).
 */
export const REELS_COVER_MAX_RATIO = 0.8;
