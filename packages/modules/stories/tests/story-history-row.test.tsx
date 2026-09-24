// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryHistoryRow, type StoryHistoryRowProps } from '../ui/StoryHistoryRow';

/**
 * UI-D-40 — the "Seus stories" row, asserted as observable contract rather than as pixels.
 *
 * The four claims worth a test are the four a later edit could quietly break:
 *
 *  1. **The row exists FOR the counts and the pinned state** (that is why D-84 rejected a grid), so
 *     the meta line and the pin indicator are the two things that must always be reachable.
 *  2. **UI zero-one-many/E08: a story pinned NOWHERE renders NO pin indicator at all** — not a
 *     zero, not a hollow glyph. The count is the presence test.
 *  3. **UI partial/E08: a row may carry a pill, an indicator, BOTH or NEITHER, and the caption may
 *     be the absent-caption fallback** — and none of the four combinations may change the row's
 *     height, because the geometry is fixed by the thumbnail.
 *  4. **It ships NO words** (PWA-03): every visible string is a prop, sentinel ASCII here so a
 *     copy change cannot turn this file red.
 */

afterEach(cleanup);

const LADDER = [640, 1080] as const;

function props(overrides: Partial<StoryHistoryRowProps> = {}): StoryHistoryRowProps {
  return {
    thumbnailAssetId: '00000001-1111-4111-8111-111111111111',
    thumbnailVariantWidths: LADDER,
    thumbnailAlt: 'thumb-alt',
    caption: 'caption-text',
    meta: 'meta-line',
    actionLabel: 'open-row',
    onOpen: () => {},
    ...overrides,
  };
}

describe('StoryHistoryRow — UI-D-40, the row that exists for its counts and its pinned state', () => {
  it('1. the whole row is ONE control carrying the accessible name the host passed', async () => {
    const onOpen = vi.fn();
    render(<StoryHistoryRow {...props({ onOpen })} />);

    const row = screen.getByRole('button', { name: 'open-row' });
    row.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('2. the caption, the meta line and the thumbnail slot all render from props', () => {
    const { container } = render(<StoryHistoryRow {...props()} />);

    expect(screen.getByText('caption-text')).toBeInTheDocument();
    expect(screen.getByText('meta-line')).toBeInTheDocument();
    // The SLOT, not the `alt`: happy-dom reports every `<img>` as `complete` with a zero
    // `naturalWidth`, so `MediaImage` takes its degraded branch here and renders the neutral box
    // instead of an image. That branch IS the UI partial/E08 case — a cover that fails degrades
    // while the row stays fully operable — so asserting the slot's fixed geometry is the claim
    // that survives both outcomes. The real `srcSet` is exercised in the browser, in `e2e`.
    const thumb = container.querySelector('[data-story-history-thumb]');
    expect(thumb).not.toBeNull();
    expect(thumb?.className).toContain('h-16');
    expect(thumb?.className).toContain('w-12');
  });

  it('3. the meta line carries tabular numerals, so a column of dates and counts does not jitter', () => {
    render(<StoryHistoryRow {...props()} />);

    expect(screen.getByText('meta-line').className).toContain('tabular-nums');
  });

  it('4. with NO pill and NO pin count, neither element exists at all (zero-one-many E08)', () => {
    render(<StoryHistoryRow {...props()} />);

    expect(screen.queryByTestId('story-history-pin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('story-history-status')).not.toBeInTheDocument();
  });

  it('5. a pinned story renders the indicator with the PLURAL-AWARE label the host composed', () => {
    render(<StoryHistoryRow {...props({ pinned: { count: 2, label: 'pinned-in-2' } })} />);

    const indicator = screen.getByTestId('story-history-pin');
    expect(indicator).toHaveTextContent('pinned-in-2');
  });

  it('6. a count of ZERO renders no indicator — the count is the presence test, never a null check', () => {
    render(<StoryHistoryRow {...props({ pinned: { count: 0, label: 'pinned-in-0' } })} />);

    expect(screen.queryByTestId('story-history-pin')).not.toBeInTheDocument();
  });

  it('7. a pill and an indicator can BOTH render, and the row keeps its minimum height (partial E08)', () => {
    render(
      <StoryHistoryRow
        {...props({
          status: { tone: 'warning', label: 'status-label' },
          pinned: { count: 1, label: 'pinned-in-1' },
        })}
      />,
    );

    expect(screen.getByTestId('story-history-status')).toHaveTextContent('status-label');
    expect(screen.getByTestId('story-history-pin')).toHaveTextContent('pinned-in-1');
    expect(screen.getByRole('button', { name: 'open-row' }).className).toContain('min-h-14');
  });

  it('8. the absent-caption fallback is rendered MUTED, so it never reads as a real caption', () => {
    render(<StoryHistoryRow {...props({ caption: 'fallback', captionMuted: true })} />);

    const caption = screen.getByText('fallback');
    expect(caption.className).toContain('text-text-tertiary');
    // …and the same node truncates: a 90-character caption may not wrap the row to a second line.
    expect(caption.className).toContain('truncate');
  });

  it('9. an optional note renders as its own line (the processing note, Pitfall 5)', () => {
    render(<StoryHistoryRow {...props({ note: 'note-line' })} />);

    expect(screen.getByText('note-line')).toBeInTheDocument();
  });

  it('10. a thumbnail-less row still renders the row, the caption and the meta (media E08)', () => {
    render(<StoryHistoryRow {...props({ thumbnailAssetId: null })} />);

    expect(screen.getByRole('button', { name: 'open-row' })).toBeInTheDocument();
    expect(screen.getByText('caption-text')).toBeInTheDocument();
    expect(screen.getByText('meta-line')).toBeInTheDocument();
  });

  it('11. it ships NO words of its own: every visible string came in as a prop (PWA-03)', () => {
    const { container } = render(
      <StoryHistoryRow
        {...props({
          status: { tone: 'danger', label: 'status-label' },
          pinned: { count: 3, label: 'pinned-in-3' },
          note: 'note-line',
        })}
      />,
    );

    const text = container.textContent ?? '';
    for (const passed of [
      'caption-text',
      'meta-line',
      'status-label',
      'pinned-in-3',
      'note-line',
    ]) {
      expect(text).toContain(passed);
    }
    // Nothing else: the concatenation of the props IS the row's whole text.
    const remainder = ['caption-text', 'meta-line', 'note-line', 'status-label', 'pinned-in-3']
      .reduce((acc, passed) => acc.replace(passed, ''), text)
      .trim();
    expect(remainder).toBe('');
  });
});
