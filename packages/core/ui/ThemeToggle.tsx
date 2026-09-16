'use client';

import { THEME_COOKIE } from '@tria/contracts/branding';
import { Switch } from '@tria/ui';
import { startTransition, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeToggleProps {
  /** The theme the server rendered (from the `tria_theme` cookie). */
  initial: Theme;
  /** Accessible name of the switch (catalog string, e.g. "Tema escuro"). */
  label: string;
  /** The `setTheme` server action — keeps the server cookie in step with the client one. */
  action: (theme: string) => Promise<void>;
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Light/dark toggle (D-41), ported from the prototype's `applyTheme` with cookie persistence:
 * flips `<html data-theme>` immediately, updates `<meta name="theme-color">` from the computed
 * tokens (the tenant's primary in light, the dark surface in dark — no literals here), writes the
 * per-device cookie and calls the server action so the next SSR renders the same theme (no flash).
 * A local cookie write cannot fail visibly (UI consideration E05/error).
 */
export function ThemeToggle({ initial, label, action }: ThemeToggleProps) {
  // `<html data-theme>` is the single source of truth: every toggle on the page (settings row, rail)
  // reads it and re-renders through the observer, so two instances never disagree.
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => initial);

  const onChange = (dark: boolean) => {
    const next: Theme = dark ? 'dark' : 'light';
    const root = document.documentElement;
    root.dataset.theme = next;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const token = next === 'dark' ? '--theme-bg' : '--brand-primary';
      const color = getComputedStyle(root).getPropertyValue(token).trim();
      if (color) meta.setAttribute('content', color);
    }

    const secure = location.protocol === 'https:' ? '; secure' : '';
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available on every supported mobile browser; this is a plain two-value preference cookie (D-41, RESEARCH Pattern 3)
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
    startTransition(() => {
      void action(next);
    });
  };

  return <Switch checked={theme === 'dark'} onChange={onChange} label={label} />;
}
