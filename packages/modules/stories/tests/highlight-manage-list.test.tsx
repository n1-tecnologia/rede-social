// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type HighlightManageItem,
  HighlightManageList,
  type HighlightManageListProps,
} from '../ui/HighlightManageList';

/**
 * 05.2-09 — the manage screen's reorder list (UI-D-72, UI-D-73, D-109).
 *
 * The list is where an admin changes the ORDER of a place's highlights, and its contract is mostly
 * about doing that without a pointer (WCAG 2.5.7):
 *
 *  - **L1** rows render in the host's order, each with a 44×44 handle named "Mover {title}" and a
 *    body button named "Editar destaque {title}"; with ONE row the drag helper line is absent.
 *  - **L2** the keyboard path: ArrowUp on a focused handle moves that row up one place, sends the
 *    FULL permutation once, keeps focus on the same handle and announces the new position in the one
 *    polite live region; ArrowUp on the first row does nothing.
 *  - **L3** a save that answers `false` puts the rows back in the last confirmed order.
 *  - **L4** an archived place (UI-D-80) renders no handle at all.
 *
 * Pointer drag is `motion/react`'s `Reorder` and is covered by the phone UAT backstop — happy-dom has
 * no layout, so a simulated drag here would test nothing real.
 *
 * Every string is a fixture word: the module ships none (PWA-03).
 */

// Springs have nothing to animate under happy-dom, and a cancelled one rejects AFTER the run ends.
MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const A: HighlightManageItem = { id: 'a', title: 'title-a', meta: 'meta-a', cover: null };
const B: HighlightManageItem = {
  id: 'b',
  title: 'title-b',
  meta: 'meta-b',
  cover: { assetId: '00000002-1111-4111-8111-111111111111', variantWidths: [640] },
};
const C: HighlightManageItem = { id: 'c', title: 'title-c', meta: 'meta-c', cover: null };

function props(overrides: Partial<HighlightManageListProps> = {}): HighlightManageListProps {
  return {
    items: [A, B, C],
    onReorder: async () => true,
    onOpen: () => {},
    labels: {
      region: 'list-region',
      helper: 'list-helper',
      dragHint: 'drag-hint',
      drag: (title) => `drag:${title}`,
      edit: (title) => `edit:${title}`,
      moved: (title, position, total) => `moved:${title}:${position}:${total}`,
    },
    ...overrides,
  };
}

/** The order the rows are drawn in, read from the body buttons' names. */
function drawnOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /^edit:/ })
    .map((node) => String(node.getAttribute('aria-label')).replace('edit:', ''));
}

describe('HighlightManageList — handle-only reorder with a keyboard equivalent (UI-D-73)', () => {
  it('L1. rows follow the host order with a named handle and a named body button; one row has no helper', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<HighlightManageList {...props({ onOpen })} />);

    expect(screen.getByRole('list', { name: 'list-region' })).toBeInTheDocument();
    expect(drawnOrder()).toEqual(['title-a', 'title-b', 'title-c']);
    const handles = screen.getAllByRole('button', { name: /^drag:/ });
    expect(handles.map((node) => node.getAttribute('aria-label'))).toEqual([
      'drag:title-a',
      'drag:title-b',
      'drag:title-c',
    ]);
    // The handle is described by the keyboard hint, and it never scrolls the page on touch.
    const hintId = handles[0]?.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(String(hintId))).toHaveTextContent('drag-hint');
    expect(handles[0]).toHaveStyle({ touchAction: 'none' });
    expect(screen.getByText('meta-b')).toBeInTheDocument();
    expect(screen.getByText('list-helper')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'edit:title-b' }));
    expect(onOpen).toHaveBeenCalledWith('b');

    rerender(<HighlightManageList {...props({ onOpen, items: [A] })} />);
    expect(drawnOrder()).toEqual(['title-a']);
    expect(screen.queryByText('list-helper')).toBeNull();
    expect(screen.getByRole('button', { name: 'drag:title-a' })).toBeInTheDocument();
  });

  it('L2. ArrowUp on the second handle sends the swapped permutation, keeps focus and announces the position', async () => {
    const onReorder = vi.fn(async (_ids: string[]) => true);
    render(<HighlightManageList {...props({ items: [A, B], onReorder })} />);

    const handle = screen.getByRole('button', { name: 'drag:title-b' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });

    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
    await waitFor(() => expect(drawnOrder()).toEqual(['title-b', 'title-a']));
    expect(screen.getByRole('button', { name: 'drag:title-b' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('moved:title-b:1:2');

    // The first row cannot go further up: nothing is sent and nothing moves.
    const first = screen.getByRole('button', { name: 'drag:title-b' });
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(drawnOrder()).toEqual(['title-b', 'title-a']);
  });

  it('L3. a save answering false restores the previous order', async () => {
    const onReorder = vi.fn(async (_ids: string[]) => false);
    render(<HighlightManageList {...props({ onReorder })} />);

    const handle = screen.getByRole('button', { name: 'drag:title-a' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']));
    await waitFor(() => expect(drawnOrder()).toEqual(['title-a', 'title-b', 'title-c']));
  });

  it('L4. an archived place renders no handle, and its rows still open', () => {
    const onOpen = vi.fn();
    render(<HighlightManageList {...props({ archived: true, onOpen })} />);

    expect(screen.queryAllByRole('button', { name: /^drag:/ })).toHaveLength(0);
    expect(screen.queryByText('list-helper')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'edit:title-c' }));
    expect(onOpen).toHaveBeenCalledWith('c');
  });
});
