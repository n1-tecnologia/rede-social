'use client';

import { mediaAcceptFor } from '@tria/contracts/media';
import { Button, FileDropZone } from '@tria/ui';
import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSignedUpload } from '@/components/media/useSignedUpload';

export interface VideoUploadFieldProps {
  /**
   * The provider accepted the bytes and the asset exists server-side as `pending`. There is no
   * confirmed payload to hand over (the provider owns the object and its webhook is what moves the
   * row to `ready`), so the library re-reads its first page and the new row appears with the real
   * `Processando` pill rather than a fabricated one.
   */
  onUploaded: (assetId: string) => void | Promise<void>;
}

/** MP4 and QuickTime — the exact pair `MEDIA_LIMITS.video.post` allows; never a hand-written list. */
const ACCEPT = mediaAcceptFor('video', 'post');
/** Announced at these percentages only — not on every tick (UI-SPEC §Motion & Accessibility). */
const QUARTILES = [25, 50, 75, 100];

/**
 * The admin media screen's upload zone (UI-SPEC §Admin media step 1, §Upload contract).
 *
 * It REUSES `useSignedUpload` unchanged rather than forking it: the same six-state machine the photo
 * zone runs, pointed at `{ kind: 'video', purpose: 'post' }`. What differs is entirely inside
 * `lib/upload.ts`'s router — a provider-owned object travels through `@mux/upchunk` in 5 MiB slices
 * with retries and `308`-continue semantics, so a dropped mobile connection resumes instead of
 * restarting a 100 MB video, and the bytes never pass through Cloud Run (MEDIA-01, R-04).
 *
 * A file the picker never offered is refused AT PICK TIME with the video-specific sentence and costs
 * no request at all; the zone keeps its own verdict here (`screen` defaults to `true`) because,
 * unlike a photo, there is nothing a browser re-encode could do to rescue a `.gif`.
 */
export function VideoUploadField({ onUploaded }: VideoUploadFieldProps) {
  const t = useTranslations('media');

  const upload = useSignedUpload({
    kind: 'video',
    purpose: 'post',
    successKey: 'toasts.videoQueued',
    onHandedToProvider: onUploaded,
    // Unreachable for a video (the provider owns the object, so there is no `complete` call), but
    // the hook's contract requires it and an empty function would hide a future routing mistake.
    onCompleted: (asset) => onUploaded(asset.id),
  });

  const uploading = upload.state === 'progress' || upload.state === 'processing';
  const announced = QUARTILES.includes(upload.progress)
    ? t('progress', { percent: upload.progress })
    : '';

  return (
    <div className="flex flex-col gap-2 px-4 md:px-0" data-testid="video-upload">
      {/* The message renders INSIDE the zone's `error` slot, which the primitive itself emits as
          `<p role="alert" class="text-sm text-danger">` (packages/ui/src/primitives/FileDropZone.tsx)
          — the announcement is the primitive's, so there is exactly one alert region on the zone. */}
      <FileDropZone
        id="video-dropzone"
        icon={Camera}
        accept={ACCEPT}
        state={uploading ? (upload.state as 'progress' | 'processing') : 'idle'}
        progress={upload.progress}
        error={upload.error ?? undefined}
        onFile={(file) => void upload.pick(file)}
        onReject={(reason) => upload.reject(reason)}
        labels={{
          caption: t('video.dropzone'),
          progress: (percent) => t('progress', { percent }),
          processing: t('video.processing'),
        }}
      />

      {upload.error ? (
        <Button type="button" variant="ghost" size="sm" onClick={upload.reset}>
          {t('retry')}
        </Button>
      ) : null}

      {upload.state === 'progress' ? (
        <Button type="button" variant="ghost" size="md" onClick={upload.cancel}>
          {t('cancel')}
        </Button>
      ) : (
        <Button
          type="button"
          variant="brand"
          fullWidth
          disabled={uploading}
          onClick={() => document.getElementById('video-dropzone')?.click()}
        >
          {uploading ? t('library.uploading', { percent: upload.progress }) : t('library.upload')}
        </Button>
      )}

      {/* Quartiles only: a per-tick live region would read the whole upload out loud. */}
      <span aria-live="polite" className="sr-only">
        {announced}
      </span>
    </div>
  );
}
