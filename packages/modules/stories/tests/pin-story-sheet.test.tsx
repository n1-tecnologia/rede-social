// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommunityPickerSheetBody, PinStoryCommunityRow } from '../ui/PinStorySheet';
import { PinStorySheet, type PinStorySheetProps } from '../ui/PinStorySheet';

/**
 * UI-D-41 — the pin sheet, whose whole product rule is a NEGATIVE one: **there is no save button,
 * because STORY-04 is a set of independent facts and a save would invent a transaction the schema
 * does not have.** Everything below follows from that.
 *
 * The five claims worth a test:
 *
 *  1. **Every toggle is its OWN immediate request.** One switch moved is one call, with the id and
 *     the direction — never a batch collected behind a Salvar.
 *  2. **The write is OPTIMISTIC.** The switch flips before the promise settles, so the sheet never
 *     shows a spinner for a one-row write.
 *  3. **A failure REVERTS and the ROW STAYS** (UI partial/E09). A community archived between render
 *     and toggle makes the write fail server-side; vanishing the row mid-gesture would be worse
 *     than the failure, and there is no inline message and no dismissal — the admin retries in
 *     place.
 *  4. **A second toggle while one is in flight is a NO-OP** (UI loading/E09). Two taps must not
 *     produce two crossing writes for one row.
 *  5. **UI empty/E09: zero communities renders the host's empty node**, not an empty switch list.
 *
 * **The list body is INJECTED, so this file supplies its own.** `CommunityPickerSheet` lives in
 * `@tria/module-communities/ui` and `turbo boundaries` denies a `module -> module` package edge
 * (MOD-02) — for the test package exactly as for the component. The double below renders the same
 * three things the real body does (the open/closed branch, one row per entry carrying the host's
 * `rowLabel`, and the injected trailing control), which is the entire surface `PinStorySheet`
 * depends on. The REAL composition is exercised where it is legal: `apps/web` assembles both and
 * `apps/web/e2e/stories.spec.ts` walks it in a browser.
 */
const CommunityPickerListBody: CommunityPickerSheetBody = ({
  open,
  title,
  helper,
  rows,
  rowLabel,
  trailing,
  leadingRow,
}) => {
  if (!open) return null;
  return (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {helper ? <p>{helper}</p> : null}
      <ul>
        {leadingRow ? <li>{leadingRow}</li> : null}
        {rows.map((row: PinStoryCommunityRow) => (
          <li key={row.id}>
            <span>{row.name}</span>
            <span aria-hidden>{rowLabel(row)}</span>
            {trailing(row)}
          </li>
        ))}
      </ul>
    </div>
  );
};

afterEach(cleanup);

const LADDER = [640, 1080] as const;

const COMMUNITIES = [
  { id: 'c1', name: 'name-1', coverAssetId: null, coverVariantWidths: LADDER, coverAlt: 'alt-1' },
  {
    id: 'c2',
    name: 'name-2',
    coverAssetId: '00000002-1111-4111-8111-111111111111',
    coverVariantWidths: LADDER,
    coverAlt: 'alt-2',
  },
] as const;

function props(overrides: Partial<PinStorySheetProps> = {}): PinStorySheetProps {
  return {
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    helper: 'sheet-helper',
    rows: COMMUNITIES,
    pinnedCommunityIds: ['c1'],
    rowLabel: (row) => `pin-${row.id}`,
    onToggle: async () => true,
    empty: <p>empty-node</p>,
    renderList: CommunityPickerListBody,
    ...overrides,
  };
}

const switchFor = (id: string) => screen.getByRole('switch', { name: `pin-${id}` });

describe('PinStorySheet — UI-D-41, one switch per community and no Salvar anywhere', () => {
  it('1. one row per community, each with a switch reflecting the CURRENT pinned state', () => {
    render(<PinStorySheet {...props()} />);

    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(switchFor('c1')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor('c2')).toHaveAttribute('aria-checked', 'false');
  });

  it('2. there is NO save button and no form — the sheet cannot imply a transaction', () => {
    const { container } = render(<PinStorySheet {...props()} />);

    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /salvar/i })).not.toBeInTheDocument();
  });

  it('3. one toggle is ONE immediate call carrying the id and the direction', async () => {
    const onToggle = vi.fn(async () => true);
    render(<PinStorySheet {...props({ onToggle })} />);

    switchFor('c2').click();

    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    expect(onToggle).toHaveBeenCalledWith('c2', true);
  });

  it('4. the switch flips OPTIMISTICALLY, before the write settles', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onToggle = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<PinStorySheet {...props({ onToggle })} />);

    switchFor('c2').click();

    // Still in flight, and the control already reads as pinned — no spinner, no wait.
    await waitFor(() => expect(switchFor('c2')).toHaveAttribute('aria-checked', 'true'));
    settle(true);
    await waitFor(() => expect(switchFor('c2')).toHaveAttribute('aria-checked', 'true'));
  });

  it('5. a FAILED toggle reverts, and the row STAYS in the list (partial E09)', async () => {
    const onToggle = vi.fn(async () => false);
    render(<PinStorySheet {...props({ onToggle })} />);

    switchFor('c2').click();

    await waitFor(() => expect(switchFor('c2')).toHaveAttribute('aria-checked', 'false'));
    // The row is still there — it did not vanish mid-gesture — and so is the sheet.
    expect(screen.getByText('name-2')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('6. an UNPIN sends the false direction and reverts the same way on failure', async () => {
    const onToggle = vi.fn(async () => false);
    render(<PinStorySheet {...props({ onToggle })} />);

    switchFor('c1').click();

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('c1', false));
    await waitFor(() => expect(switchFor('c1')).toHaveAttribute('aria-checked', 'true'));
  });

  it('7. a SECOND toggle while one is in flight is a no-op (loading E09)', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onToggle = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<PinStorySheet {...props({ onToggle })} />);

    const control = switchFor('c2');
    control.click();
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    switchFor('c2').click();

    expect(onToggle).toHaveBeenCalledTimes(1);
    settle(true);
    // …and once it settles the row is toggleable again.
    await waitFor(() => expect(switchFor('c2')).toHaveAttribute('aria-checked', 'true'));
    switchFor('c2').click();
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(2));
  });

  it('8. zero communities renders the HOST empty node instead of an empty switch list (empty E09)', () => {
    render(<PinStorySheet {...props({ rows: [], pinnedCommunityIds: [] })} />);

    expect(screen.getByText('empty-node')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('9. a closed sheet renders nothing at all', () => {
    render(<PinStorySheet {...props({ open: false })} />);

    expect(screen.queryByText('sheet-title')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('10. the title and the helper are the HOST’s words — the sheet ships none (PWA-03)', () => {
    render(<PinStorySheet {...props()} />);

    expect(screen.getByText('sheet-title')).toBeInTheDocument();
    expect(screen.getByText('sheet-helper')).toBeInTheDocument();
  });
});
