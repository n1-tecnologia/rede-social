import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (PAY-14, PAY-15, D-497, D-499) — the Membros actions branch on the bootstrap mapping, so an
 * admin whose own payment access was cut mid-session is sent to the pending screen (not shown a raw
 * error, and not signed out), exactly as a block is sent to "Acesso suspenso". The real
 * `bootstrapRedirectPath` runs; only the API client is stubbed.
 */

const mocks = vi.hoisted(() => ({ postMemberAccess: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/admin-members', () => ({
  getAdminMembers: vi.fn(),
  postMemberAccess: (...args: unknown[]) => mocks.postMemberAccess(...args),
  putMemberRole: vi.fn(),
}));

const { ApiClientError } = await import('@/lib/bootstrap');
const { blockMemberAction } = await import('./actions');

const ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => mocks.postMemberAccess.mockReset());

describe('Membros actions: the payment cut (09.1-15)', () => {
  it('navigates to the pending screen on 403 SUBSCRIPTION_PENDING', async () => {
    mocks.postMemberAccess.mockRejectedValueOnce(
      new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: 'Rede Demo' }),
    );
    await expect(blockMemberAction(ID, null)).rejects.toThrow(
      'REDIRECT:/assinatura-pendente?t=Rede%20Demo',
    );
  });

  it('still navigates the blocked flow for MEMBERSHIP_BLOCKED', async () => {
    mocks.postMemberAccess.mockRejectedValueOnce(
      new ApiClientError(403, 'MEMBERSHIP_BLOCKED', { tenantName: 'Rede Demo' }),
    );
    await expect(blockMemberAction(ID, null)).rejects.toThrow(
      'REDIRECT:/auth/blocked?t=Rede%20Demo',
    );
  });

  it('keeps a plain FORBIDDEN as the sheet’s outcome, not a navigation', async () => {
    mocks.postMemberAccess.mockRejectedValueOnce(new ApiClientError(403, 'FORBIDDEN'));
    await expect(blockMemberAction(ID, null)).resolves.toEqual({ ok: false, code: 'forbidden' });
  });
});
