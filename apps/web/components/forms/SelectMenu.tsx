'use client';

import { cn } from '@rede-social/ui';
import { Check, ChevronDown } from 'lucide-react';
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export interface SelectMenuOption {
  /** What a choice reports, and what `lead` draws. */
  id: string;
  /** Its name, as the trigger and the list show it. */
  label: string;
}

export interface SelectMenuProps {
  options: readonly SelectMenuOption[];
  /** The chosen option's id; an id outside `options` shows the first option. */
  value: string;
  /** Another option was chosen (choosing the chosen one again only closes the list). */
  onChange: (id: string) => void;
  /** The visible label's id: it names the list and, followed by the value, the trigger. */
  labelId: string;
  /** The hint's id, read after the trigger's name. */
  describedBy?: string;
  /** The focus reached the trigger. */
  onFocus?: () => void;
  /** Drawn before an option's name, in the list and (unless `triggerLead` replaces it) the trigger. */
  lead?: (id: string) => ReactNode;
  /** What the trigger draws before the chosen option's name, in place of its `lead`. */
  triggerLead?: ReactNode;
  /** Classes for the chosen option's name in the trigger (by default it takes the free width). */
  valueClassName?: string;
  /**
   * The data attribute that marks each option row, without its `data-` prefix: the row carries
   * `data-{optionAttribute}="{id}"` (the specs reach the options by it).
   */
  optionAttribute: string;
}

/** A pause in the typing this long starts a new search (the APG example's 500 ms). */
const TYPEAHEAD_MS = 500;
/** The list's distance from its trigger, and the room it leaves at the window's edge. */
const GAP = 4;
const EDGE = 8;
/** How far PageUp and PageDown move the active option (with eight, to the ends). */
const PAGE = 10;

/** Case and accents aside, so "lila" finds "Lilás" and "petro" finds "Petróleo". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

/**
 * The option a typed string lands on: the first name, from `start` round the list, that begins
 * with it; the same letter typed over and over ("aaa") steps through the names that begin with
 * that letter instead. -1 when no name matches.
 */
export function typeaheadIndex(labels: readonly string[], typed: string, start: number): number {
  const query = fold(typed);
  if (!query) return -1;
  const order = labels.map((_, step) => (start + step) % labels.length);
  const find = (prefix: string) =>
    order.find((index) => fold(labels[index] ?? '').startsWith(prefix)) ?? -1;
  const hit = find(query);
  if (hit >= 0) return hit;
  const letter = query.charAt(0);
  return [...query].every((char) => char === letter) ? find(letter) : -1;
}

/**
 * The list in the top layer when the browser has the Popover API. A browser without it, or one
 * that refuses the call, keeps the list as it is: `fixed` at the same place, `z-50`.
 */
function topLayer(list: HTMLElement, show: boolean) {
  if (typeof list.showPopover !== 'function') return;
  try {
    if (show) list.showPopover();
    else list.hidePopover();
  } catch {
    // The fixed list still shows while open, and the `hidden` attribute still hides it.
  }
}

