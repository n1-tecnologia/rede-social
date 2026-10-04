import { useEffect, useState } from 'react';
import {
  DEFAULT_TITLE_FONT,
  type GoogleFont,
  isFontFamilyName,
  sampleFontsHref,
  titleFontHref,
  titleFontStack,
} from './title-font-rules';

export {
  DEFAULT_TITLE_FONT,
  FONT_CATEGORIES,
  type FontCategory,
  filterFonts,
  type GoogleFont,
  isFontFamilyName,
  sampleFontsHref,
  sampleWeight,
  titleFontHref,
  titleFontStack,
  titleFontStyle,
  titleWeight,
} from './title-font-rules';

/**
 * The tenant's title font: ONE Google Fonts family for the app name in the header (drawn only when
 * the tenant has no logo), the Comunidades and Eventos titles and the names on community and event
 * cards; every other text keeps Manrope. Kept in the brand contract's `look.titleFont` since
 * 2026-10-03: the new-tenant wizard and the Marca tab pick it (the preview device shows it), the
 * creation and the Marca tab's save send it, and the app draws it.
 *
 * This is the BROWSER half: the catalogue (`google-fonts.ts`, generated from Google's metadata)
 * loaded on demand for the picker, Google's stylesheets added to the page with no referrer, and the
 * hooks. The pure rules (the name rule, weights, URLs, the stack) live in `title-font-rules.ts`,
 * re-exported here, and the app's layouts resolve a SAVED family on the server
 * (`title-font-catalogue.ts`), so the member app never downloads the catalogue: it only loads the one
 * stylesheet (`useFontStylesheet`). Any family name reaching CSS or a URL has passed
 * `isFontFamilyName` and is looked up in the catalogue first.
 */

let catalogue: Promise<readonly GoogleFont[]> | null = null;
const catalogueListeners = new Set<() => void>();

/**
 * Calls `listener` when a catalogue load succeeds: whoever saw it fail (a dropped chunk) tries again
 * as soon as anything loads it, like the picker's "Tentar de novo". Returns the unsubscribe.
 */
function onCatalogueLoaded(listener: () => void): () => void {
  catalogueListeners.add(listener);
  return () => {
    catalogueListeners.delete(listener);
  };
}

/** The generated catalogue, imported once on demand (a failed import is tried again next time). */
export function loadGoogleFonts(): Promise<readonly GoogleFont[]> {
  if (!catalogue) {
    const pending = import('./google-fonts').then((module) => module.GOOGLE_FONTS);
    catalogue = pending;
    pending.then(
      () => {
        for (const listener of [...catalogueListeners]) listener();
      },
      () => {
        if (catalogue === pending) catalogue = null;
      },
    );
  }
  return catalogue;
}

/** The catalogue entry of `family`, or `null` for an unknown or malformed name. */
export async function findGoogleFont(family: string): Promise<GoogleFont | null> {
  if (!isFontFamilyName(family)) return null;
  return (await loadGoogleFonts()).find(([name]) => name === family) ?? null;
}

const sheets = new Map<string, Promise<void>>();

/**
 * Adds one of Google's stylesheets to the page, once per URL, with no referrer (the request names no
 * page of the panel, like the panel's external images, T-02-112). Resolves when it loaded; rejects
 * when Google refused it, and then forgets it so a later call asks again.
 */
export function ensureFontStylesheet(href: string): Promise<void> {
  const known = sheets.get(href);
  if (known) return known;
  const loaded = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.referrerPolicy = 'no-referrer';
    link.dataset.googleFont = '';
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener(
      'error',
      () => {
        link.remove();
        sheets.delete(href);
        reject(new Error('google font stylesheet refused'));
      },
      { once: true },
    );
    document.head.append(link);
  });
  sheets.set(href, loaded);
  return loaded;
}

/** Families per sample request: a short URL, and a refused family costs only its own batch. */
const SAMPLE_BATCH = 20;
/** Families asked for or loaded; one that finally failed leaves it, so a later call asks again. */
const sampled = new Set<string>();

/**
 * Loads the picker's visible families in their own letters, a batch per request. One family Google
 * refuses fails its whole batch, so that batch is asked again one family at a time: only the refused
 * one stays in Manrope. A family whose own request fails too (the network, not Google) is forgotten,
 * so the next call (the list changing, the browser back online) asks for it again.
 */
export function loadFontSamples(fonts: readonly GoogleFont[]): void {
  const pending = fonts.filter(([family]) => !sampled.has(family));
  for (const [family] of pending) sampled.add(family);
  const alone = (font: GoogleFont) =>
    ensureFontStylesheet(sampleFontsHref([font])).catch(() => {
      sampled.delete(font[0]);
    });
  for (let start = 0; start < pending.length; start += SAMPLE_BATCH) {
    const batch = pending.slice(start, start + SAMPLE_BATCH);
    if (batch.length === 1 && batch[0]) {
      alone(batch[0]);
      continue;
    }
    ensureFontStylesheet(sampleFontsHref(batch)).catch(() => {
      for (const font of batch) alone(font);
    });
  }
}

/**
 * The CSS stack of the title font `family` once the catalogue confirms it, with its stylesheet
 * requested; `null` for the default (Manrope), an unknown name or while the catalogue loads, so the
 * titles keep Manrope. A failure is never final: a catalogue that did not load is looked up again
 * when anything loads it, and a stylesheet Google could not serve is asked again when the browser is
 * back online.
 */
export function useTitleFont(family: string | null): string | null {
  const [found, setFound] = useState<GoogleFont | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    if (!family || family === DEFAULT_TITLE_FONT) {
      setFound(null);
      return;
    }
    let live = true;
    const stops: Array<() => void> = [];
    const retry = () => {
      if (live) setAttempt((n) => n + 1);
    };
    findGoogleFont(family).then(
      (font) => {
        if (!live) return;
        setFound(font);
        if (!font) return;
        ensureFontStylesheet(titleFontHref(font)).catch(() => {
          if (!live) return;
          window.addEventListener('online', retry, { once: true });
          stops.push(() => window.removeEventListener('online', retry));
        });
      },
      () => {
        if (!live) return;
        setFound(null);
        stops.push(onCatalogueLoaded(retry));
      },
    );
    return () => {
      live = false;
      for (const stop of stops) stop();
    };
  }, [family, attempt]);
  return found && found[0] === family ? titleFontStack(found[0]) : null;
}

/**
 * Loads ONE of Google's stylesheets, the app's saved title font (the URL resolved on the server by
 * `title-font-catalogue.ts`, so the member app never needs the catalogue), with no referrer, once
 * hydrated: never render-blocking, so a slow or offline start draws the titles in Manrope (the
 * stack's fallback) instead of waiting on Google, and they swap once the font arrives. A stylesheet
 * Google could not serve is asked again when the browser is back online. `null` loads nothing.
 */
export function useFontStylesheet(href: string | null): void {
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    if (!href) return;
    let live = true;
    const retry = () => {
      if (live) setAttempt((n) => n + 1);
    };
    ensureFontStylesheet(href).catch(() => {
      if (live) window.addEventListener('online', retry, { once: true });
    });
    return () => {
      live = false;
      window.removeEventListener('online', retry);
    };
  }, [href, attempt]);
}
