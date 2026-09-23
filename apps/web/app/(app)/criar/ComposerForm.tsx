'use client';

import {
  MEDIA_LIMITS,
  type MediaStatus,
  mediaAcceptFor,
  PURPOSE_WIDTHS,
} from '@tria/contracts/media';
import {
  createPostSchema,
  FEED_MAX_ATTACHMENTS,
  FEED_MAX_CAPTION,
  FEED_MAX_IMAGES,
  firstUrlIn,
  updatePostSchema,
} from '@tria/module-feed/contracts';
import {
  Button,
  ConfirmDialog,
  FileDropZone,
  IconButton,
  PageHeader,
  Textarea,
  useToast,
} from '@tria/ui';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Images,
  Link2,
  Paperclip,
  Video,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { createPostAction } from '@/app/(app)/criar/actions';
// The SAME action the card's overflow menu drives, imported from where it lives: a `'use server'`
// module cannot re-export another one (Turbopack drops the re-export), so the import is direct.
import { updatePostAction } from '@/app/(app)/inicio/feed-actions';
import { MediaImage } from '@/components/media/MediaImage';
import { formatMediaLimit, useSignedUpload } from '@/components/media/useSignedUpload';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import type { ComposerDraft } from '@/lib/feed-view';

/**
 * THE composer (FEED-01 / FEED-03, D-57, UI-SPEC §Composer contract) — one form component, two
 * routes: `/criar` in `create` mode and `/post/[postId]/editar` in `edit` mode, pre-filled. The only
 * things that differ between them are the header title, the submit's label and which action runs.
 *
 * **A full-screen ROUTE, never a bottom sheet** (D-57). Picking several photos, waiting on an
 * upload, watching a link row appear and attaching a PDF do not fit a sheet with the mobile
 * keyboard up — and a long video upload must not live in a layer a stray drag can dismiss.
 *
 * **ZERO UPLOAD CODE LIVES HERE.** Every byte path is the Phase 3 machine: `useSignedUpload` picks,
 * re-encodes a phone photo in the browser, brokers a signed target and sends the bytes STRAIGHT to
 * Storage — the resumable path above 6 MiB, and the provider-owned branch that skips `complete` for
 * a vendor-hosted video. Nothing in this file constructs an upload URL, a TUS session or a Storage
 * request; what it holds is a list of asset IDS (T-04-59: no file byte ever passes through the API,
 * which is also why Cloud Run's 32 MiB body cap is irrelevant to publishing a 400 MB video).
 *
 * **The publishable rule is IMPORTED, not re-expressed.** `createPostSchema` is the same schema the
 * Hono route validates the body with, so "a caption OR at least one asset" is literally one
 * definition shared by the disabled submit and the API's refusal (FEED-01/empty).
 *
 * **Gallery XOR video is enforced three times over and this file is the friendliest of them**
 * (D-53): choosing one picker disables the other and reveals the helper line; the schema refuses
 * the shape; and `feed_post_media_kind_fk` refuses it at the database for a caller that never saw
 * this screen.
 *
 * **Publish rules while media is in flight** (UI-SPEC E14/partial): a post whose VIDEO is still
 * transcoding IS publishable — it enters the feed in the Phase 3 `processando` state — while a post
 * whose IMAGE is still uploading is NOT: the submit waits with its pending label rather than
 * sending a half-uploaded asset id the API would refuse as `asset_not_usable`.
 *
 * **Upload refusals are the Phase 3 copy verbatim**, read from the `media` catalog namespace by the
 * hook itself. This phase adds none of its own (UI-SPEC §Copywriting Contract, "upload refusals").
 */
export type ComposerMode = 'create' | 'edit';

export type ComposerFormProps = {
  mode: ComposerMode;
  /** Edit mode only: which post is being saved. */
  postId?: string;
  /** Edit mode only: the post as it stands, mapped by `lib/feed-view.tsx`. */
  initial?: ComposerDraft;
  /**
   * The tenant's display name, interpolated into the caption placeholder (UI-D-46). Both routes
   * that render this form already hold the bootstrap, so this is a value passed DOWN rather than a
   * second read: a client component may not reach for the tenant of record on its own.
   */
  tenantName: string;
};

