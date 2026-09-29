import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Mux adapter's reconciliation lookup (quick-260929-ltf), with the SDK mocked — no network, no
 * credentials. Production runs Mux, not the fake, so the mapping from `uploads.retrieve` /
 * `assets.retrieve` onto `VideoUploadState` is pinned here rather than trusted: a wrong mapping would
 * make every reconciliation a silent no-op (or worse, a wrong transition).
 */

const { uploadsRetrieve, assetsRetrieve } = vi.hoisted(() => ({
  uploadsRetrieve: vi.fn(),
  assetsRetrieve: vi.fn(),
}));

vi.mock('@mux/mux-node', () => ({
  Mux: class {
    video = {
      uploads: { retrieve: uploadsRetrieve },
      assets: { retrieve: assetsRetrieve },
    };
  },
}));

const { createMuxVideoProvider } = await import('../server/media/video/mux');
const { VideoProviderError } = await import('../server/media/video/types');

const provider = createMuxVideoProvider({
  tokenId: 'test-token-id',
  tokenSecret: 'test-token-secret',
  signingKeyId: 'test-signing-key-id',
  signingKeyPrivate: 'test-signing-key-private',
  webhookSecret: 'test-webhook-secret',
});

const LOOKUP = { timeout: 4000, maxRetries: 0 };

beforeEach(() => {
  uploadsRetrieve.mockReset();
  assetsRetrieve.mockReset();
});

describe('mux getUploadState — the reconciliation lookup (quick-260929-ltf)', () => {
  it('M1: an upload with an asset answers the mapped asset, both reads bounded', async () => {
    uploadsRetrieve.mockResolvedValue({ id: 'up1', status: 'asset_created', asset_id: 'as1' });
    assetsRetrieve.mockResolvedValue({
      id: 'as1',
      status: 'ready',
      duration: 12.4,
      aspect_ratio: '9:16',
      playback_ids: [{ id: 'pb1' }],
    });

    await expect(provider.getUploadState('up1')).resolves.toEqual({
      state: 'asset',
      asset: {
        providerAssetId: 'as1',
        status: 'ready',
        playbackId: 'pb1',
        durationSeconds: 12,
        aspectRatio: '9:16',
      },
    });
    expect(uploadsRetrieve).toHaveBeenCalledWith('up1', LOOKUP);
    expect(assetsRetrieve).toHaveBeenCalledWith('as1', LOOKUP);
  });

  it.each(['waiting', 'timed_out', 'cancelled'])(
    'M2: an upload %s with no asset answers waiting and reads no asset',
    async (status) => {
      uploadsRetrieve.mockResolvedValue({ id: 'up1', status });
      await expect(provider.getUploadState('up1')).resolves.toEqual({ state: 'waiting' });
      expect(assetsRetrieve).not.toHaveBeenCalled();
    },
  );

  it('M3: an errored upload with no asset answers errored', async () => {
    uploadsRetrieve.mockResolvedValue({ id: 'up1', status: 'errored' });
    await expect(provider.getUploadState('up1')).resolves.toEqual({ state: 'errored' });
    expect(assetsRetrieve).not.toHaveBeenCalled();
  });

  it('M4: a preparing asset stays preparing, an errored asset is errored', async () => {
    uploadsRetrieve.mockResolvedValue({ id: 'up1', status: 'asset_created', asset_id: 'as1' });

    assetsRetrieve.mockResolvedValueOnce({ id: 'as1', status: 'preparing', playback_ids: [] });
    const preparing = await provider.getUploadState('up1');
    expect(preparing.state === 'asset' && preparing.asset.status).toBe('preparing');

    assetsRetrieve.mockResolvedValueOnce({ id: 'as1', status: 'errored' });
    const errored = await provider.getUploadState('up1');
    expect(errored.state === 'asset' && errored.asset.status).toBe('errored');
  });

  it('M5: SDK failures become a VideoProviderError carrying only kind and status', async () => {
    uploadsRetrieve.mockRejectedValueOnce({ status: 404, body: 'secret body with a token' });
    const notFound = await provider.getUploadState('up1').catch((error: unknown) => error);
    expect(notFound).toBeInstanceOf(VideoProviderError);
    expect((notFound as InstanceType<typeof VideoProviderError>).kind).toBe('not_found');

    uploadsRetrieve.mockRejectedValueOnce({ status: 500, body: 'secret body with a token' });
    const unavailable = await provider.getUploadState('up1').catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(VideoProviderError);
    const mapped = unavailable as InstanceType<typeof VideoProviderError>;
    expect(mapped.kind).toBe('unavailable');
    expect(mapped.message).not.toContain('body');
    expect(mapped.message).not.toContain('token');
  });
});
