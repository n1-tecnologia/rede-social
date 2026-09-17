import {
  BRANDING_MAX_BYTES,
  BRANDING_UPLOAD_MIMES,
  type BrandingUploadMime,
} from '@tria/contracts/branding';

/**
 * Client-safe signed-upload helper (02-14, D-27, CLAUDE.md §4): the browser PUTs the bytes straight
 * to the API-minted signed Storage URL — never through the API or the Next server. The 2 MiB
 * branding cap keeps every upload under the 6 MB plain-PUT threshold, so there is no TUS here;
 * Phase 3 adds the resumable TUS branch (6 MB chunks, `x-signature`) behind the same
 * `uploadToSignedUrl` signature for the private media bucket.
 *
 * `classifyFile` is UX only (T-02-111): Storage enforces size/mime at PUT time and the API's
 * `complete` re-validates the object; the panel never treats a client check as proof.
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
  opts: { mime: BrandingUploadMime; onProgress?: (percent: number) => void; signal?: AbortSignal },
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
