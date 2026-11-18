/**
 * 2026-11-18 — what every surface that shows the vendor's bar (`<mux-player>`'s own control bar)
 * shares: the bar's numbers, and the rule that tells an event from the bar from one from the video.
 */

/** The bar's back and forward buttons (and the arrow hotkeys) jump this many seconds. */
export const SEEK_STEP_SECONDS = 10;
/** The speed menu: the vendor default has no slow rate, and a lesson needs 0.5 and 0.75. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * True when `event` comes from the vendor's own bar, centre buttons or menus, false when it comes
 * from the video surface (or from anywhere outside a player).
 *
 * An event from inside the vendor's shadow tree is retargeted to the `<mux-player>` host by the time
 * it reaches our code, so its `target` cannot tell a bar button from the video. Its composed path
 * can: the real origin is `composedPath()[0]`. This is the vendor's own gesture-layer rule
 * (media-chrome's `media-gesture-receiver` only acts when the origin is `video` or
 * `media-controller`): every other origin inside the player is the bar's.
 *
 * It fails closed toward the surface: no `composedPath`, an empty path or an origin that is no
 * element is a surface event, which is how the feed behaved before it had a bar.
 */
export function isVendorBarEvent(event: Event): boolean {
  if (typeof event.composedPath !== 'function') return false;
  const path = event.composedPath();
  const origin = path[0];
  if (!(origin instanceof Element)) return false;
  if (
    origin.localName === 'video' ||
    origin.localName === 'media-controller' ||
    origin.localName === 'mux-player'
  ) {
    return false;
  }
  return path.some((node) => node instanceof Element && node.localName === 'mux-player');
}
