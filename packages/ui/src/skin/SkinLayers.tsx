/**
 * The member skin's decorative layers (2026-10-26). Each is an empty `aria-hidden` span that ships
 * with Tailwind's `hidden` class, so a component the admin screens share can carry it and draw
 * nothing there; inside `[data-member-skin]` member-skin.css shows it. Never the HTML `hidden`
 * attribute: Tailwind's preflight forces that one to `display: none !important`.
 *
 * No directive and no hook: a Server Component renders them.
 */

/**
 * Over an image frame (a poster, a cover): a vignette, two brand glows in screen blend and a fine
 * dot texture. `soft` for a small frame, with a lighter vignette. Place it as the frame's last
 * decorative child, before the text drawn over the image; the frame must be `relative` and clip
 * (`overflow-hidden`), with the radius it wants the layer to follow.
 */
export function SkinTileFx({ soft = false }: { soft?: boolean }) {
  return (
    <span aria-hidden="true" className={soft ? 'ms-tile-fx ms-soft hidden' : 'ms-tile-fx hidden'} />
  );
}

/**
 * A slow floating glow in the brand's colours, behind the content of a header or a banner (the
 * host isolates, so the glow sits under its text and over its ground).
 */
export function SkinAmbient() {
  return <span aria-hidden="true" className="ms-ambient hidden" />;
}

/**
 * The atmosphere of a frame with no image: a dark field tinted by the brand, a drifting glow, a
 * vignette and a grain, drawn OVER the frame's own fallback (an inline gradient cannot be restyled).
 */
export function SkinAtmos() {
  return <span aria-hidden="true" className="ms-atmos hidden" />;
}