/**
 * A dropdown of a few named options (2026-10-03, born as the wizard's ground-tone `ToneSelect`;
 * shared since 2026-10-06 with the administrator's icon on "Editar perfil"): the WAI-ARIA
 * "select-only combobox", each option drawn with its `lead` (a swatch, an icon).
 *
 * The trigger is a button with the combobox role, in the field look (the `Input` box: rounded-xl,
 * bg-bg-input, the hairline border that turns brand on focus, 16px text, 50px tall): the chosen
 * option's lead (or `triggerLead`), its name and a chevron. Its name is the label followed by the
 * value (`aria-labelledby` = label + value), the hint describes it, `aria-controls` names the list
 * and, while the list is open, `aria-activedescendant` names the active option. DOM focus stays on
 * the trigger: the options are reached through that reference, so the arrows never scroll the page.
 * Only a press on the list's own scrollbar may move it to the list (which answers the same keys),
 * and a choice or Escape from there sends it back, so it never stays on a list that closes.
 *
 * The list is a card (bg-bg-secondary, rounded-xl, border, shadow) of `role="option"` rows: the
 * lead, the name and, on the chosen one only, a check (a cue that is not a colour) with
 * `aria-selected`. The active one is tinted; when the keyboard moved it there, it also takes the
 * brand ring the font list draws around its focused row, so the pointer moving over the rows never
 * drags a focus ring along. Forced colours (Windows High Contrast) drop the tint and the ring
 * alike, a background and a box-shadow, so there the active row is outlined instead, however it
 * got there: it is the one Enter and Tab choose, and an outline keeps a system colour. Closed, the
 * list stays mounted and `hidden` (out of the accessibility tree), so `aria-controls` always names
 * a real element.
 *
 * Keyboard, as in the APG example: closed, Enter, Space, Down and Up open it on the chosen option,
 * Home and End on the first and the last; open, Down and Up move (stopping at the ends), Home, End,
 * PageUp and PageDown jump, Enter and Space choose the active option and close, Alt+Up too, and
 * Escape closes without choosing, the focus staying on (or going back to) the trigger. Tab chooses
 * the active option and lets the focus move on, as the APG example and a native select on Windows
 * do: what the keyboard user left highlighted is what they meant. Typed letters, open or closed,
 * open the list and jump to the first name that begins with them, accents and case aside, the same
 * letter again stepping through its names. A press outside closes the list without choosing; so
 * does the focus leaving the trigger for anything but the list.
 *
 * Placement: a card around the menu may clip its content (`Card` is `overflow-hidden`) and the next
 * card would paint over a list that spilled out of it, so the list never lives in the card's flow.
 * It goes to the TOP LAYER (`popover="manual"`, shown and hidden here): above every card and the
 * sticky bars, out of reach of any ancestor's overflow, z-index or transform, yet still a DOM child
 * of its picker (`[data-tone-picker] [data-tone-option]` keeps matching, and it inherits the
 * theme). Without the Popover API (Safari 16, Chrome before 114, Firefox before 125) it stays
 * `fixed` at `z-50`: over the cards and over a sticky `z-40` bar too, as the top layer would be,
 * and under the sheets, dialogs and toasts (the stacking ladder in tokens.css). Either way it is
 * placed from the trigger's box: under it, or over it when the room below is short and the room
 * above larger, as wide as the trigger, scrolling inside the room it gets (its rows keep their
 * height: a column flex box would squeeze a wrapped name's row to its min-height), and it follows
 * the trigger while the page scrolls or the window resizes. It is placed by its TOP both ways, over
 * the trigger at the height it ends up with: the window's height only sizes the room. On a phone
 * whose toolbar collapses, `documentElement.clientHeight` keeps the small viewport while a fixed
 * box anchored by its bottom follows the visible one, so a list hung from the bottom would land on
 * its own trigger.
 */
