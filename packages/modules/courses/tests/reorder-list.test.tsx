// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReorderList, type ReorderListLabels } from '../ui';

/**
 * UI-D-395 / UI-D-397 — the three protected rules of the arrows-only list (the
 * `CommunitiesList.test.tsx` cases 8-10 template), plus the two deltas of the whole-order host: the
 * refocus WAITS while the host disables the list, and a host-drawn row keeps the same buttons. The
 * list ships NO words (PWA-03): every name is a function prop, sentinel ASCII here.
 */

afterEach(cleanup);

const LABELS: ReorderListLabels = {
  moveUp: (name) => `up:${name}`,
  moveDown: (name) => `down:${name}`,
  moved: (name, position, total) => `moved:${name}:${position}:${total}`,
};

const ITEMS = [
  { id: 'a', name: 'alpha' },
  { id: 'b', name: 'beta' },
  { id: 'c', name: 'gamma' },
];

const up = (name: string) => screen.getByRole('button', { name: `up:${name}` });
const down = (name: string) => screen.getByRole('button', { name: `down:${name}` });
const rowNames = () =>
  Array.from(document.querySelectorAll('[data-reorder-row]')).map(
    (row) => row.getAttribute('data-reorder-row') ?? '',
  );

/** A host that applies the permutation it receives, as the curriculum editor's draft does. */
function Host({
  initial = ITEMS,
  disabled = false,
  onChange,
}: {
  initial?: typeof ITEMS;
  disabled?: boolean;
  onChange?: (ids: string[]) => void;
}) {
  const [items, setItems] = useState(initial);
  return (
    <>
      <h2 id="heading">heading-sentinel</h2>
      <ReorderList
        items={items}
        labelledBy="heading"
        labels={LABELS}
        disabled={disabled}
        onChange={(ids) => {
          onChange?.(ids);
          const byId = new Map(items.map((item) => [item.id, item]));
          setItems(ids.map((id) => byId.get(id)).filter((item) => item !== undefined));
        }}
      />
    </>
  );
}

