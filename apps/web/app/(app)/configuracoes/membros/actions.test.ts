import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-16 (T-09.1-76) — the load-more action forwards `subscription_pending` only while the list says
 * `payments` is on; otherwise the page asked for is the unfiltered one, the page's own reading of a
 * hand-typed URL. Every other filter is forwarded as before.
 */

const mocks = vi.hoisted(() => ({ getAdminMembers: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/lib/admin-members', () => ({
  getAdminMembers: (...args: unknown[]) => mocks.getAdminMembers(...args),
  postMemberAccess: vi.fn(),
  putMemberRole: vi.fn(),
}));
vi.mock('@/lib/bootstrap', () => ({
  ApiClientError: class ApiClientError extends Error {},
  bootstrapRedirectPath: () => null,
}));

const { loadMoreAdminMembersAction } = await import('./actions');

beforeEach(() => {
  mocks.getAdminMembers.mockReset();
  mocks.getAdminMembers.mockResolvedValue({ items: [], nextCursor: null });
});

describe('loadMoreAdminMembersAction — the payments filter (T-09.1-76)', () => {
  it('forwards subscription_pending while payments is on', async () => {
    const result = await loadMoreAdminMembersAction(null, null, 'subscription_pending', true);
    expect(result.ok).toBe(true);
    expect(mocks.getAdminMembers).toHaveBeenCalledWith({
      cursor: undefined,
      q: undefined,
      status: 'subscription_pending',
    });
  });

  it('asks for the unfiltered page while payments is off', async () => {
    await loadMoreAdminMembersAction('opaque', 'bia', 'subscription_pending', false);
    expect(mocks.getAdminMembers).toHaveBeenCalledWith({
      cursor: 'opaque',
      q: 'bia',
      status: 'all',
    });
  });

  it('forwards every other filter whatever the flag says', async () => {
    await loadMoreAdminMembersAction(null, null, 'blocked', false);
    expect(mocks.getAdminMembers).toHaveBeenLastCalledWith({
      cursor: undefined,
      q: undefined,
      status: 'blocked',
    });
    await loadMoreAdminMembersAction(null, null, 'invited', true);
    expect(mocks.getAdminMembers).toHaveBeenLastCalledWith({
      cursor: undefined,
      q: undefined,
      status: 'invited',
    });
  });

  it('still refuses an unknown filter before any request', async () => {
    const result = await loadMoreAdminMembersAction(null, null, 'bogus', true);
    expect(result).toEqual({ ok: false, code: 'generic' });
    expect(mocks.getAdminMembers).not.toHaveBeenCalled();
  });
});