type PickedImage = {
  assetId: string;
  /** An object URL from the picked File — the preview never waits for the variant ladder. */
  previewUrl: string | null;
  variantWidths: number[];
};

type PickedVideo = { assetId: string; status: MediaStatus };

type PickedAttachment = {
  assetId: string;
  filename: string;
  typeLabel: string;
  sizeLabel: string | null;
};

const EMPTY_DRAFT: ComposerDraft = {
  caption: '',
  images: [],
  video: null,
  attachments: [],
  hasLinkPreview: false,
};

/** Binary sizes in pt-BR, the `feed-view` rule restated for a file the browser has not sent yet. */
const sizeFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${sizeFormat.format(unit === 0 ? Math.round(value) : value)} ${SIZE_UNITS[unit]}`;
}

const IMAGE_ACCEPT = mediaAcceptFor('image', 'post');
const VIDEO_ACCEPT = mediaAcceptFor('video', 'post');
const FILE_ACCEPT = mediaAcceptFor('file', 'attachment');

export function ComposerForm({
  mode,
  postId,
  initial = EMPTY_DRAFT,
  tenantName,
}: ComposerFormProps) {
  const t = useTranslations('feed');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const [caption, setCaption] = useState(initial.caption);
  const [images, setImages] = useState<PickedImage[]>(() =>
    initial.images.map((image) => ({ ...image, previewUrl: null })),
  );
  const [video, setVideo] = useState<PickedVideo | null>(initial.video);
  const [attachments, setAttachments] = useState<PickedAttachment[]>(initial.attachments);
  /** UI-D-11: the row is dismissible, and dismissing it is the WHOLE remove-preview affordance. */
  const [linkRemoved, setLinkRemoved] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | undefined>(undefined);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pending, startTransition] = useTransition();

  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The object URL of the file currently in flight, claimed by `onCompleted` a moment later. */
  const pendingPreview = useRef<string | null>(null);

  const clearErrors = useCallback(() => {
    setFormError(null);
    setCaptionError(undefined);
    setMediaError(null);
  }, []);

  const imageUpload = useSignedUpload({
    kind: 'image',
    purpose: 'post',
    // No per-file toast: the thumbnail appearing in the grid is the confirmation, and three photos
    // would otherwise stack three notifications over a form still being filled in.
    successKey: null,
    onPicked: (file) => {
      pendingPreview.current = URL.createObjectURL(file);
    },
    onCompleted: (asset) => {
      const previewUrl = pendingPreview.current;
      pendingPreview.current = null;
      setImages((previous) =>
        previous.length >= FEED_MAX_IMAGES
          ? previous
          : [
              ...previous,
              {
                assetId: asset.id,
                previewUrl,
                variantWidths: asset.variants.map((variant) => variant.width),
              },
            ],
      );
      clearErrors();
    },
  });

  const videoUpload = useSignedUpload({
    kind: 'video',
    purpose: 'post',
    successKey: 'toasts.videoQueued',
    // 03-06's provider branch: the bytes belong to the streaming provider, the row is already
    // `pending` server-side and its webhook is what moves it to `ready`. There is nothing to
    // confirm here, which is exactly why D-53 lets the post publish while the transcode runs.
    onHandedToProvider: (assetId) => {
      setVideo({ assetId, status: 'processing' });
      clearErrors();
    },
    onCompleted: (asset) => {
      setVideo({ assetId: asset.id, status: asset.status });
      clearErrors();
    },
  });

  const fileUpload = useSignedUpload({
    kind: 'file',
    purpose: 'attachment',
    successKey: null,
    onCompleted: (asset) => {
      setAttachments((previous) =>
        previous.length >= FEED_MAX_ATTACHMENTS
          ? previous
          : [
              ...previous,
              {
                assetId: asset.id,
                filename: asset.filename ?? '',
                typeLabel:
                  asset.mime === 'application/pdf'
                    ? t('attachment.type.pdf')
                    : t('attachment.type.other'),
                sizeLabel: formatBytes(asset.bytes),
              },
            ],
      );
      clearErrors();
    },
  });

  const uploads = [imageUpload, videoUpload, fileUpload];
  /**
   * Any transfer in flight blocks the submit (E14/partial). The video's TRANSCODE is deliberately
   * not in here: the hook has already reached `done` by then, which is how "publish while the video
   * processes" and "wait while a photo uploads" come out of one condition.
   */
  const uploading = uploads.some(
    (upload) =>
      upload.state === 'preparing' || upload.state === 'progress' || upload.state === 'processing',
  );

  const galleryChosen = images.length > 0;
  const videoChosen = video !== null;
  const trimmedCaption = caption.trim();
  const publishable =
    trimmedCaption.length > 0 || galleryChosen || videoChosen || attachments.length > 0;

  /** UI-D-11: the row appears once the CAPTION carries a URL, and it stays for a post that has one. */
  const showLinkRow =
    !linkRemoved && (firstUrlIn(caption) !== null || (mode === 'edit' && initial.hasLinkPreview));

  const dirty = useMemo(() => {
    if (caption !== initial.caption) return true;
    if (images.length !== initial.images.length) return true;
    if (images.some((image, index) => image.assetId !== initial.images[index]?.assetId))
      return true;
    if ((video?.assetId ?? null) !== (initial.video?.assetId ?? null)) return true;
    if (attachments.length !== initial.attachments.length) return true;
    if (attachments.some((file, index) => file.assetId !== initial.attachments[index]?.assetId)) {
      return true;
    }
    return linkRemoved;
  }, [caption, images, video, attachments, linkRemoved, initial]);

  /** Several files, one hook: `pick` resolves before the next call, so the queue runs in order. */
  const pickImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        await imageUpload.pick(file);
      }
    },
    [imageUpload],
  );

  const onImageInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0) void pickImages(files);
  };

  const removeImage = (assetId: string) => {
    setImages((previous) => {
      const gone = previous.find((image) => image.assetId === assetId);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return previous.filter((image) => image.assetId !== assetId);
    });
    clearErrors();
  };

  /**
   * The reorder affordance, and its ONLY effect is to reorder the asset-id array the API receives:
   * `imageAssetIds[i]` becomes `position = i` server-side, so the gallery's order is the array's
   * order and there is no separate position field to keep in sync.
   *
   * Two 44×44 controls rather than the mockup's drag grip: a pointer-only drag is unreachable by
   * keyboard and unassertable in a spec, and moving one slide at a time says the same thing.
   */
  const moveImage = (index: number, delta: number) => {
    setImages((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
      return next;
    });
  };

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(mode === 'edit' && postId ? `/post/${postId}` : '/inicio');
  };

  /** Exhaustive over what the action can answer: a new refusal code cannot compile without copy. */
  const messageFor = (code: string): string => {
    switch (code) {
      case 'empty_post':
        return t('composer.errors.empty');
      case 'too_many_images':
        return t('composer.errors.tooManyImages', { limit: FEED_MAX_IMAGES });
      case 'too_many_attachments':
        return t('composer.errors.tooManyAttachments', { limit: FEED_MAX_ATTACHMENTS });
      case 'gallery_and_video':
        return t('composer.errors.galleryAndVideo');
      case 'asset_not_usable':
        return t('composer.errors.assetNotUsable');
      case 'not_found':
        return t('composer.errors.notFound');
      default:
        return t('composer.errors.publish');
    }
  };

  const submit = () => {
    clearErrors();
    startTransition(async () => {
      const imageAssetIds = images.map((image) => image.assetId);
      const attachmentAssetIds = attachments.map((file) => file.assetId);

      // The EDIT body is a full replacement of the media set (see `updatePostSchema`): the composer
      // holds the complete post on screen, so it sends what the post should BE rather than a diff
      // the server would have to reconstruct. `linkPreviewId: null` is the remove affordance.
      const body =
        mode === 'edit'
          ? updatePostSchema.safeParse({
              caption: trimmedCaption,
              imageAssetIds,
              videoAssetId: video?.assetId ?? null,
              attachmentAssetIds,
              ...(linkRemoved ? { linkPreviewId: null } : {}),
            })
          : createPostSchema.safeParse({
              caption: trimmedCaption,
              ...(imageAssetIds.length > 0 ? { imageAssetIds } : {}),
              ...(video ? { videoAssetId: video.assetId } : {}),
              ...(attachmentAssetIds.length > 0 ? { attachmentAssetIds } : {}),
              // An empty string is "no preview, thank you": `new URL('')` throws inside the SSRF
              // guard, so the create path needs no second field for the remove affordance.
              ...(linkRemoved ? { linkUrl: '' } : {}),
            });

      if (!body.success) {
        const empty = body.error.issues.some((issue) => issue.message === 'empty_post');
        if (empty) setCaptionError(t('composer.errors.empty'));
        setFormError(empty ? t('composer.errors.empty') : t('composer.errors.publish'));
        return;
      }

      const result =
        mode === 'edit' && postId
          ? await updatePostAction(postId, body.data)
          : await createPostAction(body.data);

      if (result.ok) {
        toast.show({
          tone: 'success',
          message: mode === 'edit' ? t('toasts.saved') : t('toasts.created'),
        });
        router.push(`/post/${result.postId}`);
        return;
      }

      if (result.code === 'empty_post') setCaptionError(t('composer.errors.empty'));
      if (
        result.code === 'too_many_images' ||
        result.code === 'gallery_and_video' ||
        result.code === 'too_many_attachments' ||
        result.code === 'asset_not_usable'
      ) {
        setMediaError(messageFor(result.code));
      }
      setFormError(messageFor(result.code));
    });
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('composer.saving')
      : t('composer.publishing')
    : mode === 'edit'
      ? t('composer.save')
      : t('composer.publish');

  const busy = pending || uploading;

  /** One row for a mobile picker; the desktop breakpoint swaps it for a `FileDropZone`. */
  const pickerRow = (
    icon: typeof Images,
    label: string,
    onPick: () => void,
    disabled: boolean,
    testId: string,
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={onPick}
        disabled={disabled}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg-tertiary text-text-tertiary">
          <Icon aria-hidden size={20} />
        </span>
        <span className="text-sm font-bold text-text">{label}</span>
      </button>
    );
  };

  return (
    <form
      data-composer
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('composer.editTitle') : t('composer.createTitle')}
        backIcon={X}
        backLabel={t('composer.close')}
        onBack={close}
        stickyTop="0px"
        className="md:static md:px-0"
        trailing={
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={!publishable || busy}
            loading={busy}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-4 md:px-6">
        {/* E14/error: a server refusal is an alert-role card at the TOP of the form, never a toast —
            the admin has to be able to see which field it is about without the message vanishing. */}
        {formError ? (
          <p
            role="alert"
            data-composer-error
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
          >
            {formError}
          </p>
        ) : null}

        <Textarea
          id="composer-caption"
          name="caption"
          aria-label={t('composer.captionLabel')}
          placeholder={t('composer.captionPlaceholder', { tenant: tenantName })}
          value={caption}
          rows={4}
          maxLength={FEED_MAX_CAPTION}
          counter={{ value: caption.length, max: FEED_MAX_CAPTION }}
          error={captionError}
          // E14/long-text: the field grows to its content and the PAGE scrolls; the cap and its
          // counter (which turns destructive at the limit, inside the primitive) bound it.
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => {
            setCaption(event.target.value);
            setCaptionError(undefined);
          }}
        />

        {/* ── Media: two mutually exclusive pickers (D-53) ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            aria-label={t('composer.addPhotos')}
            onChange={onImageInput}
          />
          <input
            ref={videoInput}
            type="file"
            accept={VIDEO_ACCEPT}
            className="sr-only"
            aria-label={t('composer.addVideo')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void videoUpload.pick(file);
            }}
          />

          <div className="flex flex-col gap-2 md:hidden">
            {pickerRow(
              Images,
              t('composer.addPhotos'),
              () => imageInput.current?.click(),
              videoChosen || busy || images.length >= FEED_MAX_IMAGES,
              'composer-add-photos',
            )}
            {pickerRow(
              Video,
              t('composer.addVideo'),
              () => videoInput.current?.click(),
              galleryChosen || videoChosen || busy,
              'composer-add-video',
            )}
          </div>

          {/* Desktop swaps the rows for the shipped drop zones (UI-SPEC §Composer contract, body 2). */}
          <div className="hidden gap-4 md:grid md:grid-cols-2">
            <FileDropZone
              id="composer-photos-dropzone"
              icon={Images}
              accept={IMAGE_ACCEPT}
              // The hook owns the verdict: a dropped phone photo or an over-cap image is re-encoded
              // in the browser (R-12), so the zone must not refuse it first.
              screen={false}
              disabled={videoChosen || images.length >= FEED_MAX_IMAGES}
              state={imageUpload.state === 'progress' ? 'progress' : 'idle'}
              progress={imageUpload.progress}
              onFile={(file) => void imageUpload.pick(file)}
              labels={{
                caption: t('composer.addPhotos'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('photo.preparing'),
              }}
            />
            <FileDropZone
              id="composer-video-dropzone"
              icon={Video}
              accept={VIDEO_ACCEPT}
              disabled={galleryChosen || videoChosen}
              state={
                videoUpload.state === 'progress' || videoUpload.state === 'processing'
                  ? videoUpload.state
                  : 'idle'
              }
              progress={videoUpload.progress}
              onFile={(file) => void videoUpload.pick(file)}
              onReject={(reason) => videoUpload.reject(reason)}
              labels={{
                caption: t('composer.addVideo'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('video.processing'),
              }}
            />
          </div>

          {/* D-53's helper, revealed exactly when one kind has disabled the other. */}
          {galleryChosen || videoChosen ? (
            <p data-composer-exclusive className="text-xs font-normal text-text-secondary">
              {t('composer.mediaHelper')}
            </p>
          ) : null}

          {mediaError ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {mediaError}
            </p>
          ) : null}

          {/* Phase 3's refusal copy, verbatim from the `media` namespace — this phase adds none. */}
          {imageUpload.error ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {imageUpload.error}
            </p>
          ) : null}
          {videoUpload.error ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {videoUpload.error}
            </p>
          ) : null}

          {imageUpload.state === 'progress' || imageUpload.state === 'preparing' ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs tabular-nums text-text-tertiary">
                {tm('progress', { percent: imageUpload.progress })}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={imageUpload.cancel}>
                {tm('cancel')}
              </Button>
            </div>
          ) : null}

          {/* E14/zero-one-many: ONE picked photo renders in the same grid as ten — a single image is
              never special-cased into a large preview, so the geometry never changes under the
              admin as they add the second one. E14/overflow: the tiles wrap and the page scrolls. */}
          {images.length > 0 ? (
            <ul
              aria-label={t('composer.photosRegion')}
              data-composer-thumbs
              className="grid grid-cols-3 gap-2"
            >
              {images.map((image, index) => (
                <li
                  key={image.assetId}
                  className="relative aspect-square overflow-hidden rounded-xl bg-bg-tertiary"
                >
                  {image.previewUrl ? (
                    /* A local object URL has no asset route to derive a ladder from, and it is
                       revoked the moment the tile is removed — `next/image` has nothing to optimise
                       here and would only defer the preview the admin just asked to see. */
                    // biome-ignore lint/performance/noImgElement: local object URL, see above
                    <img
                      src={image.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      decoding="async"
                    />
                  ) : (
                    <MediaImage
                      assetId={image.assetId}
                      widths={
                        image.variantWidths.length > 0 ? image.variantWidths : PURPOSE_WIDTHS.post
                      }
                      alt=""
                      sizes="33vw"
                      ratio="aspect-square"
                      className="h-full w-full"
                    />
                  )}
                  <IconButton
                    icon={X}
                    size={16}
                    label={t('composer.removePhoto')}
                    onClick={() => removeImage(image.assetId)}
                    className="absolute top-1 right-1 bg-black/45 text-white hover:bg-black/60"
                  />
                  {index > 0 ? (
                    <IconButton
                      icon={ChevronLeft}
                      size={16}
                      label={t('composer.movePhotoLeft')}
                      onClick={() => moveImage(index, -1)}
                      className="absolute bottom-1 left-1 bg-black/45 text-white hover:bg-black/60"
                    />
                  ) : null}
                  {index < images.length - 1 ? (
                    <IconButton
                      icon={ChevronRight}
                      size={16}
                      label={t('composer.movePhotoRight')}
                      onClick={() => moveImage(index, 1)}
                      className="absolute right-1 bottom-1 bg-black/45 text-white hover:bg-black/60"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The video preview IS the Phase 3 player, so its `processando` and `falhou` states are
              the ones the card will show — never a second rendering of the same two facts. */}
          {video ? (
            <div data-composer-video className="flex flex-col gap-2">
              <VideoPlayer assetId={video.assetId} status={video.status} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-danger"
                onClick={() => {
                  setVideo(null);
                  clearErrors();
                }}
              >
                {t('composer.removeVideo')}
              </Button>
            </div>
          ) : null}
        </div>

        {/* ── UI-D-11: inert copy plus a remove control. There is no preview to show yet, and no
            override: an admin may DROP a card, never hand-write one that looks like the site's. ── */}
        {showLinkRow ? (
          <div
            data-composer-link-row
            className="flex items-center gap-3 rounded-xl border border-border px-3 py-3"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg-tertiary text-text-tertiary">
              <Link2 aria-hidden size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-text-secondary">
                {t('linkPreview.composer.label')}
              </span>
              <span className="block text-xs font-normal text-text-tertiary">
                {t('linkPreview.composer.body')}
              </span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLinkRemoved(true)}>
              {t('linkPreview.composer.remove')}
            </Button>
          </div>
        ) : null}

        {/* ── Attachments ──────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={FILE_ACCEPT}
            className="sr-only"
            aria-label={t('composer.addFile')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void fileUpload.pick(file);
            }}
          />
          {pickerRow(
            Paperclip,
            t('composer.addFile'),
            () => fileInput.current?.click(),
            busy || attachments.length >= FEED_MAX_ATTACHMENTS,
            'composer-add-file',
          )}

          {fileUpload.error ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {fileUpload.error}
            </p>
          ) : null}

          {attachments.length > 0 ? (
            <ul aria-label={t('composer.attachmentsRegion')} className="flex flex-col gap-2">
              {attachments.map((file) => (
                <li
                  key={file.assetId}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border px-3 py-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg-tertiary text-text-tertiary">
                    <FileText aria-hidden size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text">
                      {file.filename}
                    </span>
                    <span className="block text-xs tabular-nums text-text-tertiary">
                      {file.sizeLabel === null
                        ? file.typeLabel
                        : `${file.typeLabel} · ${file.sizeLabel}`}
                    </span>
                  </span>
                  <IconButton
                    icon={X}
                    size={20}
                    label={t('composer.removeAttachment')}
                    onClick={() =>
                      setAttachments((previous) =>
                        previous.filter((row) => row.assetId !== file.assetId),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs font-normal text-text-secondary">
            {t('composer.attachmentHelper', {
              limit: formatMediaLimit(MEDIA_LIMITS.file.attachment?.maxBytes ?? 0),
            })}
          </p>
        </div>
      </div>

      {/* E18: all four strings are FIXED — no caption, filename or comment body is ever quoted into
          a destructive confirmation (T-04-58). */}
      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('composer.discard.title')}
        body={t('composer.discard.body')}
        confirmLabel={t('composer.discard.confirm')}
        cancelLabel={t('composer.discard.cancel')}
        onConfirm={() => router.push(mode === 'edit' && postId ? `/post/${postId}` : '/inicio')}
        onClose={() => setDiscarding(false)}
      />
    </form>
  );
}
