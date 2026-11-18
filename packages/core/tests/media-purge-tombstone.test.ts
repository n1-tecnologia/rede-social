import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.5 review WR-02 (D-868): the purge tombstone is for a voice RECORDING only. A foreign-key refusal
 * (SQLSTATE 23503) of an audio row keeps the row as a tombstone; the same refusal of an image, a file or a
 * video still throws, so the sweeper logs `media.sweep.purge_failed` and an operator sees a dangling reference.
 *
 * The admin transaction lane and the three storage functions are mocked: no database, no Storage.
 */

const h = vi.hoisted(() => ({
  withAdminTx: vi.fn(),
  listObjects: vi.fn(),
  removeObjects: vi.fn(),
  invalidateSignedUrl: vi.fn(),
}));

vi.mock('../db/admin-tx', () => ({
  withAdminTx: h.withAdminTx,
}));

vi.mock('../server/rbac/permissions', () => ({
  permissionsForRequest: vi.fn(),
}));

vi.mock('../server/media/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/media/storage')>()),
  listObjects: h.listObjects,
  removeObjects: h.removeObjects,
  invalidateSignedUrl: h.invalidateSignedUrl,
}));

const { purgeAsset } = await import('../server/media/service');

const TENANT = '00000000-0000-4000-8000-000000000002';
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const KEY = `${TENANT}/media/${ASSET}/original`;

const refusal = () => Object.assign(new Error('fk violation'), { code: '23503' });

const row = (kind: string) => ({ id: ASSET, tenantId: TENANT, kind, providerAssetId: null });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.listObjects.mockResolvedValue([KEY]);
  h.removeObjects.mockResolvedValue(undefined);
});

describe('purgeAsset tombstone is audio-only (WR-02)', () => {
  it.each(['image', 'file', 'video'])(
    'WR-02: a 23503 on a %s row propagates and opens ONE admin transaction (no tombstone)',
    async (kind) => {
      const error = refusal();
      h.withAdminTx.mockRejectedValueOnce(error);

      await expect(purgeAsset(row(kind))).rejects.toBe(error);

      expect(h.withAdminTx).toHaveBeenCalledTimes(1);
      // The objects are removed before the row delete: the order in the docblock is the contract.
      expect(h.removeObjects).toHaveBeenCalledWith([KEY]);
    },
  );

  it('an audio row refused with 23503 is kept as a tombstone: purged, TWO admin transactions', async () => {
    h.withAdminTx.mockRejectedValueOnce(refusal()).mockResolvedValueOnce(undefined);

    await expect(purgeAsset(row('audio'))).resolves.toEqual({ purged: true, objects: 1 });

    expect(h.withAdminTx).toHaveBeenCalledTimes(2);
    expect(h.removeObjects).toHaveBeenCalledWith([KEY]);
  });

  it.each(['audio', 'image'])('any other error still throws for %s', async (kind) => {
    const error = Object.assign(new Error('connection lost'), { code: '08006' });
    h.withAdminTx.mockRejectedValueOnce(error);

    await expect(purgeAsset(row(kind))).rejects.toBe(error);

    expect(h.withAdminTx).toHaveBeenCalledTimes(1);
  });
});
