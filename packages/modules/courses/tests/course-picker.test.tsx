// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
});
