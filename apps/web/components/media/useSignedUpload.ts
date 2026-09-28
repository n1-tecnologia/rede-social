'use client';

import {
  classifyMediaFile,
  MEDIA_LIMITS,
  type MediaAsset,
  type MediaIssue,
  type MediaKind,
  type MediaPurpose,
} from '@rede-social/contracts/media';
import { useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { completeMediaUploadAction, startMediaUploadAction } from '@/app/(app)/perfil/actions';
import { normaliseImage, uploadBytes } from '@/lib/upload';

/** The six states of UI-SPEC §Upload contract, shared by the photo zone and 03-07's video zone. */
export type SignedUploadState = 'idle' | 'preparing' | 'progress' | 'processing' | 'done' | 'error';

export interface UseSignedUploadOptions {
  kind: MediaKind;
  purpose: MediaPurpose;
  /** The completed asset — the caller decides what to do with it (set the avatar, add a row…). */
  onCompleted: (asset: MediaAsset) => void | Promise<void>;
  /**
   * Called INSTEAD of `onCompleted` when the object belongs to a streaming provider rather than to
   * Storage (03-06's `VideoProvider` seam), because that path has no `complete` call at all: the
   * provider owns the bytes and the row reaches `ready` when its signed webhook lands. Calling
   * `complete` there would hand a video to the image/PDF decoder and reject a perfectly good upload.
   * The asset already exists server-side as `pending`, so the caller re-reads it rather than being
   * handed a payload this hook would have to invent.
   */
  onHandedToProvider?: (assetId: string) => void | Promise<void>;
  /** The file that will actually be uploaded (already normalised), for a local preview. */
  onPicked?: (file: File) => void;
  /**
   * Catalog key of the success toast, under the `media` namespace — or `null` for NO toast.
   *
   * `null` since 04-09: the composer picks several photos in a row and the thumbnail appearing in
   * the grid IS the confirmation, so a toast per file would stack three notifications over a form
   * the admin is still filling in. Every screen that uploads ONE thing still toasts.
   */
  successKey?: string | null;
}

/**
 * "8 MB" from 8388608 — the copy interpolates `{limit}` and never hard-codes a number (UI-D-05).
 *
 * Exported since 04-09: the composer's "PDF de até {limit}." helper reads the SAME function as the
 * upload refusals below, so the number a member is promised and the number they are refused with
 * can never be rounded two different ways.
 */
export function formatMediaLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/**
 * The signed-upload state machine, generalised out of `platform/LogoUpload.tsx` to any
 * `{ kind, purpose }` (MEDIA-01, R-12, CLAUDE.md §4).
 *
 *   classify (UX gate) → [preparing: browser re-encode] → start → browser PUT/TUS → complete → done
 *
 * The bytes go from the browser STRAIGHT to the signed Storage target; the two server actions carry
 * `{ kind, purpose, mime, size, filename }` and an `assetId`, never a byte of the file.
 *
 * WR-07 boundary: `pick` is try + catch ONLY — never `finally`, because the success path must not
 * re-run `fail()` after `onCompleted`. Every raw error goes to the console and the member sees a
 * catalog string (T-02-147).
 *
 * `LogoUpload` deliberately keeps its own copy of this hook for now: converging the branding zone
 * here would put an unrelated Phase 2 screen in this plan's blast radius.
 */
export function useSignedUpload({
  kind,
  purpose,
  onCompleted,
  onHandedToProvider,
  onPicked,
  successKey = 'toasts.photoUpdated',
}: UseSignedUploadOptions) {
  const t = useTranslations('media');
  const toast = useToast();
  const [state, setState] = useState<SignedUploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const transfer = useRef<AbortController | null>(null);

  const limit = MEDIA_LIMITS[kind][purpose];
  const maxBytes = limit?.maxBytes ?? 0;

  const settleIdle = () => {
    setState('idle');
    setProgress(0);
    busy.current = false;
    transfer.current = null;
  };

  const fail = (message: string) => {
    setError(message);
    settleIdle();
    setState('error');
  };

  /**
   * "Formato não suportado. Use JPEG, PNG ou WebP." is the wrong sentence for a video, so the
   * refusal copy is chosen by KIND rather than by screen: the video zone says what a video may be
   * ("Envie um MP4 ou um vídeo gravado no celular."), which is also the only advice a member can act
   * on with a phone in their hand (UI-SPEC §Copywriting Contract).
   */
  const typeMessage = (): string => (kind === 'video' ? t('errors.videoType') : t('errors.type'));

  /** Exhaustive over `MEDIA_ISSUES`: a new refusal code cannot compile until it has copy. */
  const messageFor = (issue: MediaIssue | 'generic', answeredMaxBytes?: number): string => {
    const limitText = formatMediaLimit(answeredMaxBytes ?? maxBytes);
    const seconds = limit?.maxDurationSeconds ?? 0;
    const durationText = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
    const map: Record<MediaIssue | 'generic', string> = {
      type_not_allowed: typeMessage(),
      heic_unsupported: t('errors.prepare'),
      too_large: t('errors.size', { limit: limitText }),
      quota_exceeded: t('errors.quota'),
      not_an_image: t('errors.notAnImage'),
      format_mismatch: t('errors.notAnImage'),
      object_missing: t('errors.notCompleted'),
      duration_too_long: t('errors.duration', { duration: durationText }),
      not_ready: t('errors.notCompleted'),
      transcode_failed: t('errors.transcode'),
      video_provider_missing: t('errors.generic'),
      generic: t('errors.generic'),
    };
    return map[issue];
  };

  /** A file refused by the zone itself (`FileDropZone`'s `accept`/`maxBytes`) — no request is made. */
  const reject = (reason: 'type' | 'size') => {
    if (busy.current) return;
    setError(
      reason === 'type' ? typeMessage() : t('errors.size', { limit: formatMediaLimit(maxBytes) }),
    );
    setState('error');
  };

  const pick = async (file: File) => {
    if (busy.current) return;
    try {
      setError(null);
      const verdict = classifyMediaFile(file, kind, purpose);
      // A wrong TYPE is refused at pick time and costs no request at all (criterion 3, first half).
      if (verdict === 'type') return fail(typeMessage());

      busy.current = true;
      let payload = file;

      // `'heic'` is a SIGNAL, not an error: the re-encode below is what makes an iPhone photo work,
      // silently. `'size'` enters the same branch because scaling to 2048 px is what rescues it.
      if (verdict === 'heic' || verdict === 'size') {
        setState('preparing');
        try {
          payload = await normaliseImage(file, { maxBytes });
        } catch (prepareError) {
          console.error('media.upload_prepare_failed', {
            kind,
            purpose,
            error: String(prepareError),
          });
          return fail(t('errors.prepare'));
        }
      }
      onPicked?.(payload);

      setState('progress');
      setProgress(0);
      const controller = new AbortController();
      transfer.current = controller;

      const started = await startMediaUploadAction({
        kind,
        purpose,
        mime: payload.type,
        size: payload.size,
        filename: payload.name,
      });
      if (!started.ok) return fail(messageFor(started.code, started.maxBytes));

      const sent = await uploadBytes(started.upload, payload, {
        mime: payload.type,
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (!sent.ok) {
        // Cancelling is not a failure: back to idle with NO message (UI-SPEC E8/partial).
        if (sent.reason === 'aborted') return settleIdle();
        return fail(sent.reason === 'too_large' ? messageFor('too_large') : t('errors.transfer'));
      }

      setState('processing');

      // A provider-owned object has NO `complete` call (03-06): `complete` re-reads the object from
      // Storage and decodes it as an image or a PDF, which would reject the video the provider just
      // accepted. The row is already `pending` server-side and the provider's webhook is what moves
      // it to `ready`, so the caller re-reads the list instead of confirming anything here.
      if (started.upload.provider !== 'supabase') {
        busy.current = false;
        transfer.current = null;
        setProgress(100);
        setState('done');
        await onHandedToProvider?.(started.upload.assetId);
        if (successKey !== null) toast.show({ tone: 'success', message: t(successKey) });
        return;
      }

      const completed = await completeMediaUploadAction(started.upload.assetId);
      if (!completed.ok) return fail(messageFor(completed.code, completed.maxBytes));

      busy.current = false;
      transfer.current = null;
      setProgress(100);
      setState('done');
      await onCompleted(completed.asset);
      if (successKey !== null) toast.show({ tone: 'success', message: t(successKey) });
    } catch (unexpected) {
      // WR-07: a rejected action or a thrown transfer returns the zone to idle with the generic
      // message; the raw value is logged, never rendered. try + catch only — no `finally`.
      console.error('media.upload_failed', { kind, purpose, error: String(unexpected) });
      fail(t('errors.generic'));
    }
  };

  /** Aborts the in-flight transfer; the member can pick again immediately. */
  const cancel = () => {
    transfer.current?.abort();
  };

  const reset = () => {
    setError(null);
    settleIdle();
  };

  return { state, progress, error, pick, reject, cancel, reset };
}