export function SelectMenu({
  options,
  value,
  onChange,
  labelId,
  describedBy,
  onFocus,
  lead,
  triggerLead,
  valueClassName,
  optionAttribute,
}: SelectMenuProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;
  const optionId = (id: string) => `${baseId}-option-${id}`;
  const rowAttribute = `data-${optionAttribute}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: '' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Whether the keyboard placed the active option (it then wears the focus ring).
  const [keyed, setKeyed] = useState(false);

  const last = options.length - 1;
  const chosen = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const current = options[chosen];
  const activeOption = open ? options[active] : undefined;
  const activeId = activeOption ? optionId(activeOption.id) : undefined;

  const show = (index: number, byKeys: boolean) => {
    setActive(index);
    setKeyed(byKeys);
    setOpen(true);
  };
  const move = (index: number) => {
    setActive(Math.min(Math.max(index, 0), last));
    setKeyed(true);
  };
  /** Closes the list on the option at `index`, reporting it unless it is the chosen one. */
  const choose = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (option && index !== chosen) onChange(option.id);
  };
  const refocus = () => triggerRef.current?.focus();

  const type = (key: string) => {
    const search = typed.current;
    clearTimeout(search.timer);
    search.text += key;
    const from = open ? active : chosen;
    const index = typeaheadIndex(
      options.map((option) => option.label),
      search.text,
      from + 1,
    );
    if (index < 0) {
      search.text = '';
    } else {
      search.timer = setTimeout(() => {
        search.text = '';
      }, TYPEAHEAD_MS);
    }
    show(index < 0 ? from : index, true);
  };

  /** The trigger's keys, and the list's should it ever hold the focus (a press on its scrollbar). */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const { key, altKey, ctrlKey, metaKey } = event;
    if (key.length === 1 && key !== ' ' && !altKey && !ctrlKey && !metaKey) {
      event.preventDefault();
      type(key);
      return;
    }
    if (!open) {
      if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
        show(chosen, true);
      } else if (key === 'Home' || key === 'End') {
        show(key === 'Home' ? 0 : last, true);
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    switch (key) {
      case 'ArrowDown':
        move(active + 1);
        break;
      case 'ArrowUp':
        if (altKey) {
          choose(active);
          refocus();
        } else {
          move(active - 1);
        }
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(last);
        break;
      case 'PageUp':
        move(active - PAGE);
        break;
      case 'PageDown':
        move(active + PAGE);
        break;
      case 'Enter':
      case ' ':
        choose(active);
        refocus();
        break;
      case 'Escape':
        // Only the list closes: a dialog or sheet around the picker keeps its own Escape.
        event.stopPropagation();
        setOpen(false);
        refocus();
        break;
      case 'Tab':
        // No preventDefault: the focus moves on with the choice made.
        choose(active);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  // A button clicks on the RELEASE of Space in some engines: the press already opened or chose.
  const holdSpace = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ') event.preventDefault();
  };

  const onTriggerClick = () => {
    if (open) setOpen(false);
    else show(chosen, false);
    // Safari does not focus a clicked button: the keys must reach the trigger all the same.
    refocus();
  };

  // The focus leaving for anything but the trigger or its list closes the list, choosing nothing.
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    const inside =
      next instanceof Node &&
      (triggerRef.current?.contains(next) || listRef.current?.contains(next));
    if (!inside) setOpen(false);
  };

  const optionIndex = (target: EventTarget) => {
    const row = target instanceof Element ? target.closest(`[${rowAttribute}]`) : null;
    const id = row?.getAttribute(rowAttribute);
    return options.findIndex((option) => option.id === id);
  };
  // A press on the list keeps the focus on the trigger wherever it lands, a row, the padding or a
  // gap between rows (the list itself, tabIndex -1, would take it, and Shift+Tab would then stop
  // on the trigger). Only its classic scrollbar, past the client width, is left alone: dragging it
  // must still scroll, and the list it focuses stays open and answers the same keys.
  const onListMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const scrollbar = event.target === list && event.nativeEvent.offsetX >= list.clientWidth;
    if (!scrollbar) event.preventDefault();
  };
  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    const index = optionIndex(event.target);
    if (index < 0) return;
    choose(index);
    refocus();
  };
  const onListMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const index = optionIndex(event.target);
    if (index >= 0 && (index !== active || keyed)) {
      setActive(index);
      setKeyed(false);
    }
  };

  // Open: the top layer, the place, and the place again on every scroll and resize.
  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!open || !list || !trigger) return;
    topLayer(list, true);
    let frame = 0;
    const place = () => {
      frame = 0;
      const box = trigger.getBoundingClientRect();
      const below = document.documentElement.clientHeight - box.bottom - GAP - EDGE;
      const above = box.top - GAP - EDGE;
      const { style } = list;
      style.left = `${box.left}px`;
      style.width = `${box.width}px`;
      // The whole list with its border at that width, however much the last placement let show.
      const need = list.scrollHeight + list.offsetHeight - list.clientHeight;
      const up = need > below && above > below;
      style.maxHeight = `${Math.max(up ? above : below, 0)}px`;
      // By its top either way, over the trigger at the height it now has, whole or capped: its
      // place never hangs on the window's height, which a phone's collapsing toolbar leaves stale.
      style.top = `${up ? box.top - GAP - list.offsetHeight : box.bottom + GAP}px`;
      style.bottom = 'auto';
    };
    const follow = (event: Event) => {
      if (event.target === list || frame) return;
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      topLayer(list, false);
    };
  }, [open]);

  // The active option always in sight inside the list (which may scroll), never the page moving.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = open ? list?.children[active] : undefined;
    if (!list || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [open, active]);

  // A press anywhere else closes the list, choosing nothing.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      const inside =
        target instanceof Node &&
        (triggerRef.current?.contains(target) || listRef.current?.contains(target));
      if (!inside) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  useEffect(() => {
    const search = typed.current;
    return () => clearTimeout(search.timer);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        onClick={onTriggerClick}
        onKeyDown={onKeyDown}
        onKeyUp={holdSpace}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          'flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-border bg-bg-input px-4 py-3 text-left text-base text-text transition-colors',
          'hover:border-border-secondary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20',
        )}
      >
        {triggerLead ?? (current && lead ? lead(current.id) : null)}
        <span id={valueId} className={cn('min-w-0 flex-1 truncate', valueClassName)}>
          {current?.label}
        </span>
        <ChevronDown
          aria-hidden
          size={18}
          className={cn(
            'shrink-0 text-text-tertiary transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        aria-activedescendant={activeId}
        tabIndex={-1}
        popover="manual"
        hidden={!open}
        onMouseDown={onListMouseDown}
        onClick={onListClick}
        onMouseMove={onListMouseMove}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="fixed inset-auto z-50 m-0 flex flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border border-border bg-bg-secondary p-1.5 text-text shadow-lg outline-none"
      >
        {options.map((option, index) => {
          const selected = index === chosen;
          const lit = open && index === active;
          const mark: Record<`data-${string}`, string> = { [rowAttribute]: option.id };
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: the select-only combobox pattern reaches its options through `aria-activedescendant`; the DOM focus stays on the trigger and never lands on an option.
            <div
              key={option.id}
              id={optionId(option.id)}
              role="option"
              aria-selected={selected}
              {...mark}
              className={cn(
                'flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-base',
                lit && 'bg-bg-active forced-colors:outline-2 forced-colors:-outline-offset-2',
                lit && keyed && 'ring-2 ring-brand ring-inset',
              )}
            >
              {lead ? lead(option.id) : null}
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {selected ? <Check aria-hidden size={18} className="shrink-0 text-brand" /> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
