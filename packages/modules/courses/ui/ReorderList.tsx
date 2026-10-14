'use client';

import { IconButton } from '@rede-social/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * 08.3-08 (D-414, UI-D-395, UI-D-397) — the arrows-only reorder list of the school: the
 * `CommunityReorderList` port, generalised so one component orders a course's modules, a module's
 * lessons, a lesson's materials and a track's courses. Every row carries a "move up" and a "move
 * down" button; the host receives the new permutation in `onChange` and owns what happens next (the
 * curriculum editor writes the parent's WHOLE order at once, UI-D-397).
 *
 * Presentational and props-only, the `CommunityPickerSheet` posture: it fetches nothing, writes
 * nothing, resolves no route and **ships no words** (PWA-03) — every accessible name, and the
 * announcement, arrive as functions the host composes from its catalog. The list is NAMED by the
 * host (`labelledBy` for a heading already on screen, or `label` when the name has no element of its
 * own, as the lesson list of a module card).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **Buttons, never a drag.** Two 44px buttons per row are the WHOLE interaction, so the mode works
 *    the same with a finger, a mouse, a keyboard, a switch and a screen reader (WCAG 2.5.7 needs no
 *    separate path when there is no drag to begin with). Each button's name carries the item's
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
 * Two deltas from the communities' list, both for the whole-order-per-move host (UI-D-397):
 *
 * - While the host's write runs the WHOLE list is `disabled`, the moved row's button included, and a
 *   disabled button cannot take focus. The refocus therefore WAITS: it is retried on every render
 *   until the list is enabled again, so focus lands on the moved row once the write answers — and
 *   if the host restored the previous order (a failure), on the same button in its old place.
 * - `renderItem` lets a host draw its own row (a module card, a lesson link) around the two arrow
 *   buttons this list builds; without it the default compact row of the communities' list renders
 *   (thumb slot, name, meta, pill and trailing slots). The buttons, their names, their `disabled`
 *   state and the focus rules are the list's in both shapes, which is what keeps them protected.
 *
 * The truncation is CSS only (`line-clamp-2`): a 60-character name wraps to a second line and is then
 * clipped, never cut in the string, so a grapheme can never be split (edge: encoding).
 */

export interface ReorderItem {
  id: string;
  /** The item's name: the row's text in the default shape, and what every button's name carries. */
  name: string;
  /** The host's 32×32 thumb (a `MediaImage`, a glyph) in the default row; absent renders no thumb slot. */
  thumb?: ReactNode;
  /** A finished meta line under the name (12/400 secondary) in the default row. */
  meta?: string;
  /** A host-built `StatusPill` beside the name in the default row. */
  pill?: ReactNode;
  /** Anything the host wants between the pill and the arrows in the default row (a remove control). */
  trailing?: ReactNode;
}

export interface ReorderListLabels {
  /** The up button's name — "Mover para cima: {name}". */
  moveUp: (name: string) => string;
  /** The down button's name — "Mover para baixo: {name}". */
  moveDown: (name: string) => string;
  /** The polite announcement — "{name} agora está na posição {position} de {total}." */
  moved: (name: string, position: number, total: number) => string;
}

export interface ReorderListProps<T extends ReorderItem = ReorderItem> {
  /** The draft order, first to last. CONTROLLED: the host owns it, and owns saving it. */
  items: readonly T[];
  /** The new permutation, as ids, after one move. */
  onChange: (ids: string[]) => void;
  /** True while the host saves: every move button is inert. */
  disabled?: boolean;
  /** The id of the host's heading — the list's accessible name. */
  labelledBy?: string;
  /** The list's accessible name when no heading names it (the lesson list of a module card). */
  label?: string;
  /** The id of the host's helper line — the list's description. */
  describedBy?: string;
  labels: ReorderListLabels;
  /**
   * The host's own row around the two arrow buttons (a module card, a lesson link). The `<li>` then
   * carries only `data-reorder-row`; the host owns the row's geometry.
   */
  renderItem?: (item: T, arrows: ReactNode, index: number) => ReactNode;
  /** The `<ol>`'s classes (default: the communities' `flex flex-col gap-2`). */
  className?: string;
  /** The `data-testid` of the `<ol>`. */
  testId?: string;
}

type Direction = 'up' | 'down';

const OTHER: Record<Direction, Direction> = { up: 'down', down: 'up' };

export function ReorderList<T extends ReorderItem = ReorderItem>({
  items,
  onChange,
  disabled = false,
  labelledBy,
  label,
  describedBy,
  labels,
  renderItem,
  className = 'flex flex-col gap-2',
  testId,
}: ReorderListProps<T>) {
  const listRef = useRef<HTMLOListElement>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The button that must hold focus once the moved row has re-rendered (point 2). */
  const refocus = useRef<{ id: string; direction: Direction } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    const find = (direction: Direction) =>
      listRef.current?.querySelector<HTMLButtonElement>(
        `[data-reorder-id="${target.id}"][data-reorder-move="${direction}"]`,
      );
    const button = find(target.direction);
    if (!button) {
      // The row left the list (a stale answer, a removal): nothing to follow.
      refocus.current = null;
      return;
    }
    // The host disabled the whole list for its write: wait, and try again on the next render.
    if (button.disabled && disabled) return;
    // The same button is disabled for good (the row came back to an end): the row's other button.
    const target2 = button.disabled ? find(OTHER[target.direction]) : button;
    refocus.current = null;
    if (target2 && !target2.disabled && document.activeElement !== target2) {
      target2.focus({ preventScroll: true });
    }
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

  const arrowsFor = (item: T, index: number) => (
    <>
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
    </>
  );

  return (
    <>
      <ol
        ref={listRef}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        aria-busy={disabled || undefined}
        data-testid={testId}
        className={className}
      >
        {items.map((item, index) =>
          renderItem ? (
            <li key={item.id} data-reorder-row={item.id}>
              {renderItem(item, arrowsFor(item, index), index)}
            </li>
          ) : (
            <li
              key={item.id}
              data-reorder-row={item.id}
              className="flex min-h-14 items-center gap-2 rounded-xl bg-bg-secondary py-1.5 pr-1 pl-2"
            >
              {item.thumb !== undefined && item.thumb !== null ? (
                <span
                  data-reorder-thumb
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-tertiary"
                >
                  {item.thumb}
                </span>
              ) : null}
              {/* The only flexible child: at any name length the thumb and the two buttons keep
                  their size, and the NAME gives way (two lines, then clipped). */}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 break-words text-sm font-bold text-text">
                  {item.name}
                </span>
                {item.meta ? (
                  <span
                    data-reorder-meta
                    className="text-xs font-normal text-text-secondary tabular-nums"
                  >
                    {item.meta}
                  </span>
                ) : null}
              </span>
              {item.pill ? <span className="shrink-0">{item.pill}</span> : null}
              {item.trailing}
              {arrowsFor(item, index)}
            </li>
          ),
        )}
      </ol>
      {/* ONE polite region for the whole list: the move's position announcement. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
