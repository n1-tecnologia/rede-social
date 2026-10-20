// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-09 (D-475, UI-D-495, UI-D-497, E11): one hook, two outcomes of the same DELETE. The toast copy
 * follows the VARIANT the menu passes (decided from the post's `removal`, never a role): an author's
 * delete says "excluida", a moderator's removal says "removida". A refusal is the same for both - the
 * generic error toast and a REJECTION, so `FeedList` keeps the card (no optimistic removal, 03-05).
 */

const { toast } = vi.hoisted(() => ({ toast: { show: vi.fn(), dismiss: vi.fn() } }));

vi.mock('@rede-social/ui', () => ({ useToast: () => toast }));
vi.mock('@/app/(app)/inicio/feed-actions', () => ({ deletePostAction: vi.fn() }));

const { useDeletePost } = await import('./useDeletePost');

const LABELS = { deleted: 'deleted-label', removed: 'removed-label', error: 'error-label' };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('useDeletePost - the toast follows the variant', () => {
  it('D1: an author delete toasts the deleted label', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDeletePost(action, LABELS));
    await act(async () => {
      await result.current('post-1');
    });
    expect(action).toHaveBeenCalledWith('post-1');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: LABELS.deleted });
  });

  it('D2: a moderator removal toasts the removed label', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDeletePost(action, LABELS));
    await act(async () => {
      await result.current('post-1', 'removal');
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: LABELS.removed });
  });

  it.each([undefined, 'removal'] as const)(
    'D3: a refusal (variant %s) rejects and toasts the generic error, never a success',
    async (variant) => {
      const action = vi.fn().mockResolvedValue({ ok: false, code: 'not_found' });
      const { result } = renderHook(() => useDeletePost(action, LABELS));
      await act(async () => {
        await expect(result.current('post-1', variant)).rejects.toThrow('post_delete_refused');
      });
      expect(toast.show).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: LABELS.error });
    },
  );

  it('D4: an action that never reached the server is the same refusal', async () => {
    const action = vi.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useDeletePost(action, LABELS));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      await expect(result.current('post-1', 'removal')).rejects.toThrow('post_delete_refused');
    });
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: LABELS.error });
  });
});
