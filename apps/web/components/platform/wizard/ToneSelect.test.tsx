// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToneSelect, typeaheadIndex } from './ToneSelect';

/**
 * The ground tone's dropdown on its own (`ToneSelect`, 2026-10-03): the WAI-ARIA select-only
 * combobox, its keyboard, its closing and its place, over the light tones' REAL names (read from
 * the pt-BR catalog, so a renamed tone fails here), inside a stateful stand-in for the picker. The
 * picker's own wiring (the draft, the preview's theme, both modes) is PersonalizationColors.test.
 *
 * Claims:
 *  1. The trigger is a button with the combobox role, named by the label and the value, described
 *     by the hint, controlling a listbox named by the label; closed, the list is mounted but hidden
 *     and nothing is active; open, `aria-activedescendant` names the active option, which starts on
 *     the chosen one, the only one selected.
 *  2. Closed, Enter, Space, Down and Up open it on the chosen option and Home and End on the ends,
 *     choosing nothing; Tab and Escape are left alone.
 *  3. Open, the arrows move and stop at the ends, Home, End, PageUp and PageDown jump; Enter, Space
 *     and Alt+Up choose and close, the focus on the trigger, even when the list held it (a press on
 *     its scrollbar); Escape closes choosing nothing and brings the focus back, from the list too;
 *     Tab chooses and lets the focus go; choosing the chosen one again reports nothing.
 *  4. Typed letters open the list and jump by name, accents and case aside, the same letter over
 *     and over stepping through its names, and a pause starts a new search.
 *  5. The pointer: the trigger toggles; a press on the list (a row, its padding, a gap between
 *     rows) never takes the focus, one on its scrollbar aside; a row clicked is chosen, the focus
 *     back on the trigger even from the list; the row under the pointer becomes the active one,
 *     tinted but without the keyboard's ring; forced colours, which drop both, outline the active
 *     row instead, however it got there; a press outside, or the focus leaving for anything but
 *     the list, closes choosing nothing.
 *  6. Open, the list goes to the top layer (where the Popover API exists) and leaves it on close;
 *     without it, its z-index lifts it over the panel's sticky bar. It is placed by its top: under
 *     its trigger and as wide as it, or over it when the room below is short, its bottom edge 4px
 *     above the trigger whatever the window's height says; capped by the room, it scrolls and its
 *     rows never shrink; and it follows the trigger on scroll.
 */

type Tones = { default: string; light: Record<string, string> };
type Background = { title: string; lightBody: string };
const BRAND = (
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'platform.wizard.json'), 'utf8'),
  ) as { platform: { wizard: { brand: { tones: Tones; background: Background } } } }
).platform.wizard.brand;

const IDS = [
  'cinza',
  'amarelado',
  'laranjado',
  'avermelhado',
  'lilas',
  'azulado',
  'agua',
  'esverdeado',
];
const OPTIONS = IDS.map((id) => {
  const name = BRAND.tones.light[id] ?? id;
  return { id, label: id === 'cinza' ? BRAND.tones.default.replace('{tone}', name) : name };
});
const nameOf = (id: string) => OPTIONS.find((option) => option.id === id)?.label ?? id;
const LABEL = BRAND.background.title;
const HINT = BRAND.background.lightBody;

/** The picker around the dropdown: the label, the hint, the value in state, a control after it. */
function Picker({ initial, onChange }: { initial: string; onChange: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <span id="tone-label">{LABEL}</span>
      <p id="tone-hint">{HINT}</p>
      <ToneSelect
        mode="light"
        options={OPTIONS}
        value={value}
        labelId="tone-label"
        describedBy="tone-hint"
        onChange={(id) => {
          onChange(id);
          setValue(id);
        }}
      />
      <button type="button">Depois</button>
    </div>
  );
}

function stage(initial = 'cinza') {
  const onChange = vi.fn();
  render(<Picker initial={initial} onChange={onChange} />);
  const combo = screen.getByRole('combobox');
  const list = document.getElementById(combo.getAttribute('aria-controls') ?? '') as HTMLElement;
  return { onChange, combo, list };
}

