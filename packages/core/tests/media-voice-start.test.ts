import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.5-02 (D-847, T-12.5-07): who may START a voice upload. No new permission exists; whoever may write
 * in a chat may record into it, and the check runs FIRST for the audio kind, before any limit lookup
 * and before any database access, so a refused caller learns nothing and costs nothing.
 *
 * `permissionsForRequest` and the admin transaction lane are mocked: the refusal must never reach the
 * second one.
 */

const h = vi.hoisted(() => ({
  permissions: vi.fn(),
  withAdminTx: vi.fn(),
}));

vi.mock('../server/rbac/permissions', () => ({
  permissionsForRequest: h.permissions,
}));

vi.mock('../db/admin-tx', () => ({
  withAdminTx: h.withAdminTx,
}));

const { startUpload } = await import('../server/media/service');

const ctx = {
  userId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  role: 'member' as const,
};

const voiceBody = {
  kind: 'audio' as const,
  purpose: 'voice' as const,
  mime: 'audio/webm',
  size: 11_013,
};

beforeEach(() => {
  h.permissions.mockReset();
  h.withAdminTx.mockReset();
});

describe('startUpload for audio/voice: the permission check runs first', () => {
  it('an empty permission list is 403 FORBIDDEN and no database lane is opened', async () => {
    h.permissions.mockResolvedValue([]);
    await expect(startUpload(ctx, voiceBody)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(h.permissions).toHaveBeenCalledTimes(1);
    expect(h.withAdminTx).not.toHaveBeenCalled();
  });

  it('an unrelated permission is not enough', async () => {
    h.permissions.mockResolvedValue(['feed.post.create', 'chat.support.assign']);
    await expect(startUpload(ctx, voiceBody)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(h.withAdminTx).not.toHaveBeenCalled();
  });

  it('a refused caller learns no limit: an unlisted mime still answers 403, not type_not_allowed', async () => {
    h.permissions.mockResolvedValue([]);
    await expect(startUpload(ctx, { ...voiceBody, mime: 'audio/mpeg' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(startUpload(ctx, { ...voiceBody, size: 1 << 30 })).rejects.toMatchObject({
      status: 403,
    });
    expect(h.withAdminTx).not.toHaveBeenCalled();
  });

  it.each([['chat.support.contact'], ['chat.support']])(
    'holding %s passes the check and reaches the quota transaction',
    async (permission) => {
      h.permissions.mockResolvedValue([permission]);
      h.withAdminTx.mockRejectedValue(new Error('quota lane reached'));
      await expect(startUpload(ctx, voiceBody)).rejects.toThrow('quota lane reached');
      expect(h.withAdminTx).toHaveBeenCalledTimes(1);
    },
  );
});

describe('startUpload for other kinds does not ask the voice permission', () => {
  it('an image start never calls the permission seam', async () => {
    h.withAdminTx.mockRejectedValue(new Error('quota lane reached'));
    await expect(
      startUpload(ctx, { kind: 'image', purpose: 'avatar', mime: 'image/jpeg', size: 1000 }),
    ).rejects.toThrow('quota lane reached');
    expect(h.permissions).not.toHaveBeenCalled();
  });
});
