import type { PreviewScreen } from './TenantPreviewProvider';

/** The screen a tab key opens in the preview (`home`/`profile` are the kernel's own keys). */
export function screenOfTab(key: string): PreviewScreen | null {
  return key === 'home' ||
    key === 'communities' ||
    key === 'reels' ||
    key === 'events' ||
    key === 'profile'
    ? key
    : null;
}

/** The app routes the preview emulates, by path prefix (`/membros/{id}` opens the profile too). */
const ROUTES: ReadonlyArray<readonly [string, PreviewScreen]> = [
  ['/inicio', 'home'],
  ['/comunidades', 'communities'],
  ['/reels', 'reels'],
  ['/eventos', 'events'],
  ['/perfil', 'profile'],
  ['/membros', 'profile'],
  ['/configuracoes', 'settings'],
  ['/entrar', 'login'],
];

/**
 * The preview screen an in-app link opens; `null` for a route the preview does not emulate (a post
 * page, an absolute URL), which the preview then simply does not follow.
 */
export function screenForHref(href: string): PreviewScreen | null {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  for (const [prefix, screen] of ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return screen;
  }
  return null;
}
