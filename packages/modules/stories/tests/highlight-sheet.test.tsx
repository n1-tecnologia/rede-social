// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HighlightMembershipList,
  type HighlightMembershipListProps,
  type HighlightMembershipRow,
  HighlightSheet,
  type HighlightSheetChecklistProps,
  type HighlightSheetPlace,
  type HighlightSheetSingleProps,
  type HighlightSheetTitleStepLabels,
} from '../ui/HighlightSheet';
import { HighlightTitleStep, type HighlightTitleStepProps } from '../ui/HighlightTitleStep';

/**
 * D-110 — the ONE highlight sheet, and the toggle machine it is built on.
 *
 * Three routes put a story into a highlight (the viewer's "Destacar", "Seus stories", the composer)
 * and plan 09's "Adicionar stories" puts stories into one highlight. All of them draw THIS component,
 * so the claims below are the whole contract those routes inherit:
 *
 *  - **M1-M4, the machine** (`HighlightMembershipList`): UI-D-41's three invariants carried verbatim
 *    — a failed toggle reverts IN PLACE and the row stays; a second toggle while the first is in
 *    flight is a no-op; the switches re-seed when the target changes while the sheet stays mounted —
 *    plus E09 loading: with no memberships yet every switch is DISABLED at its real row geometry, so
 *    no switch ever shows a state the server does not hold.
 *  - **C1-C2, checklist mode** (UI-D-67): places in the host's order under plain labels, each switch
 *    named by the host's sentence; zero places renders the host's empty node INSIDE the sheet.
 *  - **S1-S4, single-select mode** (UI-D-68): the origin community first, then "Nenhum", then Início,
 *    then the rest, each group closing with its own "Novo destaque"; confirming a new title CREATES
 *    NOTHING (D-114) — it selects a pending `{ communityId, title }` and closes.
 *  - **T1-T3, the title step** (UI-D-72, UI E05): trimmed-empty disables the submit and Enter shows
 *    the inline error; `maxLength` holds the field at the limit; a pending submit is single-flight
 *    and a failure keeps the typed title.
 *
 * Every string here is a fixture word (`place-home`, `row:…`): the module ships none (PWA-03).
 */

afterEach(cleanup);

const COVER = '00000002-1111-4111-8111-111111111111';

const HOME: HighlightSheetPlace = {
  key: 'home',
  label: 'place-home',
  communityId: null,
  rows: [
    { id: 'h1', title: 'title-h1', cover: null },
    { id: 'h2', title: 'title-h2', cover: { assetId: COVER, variantWidths: [640, 1080] } },
  ],
};

const C1: HighlightSheetPlace = {
  key: 'c1',
  label: 'place-c1',
  communityId: 'c1',
  rows: [{ id: 'h3', title: 'title-h3', cover: null }],
};

/** A community with ZERO highlights — only single mode ever receives one (UI-D-68 (iv)). */
const C2: HighlightSheetPlace = { key: 'c2', label: 'place-c2', communityId: 'c2', rows: [] };

/* ── The machine ─────────────────────────────────────────────────────────────────────────────── */

const MACHINE_ROWS: readonly HighlightMembershipRow[] = [
  { id: 'a', leading: <span>lead-a</span>, title: 'title-a' },
  { id: 'b', leading: <span>lead-b</span>, title: 'title-b' },
];

function machineProps(
  overrides: Partial<HighlightMembershipListProps> = {},
): HighlightMembershipListProps {
  return {
    rows: MACHINE_ROWS,
    selectedIds: ['a'],
    onToggle: async () => true,
    rowLabel: (row) => `toggle-${row.id}`,
    ...overrides,
  };
}

const machineSwitch = (id: string) => screen.getByRole('switch', { name: `toggle-${id}` });

