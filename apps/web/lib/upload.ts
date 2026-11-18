import {
  BRANDING_MAX_BYTES,
  BRANDING_UPLOAD_MIMES,
  type BrandingUploadMime,
} from '@rede-social/contracts/branding';
import { MEDIA_BUCKET, MEDIA_LIMITS } from '@rede-social/contracts/media';
import { isAllowedSupabaseOrigin } from '@/lib/supabase-origin';

/**
 * Client-safe signed-upload helper (02-14 + 03-04, D-27, CLAUDE.md §4): the browser sends the bytes
 * straight to the API-minted signed Storage target — never through the API or the Next server, whose
 * 32 MiB body cap they would hit anyway.
 *
 * Three transfer shapes behind one `uploadBytes` router, because Supabase's plain PUT stops at 6 MiB
 * and a streaming provider owns its own direct-upload URL:
 *   Supabase, `file.size <= resumableThresholdBytes` → `uploadToSignedUrl` (XHR PUT, 02-14)
 *   Supabase, above it                               → `uploadResumable`  (TUS, fixed 6 MiB chunks)
 *   any other provider (`mux`, `fake`)               → `uploadChunked`    (the in-repo resumable
 *                                                      uploader: 32 MiB chunks, retry, status query)
 *
 * `normaliseImage` is the fourth piece: an iPhone HEIC — or any photo over the cap — is re-encoded to
 * JPEG in the browser BEFORE it is ever offered to the server (R-12), silently.
 *
 * `classifyFile`/`classifyMediaFile` are UX only (T-02-111): Storage enforces size/mime at PUT time
 * and the API's `complete` re-decodes the object header; a client check is never treated as proof.
 */

/** `<input accept>` value: the contracts allow-list. */
export const BRANDING_UPLOAD_ACCEPT: string = BRANDING_UPLOAD_MIMES.join(',');

const EXT_MIME: Record<string, BrandingUploadMime> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function isAcceptedMime(type: string): type is BrandingUploadMime {
  return (BRANDING_UPLOAD_MIMES as readonly string[]).includes(type);
}

/**
 * The mime `start` is asked for: the file's `type` when accepted, else the extension lookup when the
 * browser left `type` empty (common for SVG), else `null`.
 */
export function resolveMime(file: File): BrandingUploadMime | null {
  const type = file.type.toLowerCase();
  if (isAcceptedMime(type)) return type;
  if (type === '') {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    return EXT_MIME[ext] ?? null;
  }
  return null;
}

/** `'type'` (outside PNG/SVG/WebP/JPEG), `'size'` (above 2 MiB) or `null` (looks fine — UX only). */
export function classifyFile(file: File): 'type' | 'size' | null {
  if (resolveMime(file) === null) return 'type';
  if (file.size > BRANDING_MAX_BYTES) return 'size';
  return null;
}

export type UploadOutcome =
  | { ok: true }
  | { ok: false; reason: 'transfer' | 'too_large' | 'aborted' };

/**
 * PUTs `file` to `signedUrl` with `XMLHttpRequest` (fetch has no upload progress): `content-type`
 * + `x-upsert: false`, no auth header of any kind — the signed token travels inside the URL
 * (RESEARCH A10). 2xx → ok; 413 → `too_large`; any other status, network error or timeout →
 * `transfer`; `signal` aborts the request → `aborted`.
 */
export function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  // `mime` widened from `BrandingUploadMime` to `string` for the media bucket (03-04): every existing
  // caller still type-checks, and the mime is a `content-type` header, never an authorization input.
  opts: { mime: string; onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const settle = (outcome: UploadOutcome) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      xhr.abort();
      settle({ ok: false, reason: 'aborted' });
    };

    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('content-type', opts.mime);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) settle({ ok: true });
      else if (xhr.status === 413) settle({ ok: false, reason: 'too_large' });
      else settle({ ok: false, reason: 'transfer' });
    };
    xhr.onerror = () => settle({ ok: false, reason: 'transfer' });
    xhr.ontimeout = () => settle({ ok: false, reason: 'transfer' });
    xhr.onabort = () => settle({ ok: false, reason: 'aborted' });

    if (opts.signal?.aborted) {
      settle({ ok: false, reason: 'aborted' });
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(file);
  });
}

