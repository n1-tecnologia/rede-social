import type {
  CompleteBrandingUploadResult,
  completeBrandingUploadAction,
  startBrandingUploadAction,
} from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import { classifyFile, resolveMime, uploadToSignedUrl } from '@/lib/upload';

/** The two server actions of a signed upload (start mints the URL, complete records the object). */
export type UploadActions = {
  start: typeof startBrandingUploadAction;
  complete: typeof completeBrandingUploadAction;
};

/** Every way one branding upload can fail, in the vocabulary the zones translate. */
export type BrandingUploadFailure =
  | 'type'
  | 'size'
  | 'transfer'
  | Extract<CompleteBrandingUploadResult, { ok: false }>['code'];

export type BrandingUploadOutcome =
  | { ok: true; view: BrandingView }
  | { ok: false; code: BrandingUploadFailure };

/**
 * One signed upload of a tenant's logo or square icon (02-14, D-27): `classifyFile` (UX gate, no
 * request on a wrong type or size) → `start` → the browser PUTs straight to Storage → `complete`.
 * The signed URL lives in this call for the duration of the PUT only (T-02-110). Shared by the
 * tenant page's zones (`useSignedUpload`) and by the new-tenant wizard, which holds the files until
 * the tenant is created and then uploads them with this same sequence.
 */
export async function runBrandingUpload({
  tenantId,
  kind,
  file,
  actions,
  onProgress,
  onProcessing,
}: {
  tenantId: string;
  kind: 'logo' | 'icon';
  file: File;
  actions: UploadActions;
  onProgress?: (percent: number) => void;
  /** The bytes arrived; the API is verifying and deriving the icons. */
  onProcessing?: () => void;
}): Promise<BrandingUploadOutcome> {
  const rejected = classifyFile(file);
  if (rejected) return { ok: false, code: rejected };
  const mime = resolveMime(file);
  if (!mime) return { ok: false, code: 'type' };

  const started = await actions.start(tenantId, { kind, mime, size: file.size });
  if (!started.ok) return { ok: false, code: started.code };

  const put = await uploadToSignedUrl(started.upload.signedUrl, file, { mime, onProgress });
  if (!put.ok) return { ok: false, code: put.reason === 'too_large' ? 'size' : 'transfer' };

  onProcessing?.();
  const completed = await actions.complete(tenantId, started.upload.uploadId);
  if (!completed.ok) return { ok: false, code: completed.code };
  return { ok: true, view: completed.view };
}

/** The catalog key (`platformBranding.errors.*`) of a failure. */
export function brandingUploadErrorKey(code: BrandingUploadFailure): string {
  return {
    type: 'errors.type',
    size: 'errors.size',
    transfer: 'errors.transfer',
    not_an_image: 'errors.notAnImage',
    format_mismatch: 'errors.formatMismatch',
    svg_unsafe: 'errors.svgUnsafe',
    too_large: 'errors.size',
    object_missing: 'errors.objectMissing',
    generic: 'errors.generic',
  }[code];
}