describe('ReorderList (UI-D-395, UI-D-397)', () => {
  it('1. is an <ol> named by the host heading whose rows carry two buttons each, named after the item, and nothing draggable', () => {
    render(<Host />);
    const list = screen.getByRole('list', { name: 'heading-sentinel' });
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(up('alpha')).toBeInTheDocument();
    expect(down('gamma')).toBeInTheDocument();
    expect(document.querySelector('[draggable]')).toBeNull();
    // Rule 1: 44px targets, the IconButton geometry.
    expect(up('beta').className).toContain('min-h-[44px]');
  });

  it('2. a move calls onChange with the WHOLE permutation and the rows follow it', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    fireEvent.click(down('alpha'));
    expect(onChange).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(rowNames()).toEqual(['b', 'a', 'c']);
    fireEvent.click(up('gamma'));
    expect(onChange).toHaveBeenLastCalledWith(['b', 'c', 'a']);
    expect(rowNames()).toEqual(['b', 'c', 'a']);
  });

  it('3. rule 3: the first row cannot go up, the last cannot go down; one row disables both', () => {
    render(<Host />);
    expect(up('alpha')).toBeDisabled();
    expect(down('alpha')).toBeEnabled();
    expect(down('gamma')).toBeDisabled();
    expect(up('gamma')).toBeEnabled();
    expect(up('beta')).toBeEnabled();
    expect(down('beta')).toBeEnabled();
    cleanup();

    render(<Host initial={[ITEMS[0] as (typeof ITEMS)[number]]} />);
    expect(up('alpha')).toBeDisabled();
    expect(down('alpha')).toBeDisabled();
  });

  it('4. rule 2: focus FOLLOWS the moved row, on the same button; at an end it switches to the other button', async () => {
    render(<Host />);
    down('alpha').focus();
    fireEvent.click(down('alpha'));
    // alpha is now in the middle: the same (down) button, wherever it now sits.
    await waitFor(() => expect(document.activeElement).toBe(down('alpha')));
    expect(rowNames()).toEqual(['b', 'a', 'c']);

    fireEvent.click(down('alpha'));
    // alpha reached the end: its down button is disabled, so focus goes to its up button.
    await waitFor(() => expect(document.activeElement).toBe(up('alpha')));
    expect(down('alpha')).toBeDisabled();
    expect(rowNames()).toEqual(['b', 'c', 'a']);
  });

  it('5. the polite live region announces the new position after a move, and only then', () => {
    render(<Host />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    fireEvent.click(down('beta'));
    expect(region.textContent).toBe('moved:beta:3:3');
  });

  it('6. rule 3: `disabled` makes every button inert and marks the list busy', () => {
    const onChange = vi.fn();
    render(<Host disabled onChange={onChange} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('list').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(down('alpha'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('7. whole-order host: while the host disables the list after a move the refocus WAITS, and lands on the moved row once it is enabled again', async () => {
    function SavingHost() {
      const [items, setItems] = useState(ITEMS);
      const [saving, setSaving] = useState(false);
      return (
        <>
          <ReorderList
            items={items}
            label="list-sentinel"
            labels={LABELS}
            disabled={saving}
            onChange={(ids) => {
              const byId = new Map(items.map((item) => [item.id, item]));
              setItems(ids.map((id) => byId.get(id)).filter((item) => item !== undefined));
              setSaving(true);
            }}
          />
          <button type="button" onClick={() => setSaving(false)}>
            answer
          </button>
        </>
      );
    }
    render(<SavingHost />);
    expect(screen.getByRole('list', { name: 'list-sentinel' })).toBeInTheDocument();
    down('alpha').focus();
    fireEvent.click(down('alpha'));
    // Every arrow is disabled while the write runs; a disabled button cannot hold focus.
    expect(down('alpha')).toBeDisabled();
    expect(document.activeElement).not.toBe(down('alpha'));

    fireEvent.click(screen.getByRole('button', { name: 'answer' }));
    await waitFor(() => expect(document.activeElement).toBe(down('alpha')));
    expect(rowNames()).toEqual(['b', 'a', 'c']);
  });

  it('8. renderItem draws the host row around the SAME two buttons; the default row shows thumb, meta, pill and trailing slots', () => {
    render(
      <ReorderList
        items={ITEMS}
        label="list-sentinel"
        labels={LABELS}
        onChange={() => {}}
        className="divide-y"
        renderItem={(item, arrows) => (
          <div data-testid={`host-row-${item.id}`}>
            <a href={`/x/${item.id}`}>{item.name}</a>
            {arrows}
          </div>
        )}
      />,
    );
    expect(screen.getByRole('list').className).toBe('divide-y');
    expect(screen.getByTestId('host-row-b').querySelectorAll('button')).toHaveLength(2);
    expect(up('alpha')).toBeDisabled();
    expect(down('gamma')).toBeDisabled();
    expect(document.querySelector('[data-reorder-row="b"]')?.className).toBe('');
    cleanup();

    render(
      <ReorderList
        items={[
          {
            id: 'a',
            name: 'alpha',
            thumb: <img data-testid="host-thumb" alt="" src="data:," />,
            meta: 'meta-sentinel',
            pill: <span data-testid="host-pill">pill</span>,
            trailing: <span data-testid="host-trailing">x</span>,
          },
          { id: 'b', name: 'beta' },
        ]}
        label="list-sentinel"
        labels={LABELS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('host-thumb')).toBeInTheDocument();
    expect(screen.getByTestId('host-pill')).toBeInTheDocument();
    expect(screen.getByTestId('host-trailing')).toBeInTheDocument();
    expect(document.querySelector('[data-reorder-meta]')?.textContent).toBe('meta-sentinel');
    expect(document.querySelectorAll('[data-reorder-thumb]')).toHaveLength(1);
    expect(document.querySelector('[data-reorder-row="a"]')?.className).toContain('pl-2');
  });
});
