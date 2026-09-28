'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { ChevronRight, GripVertical } from 'lucide-react';
import { Reorder, useDragControls, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { StoryMonogram } from './StoryCircle';

/**
 * UI-D-72 / UI-D-73 — the manage screen's reorder list: one place's highlights, in ROW order, each a
 * card the admin can drag, move with the keyboard, or open.
 *
 * **A list, not circles** (D-109): dragging circles inside a horizontally scrolling row is exactly
 * what the curation decision rejected, so the row stays read-only and the order is changed here.
 *
 * Presentational and props-only: it ships no words (PWA-03), makes no request of its own (the host's
 * `onReorder` is the one write), and resolves no route (the host's `onOpen` opens the edit sheet).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **The drag starts from the HANDLE only** (the item's own drag listener is off + `useDragControls`, and the
 *    handle is `touch-action: none`). A drag listener on the whole card would steal every vertical
 *    swipe, and on a phone the page could no longer scroll past a long list — a finger on the row
 *    body must scroll, a finger on the handle must drag.
 * 2. **Every drag has a keyboard equivalent on the SAME control** (WCAG 2.5.7): with the handle
 *    focused, ArrowUp/ArrowDown move the row one place, focus STAYS on that handle, and ONE polite
 *    live region announces the new position. The edit sheet's up/down buttons are the third path, for
 *    touch screen readers. Four 44px targets per row would leave a title ~36px wide at 320px.
 * 3. **ONE save per gesture, with the FULL permutation, optimistic, reverting to the LAST CONFIRMED
 *    order** — not to the order before the gesture. Two quick moves can be in flight at once; if the
 *    second is refused, the only order the server is known to hold is the last one it confirmed.
 *
 * The re-seed rule of the toggle machine applies here too: a new `items` array (the host's fresh
 * server read, e.g. after `router.refresh()` on `order_stale`) replaces the local order during render.
 */

export interface HighlightManageItem {
  id: string;
  title: string;
  /** "{n} stories" or "Vazio · só você vê" — ALREADY COMPOSED by the host (ICU plurals). */
  meta: string;
  /** The server-resolved cover (R-D-D), or null for the monogram (UI-D-62). */
  cover: { assetId: string; variantWidths: readonly number[] } | null;
}

export interface HighlightManageListLabels {
  /** The list's accessible name — "Destaques em ordem". */
  region: string;
  /** "Arraste para mudar a ordem. É a mesma ordem da fileira." — shown with ≥ 2 rows only. */
  helper: string;
  /** The handle's description — "Use as setas para cima e para baixo para mudar a posição." */
  dragHint: string;
  /** The handle's name — "Mover {title}". */
  drag: (title: string) => string;
  /** The body button's name — "Editar destaque {title}". */
  edit: (title: string) => string;
  /** The live announcement — "{title} agora está na posição {position} de {total}." */
  moved: (title: string, position: number, total: number) => string;
}

export interface HighlightManageListProps {
  items: readonly HighlightManageItem[];
  /** An archived community (UI-D-80): no handles, no helper — rows still open the reduced sheet. */
  archived?: boolean;
  /** ONE save with the full permutation. Resolves `false` to put the last confirmed order back. */
  onReorder: (ids: string[]) => Promise<boolean>;
  /** Opens the host's edit sheet for that highlight. */
  onOpen: (id: string) => void;
  labels: HighlightManageListLabels;
}

/** The lifted card's feedback (UI-D-73): a shadow and a z-index, never a scale. */
const LIFTED = 'z-10 shadow-[0_8px_24px_rgba(22,35,59,.16)]';

const idsOf = (items: readonly HighlightManageItem[]) => items.map((item) => item.id);

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export function HighlightManageList({
  items,
  archived = false,
  onReorder,
  onOpen,
  labels,
}: HighlightManageListProps) {
  const hintId = useId();
  const reduceMotion = useReducedMotion();

  const [order, setOrder] = useState<string[]>(() => idsOf(items));
  /** The last order the server CONFIRMED — what a refused save reverts to (point 3). */
  const confirmed = useRef<string[]>(idsOf(items));
  /** Mirrors `order` for the drag-end handler, which must read the order the drag left behind. */
  const orderRef = useRef<string[]>(order);
  orderRef.current = order;

  // Re-seed during render when the host hands a new array (React's documented alternative to an
  // effect): the list never paints the previous read's order next to the new one's rows.
  const [seed, setSeed] = useState(items);
  if (seed !== items) {
    setSeed(items);
    const next = idsOf(items);
    setOrder(next);
    confirmed.current = next;
  }

  const [announcement, setAnnouncement] = useState('');
  const [lifted, setLifted] = useState<string | null>(null);
  /** The handle that must hold focus after a keyboard move re-orders the DOM. */
  const refocus = useRef<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (refocus.current === null) return;
    const handle = handles.current.get(refocus.current);
    refocus.current = null;
    if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true });
  });

  const byId = new Map(items.map((item) => [item.id, item]));

  const save = useCallback(
    (next: string[]) => {
      if (sameOrder(next, confirmed.current)) return;
      void onReorder(next)
        .then((ok) => {
          if (ok) confirmed.current = next;
          else setOrder(confirmed.current);
        })
        .catch(() => setOrder(confirmed.current));
    },
    [onReorder],
  );

  const moveByKeyboard = (id: string, delta: -1 | 1) => {
    const current = orderRef.current;
    const from = current.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, id);
    refocus.current = id;
    setOrder(next);
    const title = byId.get(id)?.title ?? '';
    setAnnouncement(labels.moved(title, to + 1, next.length));
    save(next);
  };

  const rows = order.map((id) => byId.get(id)).filter((item) => item !== undefined);

  return (
    <div className="flex flex-col gap-2">
      {!archived && rows.length >= 2 ? (
        <p className="text-xs font-normal text-text-tertiary">{labels.helper}</p>
      ) : null}
      <span id={hintId} className="sr-only">
        {labels.dragHint}
      </span>
      <Reorder.Group
        as="ul"
        axis="y"
        values={order}
        onReorder={setOrder}
        aria-label={labels.region}
        className="flex flex-col gap-2"
      >
        {rows.map((item) => (
          <ManageRow
            key={item.id}
            item={item}
            archived={archived}
            lifted={lifted === item.id}
            reduceMotion={reduceMotion === true}
            hintId={hintId}
            labels={labels}
            registerHandle={(node) => {
              if (node) handles.current.set(item.id, node);
              else handles.current.delete(item.id);
            }}
            onLift={() => setLifted(item.id)}
            onDrop={() => {
              setLifted(null);
              save(orderRef.current);
            }}
            onKeyMove={(delta) => moveByKeyboard(item.id, delta)}
            onOpen={() => onOpen(item.id)}
          />
        ))}
      </Reorder.Group>
      {/* ONE polite region for the whole list: the keyboard move's position announcement. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

interface ManageRowProps {
  item: HighlightManageItem;
  archived: boolean;
  lifted: boolean;
  reduceMotion: boolean;
  hintId: string;
  labels: HighlightManageListLabels;
  registerHandle: (node: HTMLButtonElement | null) => void;
  onLift: () => void;
  onDrop: () => void;
  onKeyMove: (delta: -1 | 1) => void;
  onOpen: () => void;
}

/** One card. Its own component because each row owns its `useDragControls()`. */
function ManageRow({
  item,
  archived,
  lifted,
  reduceMotion,
  hintId,
  labels,
  registerHandle,
  onLift,
  onDrop,
  onKeyMove,
  onOpen,
}: ManageRowProps) {
  const controls = useDragControls();

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    // The arrows move the ROW, never the page.
    event.preventDefault();
    onKeyMove(event.key === 'ArrowUp' ? -1 : 1);
  };

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    controls.start(event);
  };

  return (
    <Reorder.Item
      as="li"
      value={item.id}
      dragListener={false}
      dragControls={controls}
      // Reduced motion: the layout animation is instant (the order still changes).
      transition={reduceMotion ? { duration: 0 } : undefined}
      onDragStart={onLift}
      onDragEnd={onDrop}
      className={cn(
        'relative flex min-h-16 items-center gap-3 rounded-xl bg-bg-secondary px-2 py-2',
        lifted && LIFTED,
      )}
    >
      {archived ? null : (
        <button
          type="button"
          ref={registerHandle}
          aria-label={labels.drag(item.title)}
          aria-describedby={hintId}
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKeyDown}
          style={{ touchAction: 'none' }}
          className="grid h-11 w-11 shrink-0 cursor-grab place-items-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <GripVertical aria-hidden size={20} />
        </button>
      )}
      <button
        type="button"
        aria-label={labels.edit(item.title)}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ManageCover item={item} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-bold text-text">{item.title}</span>
          <span className="truncate text-xs font-normal text-text-tertiary">{item.meta}</span>
        </span>
        <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
      </button>
    </Reorder.Item>
  );
}

/** The 48px round cover (UI-D-62 at card size), or the 48px monogram at identical geometry. */
function ManageCover({ item }: { item: HighlightManageItem }) {
  if (item.cover === null) return <StoryMonogram text={item.title} size={48} />;
  return (
    <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-full bg-bg-tertiary">
      <MediaImage
        assetId={item.cover.assetId}
        widths={item.cover.variantWidths}
        alt=""
        sizes="48px"
        ratio=""
        className="h-full w-full"
      />
    </span>
  );
}
