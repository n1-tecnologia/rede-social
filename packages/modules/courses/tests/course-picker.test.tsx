// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Radio } from 'lucide-react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoursePickerSheet } from '../ui';

/**
 * UI-D-402 — the track form's course checklist as an observable contract: every row a toggle with the
 * host's on/off name, the ONE check glyph per included row, "Concluir" handed back, the empty copy and
 * the four loading skeletons. The sheet ships NO words (PWA-03): every string is a prop, sentinel
 * ASCII here so a copy change cannot turn this file red.
 */

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const ITEMS = [
  { id: 'c1', title: 'first-course', thumb: <img data-testid="host-thumb" alt="" src="data:," /> },
  { id: 'c2', title: 'second-course-with-a-deliberately-long-title' },
  { id: 'c3', title: 'third-course' },
] as const;

const LABELS = {
  rowOn: (title: string) => `${title}, on`,
  rowOff: (title: string) => `${title}, off`,
  done: 'done-label',
};

function renderSheet(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    helper: 'sheet-helper',
    items: ITEMS,
    selectedIds: [],
    onToggle: () => {},
    onDone: () => {},
    labels: LABELS,
    empty: { title: 'empty-title', body: 'empty-body' },
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CoursePickerSheet {...(props as any)} />);
}

describe('CoursePickerSheet (UI-D-402)', () => {
  it('1. is a titled dialog whose rows are pressed toggles named by the host, on or off', () => {
    renderSheet({ selectedIds: ['c2'] });
    expect(screen.getByRole('dialog', { name: 'sheet-title' })).toBeInTheDocument();
    expect(screen.getByText('sheet-helper')).toBeInTheDocument();
    const rows = screen.getAllByTestId('course-picker-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'first-course, off' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const on = screen.getByRole('button', {
      name: 'second-course-with-a-deliberately-long-title, on',
    });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    // ONE check glyph, on the included row only (the sheet's only brand ink beside the footer).
    expect(screen.getAllByTestId('course-picker-check')).toHaveLength(1);
    expect(within(on).getByTestId('course-picker-check')).toBeInTheDocument();
  });

  it('2. a tap on a row hands back its id — including and taking out are the same gesture', () => {
    const onToggle = vi.fn();
    renderSheet({ onToggle, selectedIds: ['c1'] });
    fireEvent.click(screen.getByRole('button', { name: 'first-course, on' }));
    expect(onToggle).toHaveBeenLastCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: 'third-course, off' }));
    expect(onToggle).toHaveBeenLastCalledWith('c3');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('3. "Concluir" is the host\'s label and fires onDone, never onClose', () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderSheet({ onDone, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'done-label' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('4. the host thumb fills the 3:4 slot; a row without one takes the brand gradient; a long title truncates', () => {
    renderSheet();
    const thumb = screen.getByTestId('course-picker-thumb');
    expect(thumb.className).toContain('aspect-[3/4]');
    expect(thumb.className).toContain('w-8');
    expect(within(thumb).getByTestId('host-thumb')).toBeInTheDocument();
    expect(screen.getAllByTestId('course-picker-fallback')).toHaveLength(2);
    expect(screen.getAllByTestId('course-picker-fallback')[0]?.getAttribute('style')).toContain(
      'var(--brand-gradient)',
    );
    const row = screen.getByRole('button', {
      name: 'second-course-with-a-deliberately-long-title, off',
    });
    expect(within(row).getByText(ITEMS[1].title).className).toContain('truncate');
  });

  it("5. zero items draws the host's empty copy with no row and no action; the footer stays", () => {
    renderSheet({ items: [] });
    expect(screen.queryAllByTestId('course-picker-row')).toHaveLength(0);
    const empty = screen.getByTestId('course-picker-empty');
    expect(within(empty).getByText('empty-title')).toBeInTheDocument();
    expect(within(empty).getByText('empty-body')).toBeInTheDocument();
    expect(within(empty).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'done-label' })).toBeInTheDocument();
  });

  it('6. while loading, four wordless row skeletons stand in for the rows', () => {
    renderSheet({ loading: true });
    expect(screen.queryAllByTestId('course-picker-row')).toHaveLength(0);
    expect(screen.queryByTestId('course-picker-empty')).toBeNull();
    const loading = screen.getByTestId('course-picker-loading');
    expect(loading).toHaveAttribute('aria-busy');
    expect(within(loading).getAllByTestId('row-skeleton')).toHaveLength(4);
  });
  it('7. (08.4, UI-D-415) a row with a meta shows it under the title, truncating; a row without one is the 08.3 row', () => {
    renderSheet({
      items: [
        { id: 'c1', title: 'draft-course', meta: 'meta-label' },
        { id: 'c2', title: 'published-course' },
      ],
    });
    const withMeta = screen.getByRole('button', { name: 'draft-course, off' });
    const meta = within(withMeta).getByTestId('course-picker-meta');
    expect(meta.textContent).toBe('meta-label');
    expect(meta.className).toContain('truncate');
    expect(meta.className).toContain('text-xs');
    expect(within(withMeta).getByText('draft-course').className).toContain('truncate');
    // The title and the meta stack in the row's one flexible column.
    expect(meta.parentElement?.className).toContain('min-w-0 flex-1 flex-col');

    const plain = screen.getByRole('button', { name: 'published-course, off' });
    expect(within(plain).queryByTestId('course-picker-meta')).toBeNull();
    expect(within(plain).getByText('published-course').className).toContain(
      'min-w-0 flex-1 truncate',
    );
  });
  it('8. (08.4) the defaults stay the 08.3 sheet: 3:4 slot, poster skeletons, the GraduationCap empty glyph', () => {
    renderSheet();
    expect(screen.getByTestId('course-picker-thumb').className).toContain('w-8 ');
    cleanup();
    renderSheet({ items: [] });
    const empty = screen.getByTestId('course-picker-empty');
    expect(empty.querySelector('svg.lucide-graduation-cap')).not.toBeNull();
    cleanup();
    renderSheet({ loading: true });
    for (const skeleton of screen.getAllByTestId('row-skeleton')) {
      expect(skeleton.innerHTML).toContain('aspect-[3/4]');
    }
  });

  it('9. (08.4, UI-D-415) thumbShape wide draws the 16:10 w-12 slot and the wide skeletons', () => {
    renderSheet({ thumbShape: 'wide' });
    const thumb = screen.getByTestId('course-picker-thumb');
    expect(thumb.className).toContain('w-12');
    expect(thumb.className).toContain('aspect-[16/10]');
    expect(thumb.className).not.toContain('aspect-[3/4]');
    for (const fallback of screen.getAllByTestId('course-picker-fallback')) {
      expect(fallback.className).toContain('w-12');
    }
    cleanup();
    renderSheet({ thumbShape: 'wide', loading: true });
    const skeletons = screen.getAllByTestId('row-skeleton');
    expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) expect(skeleton.innerHTML).toContain('aspect-[16/10]');
  });

  it('10. (08.4, UI-D-420) emptyIcon replaces the glyph of the empty state', () => {
    renderSheet({ items: [], emptyIcon: Radio });
    const empty = screen.getByTestId('course-picker-empty');
    expect(empty.querySelector('svg.lucide-radio')).not.toBeNull();
    expect(empty.querySelector('svg.lucide-graduation-cap')).toBeNull();
  });

  it('11. (E04/long-text backstop) a 120-character live title and its meta both truncate; the 48px slot and the 20px check keep their size', () => {
    const title = 'L'.repeat(120);
    renderSheet({
      thumbShape: 'wide',
      items: [{ id: 'l1', title, meta: 'qui, 16 de out, 19:00 · Ao vivo' }],
      selectedIds: ['l1'],
    });
    const row = screen.getByRole('button', { name: `${title}, on` });
    expect(within(row).getByText(title).className).toContain('truncate');
    expect(within(row).getByTestId('course-picker-meta').className).toContain('truncate');
    const slot = within(row).getByTestId('course-picker-fallback');
    expect(slot.className).toContain('w-12');
    expect(slot.className).toContain('shrink-0');
    const check = within(row).getByTestId('course-picker-check');
    expect(check.getAttribute('width')).toBe('20');
    expect(check.getAttribute('height')).toBe('20');
    expect(check.parentElement?.className).toContain('shrink-0');
  });
});
