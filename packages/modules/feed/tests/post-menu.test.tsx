// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostMenu, type PostMenuLabels, type PostMenuTarget } from '../ui/PostMenu';

/**
 * 09-09 (D-475, SOCIAL-07, UI-D-495, UI-D-497): the post's "..." menu gains the moderator's removal
 * row and the member wording of the author's delete. Both are chosen by DATA on the target
 * (`removal`, `memberPost`), never by a role, and every string is a fixed catalog label the host
 * passes in (the module ships no language; none of them interpolates member content, T-04-58).
 *
 * Sentinel ASCII strings throughout. `motion/react` is replaced by plain elements, the
 * `comments-removal` rationale (happy-dom's `Animation.cancel()` rejects when a dialog unmounts).
 */

vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
    'whileTap',
    'whileHover',
    'whileFocus',
    'layout',
    'layoutId',
  ]);
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        }),
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

afterEach(cleanup);

const LABELS: PostMenuLabels = {
  edit: 'edit-label',
  copyLink: 'copy-link-label',
  delete: 'delete-label',
  deleteTitle: 'delete-title',
  deleteBody: 'delete-body',
  deleteBodyMember: 'delete-body-member',
  deleteConfirm: 'delete-confirm',
  deleteCancel: 'delete-cancel',
  remove: 'remove-label',
  removeTitle: 'remove-title',
  removeBody: 'remove-body',
  removeConfirm: 'remove-confirm',
  removeCancel: 'remove-cancel',
};

const POST = '0b9a3c2e-5d1f-4e7a-9c3b-2f6d8e1a4b70';

function target(overrides: Partial<PostMenuTarget> = {}): PostMenuTarget {
  return {
    postId: POST,
    shareUrl: 'https://lab.example/post/x',
    canManage: false,
    editHref: null,
    ...overrides,
  };
}

function renderMenu(menuTarget: PostMenuTarget, onDelete = vi.fn().mockResolvedValue(undefined)) {
  render(
    <PostMenu
      open
      target={menuTarget}
      onClose={vi.fn()}
      onSharePost={vi.fn()}
      onDelete={onDelete}
      labels={LABELS}
    />,
  );
  return onDelete;
}

describe('PostMenu - the moderator removal row (UI-D-497)', () => {
  const moderation = { removal: 'moderation' as const, memberPost: true };

  it('P1: a moderation target holds Copiar link and the danger Remover row, and no edit row', () => {
    renderMenu(target(moderation));

    expect(screen.getByText(LABELS.copyLink)).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: LABELS.remove });
    expect(remove).toHaveClass('text-danger');
    expect(screen.queryByText(LABELS.edit)).toBeNull();
    // The author's own delete row is not the moderator's row.
    expect(screen.queryByRole('button', { name: LABELS.delete })).toBeNull();
  });

  it('P2: confirming the removal calls onDelete with the post id and the removal variant', async () => {
    const onDelete = renderMenu(target(moderation));

    fireEvent.click(screen.getByRole('button', { name: LABELS.remove }));
    expect(screen.getByText(LABELS.removeTitle)).toBeInTheDocument();
    expect(screen.getByText(LABELS.removeBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.removeCancel })).toBeInTheDocument();
    expect(screen.queryByText(LABELS.deleteTitle)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: LABELS.removeConfirm }));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(POST, 'removal');
  });

  it('P3: a viewer with neither canManage nor removal gets Copiar link alone', () => {
    renderMenu(target());
    expect(screen.getByText(LABELS.copyLink)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: LABELS.remove })).toBeNull();
    expect(screen.queryByRole('button', { name: LABELS.delete })).toBeNull();
  });
});

describe('PostMenu - the author delete wording (UI-D-495)', () => {
  const own = { canManage: true, editHref: '/post/x/editar' };

  it('P4: the author of a MEMBER post sees the member body, with the author title and buttons', async () => {
    const onDelete = renderMenu(target({ ...own, memberPost: true }));

    fireEvent.click(screen.getByRole('button', { name: LABELS.delete }));
    expect(screen.getByText(LABELS.deleteTitle)).toBeInTheDocument();
    expect(screen.getByText(LABELS.deleteBodyMember)).toBeInTheDocument();
    expect(screen.queryByText(LABELS.deleteBody)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: LABELS.deleteConfirm }));
    });
    // The author's delete carries no variant: the host toasts "excluída", not "removida".
    expect(onDelete).toHaveBeenCalledWith(POST, undefined);
  });

  it('P5: an administrator post keeps 04 wording and row set', () => {
    renderMenu(target(own));

    expect(screen.getByText(LABELS.edit)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LABELS.delete }));
    expect(screen.getByText(LABELS.deleteBody)).toBeInTheDocument();
    expect(screen.queryByText(LABELS.deleteBodyMember)).toBeNull();
  });

  it('P6: the member author keeps the edit row', () => {
    renderMenu(target({ ...own, memberPost: true }));
    expect(screen.getByText(LABELS.edit)).toBeInTheDocument();
  });
});
