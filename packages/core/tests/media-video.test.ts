import { afterEach, describe, expect, it } from 'vitest';
import { assertProductionEnv } from '../server/env';
import {
  createFakeVideoProvider,
  FAKE_VIDEO_SIGNATURE_HEADER,
  fakeVideoInternals,
  resetFakeVideoInternals,
  signFakeVideoWebhook,
} from '../server/media/video/fake';
import { VideoProviderError, type VideoProviderEvent } from '../server/media/video/types';
import { normaliseProviderEvent } from '../server/media/video/wire';

/**
 * The `VIDEO_PROVIDER=fake` contract (MEDIA-03, RESEARCH Pitfall 7): what every non-production
 * environment and CI runs, and what the whole phase's automated proof stands on. PURE — no
 * database, no Storage, no network.
 *
 * `createDirectUpload` genuinely mints a Supabase signed upload URL and genuinely enqueues a
 * deferred synthetic ready event; both collaborators are behind the `fakeVideoInternals` seam so
 * this file can exercise the adapter's own logic (which key it signs, what event it schedules)
 * without either. `apps/api/tests/integration/mux-webhook.test.ts` runs the same code with the real
 * ones, which is what keeps "the bytes go straight to Storage" honest.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/** Records what the adapter asked its collaborators to do, instead of doing it. */
function captureSeams(): { signedKeys: string[]; scheduled: VideoProviderEvent[] } {
  const signedKeys: string[] = [];
  const scheduled: VideoProviderEvent[] = [];
  fakeVideoInternals.signUpload = async (key) => {
    signedKeys.push(key);
    return { signedUrl: `https://storage.test/object/upload/sign/media/${key}?token=t` };
  };
  fakeVideoInternals.scheduleReady = async (event) => {
    scheduled.push(event);
  };
  return { signedKeys, scheduled };
}

afterEach(() => {
  resetFakeVideoInternals();
});

describe('fake video provider — the direct-upload target', () => {
  it('is the fake, signs the ASSET OWN key and derives its upload id from the asset id', async () => {
    const { signedKeys } = captureSeams();
    const provider = createFakeVideoProvider();
    expect(provider.name).toBe('fake');

    const upload = await provider.createDirectUpload({
      assetId: ASSET,
      tenantId: TENANT,
      corsOrigin: 'http://rede-demo.localhost:3000',
      test: true,
    });

    expect(signedKeys).toEqual([`${TENANT}/media/${ASSET}/original`]);
    expect(upload.uploadUrl).toContain(`${TENANT}/media/${ASSET}/original`);
    expect(upload.providerUploadId).toBe(`fake-${ASSET}`);
  });

  it('refuses to sign a key outside the caller own tenant prefix (T-03-01/T-03-02)', async () => {
    captureSeams();
    const provider = createFakeVideoProvider();
    await expect(
      provider.createDirectUpload({
        assetId: '../../other-tenant/media/x',
        tenantId: TENANT,
        corsOrigin: 'http://rede-demo.localhost:3000',
        test: true,
      }),
    ).rejects.toThrow(/outside the tenant prefix/);
  });

  it('schedules a synthetic ready event carrying the seam duration and aspect ratio', async () => {
    const { scheduled } = captureSeams();
    fakeVideoInternals.durationSeconds = 42;
    fakeVideoInternals.aspectRatio = '9:16';

    await createFakeVideoProvider().createDirectUpload({
      assetId: ASSET,
      tenantId: TENANT,
      corsOrigin: 'http://rede-demo.localhost:3000',
      test: false,
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      kind: 'ready',
      rawType: 'video.asset.ready',
      assetId: ASSET,
      providerAssetId: `fake-${ASSET}`,
      durationSeconds: 42,
      aspectRatio: '9:16',
      failureReason: null,
    });
    expect(scheduled[0]?.playbackId).toBeTruthy();
  });
});

