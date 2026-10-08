// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityPickerSheet } from '../ui/CommunityPickerSheet';

/**
 * UI-D-45 / UI-D-41 — the ONE community row list, and the prop that makes it one component instead
 * of two.
 *
 * The "Publicar em" picker (UI-D-45, 05-03) and the "Fixar em comunidades" pin sheet (UI-D-41,
 * 05-08) draw the identical body: a 44px row, a 32×32 cover thumb or the brand-gradient fallback,
 * the name at 14/400 truncating, and a trailing control. The ONLY difference between them is that
 * control — a check glyph here, a `Switch` there — so it is INJECTED. Two copies of this list would
 * drift on the thumb, the truncation or the tap target the first time either sheet changed.
 *
 * Asserted as observable contract: which rows exist, what they are named in the a11y tree, that the
 * injected control really is the caller's node, and that choosing a row hands the caller back the
 * row it chose. The sheet ships NO words — every string is a prop, sentinel ASCII here.
 */

// Springs have nothing to animate under happy-dom, and a cancelled one rejects AFTER the run ends.
MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const ROWS = [
  {
    id: 'c1',
    name: 'first-community',
    coverAssetId: 'a1111111-1111-4111-8111-111111111111',
    coverVariantWidths: [320, 640],
    coverAlt: 'cover-alt-1',
  },
  {
    id: 'c2',
    name: 'second-community-with-a-deliberately-long-name',
    coverAssetId: null,
    coverVariantWidths: [],
    coverAlt: 'cover-alt-2',
  },
] as const;

function renderSheet(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    rows: ROWS,
    rowLabel: (row: { name: string }) => `row-label-${row.name}`,
    onSelect: () => {},
    trailing: (row: { id: string }) => <span data-trailing={row.id}>trailing-{row.id}</span>,
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CommunityPickerSheet {...(props as any)} />);
}

describe('CommunityPickerSheet — one list body, an injected trailing control', () => {
  it('1. renders one row per community, named by the host label', () => {
    renderSheet();

    expect(screen.getByRole('dialog', { name: 'sheet-title' })).toBeInTheDocument();
    for (const row of ROWS) {
      expect(screen.getByRole('button', { name: `row-label-${row.name}` })).toBeInTheDocument();
    }
  });

  it('2. the trailing control is the CALLER’s node, rendered per row', () => {
    renderSheet();

    // This is the whole reason the component is shared: a check glyph here, a Switch in the pin
    // sheet, and neither variant is imported by this file.
    for (const row of ROWS) {
      const rendered = document.querySelector(`[data-trailing="${row.id}"]`);
      expect(rendered, row.id).not.toBeNull();
    }
  });

  it('3. the name truncates beside its control, so a long name never pushes the control out', () => {
    renderSheet();

    const long = screen.getByRole('button', {
      name: 'row-label-second-community-with-a-deliberately-long-name',
    });
    const name = within(long).getByText(ROWS[1].name);
    expect(name.className).toContain('truncate');
    expect(within(long).getByText('trailing-c2')).toBeInTheDocument();
  });

  it('4. choosing a row hands the caller back the row it chose', () => {
    const onSelect = vi.fn();
    renderSheet({ onSelect });

    fireEvent.click(screen.getByRole('button', { name: 'row-label-first-community' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'c1', name: 'first-community' });
  });

  it('5. zero communities renders an empty list rather than a crash — the caller owns the copy', () => {
    renderSheet({ rows: [] });

    expect(screen.getByRole('dialog', { name: 'sheet-title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /row-label-/ })).toBeNull();
  });

  it('6. a footer renders after the rows when given (08.2-10), and nothing renders without one', () => {
    renderSheet({ footer: <button type="button">footer-done</button> });

    const footer = document.querySelector('[data-picker-footer]');
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement).getByRole('button', { name: 'footer-done' }),
    ).toBeInTheDocument();
    // After the list, so it never sits between two rows.
    const list = screen.getByRole('list');
    expect(
      list.compareDocumentPosition(footer as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    cleanup();
    renderSheet();
    expect(document.querySelector('[data-picker-footer]')).toBeNull();
  });
});
