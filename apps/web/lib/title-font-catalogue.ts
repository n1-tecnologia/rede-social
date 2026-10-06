import { GOOGLE_FONTS } from './google-fonts';
import {
  DEFAULT_TITLE_FONT,
  type GoogleFont,
  isFontFamilyName,
  titleFontHref,
  titleFontStack,
} from './title-font-rules';

/**
 * The saved title font as the APP draws it (2026-10-03): the tenant's `look.titleFont` looked up in
 * the generated catalogue on the SERVER, where importing it costs the bundle nothing (the browser
 * half, `lib/title-font.ts`, loads the catalogue on demand for the wizard's picker only). Imported by
 * the app's layouts (the authenticated shell and the logged-out pages), never by a client component.
 *
 * `null` for the default (Manrope, self-hosted), for a name the contract's rule refuses and for a
 * family the catalogue does not know (a family Google retired after it was saved): the titles then
 * simply keep Manrope. Otherwise the family's CSS stack (`--brand-title-font`, Manrope behind it
 * while the font loads or if it fails) and the ONE stylesheet to load, in the title weight the
 * family ships (Google answers HTTP 400 to a weight it does not have), which `TitleFontSheet` asks
 * Google for with no referrer, as the wizard's preview does.
 */
export type SavedTitleFont = { family: string; stack: string; href: string };

let byFamily: Map<string, GoogleFont> | null = null;

export function savedTitleFont(family: string | null | undefined): SavedTitleFont | null {
  if (!family || family === DEFAULT_TITLE_FONT || !isFontFamilyName(family)) return null;
  byFamily ??= new Map(GOOGLE_FONTS.map((font) => [font[0], font]));
  const font = byFamily.get(family);
  return font ? { family, stack: titleFontStack(family), href: titleFontHref(font) } : null;
}
