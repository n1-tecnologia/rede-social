import type { ComponentPropsWithoutRef } from 'react';
import { titleFontStyle } from '@/lib/title-font';

/**
 * What a line of the title font's samples stands for, each drawn with the classes of its twin in
 * the phone (`TenantAppPreview`): the app name in the top bar (drawn only without a logo), a list's
 * title (Comunidades, Eventos), a community card's name (one line) and an event card's name (up to
 * two lines). The title carries one class more, `overflow-x-clip`: a sample is narrower than the
 * phone's screen, and a very wide family makes the one word of a title wider than its column
 * (Press Start 2P draws "Comunidades" 259px wide, a sample's column at 768px is 170px), so the
 * title is cut at the column's edge, as a screen's edge cuts what runs past it, instead of running
 * onto the other theme's sample or off the card. Sideways only: the letters keep their height.
 * The phone, which has the room, keeps the word whole.
 */
export type FontSampleKind = 'appName' | 'title' | 'communityName' | 'eventName';

const DRAWN_AS: Record<FontSampleKind, string> = {
  appName: 'truncate text-base font-bold tracking-tight text-text',
  title: 'overflow-x-clip text-2xl font-bold leading-tight tracking-[-0.02em] text-text',
  communityName: 'truncate text-base font-bold text-text',
  eventName: 'line-clamp-2 text-base font-bold leading-tight text-text',
};

/**
 * One line of the title font's samples outside the phone: the title font's sample, which follows
 * the preview's theme, and the inks' samples, one per theme (`FontColorFields`), so a line reads
 * the same in all of them. It is drawn in the chosen family (`stack`, from `useTitleFont`; `null`
 * keeps Manrope) with no synthesized bold (`titleFontStyle`), and in the tenant's ink for it when
 * there is one. Without an ink it keeps `text-text`, the text colour of the theme its sample
 * declares, as the phone leaves a title alone while no colour is set (globals.css keys on a marker
 * that only a colour sets). The caller's data attributes ride on the line, which is how each sample
 * tells its lines apart.
 */
export function FontSampleLine({
  kind,
  stack,
  ink,
  ...line
}: {
  kind: FontSampleKind;
  /** The family's CSS stack; `null` for the default. */
  stack: string | null;
  /** The ink the tenant picked for this line in its sample's theme, a valid hex, or `null`. */
  ink: string | null;
} & Omit<ComponentPropsWithoutRef<'p'>, 'className' | 'style'>) {
  const font = titleFontStyle(stack);
  return <p {...line} style={ink ? { ...font, color: ink } : font} className={DRAWN_AS[kind]} />;
}
