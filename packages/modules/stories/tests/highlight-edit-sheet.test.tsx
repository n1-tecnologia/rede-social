// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type HighlightEditItem,
  HighlightEditSheet,
  type HighlightEditSheetProps,
} from '../ui/HighlightEditSheet';

/**
 * 05.2-09 — the edit sheet (UI-D-74), with its cover step (UI-D-75) and its "Adicionar stories"
 * picker step (UI-D-76), all inside ONE `BottomSheet`.
 *
 *  - **E1** the name field holds 15 units and "Salvar nome" is enabled only by a trimmed, non-empty,
 *    CHANGED value — the one control that does not write on its own (a half-typed title never
 *    reaches members).
 *  - **E2** the position controls are the touch screen reader's reorder (WCAG 2.5.7): disabled at
 *    the ends, `onMove(-1 | 1)` otherwise.
 *  - **E3** the stories are drawn in the order given (oldest first, D-103), with the media pill for a
 *    non-ready item, the "Capa" pill on the resolved cover, and a remove per row with NO confirm.
 *  - **E4** "Trocar capa" swaps to the cover step: the host's upload tile first, then one circle per
 *    IMAGE story (videos are never a cover option, D-101), the current one badged; "Usar capa
 *    automática" only when a cover was chosen.
 *  - **E5** "Adicionar stories" swaps to the picker step, whose rows are the SAME toggle machine as
 *    the other two routes (D-110) with the host's load-more node.
 *  - **E6** "Excluir destaque" asks first (the one irreversible act) and cancel closes the question.
 *  - **E7** an archived place keeps only the take-downs (UI-D-80), and an empty highlight shows the
 *    plain empty state with "Adicionar stories".
 *
 * Every string is a fixture word: the module ships none (PWA-03).
 */

// Springs have nothing to animate under happy-dom, and a cancelled one rejects AFTER the run ends.
MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const THUMB = { assetId: '00000002-1111-4111-8111-111111111111', variantWidths: [640] };

const OLD: HighlightEditItem = {
  id: 's-old',
  thumb: THUMB,
  mediaKind: 'image',
  dateLabel: 'date-old',
  isCover: false,
};
const VIDEO: HighlightEditItem = {
  id: 's-video',
  thumb: THUMB,
  mediaKind: 'video',
  dateLabel: 'date-video',
  status: { tone: 'warning', label: 'pill-processing' },
  isCover: false,
};
const NEW: HighlightEditItem = {
  id: 's-new',
  thumb: THUMB,
  mediaKind: 'image',
  dateLabel: 'date-new',
  isCover: true,
};

function props(overrides: Partial<HighlightEditSheetProps> = {}): HighlightEditSheetProps {
  return {
    open: true,
    onClose: () => {},
    highlight: {
      id: 'h1',
      title: 'Aulas',
      cover: THUMB,
      coverChosen: false,
      position: 2,
      total: 3,
      archived: false,
    },
    items: [OLD, VIDEO, NEW],
    onRename: async () => true,
    onMove: () => {},
    onRemove: async () => true,
    onCover: async () => true,
    onDelete: async () => true,
    uploadTile: <button type="button">upload-tile</button>,
    pickerRows: [
      { id: 'p1', leading: <span>lead-p1</span>, title: 'pick-1' },
      { id: 'p2', leading: <span>lead-p2</span>, title: 'pick-2' },
    ],
    pickerSelectedIds: ['p2'],
    onPickerToggle: async () => true,
    pickerFooter: <p>picker-footer</p>,
    pickerEmpty: <p>picker-empty</p>,
    labels: {
      title: 'edit-title',
      cover: 'edit-cover',
      changeCover: 'edit-change-cover',
      name: 'edit-name',
      saveName: 'edit-save-name',
      savingName: 'edit-saving-name',
      counter: (count, limit) => `${count}/${limit}`,
      limit: 15,
      position: (position, total) => `position:${position}:${total}`,
      moveUp: 'edit-move-up',
      moveDown: 'edit-move-down',
      stories: 'edit-stories',
      coverPill: 'edit-cover-pill',
      remove: (item) => `remove:${item.dateLabel}`,
      addStories: 'edit-add-stories',
      delete: 'edit-delete',
      emptyTitle: 'edit-empty-title',
      emptyBody: 'edit-empty-body',
      archivedNote: 'edit-archived-note',
      back: 'edit-back',
      coverTitle: 'cover-title',
      coverOption: (item) => `cover:${item.dateLabel}${item.isCover ? ':current' : ''}`,
      auto: 'cover-auto',
      autoHelper: 'cover-auto-helper',
      noImages: 'cover-no-images',
      pickerTitle: 'picker-title',
      pickerHelper: 'picker-helper',
      pickerRow: (row) => `pick:${row.title}`,
      confirmDelete: {
        title: 'confirm-title',
        body: 'confirm-body',
        confirm: 'confirm-yes',
        cancel: 'confirm-no',
      },
    },
    ...overrides,
  };
}

