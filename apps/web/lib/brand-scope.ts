import { brandStyleVars, type ResolvedBranding } from '@rede-social/contracts/branding';
import { type AppBrandAttributes, appBrandLook } from './bg-tone';
import { savedTitleFont } from './title-font-catalogue';

/**
 * Everything a brand scope of the APP carries for a resolved brand (2026-10-03): the authenticated
 * shell's `[data-brand-root]` (`(app)/layout.tsx`, from the bootstrap) and the logged-out pages'
 * `<main>` (`(auth)/layout.tsx`, from the public by-host answer).
 *
 * - `style`: the five `--brand-*` keys (`brandStyleVars`, unchanged since T-02-03) followed by the
 *   look's custom properties (`appBrandLook`: the buttons' raw keys of both themes, the own dark
 *   pair, the title font's stack and the inks of each theme);
 * - `attributes`: the look's markers and tone ids, which tokens.css and globals.css key on;
 * - `titleFontHref`: the saved family's ONE Google stylesheet (`savedTitleFont`, looked up in the
 *   catalogue on the server), for `TitleFontSheet` to load after hydration; `null` keeps Manrope.
 *
 * A brand without a look (every tenant saved before it, the platform and generic hosts' neutral
 * brand) gets the five keys and nothing else, so its first HTML is exactly what it was. Server-only
 * in practice: it imports the generated font catalogue, which no client bundle should carry.
 */
export type BrandScope = {
  style: Record<string, string>;
  attributes: AppBrandAttributes;
  titleFontHref: string | null;
};

export function brandScope(branding: Pick<ResolvedBranding, 'colors' | 'look'>): BrandScope {
  const font = savedTitleFont(branding.look.titleFont);
  const look = appBrandLook({
    colors: branding.colors,
    look: branding.look,
    titleFontStack: font?.stack ?? null,
  });
  return {
    style: { ...brandStyleVars(branding), ...look.style },
    attributes: look.attributes,
    titleFontHref: font?.href ?? null,
  };
}