/**
 * Supabase's TUS endpoint for the project that minted `signedUrl` — the **`/sign` variant**, which is
 * the one that authenticates with a signed upload token in `x-signature`. VERIFIED against this
 * project's own storage service (`dist/http/routes/tus/lifecycle.js`: `SIGNED_URL_SUFFIX = '/sign'`,
 * and only a URL starting with `/upload/resumable/sign` reads `x-signature` at all). The bare
 * `/upload/resumable` path expects a Supabase session JWT in `authorization`, which this browser never
 * holds — sending the upload token there answers `400 Invalid Compact JWS`.
 *
 * 09.2-17 (D-538, T-09.2-86): the origin is NOT a build-time constant any more. A tenant's media lives in
 * the tenant's own project, and the API builds `signedUrl` from that project (plan 05), so the TUS
 * endpoint is the origin of the signed URL it just handed out. A signed URL whose origin is not an
 * allowed Supabase origin (`isAllowedSupabaseOrigin`: https and `<ref>.supabase.co` in production, the
 * local stack outside it) throws: the browser never sends file bytes and a token to an arbitrary host.
 */
export function tusEndpointFor(signedUrl: string): string {
  let origin: string;
  try {
    origin = new URL(signedUrl).origin;
  } catch {
    throw new Error('upload: the signed URL is not a URL');
  }
  if (!isAllowedSupabaseOrigin(origin)) throw new Error('upload: the signed URL origin is refused');
  return `${origin}/storage/v1/upload/resumable/sign`;
}

/** What `POST /v1/media/uploads` answers, narrowed to what a transfer needs (`mediaStartSchema`). */
export type StartedUpload = {
  /**
   * WHO owns the object. `supabase` means a Storage target and the 6 MiB threshold routing below;
   * anything else (`mux`, `fake` — 03-06's `VideoProvider` seam) means the provider minted its own
   * direct-upload URL and the transfer is chunked and resumable instead.
   */
  provider: string;
  signedUrl: string;
  token: string | null;
  path: string | null;
  resumableThresholdBytes: number;
};

export type TransferOptions = {
  mime: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

/**
 * Resumable upload straight to Storage with `tus-js-client` (files above 6 MiB).
 *
 * The `x-signature` header carries the signed upload TOKEN the API minted for this one object key —
 * never a Supabase session JWT, which the browser never holds (T-03-25). The token is read from the
 * action's return value and dies with this closure: it is never rendered, stored or logged.
 *
 * `findPreviousUploads`/`resumeFromPreviousUpload` run before `start()`, so a backgrounded tab (the
 * normal case on a phone) resumes instead of restarting. `tus-js-client` is imported dynamically so
 * the branding path and every screen that never uploads keep it out of their bundle.
 */
export async function uploadResumable(
  started: Pick<StartedUpload, 'token' | 'path' | 'signedUrl'>,
  file: File,
  opts: TransferOptions,
): Promise<UploadOutcome> {
  if (!started.token || !started.path) return { ok: false, reason: 'transfer' };
  let endpoint: string;
  try {
    endpoint = tusEndpointFor(started.signedUrl);
  } catch (error) {
    console.error('media.resumable_failed', { error: String(error) });
    return { ok: false, reason: 'transfer' };
  }
  const tus = await import('tus-js-client');

  return new Promise<UploadOutcome>((resolve) => {
    let settled = false;
    let highest = 0;
    let upload: InstanceType<typeof tus.Upload> | null = null;

    const settle = (outcome: UploadOutcome) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    function onAbort() {
      void upload?.abort();
      settle({ ok: false, reason: 'aborted' });
    }

    upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { 'x-signature': started.token as string, 'x-upsert': 'false' },
      // EXACTLY 6 MiB: Supabase's TUS server refuses any other chunk size (RESEARCH Pitfall 3).
      // Lowering it to smooth the progress bar BREAKS the upload — smoothness comes from the
      // interpolation below, never from smaller chunks.
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: MEDIA_BUCKET,
        objectName: started.path as string,
        contentType: opts.mime,
        cacheControl: '3600',
      },
      onProgress: (sent: number, total: number) => {
        if (!opts.onProgress || total <= 0) return;
        const percent = Math.min(100, Math.round((sent / total) * 100));
        // Monotonic by construction: a chunk retry re-sends bytes, and the bar must never walk back.
        if (percent <= highest) return;
        highest = percent;
        opts.onProgress(percent);
      },
      onError: (error: Error) => {
        // The raw reason goes to the console only; the member sees the catalog string (T-02-147).
        console.error('media.resumable_failed', { error: String(error) });
        settle({ ok: false, reason: 'transfer' });
      },
      onSuccess: () => settle({ ok: true }),
    });

    if (opts.signal?.aborted) {
      settle({ ok: false, reason: 'aborted' });
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (settled) return;
        const resumable = previous[0];
        if (resumable) upload?.resumeFromPreviousUpload(resumable);
        upload?.start();
      })
      .catch((error: unknown) => {
        console.error('media.resumable_failed', { error: String(error) });
        settle({ ok: false, reason: 'transfer' });
      });
  });
}

