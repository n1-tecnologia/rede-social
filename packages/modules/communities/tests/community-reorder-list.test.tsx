// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CommunityReorderItem, CommunityReorderList } from '../ui/CommunityReorderList';

/**
 * 2026-10-03 — the Comunidades reorder mode's row list, as observable contract: which rows exist, what
 * every control is NAMED in the a11y tree, which controls are out of reach at the ends, what one move
 * hands the host, WHERE FOCUS LANDS after it, and what the live region says. The list ships NO words:
 * every string is a prop, sentinel ASCII here (the `community-picker-sheet.test.tsx` convention).
 *
 * The host is a tiny stateful harness, because the list is CONTROLLED: the host owns the draft and
 * hands the new order back in, exactly as `CommunitiesList` does — so "focus follows the moved row"
 * is asserted across a real re-render, not against a list that never moved.
 */

// Nothing here animates, but `@rede-social/ui` primitives may; a cancelled spring rejects after the
// run ends under happy-dom (the 05.1-04 lesson).
MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const ITEMS: CommunityReorderItem[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'first',
    coverAssetId: 'a1111111-1111-4111-8111-111111111111',
    coverVariantWidths: [320, 640],
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'second',
    coverAssetId: null,
    coverVariantWidths: [],
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'third',
    coverAssetId: null,
    coverVariantWidths: [],
  },
];

const LABELS = {
  moveUp: (name: string) => `up-${name}`,
  moveDown: (name: string) => `down-${name}`,
  moved: (name: string, position: number, total: number) => `moved-${name}-${position}-${total}`,
};

function Harness({
  onChange,
  disabled = false,
  items = ITEMS,
}: {
  onChange?: (ids: string[]) => void;
  disabled?: boolean;
  items?: CommunityReorderItem[];
}) {
  const [order, setOrder] = useState(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <>
      <h2 id="reorder-heading">heading-text</h2>
      <p id="reorder-helper">helper-text</p>
      <CommunityReorderList
        items={order}
        onChange={(ids) => {
          onChange?.(ids);
          setOrder(ids.map((id) => byId.get(id)).filter((item) => item !== undefined));
        }}
        disabled={disabled}
        labelledBy="reorder-heading"
        describedBy="reorder-helper"
        labels={LABELS}
      />
    </>
  );
}

const names = () =>
  within(screen.getByRole('list', { name: 'heading-text' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent);

/** A keyboard user's press: focus first (a click alone does not move focus under happy-dom). */
function press(name: string) {
  const button = screen.getByRole('button', { name });
  button.focus();
  act(() => {
    fireEvent.click(button);
  });
}

describe('CommunityReorderList — named rows, ends disabled, focus following the move', () => {
  it('1. an ordered list named and described by the host, one row per community, in order', () => {
    render(<Harness />);

    const list = screen.getByRole('list', { name: 'heading-text' });
    expect(list.tagName).toBe('OL');
    expect(list).toHaveAccessibleDescription('helper-text');
    expect(names()).toEqual(['first', 'second', 'third']);
    // Every button is named after ITS community, so a screen reader hears which row it moves.
    for (const item of ITEMS) {
      expect(screen.getByRole('button', { name: `up-${item.name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `down-${item.name}` })).toBeInTheDocument();
    }
  });

  it('2. the first row cannot go up and the last cannot go down — every other move is reachable', () => {
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'up-first' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'down-first' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'up-second' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'down-second' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'up-third' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'down-third' })).toBeDisabled();
  });

  it('3. one move hands the host the FULL permutation, and the rows re-render in it', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    press('up-third');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([ITEMS[0]?.id, ITEMS[2]?.id, ITEMS[1]?.id]);
    expect(names()).toEqual(['first', 'third', 'second']);
  });

  it('4. focus FOLLOWS the moved row: the same button of the same community, in its new place', () => {
    render(<Harness />);

    press('down-first');

    expect(names()).toEqual(['second', 'first', 'third']);
    expect(screen.getByRole('button', { name: 'down-first' })).toHaveFocus();
  });

  it('5. reaching an end hands focus to the row’s OTHER button, never to the page', () => {
    render(<Harness />);

    // Up to the top: "up" is now disabled, so focus moves to that row's "down".
    press('up-second');
    expect(names()).toEqual(['second', 'first', 'third']);
    expect(screen.getByRole('button', { name: 'up-second' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'down-second' })).toHaveFocus();

    // Down to the bottom: "down" is now disabled, so focus moves to that row's "up".
    press('down-first');
    expect(names()).toEqual(['second', 'third', 'first']);
    expect(screen.getByRole('button', { name: 'down-first' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'up-first' })).toHaveFocus();
  });

  it('6. one polite live region announces the new position after each move', () => {
    render(<Harness />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('');

    press('down-first');
    expect(status).toHaveTextContent('moved-first-2-3');
    press('down-first');
    expect(status).toHaveTextContent('moved-first-3-3');
  });

  it('7. while the host saves, every move is out of reach and nothing moves', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} disabled />);

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'down-first' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(names()).toEqual(['first', 'second', 'third']);
  });

  it('8. a cover renders the image thumb; a cover-less community renders the gradient block', () => {
    render(<Harness />);

    const rows = within(screen.getByRole('list', { name: 'heading-text' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]?.querySelector('[data-reorder-cover]')).not.toBeNull();
    expect(rows[0]?.querySelector('[data-reorder-cover-fallback]')).toBeNull();
    expect(rows[1]?.querySelector('[data-reorder-cover-fallback]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-reorder-cover]')).toBeNull();
  });

  it('9. a single community: both of its buttons are disabled — there is nowhere to go', () => {
    render(<Harness items={[ITEMS[0] as CommunityReorderItem]} />);

    expect(screen.getByRole('button', { name: 'up-first' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'down-first' })).toBeDisabled();
  });
});
