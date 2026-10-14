// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryPickerSheet } from '../ui';

/**
 * UI-D-393 — the single-select category sheet as an observable contract: the none row first, the
 * selected row checked, the host handed back `null` or the id. The sheet ships NO words (PWA-03):
 * every string is a prop, sentinel ASCII here so a copy change cannot turn this file red.
 */

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const ITEMS = [
  { id: 'c1', name: 'first-category', thumb: <img data-testid="host-thumb" alt="" src="data:," /> },
  { id: 'c2', name: 'second-category-with-a-deliberately-long-name' },
] as const;

function renderSheet(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    helper: 'sheet-helper',
    items: ITEMS,
    selectedId: null,
    noneLabel: 'none-label',
    onSelect: () => {},
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CategoryPickerSheet {...(props as any)} />);
}

describe('CategoryPickerSheet (UI-D-393)', () => {
  it('1. is a titled dialog over a radiogroup whose FIRST option is the none row', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'sheet-title' })).toBeInTheDocument();
    expect(screen.getByText('sheet-helper')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'sheet-title' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveTextContent('none-label');
    expect(radios[1]).toHaveTextContent('first-category');
    expect(radios[2]).toHaveTextContent('second-category-with-a-deliberately-long-name');
  });

  it('2. marks the selected row with aria-checked and the ONE check glyph; the none row when null', () => {
    renderSheet({ selectedId: 'c2' });
    expect(screen.getByRole('radio', { name: 'none-label' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'first-category' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const selected = screen.getByRole('radio', {
      name: 'second-category-with-a-deliberately-long-name',
    });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByTestId('category-picker-check')).toHaveLength(1);
    expect(within(selected).getByTestId('category-picker-check')).toBeInTheDocument();
    cleanup();

    renderSheet({ selectedId: null });
    expect(screen.getByRole('radio', { name: 'none-label' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getAllByTestId('category-picker-check')).toHaveLength(1);
  });

  it('3. the host thumb fills the 3:4 slot; a row without one takes the brand gradient', () => {
    renderSheet();
    const thumb = screen.getByTestId('category-picker-thumb');
    expect(thumb.className).toContain('aspect-[3/4]');
    expect(thumb.className).toContain('w-8');
    expect(within(thumb).getByTestId('host-thumb')).toBeInTheDocument();
    const fallback = screen.getByTestId('category-picker-fallback');
    expect(fallback.getAttribute('style')).toContain('var(--brand-gradient)');
  });

  it('4. choosing the none row hands back null; choosing a category hands back its id', () => {
    const onSelect = vi.fn();
    renderSheet({ onSelect, selectedId: 'c1' });
    fireEvent.click(screen.getByRole('radio', { name: 'none-label' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(
      screen.getByRole('radio', { name: 'second-category-with-a-deliberately-long-name' }),
    );
    expect(onSelect).toHaveBeenLastCalledWith('c2');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('5. a long name truncates beside the check, so the control never leaves the row', () => {
    renderSheet({ selectedId: 'c2' });
    const row = screen.getByRole('radio', {
      name: 'second-category-with-a-deliberately-long-name',
    });
    expect(within(row).getByText(ITEMS[1].name).className).toContain('truncate');
  });

  it('6. zero categories still renders the none row — the caller owns any empty copy', () => {
    renderSheet({ items: [] });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });
});