describe('fake video provider — verifyWebhook is a REAL HMAC check, not a no-op', () => {
  const body = JSON.stringify({
    id: 'evt-unit-1',
    type: 'video.asset.ready',
    data: {
      id: 'asset-1',
      passthrough: ASSET,
      duration: 9.6,
      aspect_ratio: '16:9',
      playback_ids: [{ id: 'pb-1' }],
    },
  });
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a body signed with the local secret and normalises it', async () => {
    const provider = createFakeVideoProvider();
    const timestamp = now();
    const event = await provider.verifyWebhook(body, {
      [FAKE_VIDEO_SIGNATURE_HEADER]: signFakeVideoWebhook(body, timestamp),
    });
    expect(event).toEqual({
      id: 'evt-unit-1',
      kind: 'ready',
      rawType: 'video.asset.ready',
      assetId: ASSET,
      providerAssetId: 'asset-1',
      playbackId: 'pb-1',
      durationSeconds: 10,
      aspectRatio: '16:9',
      failureReason: null,
    });
  });

  it('refuses a missing signature header', async () => {
    const provider = createFakeVideoProvider();
    await expect(provider.verifyWebhook(body, {})).rejects.toMatchObject({
      name: 'VideoProviderError',
      kind: 'invalid_signature',
      status: 403,
    });
  });

  it('refuses a signature computed with the WRONG secret', async () => {
    const provider = createFakeVideoProvider();
    const timestamp = now();
    // 64 hex chars of the right length but the wrong value — the compare is timing-safe, so the
    // length has to match for the comparison itself to be the thing that rejects.
    const wrong = `t=${timestamp},v1=${'a'.repeat(64)}`;
    await expect(
      provider.verifyWebhook(body, { [FAKE_VIDEO_SIGNATURE_HEADER]: wrong }),
    ).rejects.toMatchObject({ kind: 'invalid_signature' });
  });

  it('refuses a TAMPERED body, even with an otherwise valid signature', async () => {
    const provider = createFakeVideoProvider();
    const timestamp = now();
    const signature = signFakeVideoWebhook(body, timestamp);
    const tampered = body.replace('"duration":9.6', '"duration":999');
    await expect(
      provider.verifyWebhook(tampered, { [FAKE_VIDEO_SIGNATURE_HEADER]: signature }),
    ).rejects.toMatchObject({ kind: 'invalid_signature' });
  });

  it('refuses a delivery older than the 5-minute tolerance', async () => {
    const provider = createFakeVideoProvider();
    const stale = now() - 600;
    await expect(
      provider.verifyWebhook(body, {
        [FAKE_VIDEO_SIGNATURE_HEADER]: signFakeVideoWebhook(body, stale),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_signature' });
  });
});

describe('fake video provider — playback tokens and the delete recorder', () => {
  it('signPlayback returns three non-empty tokens', async () => {
    const tokens = await createFakeVideoProvider().signPlayback('pb-1', { expiresInSeconds: 7200 });
    expect(tokens.playback).toBeTruthy();
    expect(tokens.thumbnail).toBeTruthy();
    expect(tokens.storyboard).toBeTruthy();
    expect(new Set(Object.values(tokens)).size).toBe(3);
  });

  it('deleteAsset records the call on the seam, so the duration-cap path is assertable', async () => {
    const provider = createFakeVideoProvider();
    await provider.deleteAsset('asset-too-long');
    expect(fakeVideoInternals.deletedAssetIds).toEqual(['asset-too-long']);
  });
});

describe('event normalisation — the provider wire shape never reaches the job', () => {
  it('maps a ready delivery, rounding the float duration to whole seconds', () => {
    const event = normaliseProviderEvent({
      id: 'e1',
      type: 'video.asset.ready',
      data: {
        id: 'a1',
        passthrough: ASSET,
        duration: 300.49,
        aspect_ratio: '4:3',
        playback_ids: [{ id: 'pb-a' }, { id: 'pb-b' }],
      },
    });
    expect(event.kind).toBe('ready');
    expect(event.durationSeconds).toBe(300);
    expect(event.playbackId).toBe('pb-a');
    expect(event.assetId).toBe(ASSET);
  });

  it('maps video.asset.errored to a failure whose reason is the TYPE, never a provider message', () => {
    const event = normaliseProviderEvent({
      id: 'e2',
      type: 'video.asset.errored',
      data: {
        id: 'a2',
        passthrough: ASSET,
        errors: {
          type: 'invalid_input',
          messages: ['the source file is not a video: secret-token'],
        },
      },
    });
    expect(event.kind).toBe('errored');
    expect(event.failureReason).toBe('video.asset.errored');
    expect(JSON.stringify(event)).not.toContain('secret-token');
  });

  it('reads the upload passthrough from new_asset_settings on video.upload.errored', () => {
    const event = normaliseProviderEvent({
      id: 'e3',
      type: 'video.upload.errored',
      data: { id: 'upload-1', new_asset_settings: { passthrough: ASSET } },
    });
    expect(event.kind).toBe('errored');
    expect(event.assetId).toBe(ASSET);
    expect(event.providerAssetId).toBe('upload-1');
  });

  it('maps every other delivery to `ignored` — recorded and deduplicated, but applying nothing', () => {
    const event = normaliseProviderEvent({
      id: 'e4',
      type: 'video.asset.static_renditions.ready',
      data: { id: 'a4', passthrough: ASSET },
    });
    expect(event.kind).toBe('ignored');
    expect(event.playbackId).toBeNull();
    expect(event.failureReason).toBeNull();
  });

  it('refuses an envelope with no id or no type — an event we cannot deduplicate is refused', () => {
    expect(() => normaliseProviderEvent({ type: 'video.asset.ready', data: {} })).toThrow(
      VideoProviderError,
    );
    expect(() => normaliseProviderEvent({ id: 'e5', data: {} })).toThrow(VideoProviderError);
  });
});

describe('VideoProviderError carries a kind and a status and NOTHING else (T-03-41)', () => {
  it('names the kind and the status in the message', () => {
    expect(new VideoProviderError('rate_limited', 429).message).toBe(
      'video provider: rate_limited (429)',
    );
    expect(new VideoProviderError('unavailable').message).toBe('video provider: unavailable');
  });

  it('cannot carry a provider body: the constructor accepts no message argument', () => {
    // A caller that tries to smuggle a response body in gets it DROPPED — the second parameter is
    // the HTTP status, so the body never reaches the message, a log line or `failure_reason`.
    const leaked = 'Bearer mux-token-abc / another customer video';
    const error = new VideoProviderError('unauthorized', 401);
    expect(error.message).not.toContain(leaked);
    expect(error.message).toBe('video provider: unauthorized (401)');
    expect(error.kind).toBe('unauthorized');
    expect(error.status).toBe(401);
  });
});

describe('assertProductionEnv refuses a half-configured Mux selection (T-03-43)', () => {
  const base = {
    DOMAIN_PROVIDER: 'fake',
    AUTH_ALLOW_LIST: 'local',
    MAIL_TRANSPORT: 'local',
  } as const;

  const MUX_KEYS = [
    'MUX_TOKEN_ID',
    'MUX_TOKEN_SECRET',
    'MUX_SIGNING_KEY_ID',
    'MUX_SIGNING_KEY_PRIVATE',
    'MUX_WEBHOOK_SECRET',
  ] as const;

  it('names ALL FIVE missing keys when VIDEO_PROVIDER=mux', () => {
    let message = '';
    try {
      assertProductionEnv({ ...base, VIDEO_PROVIDER: 'mux' } as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Invalid kernel environment');
    for (const key of MUX_KEYS) {
      expect(message).toContain(`${key} (required when VIDEO_PROVIDER=mux)`);
    }
  });

  it('refuses a selection missing even ONE key — all five, or none', () => {
    for (const omitted of MUX_KEYS) {
      const env: Record<string, string> = { ...base, VIDEO_PROVIDER: 'mux' };
      for (const key of MUX_KEYS) if (key !== omitted) env[key] = 'set';
      expect(() => assertProductionEnv(env as never)).toThrow(
        new RegExp(`${omitted} \\(required when VIDEO_PROVIDER=mux\\)`),
      );
    }
  });

  it('accepts VIDEO_PROVIDER=mux with all five present', () => {
    const env: Record<string, string> = { ...base, VIDEO_PROVIDER: 'mux' };
    for (const key of MUX_KEYS) env[key] = 'set';
    expect(() => assertProductionEnv(env as never)).not.toThrow();
  });

  it('accepts VIDEO_PROVIDER=fake with none of them — the fail-safe default never trips', () => {
    expect(() => assertProductionEnv({ ...base, VIDEO_PROVIDER: 'fake' } as never)).not.toThrow();
  });
});