const nameField = () => screen.getByLabelText('edit-name') as HTMLInputElement;
const saveName = () => screen.getByRole('button', { name: 'edit-save-name' });

describe('HighlightEditSheet — the edit sheet (UI-D-74)', () => {
  it('E1. the name holds 15 units; "Salvar nome" needs a trimmed, non-empty, changed value', async () => {
    const onRename = vi.fn(async (_title: string) => true);
    render(<HighlightEditSheet {...props({ onRename })} />);

    expect(within(screen.getByRole('dialog')).getByText('edit-title')).toBeInTheDocument();
    expect(nameField()).toHaveValue('Aulas');
    expect(nameField()).toHaveAttribute('maxLength', '15');
    expect(saveName()).toBeDisabled();

    fireEvent.change(nameField(), { target: { value: '  Aulas  ' } });
    expect(saveName()).toBeDisabled();
    fireEvent.change(nameField(), { target: { value: '   ' } });
    expect(saveName()).toBeDisabled();

    fireEvent.change(nameField(), { target: { value: ' Aulas novas ' } });
    expect(saveName()).toBeEnabled();
    fireEvent.click(saveName());
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Aulas novas'));
  });

  it('E2. the position controls are disabled at the ends and call onMove(-1 | 1)', () => {
    const onMove = vi.fn();
    const { rerender } = render(<HighlightEditSheet {...props({ onMove })} />);

    expect(screen.getByText('position:2:3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'edit-move-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit-move-down' }));
    expect(onMove.mock.calls).toEqual([[-1], [1]]);

    const base = props().highlight;
    rerender(
      <HighlightEditSheet {...props({ onMove, highlight: { ...base, position: 1, total: 3 } })} />,
    );
    expect(screen.getByRole('button', { name: 'edit-move-up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-move-down' })).toBeEnabled();

    rerender(
      <HighlightEditSheet {...props({ onMove, highlight: { ...base, position: 1, total: 1 } })} />,
    );
    expect(screen.getByRole('button', { name: 'edit-move-up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-move-down' })).toBeDisabled();
  });

  it('E3. stories in the given order, a pill for non-ready media, "Capa" on the cover, remove with no confirm', async () => {
    const onRemove = vi.fn(async (_id: string) => true);
    render(<HighlightEditSheet {...props({ onRemove })} />);

    const removes = screen.getAllByRole('button', { name: /^remove:/ });
    expect(removes.map((node) => node.getAttribute('aria-label'))).toEqual([
      'remove:date-old',
      'remove:date-video',
      'remove:date-new',
    ]);
    expect(screen.getByText('pill-processing')).toBeInTheDocument();
    // Exactly ONE "Capa" pill, on the story the server resolved as the cover.
    const coverPills = screen.getAllByText('edit-cover-pill');
    expect(coverPills).toHaveLength(1);
    const coverRow = coverPills[0]?.closest('li');
    expect(coverRow).not.toBeNull();
    expect(within(coverRow as HTMLElement).getByText('date-new')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'remove:date-video' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('s-video'));
    // No confirm: the removal is reversible, so it is immediate (and optimistic).
    expect(screen.queryByText('confirm-title')).toBeNull();
    await waitFor(() => expect(screen.queryByText('date-video')).toBeNull());
  });

  it('E4. "Trocar capa" swaps to the cover step: upload tile, image stories only, current badged, auto only when chosen', async () => {
    const onCover = vi.fn(async (_cover: { storyId: string } | null) => true);
    const base = props().highlight;
    const { rerender } = render(<HighlightEditSheet {...props({ onCover })} />);

    fireEvent.click(screen.getByRole('button', { name: 'edit-change-cover' }));
    expect(await screen.findByRole('heading', { name: 'cover-title' })).toBeInTheDocument();

    const tile = screen.getByRole('button', { name: 'upload-tile' });
    const options = screen.getAllByRole('button', { name: /^cover:/ });
    expect(options.map((node) => node.getAttribute('aria-label'))).toEqual([
      'cover:date-old',
      'cover:date-new:current',
    ]);
    // The upload tile comes FIRST in the step.
    expect(
      tile.compareDocumentPosition(options[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Automatic is the current state, so there is nothing to reset to.
    expect(screen.queryByRole('button', { name: 'cover-auto' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'cover:date-old' }));
    await waitFor(() => expect(onCover).toHaveBeenCalledWith({ storyId: 's-old' }));
    // A landed choice returns to the main step.
    await waitFor(() => expect(saveName()).toBeInTheDocument());

    rerender(
      <HighlightEditSheet {...props({ onCover, highlight: { ...base, coverChosen: true } })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit-change-cover' }));
    fireEvent.click(await screen.findByRole('button', { name: 'cover-auto' }));
    expect(screen.getByText('cover-auto-helper')).toBeInTheDocument();
    await waitFor(() => expect(onCover).toHaveBeenLastCalledWith(null));

    // A highlight with no image story: the tile plus the note, and no circle.
    rerender(<HighlightEditSheet {...props({ onCover, items: [VIDEO] })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'edit-change-cover' }));
    expect(await screen.findByText('cover-no-images')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^cover:/ })).toHaveLength(0);
  });

  it('E5. "Adicionar stories" swaps to the picker: the shared toggle machine with the host load-more node', async () => {
    const onPickerToggle = vi.fn(async (_id: string, _next: boolean) => true);
    const onStepChange = vi.fn();
    render(<HighlightEditSheet {...props({ onPickerToggle, onStepChange })} />);

    fireEvent.click(screen.getByRole('button', { name: 'edit-add-stories' }));
    expect(await screen.findByRole('heading', { name: 'picker-title' })).toBeInTheDocument();
    expect(onStepChange).toHaveBeenLastCalledWith('picker');
    expect(screen.getByText('picker-helper')).toBeInTheDocument();
    expect(screen.getByText('picker-footer')).toBeInTheDocument();

    expect(screen.getByRole('switch', { name: 'pick:pick-1' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'pick:pick-2' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('switch', { name: 'pick:pick-1' }));
    await waitFor(() => expect(onPickerToggle).toHaveBeenCalledWith('p1', true));

    fireEvent.click(screen.getByRole('button', { name: 'edit-back' }));
    await waitFor(() => expect(onStepChange).toHaveBeenLastCalledWith('main'));
    expect(screen.getByRole('button', { name: 'edit-add-stories' })).toHaveFocus();
  });

  it('E6. "Excluir destaque" asks first; confirm calls onDelete, cancel closes the question', async () => {
    const onDelete = vi.fn(async () => true);
    render(<HighlightEditSheet {...props({ onDelete })} />);

    fireEvent.click(screen.getByRole('button', { name: 'edit-delete' }));
    expect(await screen.findByText('confirm-body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-no' }));
    await waitFor(() => expect(screen.queryByText('confirm-body')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'edit-delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm-yes' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it('E7. archived keeps only take-downs with its note; an empty highlight shows the plain empty state', () => {
    const base = props().highlight;
    const { rerender } = render(
      <HighlightEditSheet {...props({ highlight: { ...base, archived: true } })} />,
    );

    expect(screen.getByText('edit-archived-note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit-change-cover' })).toBeNull();
    expect(screen.queryByLabelText('edit-name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'edit-move-up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'edit-add-stories' })).toBeNull();
    // The take-downs stay (R-D-F).
    expect(screen.getAllByRole('button', { name: /^remove:/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'edit-delete' })).toBeInTheDocument();

    rerender(<HighlightEditSheet {...props({ items: [] })} />);
    expect(screen.getByText('edit-empty-title')).toBeInTheDocument();
    expect(screen.getByText('edit-empty-body')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'edit-add-stories' })).toHaveLength(1);
    expect(screen.queryByText('edit-archived-note')).toBeNull();
  });
});