/** The name of the option the trigger points at, or null while nothing is active. */
const activeName = (combo: HTMLElement) =>
  document.getElementById(combo.getAttribute('aria-activedescendant') ?? '')?.textContent ?? null;
const expanded = (combo: HTMLElement) => combo.getAttribute('aria-expanded');

afterEach(cleanup);

describe('ToneSelect: the trigger and its list', () => {
  it('1. a combobox named by the label and the value, controlling a hidden list until it opens', () => {
    const { combo, list } = stage();
    expect(screen.getByRole('combobox', { name: `${LABEL} ${nameOf('cinza')}` })).toBe(combo);
    expect(screen.getByRole('combobox', { description: HINT })).toBe(combo);
    expect(combo.tagName).toBe('BUTTON');
    expect(combo.getAttribute('type')).toBe('button');
    expect(combo.getAttribute('aria-haspopup')).toBe('listbox');
    expect(expanded(combo)).toBe('false');
    expect(combo.hasAttribute('aria-activedescendant')).toBe(false);
    // Closed, the list is mounted (the reference stays real) but out of reach.
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.hidden).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();

    fireEvent.click(combo);
    expect(expanded(combo)).toBe('true');
    expect(screen.getByRole('listbox', { name: LABEL })).toBe(list);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(OPTIONS.map((o) => o.label));
    expect(new Set(options.map((option) => option.id)).size).toBe(8);
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(combo.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
  });
});