/**
 * Bytes per chunk request of the chunked direct upload. 32 MiB is a multiple of the 256 KiB the
 * provider requires (128 of them); only the LAST chunk may be smaller. Compared with the old 5 MiB
 * slices it is 6.4 times fewer sequential round trips, and a failed chunk re-sends at most 32 MiB. A
 * `file.slice` Blob is a lazy reference into the file, never a copy, so the size costs no memory.
 */
export const CHUNKED_CHUNK_BYTES = 32 * 1024 * 1024;

/**
 * Wait before the next attempt after the n-th consecutive failure (n-th entry, the last entry repeats):
 * 1, 2, 4, 8, 16 then 30 s. Twelve failures add up to about four minutes of waiting.
 */
export const CHUNKED_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * Consecutive failed attempts, with no newly committed byte in between, after which the upload gives
 * up as a `transfer` failure. The counter resets whenever the committed offset passes its previous
 * high-water mark.
 */
export const CHUNKED_MAX_FAILURES = 12;

/**
 * A request that makes no upload progress for this long is treated as dead (a half-open connection
 * after a laptop sleeps or a network change never errors on its own) and retried like status 0.
 */
export const CHUNKED_STALL_MS = 120_000;

/**
 * Keeps the screen awake while a long upload runs (a phone that locks stops the transfer). Every call
 * is feature-detected and guarded: the API is absent on older browsers and a request can be refused,
 * and none of that may ever affect the upload. The browser drops the lock when the tab is hidden, so
 * it is asked for again when the tab becomes visible. Returns the function that gives it back.
 */
