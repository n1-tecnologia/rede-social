// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventHero } from '../ui/EventHero';
import { EventInfoGrid } from '../ui/EventInfoGrid';
import { EventPhotoGrid } from '../ui/EventPhotoGrid';
import { EventPhotoViewer, SWIPE_THRESHOLD_PX } from '../ui/EventPhotoViewer';

/**
 * 2026-10-03 — the module's new pieces as observable contract: the photo grid, the photo viewer,
 * the hero's category pill and the info grid's "Vagas" icon. Every string is a sentinel prop
 * (PWA-03): the module ships no words.
 */

afterEach(cleanup);

const ASSET = (n: number) => `a${n}111111-1111-4111-8111-111111111111`;
const tiles = (count: number, removable = false) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    assetId: ASSET(index + 1),
    variantWidths: [320, 640, 1080, 1600],
    openLabel: `open-${index + 1}`,
    ...(removable ? { removeLabel: `remove-${index + 1}` } : {}),
  }));

describe('EventPhotoGrid', () => {
  it('1. three columns of square tiles, ONE named button each, the image decorative inside it', () => {
    const onOpen = vi.fn();
    render(<EventPhotoGrid photos={tiles(4)} onOpen={onOpen} />);
    const grid = screen.getByTestId('event-photo-grid');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('gap-0.5');
    expect(screen.getAllByTestId('event-photo')).toHaveLength(4);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'open-1',
      'open-2',
      'open-3',
      'open-4',
    ]);
    // The tile's name is the button's own; the image inside is decorative. happy-dom never decodes
    // an image, so `MediaImage` shows its plain box here: the button carries no text of its own.
    expect(buttons[0]?.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'open-3' }));
    expect(onOpen).toHaveBeenCalledWith(2);
    // A member's grid: no remove button at all.
    expect(screen.queryAllByTestId('event-photo-remove')).toHaveLength(0);
  });

  it('2. a manager’s tile carries a SIBLING remove button (never nested), and a busy one is disabled', () => {
    const onRemove = vi.fn();
    render(
      <EventPhotoGrid
        photos={tiles(2, true)}
        onOpen={vi.fn()}
        onRemove={onRemove}
        busyIds={new Set(['p1'])}
      />,
    );
    const removes = screen.getAllByTestId('event-photo-remove');
    expect(removes).toHaveLength(2);
    for (const remove of removes)
      expect(remove.closest('button')?.parentElement?.tagName).toBe('LI');
    expect(removes[0]?.querySelector('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'remove-1' }));
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(screen.getByRole('button', { name: 'remove-2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'remove-1' })).not.toBeDisabled();
  });
});

describe('EventPhotoViewer', () => {
  const photos = Array.from({ length: 3 }, (_, index) => ({
    id: `p${index}`,
    assetId: ASSET(index + 1),
    variantWidths: [320, 640, 1080, 1600],
    alt: `alt-${index + 1}`,
  }));
  const labels = (index: number) => ({
    dialog: 'dialog-sentinel',
    close: 'close-sentinel',
    previous: 'previous-sentinel',
    next: 'next-sentinel',
    counter: `${index + 1} / 3`,
  });
  function viewer(index: number, extra: Record<string, unknown> = {}) {
    const props = {
      photos,
      index,
      labels: labels(index),
      onIndexChange: vi.fn(),
      onClose: vi.fn(),
      ...extra,
    };
    render(<EventPhotoViewer {...props} />);
    return props;
  }

  it('3. a named modal dialog over the shell, the photo uncropped, the counter announced politely', () => {
    viewer(1);
    const dialog = screen.getByRole('dialog', { name: 'dialog-sentinel' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-shell-hide', 'chrome');
    expect(dialog.className).toContain('fixed');
    // The stage holds ONE photo box (happy-dom never decodes it, so its plain box renders here).
    expect(screen.getByTestId('event-photo-stage').children).toHaveLength(1);
    const counter = screen.getByTestId('event-photo-counter');
    expect(counter).toHaveTextContent('2 / 3');
    expect(counter).toHaveAttribute('aria-live', 'polite');
  });

  it('4. the buttons and the arrow keys move by one; the ends are hard stops', () => {
    const middle = viewer(1);
    fireEvent.click(screen.getByRole('button', { name: 'next-sentinel' }));
    expect(middle.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'previous-sentinel' }));
    expect(middle.onIndexChange).toHaveBeenLastCalledWith(0);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(middle.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(middle.onIndexChange).toHaveBeenLastCalledWith(0);
    cleanup();

    const first = viewer(0);
    expect(screen.getByRole('button', { name: 'previous-sentinel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(first.onIndexChange).not.toHaveBeenCalled();
    cleanup();

    const last = viewer(2);
    expect(screen.getByRole('button', { name: 'next-sentinel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(last.onIndexChange).not.toHaveBeenCalled();
  });

  it('5. at the last loaded photo, while the host has more, "next" asks for them instead', () => {
    const onEndReached = vi.fn();
    const props = viewer(2, { hasMore: true, onEndReached });
    const next = screen.getByRole('button', { name: 'next-sentinel' });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(onEndReached).toHaveBeenCalledTimes(1);
    expect(props.onIndexChange).not.toHaveBeenCalled();
  });

  it('6. Escape and the close button close it', () => {
    const props = viewer(0);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'close-sentinel' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('7. a horizontal swipe past the threshold turns the page; a short or vertical one does not', () => {
    const props = viewer(1);
    const stage = screen.getByTestId('event-photo-stage');
    const swipe = (dx: number, dy = 0) => {
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 300 });
      fireEvent.pointerUp(stage, { clientX: 200 + dx, clientY: 300 + dy });
    };
    swipe(-(SWIPE_THRESHOLD_PX + 10));
    expect(props.onIndexChange).toHaveBeenLastCalledWith(2);
    swipe(SWIPE_THRESHOLD_PX + 10);
    expect(props.onIndexChange).toHaveBeenLastCalledWith(0);
    props.onIndexChange.mockClear();
    swipe(-(SWIPE_THRESHOLD_PX - 10));
    swipe(-(SWIPE_THRESHOLD_PX + 10), SWIPE_THRESHOLD_PX + 40);
    expect(props.onIndexChange).not.toHaveBeenCalled();
  });
});

describe('EventPhotoViewer — inline over a host gesture', () => {
  it('7b. takes no browser panning, and its touches never reach an ancestor (a pull-to-refresh)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const heard = vi.fn();
    host.addEventListener('touchstart', heard);
    host.addEventListener('touchmove', heard);
    render(
      <EventPhotoViewer
        photos={[{ id: 'p0', assetId: ASSET(1), variantWidths: [320], alt: 'alt' }]}
        index={0}
        labels={{ dialog: 'd', close: 'c', previous: 'p', next: 'n', counter: '1 / 1' }}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
      { container: host },
    );
    expect(screen.getByRole('dialog').style.touchAction).toBe('none');
    fireEvent.touchStart(screen.getByTestId('event-photo-stage'));
    fireEvent.touchMove(screen.getByTestId('event-photo-stage'));
    expect(heard).not.toHaveBeenCalled();
    // Positive control: the same touch on the host itself is heard.
    fireEvent.touchStart(host);
    expect(heard).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe('EventHero — the category pill (2026-10-03)', () => {
  const base = {
    title: 'title-sentinel',
    overline: 'overline-sentinel',
    place: 'place-sentinel',
    placeKind: 'venue' as const,
    coverVariantWidths: [640, 1080],
    coverAlt: 'cover-alt',
  };

  it('8. the category rides the top-left on both branches, in the button colour (the REINE category pill), truncating', () => {
    render(<EventHero {...base} coverAssetId={ASSET(1)} category="category-sentinel" />);
    const pill = screen.getByTestId('event-hero-category');
    expect(pill).toHaveTextContent('category-sentinel');
    expect(pill.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['bg-button', 'text-on-button', 'uppercase', 'truncate']),
    );
    cleanup();

    render(<EventHero {...base} coverAssetId={null} category="category-sentinel" />);
    expect(screen.getByTestId('event-cover-fallback')).toContainElement(
      screen.getByTestId('event-hero-category'),
    );
    cleanup();

    for (const none of [null, undefined, '']) {
      render(<EventHero {...base} coverAssetId={null} category={none} />);
      expect(screen.queryByTestId('event-hero-category')).toBeNull();
      cleanup();
    }
  });
});

describe('EventInfoGrid — the "Vagas" cell (2026-10-03)', () => {
  it('9. a fifth cell with its own icon; the count cell stays the only live region', () => {
    render(
      <EventInfoGrid
        layout="grid"
        ariaLiveIndex={3}
        cells={[
          { icon: 'date', label: 'l-date', value: 'v-date' },
          { icon: 'time', label: 'l-time', value: 'v-time' },
          { icon: 'place', label: 'l-place', value: 'v-place' },
          { icon: 'people', label: 'l-count', value: 'v-count' },
          { icon: 'spots', label: 'l-spots', value: 'v-spots' },
        ]}
      />,
    );
    const cells = screen.getAllByTestId('event-info-cell');
    expect(cells).toHaveLength(5);
    expect(cells[4]).toHaveTextContent('l-spots');
    expect(cells[4]?.querySelector('svg')).not.toBeNull();
    expect(
      screen.getAllByTestId('event-info-value').map((value) => value.getAttribute('aria-live')),
    ).toEqual([null, null, null, 'polite', null]);
  });
});
