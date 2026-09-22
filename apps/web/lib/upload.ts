import {
  BRANDING_MAX_BYTES,
  BRANDING_UPLOAD_MIMES,
  type BrandingUploadMime,
} from '@tria/contracts/branding';
import { MEDIA_BUCKET, MEDIA_LIMITS } from '@tria/contracts/media';

/**
 * Client-safe signed-upload helper (02-14 + 03-04, D-27, CLAUDE.md §4): the browser sends the bytes
 * straight to the API-minted signed Storage target — never through the API or the Next server, whose
 * 32 MiB body cap they would hit anyway.
 *
 * Two transfer shapes behind one `uploadBytes` router, because Supabase's plain PUT stops at 6 MiB:
 *   `file.size <= resumableThresholdBytes` → `uploadToSignedUrl` (XHR PUT, 02-14)
 *   above it                               → `uploadResumable`  (TUS, fixed 6 MiB chunks)
 *
 * `normaliseImage` is the third piece: an iPhone HEIC — or any photo over the cap — is re-encoded to
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
 * Supabase's TUS endpoint — the **`/sign` variant**, which is the one that authenticates with a
 * signed upload token in `x-signature`. VERIFIED against this project's own storage service
 * (`dist/http/routes/tus/lifecycle.js`: `SIGNED_URL_SUFFIX = '/sign'`, and only a URL starting with
 * `/upload/resumable/sign` reads `x-signature` at all). The bare `/upload/resumable` path expects a
 * Supabase session JWT in `authorization`, which this browser never holds — sending the upload token
 * there answers `400 Invalid Compact JWS`.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time, so this is a plain string in the bundle — and
 * it is the ONLY Supabase origin the browser talks to for an upload.
 */
export const SUPABASE_TUS_ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable/sign`;

/** What `POST /v1/media/uploads` answers, narrowed to what a transfer needs (`mediaStartSchema`). */
export type StartedUpload = {
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
  started: Pick<StartedUpload, 'token' | 'path'>,
  file: File,
  opts: TransferOptions,
): Promise<UploadOutcome> {
  if (!started.token || !started.path) return { ok: false, reason: 'transfer' };
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
      endpoint: SUPABASE_TUS_ENDPOINT,
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
 * The threshold router: the plain PUT at or below `resumableThresholdBytes` (6 MiB), TUS above it.
 * The boundary belongs to the SERVER's answer, not to a client constant, so a later change to
 * Supabase's ceiling moves in one place.
 */
export async function uploadBytes(
  started: StartedUpload,
  file: File,
  opts: TransferOptions,
): Promise<UploadOutcome> {
  return file.size <= started.resumableThresholdBytes
    ? uploadToSignedUrl(started.signedUrl, file, opts)
    : uploadResumable(started, file, opts);
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
