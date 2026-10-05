'use client';

import { MediaImage } from '@rede-social/core/ui';
import { IconButton } from '@rede-social/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * 2026-10-03 — the `Comunidades` list's REORDER MODE body: every active community as one compact row,
 * each with a "move up" and a "move down" button. The admin's order is written by the host's "Salvar
 * ordem"; this component only rearranges a draft the host holds.
 *
 * Presentational and props-only, the `CommunityPickerSheet` posture: it fetches nothing, writes
 * nothing (the host's `onChange` receives the new permutation), resolves no route and **ships no
 * words** (PWA-03) — every accessible name, and the announcement, arrive as functions the host
 * composes from its catalog. The list is NAMED and DESCRIBED by the host's own heading and helper
 * line (`labelledBy` / `describedBy`), so the words exist once on the screen and once in the tree.
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **Buttons, never a drag.** Two 44px buttons per row are the WHOLE interaction, so the mode works
 *    the same with a finger, a mouse, a keyboard, a switch and a screen reader (WCAG 2.5.7 needs no
 *    separate path when there is no drag to begin with). Each button's name carries the community's
 *    name, so a screen reader moving through the list hears which row each one moves. A row is NOT a
 *    card here: no cover block, no counts. The 32px thumb and the name are what the admin needs to
 *    recognise a row, and anything taller would turn a 10-community reorder into a long scroll.
 * 2. **Focus FOLLOWS the moved row.** React may move another row's DOM node instead of this one (its
 *    keyed reconciliation picks), and a node that is moved loses focus — so after every move the
 *    SAME button of the SAME community is focused again, wherever it now sits. At either end that
 *    button is now disabled, and a disabled button cannot hold focus (the browser would drop it to
 *    the page), so focus goes to the row's OTHER button instead. One polite live region announces
 *    the new position.
 * 3. **Disabled at the ends, and all of it disabled while the host saves.** The first row cannot go
 *    up and the last cannot go down; `disabled` (not a no-op) takes those two out of the tab order,
 *    which is what tells a keyboard user they are at an end.
 *
 * The truncation is CSS only (`line-clamp-2`): a 60-character name wraps to a second line and is then
 * clipped, never cut in the string, so a grapheme can never be split (edge: encoding).
 */

export interface CommunityReorderItem {
  id: string;
  name: string;
  /** Null takes the gradient branch (D-69), exactly as the list card's cover does. */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  coverVariantWidths: readonly number[];
}

export interface CommunityReorderListLabels {
  /** The up button's name — "Mover para cima: {community}". */
  moveUp: (name: string) => string;
  /** The down button's name — "Mover para baixo: {community}". */
  moveDown: (name: string) => string;
  /** The polite announcement — "{community} agora está na posição {position} de {total}." */
  moved: (name: string, position: number, total: number) => string;
}

export interface CommunityReorderListProps {
  /** The draft order, first to last. CONTROLLED: the host owns it, and owns saving it. */
  items: readonly CommunityReorderItem[];
  /** The new permutation, as ids, after one move. */
  onChange: (ids: string[]) => void;
  /** True while the host saves: every move button is inert. */
  disabled?: boolean;
  /** The id of the host's heading — the list's accessible name. */
  labelledBy: string;
  /** The id of the host's helper line — the list's description. */
  describedBy?: string;
  labels: CommunityReorderListLabels;
}

type Direction = 'up' | 'down';

/** The thumb is a fixed 32×32 square in every row, so `sizes` never needs the viewport. */
const THUMB_SIZES = '32px';

export function CommunityReorderList({
  items,
  onChange,
  disabled = false,
  labelledBy,
  describedBy,
  labels,
}: CommunityReorderListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The button that must hold focus once the moved row has re-rendered (point 2). */
  const refocus = useRef<{ id: string; direction: Direction } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    refocus.current = null;
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-reorder-id="${target.id}"][data-reorder-move="${target.direction}"]`,
    );
    if (button && document.activeElement !== button) button.focus({ preventScroll: true });
  });

  const move = (id: string, delta: -1 | 1) => {
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);

    // The same button again — unless the row just reached the end that disables it (point 2).
    const last = ids.length - 1;
    const direction: Direction =
      delta < 0 ? (to === 0 ? 'down' : 'up') : to === last ? 'up' : 'down';
    refocus.current = { id, direction };
    setAnnouncement(labels.moved(items[from]?.name ?? '', to + 1, ids.length));
    onChange(ids);
  };

  return (
    <>
      <ol
        ref={listRef}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="flex flex-col gap-2"
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            data-reorder-row={item.id}
            className="flex min-h-14 items-center gap-2 rounded-xl bg-bg-secondary py-1.5 pr-1 pl-2"
          >
            {item.coverAssetId !== null ? (
              <span
                data-reorder-cover
                className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
              >
                {/* Decorative: the name is right beside it, and the buttons carry it too. */}
                <MediaImage
                  assetId={item.coverAssetId}
                  widths={item.coverVariantWidths}
                  alt=""
                  sizes={THUMB_SIZES}
                  ratio=""
                  className="h-full w-full"
                />
              </span>
            ) : (
              // D-69 / UI-D-35: a cover-less community is the tenant's own gradient, never a
              // broken-image glyph. Inline because the gradient is a runtime tenant variable.
              <span
                aria-hidden
                data-reorder-cover-fallback
                className="h-8 w-8 shrink-0 rounded-lg"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            )}
            {/* The only flexible child: at any name length the thumb and the two buttons keep their
                size, and the NAME gives way (two lines, then clipped). */}
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-bold text-text">
              {item.name}
            </span>
            <IconButton
              icon={ChevronUp}
              label={labels.moveUp(item.name)}
              size={20}
              disabled={disabled || index === 0}
              onClick={() => move(item.id, -1)}
              data-reorder-id={item.id}
              data-reorder-move="up"
              className="shrink-0"
            />
            <IconButton
              icon={ChevronDown}
              label={labels.moveDown(item.name)}
              size={20}
              disabled={disabled || index === items.length - 1}
              onClick={() => move(item.id, 1)}
              data-reorder-id={item.id}
              data-reorder-move="down"
              className="shrink-0"
            />
          </li>
        ))}
      </ol>
      {/* ONE polite region for the whole list: the move's position announcement. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
