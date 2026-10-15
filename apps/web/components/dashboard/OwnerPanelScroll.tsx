'use client';

import { useEffect } from 'react';

export interface OwnerPanelScrollProps {
  /** The panel wrapper's id (`OWNER_PANEL_ANCHOR`). */
  anchor: string;
  /** The page was reached from inside the panel (its URL carries `?area=`). */
  land: boolean;
}

/**
 * Where a step of the owner panel lands on `/perfil`. Every panel link is a full load of `/perfil`
 * with a query, and the shell's scroll root goes back to the top once it mounts (`ScrollRoot`, a
 * parent whose effect runs after this one), which would undo the browser's own jump to the URL's
 * anchor and show the profile's hero instead of the step just opened. So, one frame later (after
 * that reset), this scrolls to the anchor when it is inside the panel (`#faixas`, `#lista`, the card
 * a "Voltar" returns to), else to the panel itself when the page came from the panel (a tab, a
 * member opened), else nowhere: a plain `/perfil` keeps its top. Without JavaScript the browser's
 * jump is never undone, so the anchors work as they are.
 */
export function OwnerPanelScroll({ anchor, land }: OwnerPanelScrollProps) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(anchor);
      if (!panel) return;
      let hash = '';
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        hash = '';
      }
      const target = hash ? document.getElementById(hash) : null;
      const into = target && panel.contains(target) ? target : land ? panel : null;
      into?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, land]);

  return null;
}
