import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Mux adapter's reconciliation lookup (quick-260929-ltf), with the SDK mocked — no network, no
 * credentials. Production runs Mux, not the fake, so the mapping from `uploads.retrieve` /
 * `assets.retrieve` onto `VideoUploadState` is pinned here rather than trusted: a wrong mapping would
 * make every reconciliation a silent no-op (or worse, a wrong transition).
 */

const { uploadsRetrieve, assetsRetrieve, uploadsCreate } = vi.hoisted(() => ({
  uploadsRetrieve: vi.fn(),
  assetsRetrieve: vi.fn(),
  uploadsCreate: vi.fn(),
}));

vi.mock('@mux/mux-node', () => ({
  Mux: class {
    video = {
      uploads: { retrieve: uploadsRetrieve, create: uploadsCreate },
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
  uploadsCreate.mockReset();
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

describe('mux createDirectUpload — the passthrough carries the tenant (09.2-10, DBT-13)', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const ASSET = '22222222-2222-4222-8222-222222222222';

  it('P1: sends <tenantId>:<assetId> as the passthrough, 73 characters, far below the 255 cap', async () => {
    uploadsCreate.mockResolvedValue({ id: 'up1', url: 'https://upload.example/up1' });
    await provider.createDirectUpload({
      assetId: ASSET,
      tenantId: TENANT,
      corsOrigin: 'https://comunidade.example',
      test: true,
    });
    const params = uploadsCreate.mock.calls[0]?.[0] as {
      new_asset_settings: { passthrough: string; playback_policies: string[] };
    };
    expect(params.new_asset_settings.passthrough).toBe(`${TENANT}:${ASSET}`);
    expect(params.new_asset_settings.passthrough).toHaveLength(73);
    expect(params.new_asset_settings.passthrough.length).toBeLessThan(255);
    // The guard rails are untouched by the new passthrough.
    expect(params.new_asset_settings.playback_policies).toEqual(['signed']);
  });

  it('P2: the passthrough the adapter sends is exactly what the wire normaliser reads back', async () => {
    const { normaliseProviderEvent } = await import('../server/media/video/wire');
    uploadsCreate.mockResolvedValue({ id: 'up1', url: 'https://upload.example/up1' });
    await provider.createDirectUpload({
      assetId: ASSET,
      tenantId: TENANT,
      corsOrigin: 'https://comunidade.example',
      test: false,
    });
    const params = uploadsCreate.mock.calls[0]?.[0] as {
      new_asset_settings: { passthrough: string };
    };
    const sent = params.new_asset_settings.passthrough;
    const event = normaliseProviderEvent({
      id: 'e1',
      type: 'video.upload.errored',
      data: { id: 'up1', new_asset_settings: { passthrough: sent } },
    });
    expect(event.tenantId).toBe(TENANT);
    expect(event.assetId).toBe(ASSET);
  });
});
