'use client';

import { recordAppPath, startBackStack } from '@rede-social/ui';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Feeds the in-app back stack (`@rede-social/ui`, 2026-10-09) that every `BackLink` reads, so "voltar"
 * returns to the screen the member came from instead of a fixed parent. Mounting starts the stack
 * (classifying how this document was reached, `startBackStack`), and every pathname the shell shows
 * is recorded on top of it. Renders nothing.
 *
 * Only `usePathname`, never the router: a query-only `router.replace` (a search field, a filter chip)
 * is not a new screen, and the stories viewer's `pushState('/stories/{id}')` reaches it through Next's
 * patched history like any navigation, so closing the viewer (`history.back()`) pops it again.
 * Mounted once, by `AppShell`.
 */
export function BackStackTracker() {
  const pathname = usePathname();

  useEffect(() => startBackStack(), []);

  useEffect(() => {
    recordAppPath(pathname);
  }, [pathname]);

  return null;
}
