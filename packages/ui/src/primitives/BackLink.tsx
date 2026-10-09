'use client';

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { goBack } from '../navigation/back-stack';

export type BackLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & {
  /**
   * The FALLBACK: where the link goes when no app screen is behind this one (a fresh tab, a shared
   * link, a reload with nothing behind it). The screen's static parent, as before 2026-10-09.
   */
  href: string;
};

/**
 * The back control of every navigational header (`PageHeader`, `CommunityHeader`, `ThreadHeader`):
 * a plain `<a href>` whose plain click steps back to the screen the member came from (the back
 * stack's `goBack`, 2026-10-09), so "voltar" on `/configuracoes` reached from Perfil returns to
 * Perfil instead of Início. With nothing to step back to, the click is left alone and the href
 * navigates as any link does. A modified or middle click (a new tab or window) and a link aimed at
 * another target are the browser's, exactly like `reselectTab`'s. Before hydration it is the same
 * plain link.
 *
 * No hooks and no state: it renders identically on the server and in `renderToStaticMarkup`.
 */
export function BackLink({ href, ...anchor }: BackLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const { target } = event.currentTarget;
    if (target && target !== '_self') return;
    if (goBack(href)) event.preventDefault();
  };

  return <a {...anchor} href={href} onClick={onClick} />;
}