describe('HighlightMembershipList — the toggle machine (UI-D-41 carried, D-110)', () => {
  it('M1. a toggle calls onToggle(id, true); a false answer REVERTS the switch and the row STAYS', async () => {
    const onToggle = vi.fn(async () => false);
    render(<HighlightMembershipList {...machineProps({ onToggle })} />);

    fireEvent.click(machineSwitch('b'));

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('b', true));
    await waitFor(() => expect(machineSwitch('b')).toHaveAttribute('aria-checked', 'false'));
    // The row did not vanish mid-gesture, and neither did its neighbour.
    expect(screen.getByText('title-b')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('M2. a second tap on a row whose write is still in flight does NOT call onToggle again', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onToggle = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<HighlightMembershipList {...machineProps({ onToggle })} />);

    fireEvent.click(machineSwitch('b'));
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    fireEvent.click(machineSwitch('b'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    await act(async () => settle(true));
    await waitFor(() => expect(machineSwitch('b')).toHaveAttribute('aria-checked', 'true'));
    // Settled, the row is toggleable again.
    fireEvent.click(machineSwitch('b'));
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(2));
  });

  it('M3. a NEW selectedIds array (another story) re-seeds every switch with no stale state', async () => {
    const { rerender } = render(<HighlightMembershipList {...machineProps()} />);
    // A local, optimistic change on the first target…
    fireEvent.click(machineSwitch('b'));
    await waitFor(() => expect(machineSwitch('b')).toHaveAttribute('aria-checked', 'true'));

    // …must not survive the move to another story whose memberships are exactly ['b'].
    rerender(<HighlightMembershipList {...machineProps({ selectedIds: ['b'] })} />);
    await waitFor(() => expect(machineSwitch('a')).toHaveAttribute('aria-checked', 'false'));
    expect(machineSwitch('b')).toHaveAttribute('aria-checked', 'true');

    rerender(<HighlightMembershipList {...machineProps({ selectedIds: [] })} />);
    await waitFor(() => expect(machineSwitch('b')).toHaveAttribute('aria-checked', 'false'));
    expect(machineSwitch('a')).toHaveAttribute('aria-checked', 'false');
  });

  it('M4. selectedIds null renders every switch DISABLED at its full row geometry (E09 loading)', () => {
    const onToggle = vi.fn(async () => true);
    const { container } = render(
      <HighlightMembershipList {...machineProps({ selectedIds: null, onToggle })} />,
    );

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    for (const control of switches) {
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('aria-checked', 'false');
    }
    // The rows are really there — the 44px shell, the leading node and the title.
    expect(container.querySelectorAll('.min-h-11')).toHaveLength(2);
    expect(screen.getByText('lead-a')).toBeInTheDocument();
    expect(screen.getByText('title-b')).toBeInTheDocument();
    fireEvent.click(machineSwitch('a'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

/* ── Checklist mode ──────────────────────────────────────────────────────────────────────────── */

function checklistProps(
  overrides: Partial<HighlightSheetChecklistProps> = {},
): HighlightSheetChecklistProps {
  return {
    mode: 'checklist',
    open: true,
    onClose: () => {},
    title: 'sheet-title',
    helper: 'sheet-helper',
    places: [HOME, C1],
    rowLabel: (row, place) => `row:${row.title}@${place.label}`,
    selectedIds: ['h2'],
    onToggle: async () => true,
    empty: <p>empty-node</p>,
    ...overrides,
  };
}

describe('HighlightSheet — checklist mode (UI-D-67)', () => {
  it('C1. places render in the given order under plain labels; each switch is named by rowLabel(row, place)', async () => {
    const onToggle = vi.fn(async () => true);
    render(<HighlightSheet {...checklistProps({ onToggle })} />);

    const dialog = screen.getByRole('dialog');
    const labels = within(dialog)
      .getAllByText(/^place-/)
      .map((node) => node.textContent);
    expect(labels).toEqual(['place-home', 'place-c1']);
    // A plain label, never a heading: no brand ink on a repeated header (UI-D-67).
    expect(within(dialog).queryByRole('heading', { name: 'place-home' })).toBeNull();

    const names = screen.getAllByRole('switch').map((node) => node.getAttribute('aria-label'));
    expect(names).toEqual([
      'row:title-h1@place-home',
      'row:title-h2@place-home',
      'row:title-h3@place-c1',
    ]);
    expect(screen.getByRole('switch', { name: 'row:title-h2@place-home' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // A cover-less highlight shows the monogram; the covered one does not.
    expect(screen.getAllByTestId('story-monogram')).toHaveLength(2);

    // A toggle carries the highlight, the direction AND its place (the host picks a revalidation).
    fireEvent.click(screen.getByRole('switch', { name: 'row:title-h3@place-c1' }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('h3', true, C1));
    // No save button and no inline creation in this mode (D-109).
    expect(screen.queryByRole('button', { name: /salvar|novo/i })).toBeNull();
  });

  it('C2. zero places renders the HOST empty node inside the sheet, and no switch', () => {
    render(<HighlightSheet {...checklistProps({ places: [], selectedIds: [] })} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('empty-node')).toBeInTheDocument();
    expect(within(dialog).getByText('sheet-title')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});

/* ── Single-select mode ──────────────────────────────────────────────────────────────────────── */

const TITLE_STEP: HighlightSheetTitleStepLabels = {
  heading: 'step-heading',
  placeLine: (place) => `in:${place}`,
  label: 'field-label',
  placeholder: 'field-placeholder',
  helper: 'step-helper',
  counter: (count, limit) => `${count}/${limit}`,
  limit: 15,
  submitLabel: 'step-submit',
  submittingLabel: 'step-submitting',
  backLabel: 'step-back',
  emptyError: 'step-empty',
};

function singleProps(
  overrides: Partial<HighlightSheetSingleProps> = {},
): HighlightSheetSingleProps {
  return {
    mode: 'single',
    open: true,
    onClose: () => {},
    title: 'select-title',
    helper: 'select-helper',
    places: [HOME, C1, C2],
    rowLabel: (row, place) => `pick:${row.title}@${place.label}`,
    selection: { kind: 'none' },
    onSelect: () => {},
    noneLabel: 'none-label',
    createLabel: 'create-label',
    selectedLabel: 'selected-label',
    originCommunityId: null,
    titleStep: TITLE_STEP,
    ...overrides,
  };
}

/** The sheet's rows, top to bottom, as their visible words (group labels included). */
function rowOrder(): string[] {
  const dialog = screen.getByRole('dialog');
  return Array.from(dialog.querySelectorAll('[data-highlight-sheet-item]')).map(
    (node) => node.getAttribute('data-highlight-sheet-item') ?? '',
  );
}

describe('HighlightSheet — single-select mode (UI-D-68)', () => {
  it('S1. with an origin community: its group first, then "Nenhum", then Início, then the other groups', () => {
    render(<HighlightSheet {...singleProps({ originCommunityId: 'c1' })} />);

    expect(rowOrder()).toEqual([
      'label:c1',
      'row:h3',
      'create:c1',
      'none',
      'label:home',
      'row:h1',
      'row:h2',
      'create:home',
      'label:c2',
      'create:c2',
    ]);
    // Without an origin, "Nenhum" leads and Início follows.
    cleanup();
    render(<HighlightSheet {...singleProps()} />);
    expect(rowOrder().slice(0, 2)).toEqual(['none', 'label:home']);
  });

  it('S2. the selected row carries the Check "Selecionado"; tapping another calls onSelect with it and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <HighlightSheet
        {...singleProps({
          selection: { kind: 'highlight', highlightId: 'h1' },
          onSelect,
          onClose,
        })}
      />,
    );

    const selected = screen.getByRole('button', { name: 'pick:title-h1@place-home' });
    expect(within(selected).getByLabelText('selected-label')).toBeInTheDocument();
    expect(screen.getAllByLabelText('selected-label')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'pick:title-h3@place-c1' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'highlight', highlightId: 'h3' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'none-label' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'none' });
  });

  it('S3. a community with zero highlights shows only its label and its "Novo destaque" row', () => {
    render(<HighlightSheet {...singleProps()} />);

    const order = rowOrder();
    const at = order.indexOf('label:c2');
    expect(order.slice(at)).toEqual(['label:c2', 'create:c2']);
    expect(screen.getAllByRole('button', { name: 'create-label' })).toHaveLength(3);
  });

  it('S4. "Novo destaque" swaps to the title step; confirming "  Bastidores " selects a PENDING highlight and creates nothing', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const props = singleProps({ onSelect, onClose });
    render(<HighlightSheet {...props} />);

    const createInC2 = screen
      .getByRole('dialog')
      .querySelector('[data-highlight-sheet-item="create:c2"]') as HTMLElement;
    fireEvent.click(createInC2);

    // The body swapped inside the ONE sheet: the step, its place line, and no list rows.
    expect(screen.getByRole('heading', { name: 'step-heading' })).toBeInTheDocument();
    expect(screen.getByText('in:place-c2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'none-label' })).toBeNull();

    fireEvent.change(screen.getByLabelText('field-label'), { target: { value: '  Bastidores ' } });
    fireEvent.click(screen.getByRole('button', { name: 'step-submit' }));

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'pending',
        communityId: 'c2',
        title: 'Bastidores',
      }),
    );
    expect(onClose).toHaveBeenCalled();
    // D-114: the sheet has no request of its own — the only callbacks it was given are the host's
    // selection and close, and no prop names a create/network callback.
    expect(Object.keys(props).filter((key) => /create|fetch|request|save/i.test(key))).toEqual([
      'createLabel',
    ]);
  });
});

/* ── The title step ──────────────────────────────────────────────────────────────────────────── */

function stepProps(overrides: Partial<HighlightTitleStepProps> = {}): HighlightTitleStepProps {
  return {
    heading: 'step-heading',
    placeLine: 'in:place-home',
    label: 'field-label',
    placeholder: 'field-placeholder',
    counter: (count, limit) => `${count}/${limit}`,
    limit: 15,
    submitLabel: 'step-submit',
    submittingLabel: 'step-submitting',
    backLabel: 'step-back',
    emptyError: 'step-empty',
    onBack: () => {},
    onSubmit: async () => true,
    ...overrides,
  };
}

describe('HighlightTitleStep — the shared "Novo destaque" form (UI-D-72, UI E05)', () => {
  it('T1. submit is disabled for "" and "   "; Enter on "" shows the empty error and keeps focus', () => {
    const onSubmit = vi.fn(async () => true);
    render(<HighlightTitleStep {...stepProps({ onSubmit })} />);

    const field = screen.getByLabelText('field-label');
    const submit = screen.getByRole('button', { name: 'step-submit' });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    // The counter reflects the UNTRIMMED length (E05 partial).
    expect(screen.getByText('3/15')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '' } });
    field.focus();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('step-empty');
    expect(field).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('T2. typing 20 characters leaves 15 in the field and the counter reads 15/15', () => {
    render(<HighlightTitleStep {...stepProps()} />);

    const field = screen.getByLabelText('field-label') as HTMLInputElement;
    expect(field).toHaveAttribute('maxLength', '15');
    fireEvent.change(field, { target: { value: 'abcdefghijklmnopqrst' } });

    expect(field.value).toBe('abcdefghijklmno');
    expect(screen.getByText('15/15')).toBeInTheDocument();
  });

  it('T3. while onSubmit is pending the button reads the submitting label and a second submit is ignored; a failure keeps the title', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<HighlightTitleStep {...stepProps({ onSubmit })} />);

    const field = screen.getByLabelText('field-label') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Aulas' } });
    fireEvent.click(screen.getByRole('button', { name: 'step-submit' }));

    const pending = await screen.findByRole('button', { name: /step-submitting/ });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('Aulas');

    await act(async () => settle(false));
    await screen.findByRole('button', { name: 'step-submit' });
    expect(field.value).toBe('Aulas');
  });
});
