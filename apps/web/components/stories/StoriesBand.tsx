import type { ReactNode } from 'react';

/**
 * The Início stories row's own box (the REINE timeline, 2026-10-02): a full-bleed band of the card
 * surface with a hairline below, so the row reads as a box apart from the page ground and the posts
 * under it. The row keeps its own geometry (`px-4 py-3`, the horizontal scroller); the band only
 * paints behind it. Inside it the page colour is the card's (`--theme-bg`), so what the row cuts out
 * in the page colour (the focus ring's offset) matches the band instead of drawing a grey ring.
 * Rendered only around a row that has circles: a member with none gets no node at all (UI-D-26),
 * never an empty white box.
 *
 * **`desktopCard` (2026-10-20, the client's FRONT.pdf: rounded corners on the white box).** From
 * `md` up, where the band sits in the centred column, it becomes a card like the others on the
 * desktop: rounded corners, the cards' soft shadow instead of the hairline and a border in the dark
 * theme. On a phone it stays the edge-to-edge band. (Nothing needs clipping: the row's own padding
 * keeps every circle clear of the corners.)
 */
export function StoriesBand({
  children,
  desktopCard = false,
}: {
  children: ReactNode;
  desktopCard?: boolean;
}) {
  return (
    <div
      data-stories-band
      data-desktop-card={desktopCard ? '' : undefined}
      className={`border-b border-border bg-card [--theme-bg:var(--theme-card)]${
        desktopCard
          ? ' md:rounded-xl md:border-b-0 md:shadow-[0_1px_3px_rgba(22,35,59,.06)] md:dark:border md:dark:border-border'
          : ''
      }`}
    >
      {children}
    </div>
  );
}
