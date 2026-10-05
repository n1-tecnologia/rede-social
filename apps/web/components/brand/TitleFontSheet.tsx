'use client';

import { useFontStylesheet } from '@/lib/title-font';

/**
 * The saved title font's stylesheet for a brand scope (the app shell, the logged-out pages): the
 * layout resolves the family on the server (`savedTitleFont`, `lib/title-font-catalogue.ts`) and
 * sets `--brand-title-font` with its marker on the scope; this only asks Google for the ONE
 * stylesheet, with no referrer, after hydration (`useFontStylesheet`). Renders nothing.
 */
export function TitleFontSheet({ href }: { href: string }) {
  useFontStylesheet(href);
  return null;
}
