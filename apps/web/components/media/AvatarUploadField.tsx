'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@tria/contracts/media';
import { Avatar, Button, ConfirmDialog, FileDropZone, useToast } from '@tria/ui';
import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { removeAvatarAction, setAvatarAction } from '@/app/(app)/perfil/actions';
import { MediaImage } from '@/components/media/MediaImage';
import { useSignedUpload } from '@/components/media/useSignedUpload';

export interface AvatarUploadFieldProps {
  displayName: string;
  avatarAssetId: string | null;
  /** Told whenever the committed photo changes, so the surrounding form can follow it. */
  onChanged?: (assetId: string | null) => void;
}

const ACCEPT = mediaAcceptFor('image', 'avatar');
/** Announced at these percentages only — not on every tick (UI-SPEC §Motion & Accessibility). */
const QUARTILES = [25, 50, 75, 100];

/**
 * The photo block of `/perfil/editar` (UI-SPEC §Edit profile step 1, §Upload contract).
 *
 * The picker declares only JPEG/PNG/WebP, so the iPhone's own photo formats are never offered as a
 * choice; a photo outside that list is re-encoded in the browser before the upload starts, which is
 * why picking a phone photo produces no warning and no format mention anywhere on this screen.
 *
 * The upload COMMITS ON ITS OWN (`setAvatarAction` right after `complete`), independently of
 * "Salvar alterações": a member who only changes their photo never submits the form. The local
 * preview appears the instant a file is picked, so the avatar never waits for the worker.
 */
export function AvatarUploadField({
  displayName,
  avatarAssetId,
  onChanged,
}: AvatarUploadFieldProps) {
  const t = useTranslations('profile');
  const tm = useTranslations('media');
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const [assetId, setAssetId] = useState(avatarAssetId);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  /** Drops the local preview: an upload that was cancelled or refused never becomes the avatar. */
  const clearPreview = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
  }, []);

  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'avatar',
    successKey: 'toasts.photoUpdated',
    onPicked: (file) => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = URL.createObjectURL(file);
      setPreview(previewRef.current);
    },
    onCompleted: async (asset) => {
      const applied = await setAvatarAction(asset.id);
      // A refused commit is NOT a success: throwing hands it to the hook's WR-07 boundary, which
      // renders the generic message instead of a toast claiming the photo changed.
      if (!applied.ok) throw new Error(`setAvatar refused: ${applied.code}`);
      setAssetId(asset.id);
      onChanged?.(asset.id);
    },
  });

  // The object URL outlives the picked File only until the component unmounts.
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  // A refused upload must not leave a photo on screen that the server never accepted.
  useEffect(() => {
    if (upload.state === 'error') clearPreview();
  }, [upload.state, clearPreview]);

  const uploading = upload.state === 'preparing' || upload.state === 'progress';
  const announced = QUARTILES.includes(upload.progress)
    ? tm('progress', { percent: upload.progress })
    : '';

  const remove = async () => {
    setRemoving(true);
    try {
      const result = await removeAvatarAction();
      if (!result.ok) {
        toast.show({ tone: 'error', message: tm('errors.generic') });
        return;
      }
      clearPreview();
      setAssetId(null);
      onChanged?.(null);
      upload.reset();
      toast.show({ tone: 'success', message: t('toasts.photoRemoved') });
    } catch (error) {
      console.error('profile.avatar_remove_failed', { error: String(error) });
      toast.show({ tone: 'error', message: tm('errors.generic') });
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  };

  const photo = preview ? (
    <Avatar size="xl" src={preview} alt={displayName} />
  ) : assetId ? (
    <MediaImage
      assetId={assetId}
      widths={PURPOSE_WIDTHS.avatar}
      baseWidth={320}
      alt={displayName}
      sizes="80px"
      eager
      ratio="aspect-square"
      className="h-20 w-20 shrink-0 rounded-full"
      fallback={<Avatar size="xl" alt={displayName} />}
    />
  ) : (
    <Avatar size="xl" alt={displayName} />
  );

  return (
    <div
      data-photo-field
      aria-busy={uploading || undefined}
      className="flex flex-col items-center gap-3"
    >
      {photo}

      {/* Phone: a tap target under the avatar. Desktop (md:): the dashed zone, which also accepts a drop. */}
      <div className="flex flex-col items-center gap-2 md:hidden">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={t('edit.photo.change')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload.pick(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {t('edit.photo.change')}
        </Button>
      </div>

      <div className="hidden w-full max-w-sm md:block">
        <FileDropZone
          id="avatar-dropzone"
          icon={Camera}
          accept={ACCEPT}
          // The hook owns the verdict: a dropped phone photo or an over-cap image is re-encoded
          // here in the browser (R-12), so the zone must not refuse it first.
          screen={false}
          state={
            upload.state === 'progress' || upload.state === 'processing' ? upload.state : 'idle'
          }
          progress={upload.progress}
          onFile={(file) => void upload.pick(file)}
          labels={{
            caption: t('edit.photo.dropzone'),
            progress: (percent) => tm('progress', { percent }),
            processing: tm('photo.preparing'),
          }}
        />
      </div>

      {upload.state === 'preparing' ? (
        <p className="text-xs text-text-tertiary">{tm('photo.preparing')}</p>
      ) : null}

      {upload.state === 'progress' ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.progress}
            className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-text-tertiary">
            {tm('progress', { percent: upload.progress })}
          </span>
          {/* `size="md"` is 44px high: the cancel control is a real touch target in the tab order. */}
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => {
              upload.cancel();
              clearPreview();
            }}
          >
            {tm('cancel')}
          </Button>
        </div>
      ) : null}

      {/* Quartiles only: a per-tick live region would read the whole upload out loud. */}
      <span aria-live="polite" className="sr-only">
        {announced}
      </span>

      {upload.error ? (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-center text-sm text-danger">
            {upload.error}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={upload.reset}>
            {tm('retry')}
          </Button>
        </div>
      ) : (
        <p className="max-w-xs text-center text-xs text-text-tertiary">{t('edit.photo.helper')}</p>
      )}

      {assetId && !uploading ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={() => setConfirming(true)}
        >
          {t('edit.photo.remove')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t('confirm.removePhoto.title')}
        body={t('confirm.removePhoto.body')}
        confirmLabel={t('confirm.removePhoto.confirm')}
        cancelLabel={t('confirm.removePhoto.cancel')}
        onConfirm={remove}
        onClose={() => {
          if (!removing) setConfirming(false);
        }}
        onError={(error) => {
          console.error('profile.avatar_remove_failed', { error: String(error) });
          toast.show({ tone: 'error', message: tm('errors.generic') });
        }}
      />
    </div>
  );
}
