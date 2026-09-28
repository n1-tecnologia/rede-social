import { env } from '../../env';
import { registerJobQueues } from '../../jobs/boss';
import { createFakeVideoProvider } from './fake';
import { createMuxVideoProvider } from './mux';
import { MEDIA_PROVIDER_EVENT_QUEUE, type VideoProvider } from './types';

/**
 * Env-selected singleton (T-02-59, the `domains/index.ts` shape): the fail-safe default is the LOCAL
 * implementation, and a real selection without its credentials already failed at import in `env.ts`
 * (`assertProductionEnv`). Configuration is read ONLY through the kernel `env` module, never through
 * the raw Node environment, so the selection is validated once and the secrets never leave this
 * file's callers.
 *
 * Imported as `@rede-social/core/server/media/video/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 */

/**
 * `assertProductionEnv()` already refused a `mux` selection without these five values at import
 * time, so a missing one here is a programming error, not a deploy error — but it still fails with a
 * named message instead of a `!` assertion that would let `undefined` reach an Authorization header.
 */
function requireEnv(
  name:
    | 'MUX_TOKEN_ID'
    | 'MUX_TOKEN_SECRET'
    | 'MUX_SIGNING_KEY_ID'
    | 'MUX_SIGNING_KEY_PRIVATE'
    | 'MUX_WEBHOOK_SECRET',
): string {
  const value = env[name];
  if (!value)
    throw new Error(`${name} is required by the selected adapter (see assertProductionEnv)`);
  return value;
}

export const videoProvider: VideoProvider =
  env.VIDEO_PROVIDER === 'mux'
    ? createMuxVideoProvider({
        tokenId: requireEnv('MUX_TOKEN_ID'),
        tokenSecret: requireEnv('MUX_TOKEN_SECRET'),
        signingKeyId: requireEnv('MUX_SIGNING_KEY_ID'),
        signingKeyPrivate: requireEnv('MUX_SIGNING_KEY_PRIVATE'),
        webhookSecret: requireEnv('MUX_WEBHOOK_SECRET'),
      })
    : createFakeVideoProvider();

// `kernel.media-provider-event` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). Every enqueue path
// (the webhook route, the fake's simulated transcode) imports this barrel at module top, so the
// API's lazy `startedBoss()` always knows the queue before the first `send`; the worker creates it
// from its explicit job list.
registerJobQueues([MEDIA_PROVIDER_EVENT_QUEUE]);

export type {
  VideoAssetInfo,
  VideoDirectUpload,
  VideoDirectUploadInput,
  VideoPlaybackTokens,
  VideoProvider,
  VideoProviderErrorKind,
  VideoProviderEvent,
  VideoProviderEventKind,
  VideoProviderName,
} from './types';
export {
  MEDIA_PROVIDER_EVENT_QUEUE,
  VIDEO_UPLOAD_TTL_S,
  VIDEO_WEBHOOK_TOLERANCE_S,
  VideoProviderError,
} from './types';
