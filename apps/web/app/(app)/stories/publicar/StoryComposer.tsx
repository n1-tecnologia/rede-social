'use client';

import { MEDIA_LIMITS, mediaAcceptFor } from '@tria/contracts/media';
import {
  STORY_MAX_CAPTION,
  type StoryIssue,
  type StoryMediaKind,
} from '@tria/module-stories/contracts';
import { Button, ConfirmDialog, FileDropZone, IconButton, PageHeader, useToast } from '@tria/ui';
import { Image as ImageIcon, Loader, Video, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { publishStoryAction } from '@/app/(app)/stories/story-actions';
import { useSignedUpload } from '@/components/media/useSignedUpload';

/**
 * STORY-01's publish screen (UI-D-39, D-81) — ONE full-screen route with TWO states.
 *
 * **Before a pick the screen is neutral**: there is nothing to frame yet, so it is the standard
 * `PageHeader` and two pickers. **After a pick the screen goes BLACK and becomes a live preview of
 * the story** — the same frame a member will see, with the caption as a transparent field overlaid
 * at the bottom. That is not decoration: composing inside the real frame is the only affordance that
 * prevents a cropped or unreadable story, and a story is NOT editable after publishing (D-81), so
 * the caption is part of the publish step rather than something to fix later.
 *
 * **ZERO UPLOAD CODE LIVES HERE.** Every byte path is the Phase 3 machine: `useSignedUpload` picks,
 * re-encodes a phone photo in the browser, brokers a signed target and sends the bytes STRAIGHT to
 * Storage — or hands a video to the streaming vendor through the branch that skips `complete`
 * entirely. Nothing in this file constructs an upload URL, a TUS session or a Storage request; what
 * it holds is ONE asset id. The caps are READ from `MEDIA_LIMITS` and never redeclared.
 *
 * **Upload refusals are the Phase 3 copy verbatim**, read from the `media` catalog namespace by the
 * hook itself. This phase adds none of its own — including the ~60 s refusal, which is `media`'s
 * duration sentence with its own `{duration}` interpolated (UI-SPEC §Copywriting Contract).
 *
 * **The duration cap is enforced ASYNCHRONOUSLY and the copy says so** (Pitfall 5). The pick-time
 * gate is UX; the authority is the worker, which can only measure a video once the vendor reports it
 * ready. So publishing a video is allowed while it transcodes: the row is created immediately, the
 * strip filters it out until the asset is ready, and the note states plainly that the 24 h window
 * starts at PUBLISH — the alternative is silently losing story life.
 */

export interface StoryComposerProps {
  /** Where the header's trailing text action points (05-08 creates the destination). */
  historyHref: string;
}

/** What the admin picked: the brokered asset, its kind, and a LOCAL preview of the real bytes. */
type Picked = { assetId: string; kind: StoryMediaKind; previewUrl: string | null };

/** Announced at these percentages only — not on every tick (UI-SPEC §Motion & Accessibility). */
const QUARTILES = [25, 50, 75, 100];

const PHOTO_INPUT_ID = 'story-photo-input';
const VIDEO_INPUT_ID = 'story-video-input';

const PHOTO_ACCEPT = mediaAcceptFor('image', 'story');
const VIDEO_ACCEPT = mediaAcceptFor('video', 'story');

/**
 * "45 s" / "1 min" from the CONTRACT's own number — never a literal in the copy (UI-D-05).
 *
 * The `>= 60 -> minutes` rule is `useSignedUpload`'s `messageFor` verbatim, deliberately: that
 * function formats the duration REFUSAL from the same `MEDIA_LIMITS` entry, so the number a member
 * is promised here and the number they are refused with cannot be rounded two different ways. The
 * approved drawing shows "60 s"; the shipped refusal says "1 min", and one of the two had to give —
 * consistency with the sentence a member reads at the moment of failure won.
 */
function durationLabel(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
}

export function StoryComposer({ historyHref }: StoryComposerProps) {
  const t = useTranslations('stories');
  const tm = useTranslations('media');
  const router = useRouter();
  const toast = useToast();

  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [busy, startPublish] = useTransition();
  /** The object URL currently held, so it is revoked exactly once when it is replaced or dropped. */
  const preview = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  const take = (kind: StoryMediaKind) => (assetId: string) => {
    setFormError(null);
    setPicked((current) => ({ assetId, kind, previewUrl: current?.previewUrl ?? null }));
  };

  /** The local preview: the REAL bytes the hook is about to send, so nothing is re-downloaded. */
  const previewFile = (file: File) => {
    if (preview.current) URL.revokeObjectURL(preview.current);
    const url = URL.createObjectURL(file);
    preview.current = url;
    setPicked((current) => (current ? { ...current, previewUrl: url } : null));
    // The pick lands BEFORE the asset id exists, so the frame can paint while the bytes travel.
    setPicked((current) => current ?? { assetId: '', kind: 'image', previewUrl: url });
  };

  const photo = useSignedUpload({
    kind: 'image',
    purpose: 'story',
    successKey: null,
    onPicked: previewFile,
    onCompleted: (asset) => take('image')(asset.id),
  });

  const video = useSignedUpload({
    kind: 'video',
    purpose: 'story',
    successKey: null,
    onPicked: previewFile,
    onHandedToProvider: take('video'),
    // Unreachable for a vendor-owned video (there is no `complete` call), but the hook's contract
    // requires it and an empty function would hide a future routing mistake.
    onCompleted: (asset) => take('video')(asset.id),
  });

  const active = picked?.kind === 'video' ? video : photo;
  const uploading = active.state === 'progress' || active.state === 'preparing';
  const processing =
    active.state === 'processing' || (picked?.kind === 'video' && !!picked.assetId);
  const announced = QUARTILES.includes(active.progress)
    ? tm('progress', { percent: active.progress })
    : '';

  /** Ready to publish: a brokered asset id exists. A local preview alone is not enough. */
  const publishable = picked !== null && picked.assetId !== '';

  /** The closed refusal vocabulary, mapped to copy exhaustively — a new code cannot compile silently. */
  const refusalCopy = (code: StoryIssue | 'not_found' | 'generic'): string => {
    const map: Record<StoryIssue | 'not_found' | 'generic', string> = {
      media_required: t('publish.errors.noMedia'),
      media_invalid: t('publish.errors.failed'),
      not_found: t('publish.errors.failed'),
      generic: t('publish.errors.failed'),
    };
    return map[code];
  };

  const submit = () => {
    if (!publishable) {
      // Client-side, and it costs NO request: there is nothing to publish (UI empty/E07).
      setFormError(t('publish.errors.noMedia'));
      return;
    }
    setFormError(null);
    startPublish(async () => {
      const result = await publishStoryAction({
        mediaAssetId: picked.assetId,
        mediaKind: picked.kind,
        caption,
      });
      if (!result.ok) {
        setFormError(refusalCopy(result.code));
        return;
      }
      toast.show({ tone: 'success', message: t('publish.toast') });
      router.push('/inicio');
      // `revalidatePath('/inicio')` in the action clears the SERVER cache; this clears the client
      // Router Cache, which still holds the `/inicio` payload the admin navigated away from. Both
      // are needed and neither is redundant: without the refresh the admin lands back on the exact
      // strip they left and their own story is missing — a real e2e failure, not a hypothesis.
      // The composer never hit this because it navigates to a route that did not exist yet.
      router.refresh();
    });
  };

  const close = () => {
    if (picked === null) return router.push('/inicio');
    setDiscarding(true);
  };

  const header = (
    <PageHeader
      title={t('publish.title')}
      backIcon={X}
      backLabel={t('publish.close')}
      onBack={close}
      stickyTop="0px"
      className="md:static md:px-0"
      trailing={
        <a href={historyHref} className="px-2 py-1 text-sm font-bold text-brand">
          {t('publish.history')}
        </a>
      }
    />
  );

  /** One picker: the mobile ROW and the desktop drop zone drive the SAME hidden input. */
  const picker = (
    kind: StoryMediaKind,
    inputId: string,
    accept: string,
    label: string,
    Icon: typeof ImageIcon,
    upload: typeof photo,
  ) => (
    <div className="flex flex-col gap-2">
      {/* The mobile row. `md:hidden`, because the approved drawing turns the pair into two drop
          zones on desktop — same two things, same order, same words. */}
      <button
        type="button"
        onClick={() => document.getElementById(inputId)?.click()}
        disabled={uploading}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:hidden"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg-tertiary text-text-secondary">
          <Icon size={20} aria-hidden />
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </button>

      {/* The desktop drop zone, carrying the SAME `accept` and the SAME hidden input id. The
          primitive owns its own `role="alert"` error slot, so there is exactly one alert per zone. */}
      <FileDropZone
        id={inputId}
        icon={Icon}
        accept={accept}
        // `screen: false` for the PHOTO zone only (R-12): the hook re-encodes a HEIC or an over-cap
        // phone photo in the browser instead of refusing it, and a drop has to reach that decision.
        screen={kind === 'video'}
        state={
          upload.state === 'progress' || upload.state === 'processing'
            ? (upload.state as 'progress' | 'processing')
            : 'idle'
        }
        progress={upload.progress}
        error={upload.error ?? undefined}
        onFile={(file) => void upload.pick(file)}
        onReject={(reason) => upload.reject(reason)}
        labels={{
          caption: label,
          progress: (percent) => tm('progress', { percent }),
          processing: tm('video.processing'),
        }}
        className="hidden md:flex"
      />
    </div>
  );

  return (
    <form
      data-testid="story-composer"
      className={
        picked === null
          ? 'mx-auto flex w-full max-w-[680px] flex-col'
          : // `z-[52]` is a deliberate rung of the shipped ladder, not a magic number: the shell's
            // BottomNav is `z-50` and WOULD intercept the `Publicar` tap (a real e2e failure, not a
            // hypothesis), while `ConfirmDialog` / `BottomSheet` sit at `z-[55]` so the discard
            // dialog still opens ABOVE this frame. Above the nav, below the overlays.
            'fixed inset-0 z-[52] flex flex-col overflow-hidden bg-black'
      }
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {picked === null ? (
        <>
          {header}
          <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
            {/* E07/error: a refusal is an alert-role card at the TOP, never a toast — the admin has
                to be able to see it without the message vanishing. */}
            {formError ? (
              <p
                role="alert"
                className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
              >
                {formError}
              </p>
            ) : null}

            {picker(
              'image',
              PHOTO_INPUT_ID,
              PHOTO_ACCEPT,
              t('publish.pickPhoto'),
              ImageIcon,
              photo,
            )}
            {picker('video', VIDEO_INPUT_ID, VIDEO_ACCEPT, t('publish.pickVideo'), Video, video)}

            {/* UI-D-05: the cap is INTERPOLATED from the contract, never typed into the copy. */}
            <p
              data-testid="story-duration-helper"
              className="text-xs font-normal text-text-tertiary"
            >
              {t('publish.helper', {
                limit: durationLabel(MEDIA_LIMITS.video.story?.maxDurationSeconds ?? 0),
              })}
            </p>

            {/* The Phase 3 upload machine, verbatim: a 4px brand bar, the percent in tabular-nums,
                a polite live region at the quartiles and a ghost cancel. */}
            {uploading ? (
              <div className="flex flex-col gap-2">
                <span className="block h-1 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <span
                    className="block h-full bg-brand transition-[width]"
                    style={{ width: `${active.progress}%` }}
                  />
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-normal text-text-tertiary tabular-nums">
                    {tm('progress', { percent: active.progress })}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={active.cancel}>
                    {tm('cancel')}
                  </Button>
                </div>
              </div>
            ) : null}

            <span aria-live="polite" className="sr-only">
              {announced}
            </span>
          </div>
        </>
      ) : (
        <div className="relative flex-1">
          {/* The media fills the black screen at `object-contain`: the admin composes in EXACTLY the
              frame a member will see, which is the whole of UI-D-39's argument. */}
          {picked.previewUrl && picked.kind === 'image' ? (
            /* biome-ignore lint/performance/noImgElement: a local `blob:` preview of bytes already in memory; next/image would re-fetch a URL that only exists in this tab */
            <img
              data-testid="story-preview"
              src={picked.previewUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : picked.previewUrl ? (
            <video
              data-testid="story-preview"
              src={picked.previewUrl}
              muted
              playsInline
              autoPlay
              loop
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <span data-testid="story-preview" className="absolute inset-0 object-contain" />
          )}

          {/* The scrim: the caption and the CTA sit over media nobody has seen, so the ink needs a
              ground rather than luck. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70"
          />

          <div className="absolute left-3 z-10" style={{ top: 'calc(var(--safe-top) + 0.5rem)' }}>
            <IconButton
              icon={X}
              label={t('publish.close')}
              onClick={close}
              className="bg-black/35 text-white"
            />
          </div>

          {formError ? (
            <p
              role="alert"
              className="absolute inset-x-4 z-10 rounded-xl bg-danger px-4 py-3 text-sm font-normal text-white"
              style={{ top: 'calc(var(--safe-top) + 4rem)' }}
            >
              {formError}
            </p>
          ) : null}

          <div
            className="absolute inset-x-4 z-10 flex flex-col gap-3"
            style={{ bottom: 'calc(var(--safe-bottom) + 1rem)' }}
          >
            {/* The processing row: publishing is ALLOWED while a video transcodes, and the note says
                the 24 h window starts now rather than losing story life in silence (Pitfall 5). */}
            {processing && picked.kind === 'video' ? (
              <div className="flex items-start gap-3 rounded-xl bg-black/45 px-3 py-2">
                <Loader size={20} aria-hidden className="mt-0.5 shrink-0 text-white/70" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-white">
                    {t('publish.processingTitle')}
                  </span>
                  <span className="block text-xs font-normal text-white/70">
                    {t('publish.processingNote')}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="flex items-end gap-3">
              <span className="min-w-0 flex-1">
                {/* A transparent field: the media IS the background, so the textarea carries no
                    frame of its own (UI-D-39). 16px text — never smaller (iOS zoom guard). */}
                <textarea
                  aria-label={t('publish.captionLabel')}
                  placeholder={t('publish.captionPlaceholder')}
                  value={caption}
                  rows={2}
                  maxLength={STORY_MAX_CAPTION}
                  onChange={(event) => setCaption(event.target.value)}
                  onInput={(event) => {
                    const el = event.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  className="block w-full resize-none bg-transparent text-base font-normal text-white placeholder:text-white/60 focus:outline-none"
                />
                <span
                  data-testid="story-caption-counter"
                  className={`block text-xs font-normal tabular-nums ${
                    caption.length >= STORY_MAX_CAPTION ? 'text-danger' : 'text-white/70'
                  }`}
                >
                  {`${caption.length}/${STORY_MAX_CAPTION}`}
                </span>
              </span>

              <Button
                type="submit"
                variant="brand"
                size="md"
                disabled={busy || !publishable}
                loading={busy}
                aria-busy={busy || undefined}
              >
                {busy ? t('publish.submitting') : t('publish.submit')}
              </Button>
            </div>
          </div>

          <span aria-live="polite" className="sr-only">
            {announced}
          </span>
        </div>
      )}

      {/* E18: all four strings are FIXED — no caption or filename is ever quoted into a destructive
          confirmation. */}
      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('publish.discard.title')}
        body={t('publish.discard.body')}
        confirmLabel={t('publish.discard.confirm')}
        cancelLabel={t('publish.discard.cancel')}
        onConfirm={() => router.push('/inicio')}
        onClose={() => setDiscarding(false)}
      />
    </form>
  );
}
