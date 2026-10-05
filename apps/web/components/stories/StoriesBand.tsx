import type { ReactNode } from 'react';

/**
 * The Início stories row's own box (the REINE timeline, 2026-10-02): a full-bleed band of the card
 * surface with a hairline below, so the row reads as a box apart from the page ground and the posts
 * under it. The row keeps its own geometry (`px-4 py-3`, the horizontal scroller); the band only
 * paints behind it. Inside it the page colour is the card's (`--theme-bg`), so what the row cuts out
 * in the page colour (the focus ring's offset) matches the band instead of drawing a grey ring.
 * Rendered only around a row that has circles: a member with none gets no node at all (UI-D-26),
 * never an empty white box.
 */
export function StoriesBand({ children }: { children: ReactNode }) {
  return (
    <div
      data-stories-band
      className="border-b border-border bg-card [--theme-bg:var(--theme-card)]"
    >
      {children}
    </div>
  );
}