function holdScreenAwake(): () => void {
  const wakeLock = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;
  if (!wakeLock) return () => {};
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;
  let released = false;
  const drop = (lock: WakeLockSentinel) => {
    try {
      Promise.resolve(lock.release()).catch(() => {});
    } catch {}
  };
  const acquire = () => {
    if (pending) return;
    try {
      pending = true;
      wakeLock.request('screen').then(
        (lock) => {
          pending = false;
          if (released) drop(lock);
          else sentinel = lock;
        },
        () => {
          pending = false;
        },
      );
    } catch {
      pending = false;
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  acquire();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    if (sentinel) drop(sentinel);
  };
}

/** One request's answer: HTTP status (0 = no answer), the `Range` header if readable, a short note. */
type ChunkAnswer = { status: number; range: string | null; detail: string };

/** `bytes=0-N` of a 308 `Range` header → N, or null when absent, unreadable or malformed. */
function parseCommittedRange(range: string | null): number | null {
  const match = /^bytes=0-(\d+)$/i.exec((range ?? '').trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Resumable, chunked upload to a streaming provider's own direct-upload URL (MEDIA-03, R-04). The
 * bytes go browser -> provider and never touch Cloud Run.
 *
 * It replaces a third-party chunk-upload library that treated any network-level failure as final
 * (one dropped request restarted a multi-hour, multi-GB upload from zero), gave a failing request only
 * about five seconds of retries and could not ask the server how much it had persisted.
 *
 * Protocol (the provider's resumable session): a PUT per chunk with `Content-Range: bytes s-e/total`,
 * a 308 whose `Range: bytes=0-N` says N+1 bytes are persisted, a 2xx meaning the object is complete.
 * Each request carries exactly two request headers, `Content-Type` and `Content-Range`, so the CORS
 * preflight stays the small one the provider already answers.
 *
 * - Chunks are `CHUNKED_CHUNK_BYTES`; every ATTEMPT reads a FRESH `file.slice(start, end)`, a Blob is
 *   never kept across attempts and the file is never copied into memory.
 * - A readable `Range` of ANY 308 is trusted as the committed offset, behind or ahead of the chunk
 *   sent. Whether the provider exposes `Range` to the browser through CORS is not verified, so a 308
 *   with no readable `Range` on a data chunk advances by the chunk just sent (what the old library
 *   did) and on a status query keeps the last known offset.
 * - A network failure (status 0), a stalled request (`CHUNKED_STALL_MS`), 408, 429 and any 5xx are
 *   retried with `CHUNKED_BACKOFF_MS`. Before re-sending, the uploader asks the server for the
 *   committed offset (an empty PUT whose `Content-Range` is an unknown range over the total) and resumes from it; when
 *   that answer is inconclusive it resends from the last known offset. After `CHUNKED_MAX_FAILURES`
 *   consecutive failures with no new byte it gives up as `transfer`. A 413 is `too_large`, every
 *   other 4xx is fatal at once.
 * - While `navigator.onLine` is false it pauses without counting a failure and continues on the
 *   `online` event. `signal` aborts the request and every timer and listener.
 * - Progress is an integer percent that never walks back across a retry; 100 only at success.
 * - The one raw log line carries a short reason only, never the URL (a bearer capability), a header
 *   or the file name. The member sees the catalog sentence.
 */
export function uploadChunked(
  uploadUrl: string,
  file: File,
  opts: Pick<TransferOptions, 'onProgress' | 'signal'>,
): Promise<UploadOutcome> {
  const total = file.size;
  if (total <= 0) {
    console.error('media.chunked_failed', { error: 'empty file; committed=0/0; attempts=0' });
    return Promise.resolve({ ok: false, reason: 'transfer' });
  }
  if (opts.signal?.aborted) return Promise.resolve({ ok: false, reason: 'aborted' });

  return new Promise<UploadOutcome>((resolve) => {
    let settled = false;
    let committed = 0;
    let highest = 0;
    let failures = 0;
    let sends = 0;
    let reported = 0;
    let needQuery = false;
    // What the current wait (backoff timer, online wait, in-flight request) installs, so ONE abort
    // handler can stop whatever is pending.
    let cancel: (() => void) | null = null;
    const releaseScreen = holdScreenAwake();

    const settle = (outcome: UploadOutcome) => {
      if (settled) return;
      settled = true;
      const stop = cancel;
      cancel = null;
      stop?.();
      opts.signal?.removeEventListener('abort', onAbort);
      releaseScreen();
      resolve(outcome);
    };
    function onAbort() {
      settle({ ok: false, reason: 'aborted' });
    }
    const giveUp = (reason: 'transfer' | 'too_large', detail: string) => {
      console.error('media.chunked_failed', {
        error: `${detail}; committed=${committed}/${total}; attempts=${sends}`,
      });
      settle({ ok: false, reason });
    };
    const succeed = () => {
      reported = 100;
      opts.onProgress?.(100);
      settle({ ok: true });
    };
    // Every assignment of `committed` goes through here: a new high-water mark resets the failures.
    const commit = (offset: number) => {
      committed = Math.max(0, Math.min(offset, total));
      if (committed > highest) {
        highest = committed;
        failures = 0;
      }
    };
    // Monotonic across retries and resumes, and never 100 before success.
    const report = (bytes: number) => {
      const percent = Math.min(99, Math.floor((bytes / total) * 100));
      if (percent <= reported) return;
      reported = percent;
      opts.onProgress?.(percent);
    };
    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

    const sleep = (ms: number) =>
      new Promise<void>((done) => {
        const timer = setTimeout(() => {
          cancel = null;
          done();
        }, ms);
        cancel = () => {
          clearTimeout(timer);
          done();
        };
      });
    const untilOnline = () =>
      new Promise<void>((done) => {
        const onOnline = () => {
          window.removeEventListener('online', onOnline);
          cancel = null;
          done();
        };
        window.addEventListener('online', onOnline);
        cancel = () => {
          window.removeEventListener('online', onOnline);
          done();
        };
      });

    // One PUT. `body` null is the empty status query. Resolves exactly once.
    const send = (contentRange: string, body: Blob | null, base: number, span: number) =>
      new Promise<ChunkAnswer>((done) => {
        const xhr = new XMLHttpRequest();
        let over = false;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const finish = (answer: ChunkAnswer) => {
          if (over) return;
          over = true;
          clearTimeout(watchdog);
          cancel = null;
          done(answer);
        };
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            finish({ status: 0, range: null, detail: 'stalled' });
            xhr.abort();
          }, CHUNKED_STALL_MS);
        };
        cancel = () => {
          over = true;
          clearTimeout(watchdog);
          xhr.abort();
          done({ status: 0, range: null, detail: 'aborted' });
        };
        try {
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.setRequestHeader('Content-Range', contentRange);
          xhr.upload.onprogress = (event) => {
            arm();
            report(base + Math.min(event.loaded, span));
          };
          xhr.upload.onload = arm;
          xhr.onload = () =>
            finish({
              status: xhr.status,
              range: xhr.getResponseHeader('Range'),
              detail: `status ${xhr.status}`,
            });
          xhr.onerror = () => finish({ status: 0, range: null, detail: 'network error' });
          xhr.ontimeout = () => finish({ status: 0, range: null, detail: 'timeout' });
          xhr.onabort = () => finish({ status: 0, range: null, detail: 'aborted' });
          arm();
          if (body) xhr.send(body);
          else xhr.send();
        } catch {
          finish({ status: 0, range: null, detail: 'send failed' });
        }
      });

    // A failed attempt: count it (unless the browser is offline), give up at the budget, else back off.
    const failed = async (detail: string) => {
      needQuery = true;
      if (isOffline()) return;
      failures += 1;
      if (failures >= CHUNKED_MAX_FAILURES) {
        giveUp('transfer', detail);
        return;
      }
      const last = CHUNKED_BACKOFF_MS.length - 1;
      await sleep(CHUNKED_BACKOFF_MS[Math.min(failures - 1, last)] ?? 30000);
    };

    const run = async () => {
      while (!settled) {
        while (isOffline() && !settled) await untilOnline();
        if (settled) return;

        if (needQuery) {
          needQuery = false;
          const query = await send(`bytes */${total}`, null, 0, 0);
          if (settled) return;
          if (query.status >= 200 && query.status < 300) return succeed();
          if (query.status === 308) {
            const last = parseCommittedRange(query.range);
            if (last !== null) commit(last + 1);
          }
          // Anything else is inconclusive: keep the last known offset and resend from it. A session
          // that really expired answers the resend with a fatal 4xx.
        }

        if (committed >= total) {
          // The server says everything is there but never answered 2xx: ask again after a backoff.
          await failed('status 308 without completion');
          continue;
        }

        const start = committed;
        const end = Math.min(start + CHUNKED_CHUNK_BYTES, total);
        sends += 1;
        // A FRESH slice for every attempt, built here and never kept.
        const answer = await send(
          `bytes ${start}-${end - 1}/${total}`,
          file.slice(start, end),
          start,
          end - start,
        );
        if (settled) return;

        const { status } = answer;
        if (status >= 200 && status < 300) return succeed();
        if (status === 308) {
          const last = parseCommittedRange(answer.range);
          commit(last !== null ? last + 1 : end);
          report(committed);
          if (committed > start) continue;
          await failed('status 308 without progress');
          continue;
        }
        if (status === 413) return giveUp('too_large', 'status 413');
        if (status !== 0 && status !== 408 && status !== 429 && status < 500 && status >= 400) {
          return giveUp('transfer', `status ${status}`);
        }
        await failed(status === 0 ? `status 0 (${answer.detail})` : `status ${status}`);
      }
    };

    opts.signal?.addEventListener('abort', onAbort, { once: true });
    run().catch((error: unknown) => {
      giveUp('transfer', `unexpected ${error instanceof Error ? error.name : 'error'}`);
    });
  });
}

/**
 * The transfer router.
 *
 * A `supabase`-brokered object keeps 03-04's threshold routing (plain PUT at or below
 * `resumableThresholdBytes`, TUS above it); the boundary belongs to the SERVER's answer, not to a
 * client constant, so a later change to Supabase's ceiling moves in one place.
 *
 * Any OTHER provider owns its own storage (03-06's `VideoProvider` seam), so the destination is its
 * direct-upload URL and the transfer is chunked and resumable regardless of size — a phone video is
 * never small enough for a single PUT to be the kind thing to do.
 */
export async function uploadBytes(
  started: StartedUpload,
  file: File,
  opts: TransferOptions,
): Promise<UploadOutcome> {
  if (started.provider === 'supabase') {
    return file.size <= started.resumableThresholdBytes
      ? uploadToSignedUrl(started.signedUrl, file, opts)
      : uploadResumable(started, file, opts);
  }
  return uploadChunked(started.signedUrl, file, opts);
}

/** What the browser re-encodes TO — the one format every target decodes (R-12). */
const NORMALISED_MIME = 'image/jpeg';

/** The image mimes a member may upload (03-01's avatar allow-list is the narrowest of them). */
const DEFAULT_IMAGE_MIMES: readonly string[] = MEDIA_LIMITS.image.avatar?.mimes ?? [];

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // An <img> ELEMENT, never `createImageBitmap`: the element inherits the browser's default
    // `image-orientation: from-image`, so EXIF rotation is applied by the decoder itself and this
    // app needs no EXIF parser (RESEARCH A1). The worker's `sharp(...).rotate()` is the second line.
    const img = document.createElement('img');
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

/**
 * Re-encodes a picked photo to JPEG at `maxSide` — the invisible half of R-12.
 *
 * Returns the ORIGINAL `File` instance untouched when it is already an allow-listed mime, under
 * `maxBytes` and under `maxSide`: the common case costs one decode and no re-encode, and the caller
 * can prove it by identity.
 *
 * REJECTS when the decode or `canvas.toBlob` fails, so the caller renders "Não foi possível preparar
 * esta imagem." instead of silently uploading something the server would refuse. That rejection is
 * the ONLY way a HEIC photo can ever surface an error to the member.
 */
export async function normaliseImage(
  file: File,
  opts: { maxBytes: number; maxSide?: number; quality?: number; mimes?: readonly string[] },
): Promise<File> {
  const { maxBytes, maxSide = 2048, quality = 0.85, mimes = DEFAULT_IMAGE_MIMES } = opts;
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    const allowed = mimes.includes(file.type.toLowerCase());
    if (allowed && file.size <= maxBytes && side <= maxSide) return file;

    const scale = side > maxSide ? maxSide / side : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, NORMALISED_MIME, quality);
    });
    if (!blob) throw new Error('canvas encode failed');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: NORMALISED_MIME });
  } finally {
    URL.revokeObjectURL(url);
  }
}