describe('ToneSelect: the keyboard', () => {
  it.each(['Enter', ' ', 'ArrowDown', 'ArrowUp'])(
    '2. closed, %j opens on the chosen option, choosing nothing',
    (key) => {
      const { onChange, combo } = stage('lilas');
      // Prevented: no page scroll, no click of the button.
      expect(fireEvent.keyDown(combo, { key })).toBe(false);
      expect(expanded(combo)).toBe('true');
      expect(activeName(combo)).toBe(nameOf('lilas'));
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('2. closed, Home and End open on the ends; Tab and Escape are left alone', () => {
    const { onChange, combo } = stage('lilas');
    expect(fireEvent.keyDown(combo, { key: 'Home' })).toBe(false);
    expect(activeName(combo)).toBe(nameOf('cinza'));
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(fireEvent.keyDown(combo, { key: 'End' })).toBe(false);
    expect(activeName(combo)).toBe(nameOf('esverdeado'));
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(expanded(combo)).toBe('false');
    expect(fireEvent.keyDown(combo, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(combo, { key: 'Escape' })).toBe(true);
    expect(expanded(combo)).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('3. open, the arrows move and stop at the ends; Home, End and the pages jump', () => {
    const { onChange, combo } = stage();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(activeName(combo)).toBe(nameOf('cinza'));
    expect(fireEvent.keyDown(combo, { key: 'ArrowUp' })).toBe(false);
    expect(activeName(combo)).toBe(nameOf('cinza'));
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(activeName(combo)).toBe(nameOf('laranjado'));
    fireEvent.keyDown(combo, { key: 'End' });
    expect(activeName(combo)).toBe(nameOf('esverdeado'));
    expect(fireEvent.keyDown(combo, { key: 'ArrowDown' })).toBe(false);
    expect(activeName(combo)).toBe(nameOf('esverdeado'));
    fireEvent.keyDown(combo, { key: 'Home' });
    expect(activeName(combo)).toBe(nameOf('cinza'));
    fireEvent.keyDown(combo, { key: 'PageDown' });
    expect(activeName(combo)).toBe(nameOf('esverdeado'));
    fireEvent.keyDown(combo, { key: 'PageUp' });
    expect(activeName(combo)).toBe(nameOf('cinza'));
    // Moving only: still open, still the gray.
    expect(expanded(combo)).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(['Enter', ' '])(
    '3. open, %j chooses the active option and closes, the focus on the trigger',
    (key) => {
      const { onChange, combo } = stage();
      combo.focus();
      fireEvent.keyDown(combo, { key: 'ArrowDown' });
      fireEvent.keyDown(combo, { key: 'ArrowDown' });
      expect(fireEvent.keyDown(combo, { key })).toBe(false);
      // A released Space never clicks the trigger open again.
      expect(fireEvent.keyUp(combo, { key: ' ' })).toBe(false);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith('amarelado');
      expect(expanded(combo)).toBe('false');
      expect(combo.hasAttribute('aria-activedescendant')).toBe(false);
      expect(document.activeElement).toBe(combo);
      // The trigger names and shows the choice.
      expect(screen.getByRole('combobox', { name: `${LABEL} ${nameOf('amarelado')}` })).toBe(combo);
      expect(combo.querySelector('[data-bg-tone]')?.getAttribute('data-bg-tone')).toBe('amarelado');
    },
  );

  it('3. open, Alt+Up chooses the active option and closes', () => {
    const { onChange, combo } = stage();
    fireEvent.keyDown(combo, { key: 'End' });
    fireEvent.keyDown(combo, { key: 'ArrowUp' });
    expect(fireEvent.keyDown(combo, { key: 'ArrowUp', altKey: true })).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('agua');
    expect(expanded(combo)).toBe('false');
  });

  it('3. Escape closes choosing nothing and brings the focus back to the trigger', () => {
    const { onChange, combo, list } = stage();
    combo.focus();
    fireEvent.keyDown(combo, { key: 'End' });
    expect(fireEvent.keyDown(combo, { key: 'Escape' })).toBe(false);
    expect(expanded(combo)).toBe('false');
    expect(document.activeElement).toBe(combo);
    expect(screen.getByRole('combobox', { name: `${LABEL} ${nameOf('cinza')}` })).toBe(combo);
    // Even when the list held the focus (a press on its scrollbar): the focus goes back.
    fireEvent.click(combo);
    list.focus();
    expect(document.activeElement).toBe(list);
    expect(expanded(combo)).toBe('true');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(expanded(combo)).toBe('false');
    expect(document.activeElement).toBe(combo);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'Enter', key: 'Enter', altKey: false },
    { name: 'Space', key: ' ', altKey: false },
    { name: 'Alt+Up', key: 'ArrowUp', altKey: true },
  ])(
    '3. $name from the list chooses, closes and sends the focus back to the trigger',
    ({ key, altKey }) => {
      const { onChange, combo, list } = stage();
      fireEvent.click(combo);
      // The list holds the focus (a press on its scrollbar gives it): its keys are the trigger's.
      list.focus();
      expect(document.activeElement).toBe(list);
      fireEvent.keyDown(list, { key: 'ArrowDown' });
      expect(fireEvent.keyDown(list, { key, altKey })).toBe(false);
      expect(onChange).toHaveBeenLastCalledWith('amarelado');
      expect(expanded(combo)).toBe('false');
      // The list closed under the focus: the focus goes back to the trigger, never to the page.
      expect(document.activeElement).toBe(combo);
    },
  );

  it('3. Tab chooses the active option and lets the focus move on', () => {
    const { onChange, combo } = stage();
    fireEvent.keyDown(combo, { key: 'End' });
    // Not prevented: the browser moves the focus to the next control.
    expect(fireEvent.keyDown(combo, { key: 'Tab' })).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('esverdeado');
    expect(expanded(combo)).toBe('false');
  });

  it('3. the chosen option chosen again reports nothing', () => {
    const { onChange, combo } = stage('azulado');
    fireEvent.keyDown(combo, { key: 'Enter' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(expanded(combo)).toBe('false');
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Tab' });
    expect(expanded(combo)).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ToneSelect: typing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('4. letters open the list and jump by name, accents and case aside', () => {
    const { onChange, combo } = stage();
    expect(fireEvent.keyDown(combo, { key: 'L' })).toBe(false);
    expect(expanded(combo)).toBe('true');
    expect(activeName(combo)).toBe(nameOf('laranjado'));
    for (const key of ['i', 'l', 'a']) fireEvent.keyDown(combo, { key });
    expect(activeName(combo)).toBe(nameOf('lilas'));
    // A pause starts a new search.
    vi.advanceTimersByTime(600);
    fireEvent.keyDown(combo, { key: 'v' });
    expect(activeName(combo)).toBe(nameOf('agua'));
    // A letter no name begins with keeps the active option; a shortcut is not typing.
    vi.advanceTimersByTime(600);
    fireEvent.keyDown(combo, { key: 'x' });
    expect(activeName(combo)).toBe(nameOf('agua'));
    expect(fireEvent.keyDown(combo, { key: 'c', ctrlKey: true })).toBe(true);
    expect(activeName(combo)).toBe(nameOf('agua'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('4. the same letter over and over steps through its names', () => {
    const { combo } = stage();
    const steps: (string | null)[] = [];
    for (let press = 0; press < 4; press += 1) {
      fireEvent.keyDown(combo, { key: 'a' });
      steps.push(activeName(combo));
    }
    // Amarelado, Avermelhado, Azulado, and round again (Verde-água starts with a "v").
    expect(steps).toEqual(['amarelado', 'avermelhado', 'azulado', 'amarelado'].map(nameOf));
  });

  it('4. the search folds case and accents, and wraps round from where it starts', () => {
    const labels = ['Grafite (padrão)', 'Café', 'Petróleo', 'Musgo'];
    expect(typeaheadIndex(labels, 'CAFE', 0)).toBe(1);
    expect(typeaheadIndex(labels, 'petro', 3)).toBe(2);
    expect(typeaheadIndex(labels, 'g', 1)).toBe(0);
    expect(typeaheadIndex(labels, 'gg', 1)).toBe(0);
    expect(typeaheadIndex(labels, 'z', 0)).toBe(-1);
    expect(typeaheadIndex(labels, '', 0)).toBe(-1);
  });
});

describe('ToneSelect: the pointer', () => {
  it('5. the trigger toggles; a row clicked is chosen and the focus stays on the trigger', () => {
    const { onChange, combo } = stage();
    fireEvent.click(combo);
    expect(expanded(combo)).toBe('true');
    // Focused even where a click does not focus a button (Safari), so the keys reach it.
    expect(document.activeElement).toBe(combo);
    fireEvent.click(combo);
    expect(expanded(combo)).toBe('false');
    fireEvent.click(combo);
    const row = screen.getByRole('option', { name: nameOf('azulado') });
    // Pressing a row never takes the focus from the trigger.
    expect(fireEvent.mouseDown(row)).toBe(false);
    fireEvent.click(row.querySelector('span:last-of-type') ?? row);
    expect(onChange).toHaveBeenLastCalledWith('azulado');
    expect(expanded(combo)).toBe('false');
    expect(document.activeElement).toBe(combo);
  });

  it('5. a row clicked while the list holds the focus sends the focus back to the trigger', () => {
    const { onChange, combo, list } = stage();
    fireEvent.click(combo);
    // A press on the list's scrollbar is the one press that may focus it.
    list.focus();
    expect(document.activeElement).toBe(list);
    fireEvent.click(screen.getByRole('option', { name: nameOf('azulado') }));
    expect(onChange).toHaveBeenLastCalledWith('azulado');
    expect(expanded(combo)).toBe('false');
    // The list closed under the focus: the focus goes back to the trigger, never to the page.
    expect(document.activeElement).toBe(combo);
  });

  it('5. a press on the list never takes the focus, one on its scrollbar aside', () => {
    const { combo, list } = stage();
    fireEvent.click(combo);
    // A classic scrollbar: the list's client width stops where the bar begins.
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 290 });
    /** A press `offsetX` px into `target`; true when the browser keeps its default. */
    const press = (target: HTMLElement, offsetX: number) => {
      const event = createEvent.mouseDown(target);
      Object.defineProperty(event, 'offsetX', { value: offsetX });
      return fireEvent(target, event);
    };
    // The list's own padding, or a gap between two rows: the list itself, inside its client width.
    // Its default would focus it (it is tabIndex -1), and Shift+Tab would then land on the trigger.
    expect(press(list, 3)).toBe(false);
    expect(press(list, 289)).toBe(false);
    // A row, wherever on it.
    expect(press(screen.getByRole('option', { name: nameOf('lilas') }), 300)).toBe(false);
    // The scrollbar, past the client width: left alone, so dragging it still scrolls the list.
    expect(press(list, 290)).toBe(true);
    expect(press(list, 300)).toBe(true);
    expect(expanded(combo)).toBe('true');
  });

  it('5. the row under the pointer becomes the active one, without the keyboard’s ring', () => {
    const { combo } = stage();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    const keyed = screen.getByRole('option', { name: nameOf('amarelado') });
    expect(keyed.className).toContain('bg-bg-active');
    expect(keyed.className).toContain('ring-2');
    const hovered = screen.getByRole('option', { name: nameOf('lilas') });
    fireEvent.mouseMove(hovered.querySelector('span:last-of-type') ?? hovered);
    expect(combo.getAttribute('aria-activedescendant')).toBe(hovered.id);
    expect(hovered.className).toContain('bg-bg-active');
    expect(hovered.className).not.toContain('ring-2');
    expect(keyed.className).not.toContain('bg-bg-active');
    // The keyboard goes on from there, with its ring again.
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(activeName(combo)).toBe(nameOf('azulado'));
    expect(screen.getByRole('option', { name: nameOf('azulado') }).className).toContain('ring-2');
  });

  it('5. forced colours drop the tint and the ring: the active row is outlined instead', () => {
    const { combo } = stage();
    // An outline keeps a system colour there; a background and a box-shadow do not.
    const OUTLINE = ['forced-colors:outline-2', 'forced-colors:-outline-offset-2'];
    const outlined = () =>
      screen
        .getAllByRole('option')
        .filter((row) => OUTLINE.every((name) => row.classList.contains(name)))
        .map((row) => row.getAttribute('data-tone-option'));
    // The keyboard's active row, the one wearing the ring...
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(outlined()).toEqual(['amarelado']);
    // ...and the pointer's, only tinted: either one is what Enter and Tab would choose.
    const hovered = screen.getByRole('option', { name: nameOf('lilas') });
    fireEvent.mouseMove(hovered.querySelector('span:last-of-type') ?? hovered);
    expect(hovered.className).not.toContain('ring-2');
    expect(outlined()).toEqual(['lilas']);
    // Only while forced: the normal look keeps no outline of its own.
    expect(hovered.className).not.toMatch(/(^|\s)outline-/);
  });

  it('5. a press outside, or the focus leaving, closes the list choosing nothing', () => {
    const { onChange, combo, list } = stage();
    fireEvent.click(combo);
    // A press on a row or on the trigger is not outside.
    fireEvent.pointerDown(screen.getByRole('option', { name: nameOf('amarelado') }));
    fireEvent.pointerDown(combo);
    expect(expanded(combo)).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(expanded(combo)).toBe('false');
    // The focus going into the list keeps it open; anywhere else, it closes.
    fireEvent.click(combo);
    fireEvent.focusOut(combo, { relatedTarget: list });
    expect(expanded(combo)).toBe('true');
    fireEvent.focusOut(combo, { relatedTarget: screen.getByRole('button', { name: 'Depois' }) });
    expect(expanded(combo)).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ToneSelect: the list’s place', () => {
  const proto = HTMLElement.prototype;
  const saved = {
    show: Object.getOwnPropertyDescriptor(proto, 'showPopover'),
    hide: Object.getOwnPropertyDescriptor(proto, 'hidePopover'),
  };
  const restore = (name: 'showPopover' | 'hidePopover', descriptor?: PropertyDescriptor) => {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else Reflect.deleteProperty(proto, name);
  };
  afterEach(() => {
    restore('showPopover', saved.show);
    restore('hidePopover', saved.hide);
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
  });

  /**
   * A trigger box at `top` (50px tall, 300px wide at x 40) in a window `height` px tall (800),
   * and the list laid out as a browser would: `whole` px tall (380), or its max-height if less.
   */
  const at = (
    combo: HTMLElement,
    list: HTMLElement,
    top: number,
    { whole = 380, height = 800 } = {},
  ) => {
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: height,
    });
    const shown = () =>
      Math.min(whole, list.style.maxHeight ? Number.parseFloat(list.style.maxHeight) : whole);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: whole });
    Object.defineProperty(list, 'offsetHeight', { configurable: true, get: shown });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: shown });
    combo.getBoundingClientRect = () =>
      ({ top, bottom: top + 50, left: 40, right: 340, width: 300, height: 50 }) as DOMRect;
  };

  it('6. open, the list is in the top layer, and it leaves it on close', () => {
    const show = vi.fn();
    const hide = vi.fn();
    Object.defineProperty(proto, 'showPopover', { configurable: true, value: show });
    Object.defineProperty(proto, 'hidePopover', { configurable: true, value: hide });
    const { combo, list } = stage();
    expect(list.getAttribute('popover')).toBe('manual');
    expect(list.className).toContain('fixed');
    expect(show).not.toHaveBeenCalled();
    fireEvent.click(combo);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.contexts[0]).toBe(list);
    expect(hide).not.toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide.mock.contexts[0]).toBe(list);
  });

  it('6. it opens under the trigger, as wide as it, or over it when the room below is short', () => {
    const { combo, list } = stage();
    at(combo, list, 100);
    fireEvent.click(combo);
    expect(list.style.left).toBe('40px');
    expect(list.style.width).toBe('300px');
    expect(list.style.top).toBe('154px');
    expect(list.style.bottom).toBe('auto');
    // All the room down to 8px off the window's edge; it scrolls inside if it needs more.
    expect(list.style.maxHeight).toBe(`${800 - 150 - 4 - 8}px`);
    fireEvent.click(combo);

    at(combo, list, 700);
    fireEvent.click(combo);
    // Over it, placed by its top as well: its bottom edge 4px above the trigger.
    expect(list.style.top).toBe(`${700 - 4 - 380}px`);
    expect(list.style.bottom).toBe('auto');
    expect(list.style.maxHeight).toBe(`${700 - 4 - 8}px`);
  });

  it('6. over the trigger and short of room, it fills it up to 8px off the window’s top', () => {
    const { combo, list } = stage();
    // 488px above against 238px below for a 600px list: over it, capped, scrolling inside.
    at(combo, list, 500, { whole: 600 });
    fireEvent.click(combo);
    expect(list.style.maxHeight).toBe(`${500 - 4 - 8}px`);
    expect(list.style.top).toBe('8px');
    expect(list.style.bottom).toBe('auto');
  });

  it('6. its place over the trigger never hangs on the window’s height', () => {
    // A phone whose toolbar collapsed: `documentElement.clientHeight` keeps the small viewport,
    // 56px short of the one a fixed box is placed in. Hung from its bottom by that height, the list
    // would land 56px low, over its own trigger; placed by its top, it stays where it belongs.
    const tops: string[] = [];
    for (const height of [800, 800 - 56]) {
      const { combo, list } = stage();
      at(combo, list, 700, { height });
      fireEvent.click(combo);
      expect(list.style.bottom).toBe('auto');
      tops.push(list.style.top);
      cleanup();
    }
    expect(tops).toEqual([`${700 - 4 - 380}px`, `${700 - 4 - 380}px`]);
  });

  it('6. capped by the room, the list scrolls: its rows never shrink', () => {
    const { combo } = stage();
    fireEvent.click(combo);
    // A column flex box with a max-height would squeeze a wrapped name's row to its min-height.
    for (const row of screen.getAllByRole('option')) {
      expect(row.classList.contains('shrink-0')).toBe(true);
      expect(row.classList.contains('min-h-11')).toBe(true);
    }
  });

  it('6. without the Popover API, it paints over the panel’s sticky bar, under the dialogs', () => {
    Reflect.deleteProperty(proto, 'showPopover');
    Reflect.deleteProperty(proto, 'hidePopover');
    const { combo, list } = stage();
    fireEvent.click(combo);
    expect(list.hidden).toBe(false);
    expect(list.className).toContain('fixed');
    // Its z-index is all that lifts it there. The stacking ladder (tokens.css): 40 the sticky page
    // layer (the panel's top bar on a phone), 55 the sheets and dialogs.
    const rung = Number(/(?:^|\s)z-(\d+)(?:\s|$)/.exec(list.className)?.[1]);
    expect(rung).toBeGreaterThan(40);
    expect(rung).toBeLessThan(55);
  });

  it('6. it follows the trigger while the page scrolls', async () => {
    const { combo, list } = stage();
    at(combo, list, 100);
    fireEvent.click(combo);
    expect(list.style.top).toBe('154px');
    at(combo, list, 60);
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(list.style.top).toBe('114px');
  });
});
