'use client';

import { type ToastTone, useToast } from '@rede-social/ui';
import { useEffect, useRef } from 'react';

/**
 * One notice a server page decided to show, fired ONCE on mount (07-04, UI-D-254): the
 * `ActionToast` / `FlashToast` pattern generalised. The page chooses the message from the catalog
 * (this component ships no words) and names the query parameter that asked for it (`aviso` on
 * Início, `comentario` on the post page).
 *
 * After firing, the parameter is dropped from the address with `history.replaceState`, which Next
 * syncs into its router without a server round trip, so a reload does not repeat the notice and the
 * page the member is reading is not re-rendered under them. Every other parameter is kept.
 *
 * The ref guard keeps React's development double-mount from firing it twice.
 */
export function NoticeToast({
  message,
  param,
  tone = 'info',
}: {
  message: string;
  param: string;
  tone?: ToastTone;
}) {
  const { show } = useToast();
  const fired = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per landing with the message the page chose
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    show({ tone, message });
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  return null;
}
