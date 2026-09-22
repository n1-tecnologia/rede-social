'use client';

import {
  classifyMediaFile,
  MEDIA_LIMITS,
  type MediaAsset,
  type MediaIssue,
  type MediaKind,
  type MediaPurpose,
} from '@tria/contracts/media';
import { useToast } from '@tria/ui';
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
  /** The file that will actually be uploaded (already normalised), for a local preview. */
  onPicked?: (file: File) => void;
  /** Catalog key of the success toast, under the `media` namespace. */
  successKey?: string;
}

/** "8 MB" from 8388608 — the copy interpolates `{limit}` and never hard-codes a number (UI-D-05). */
function formatLimit(bytes: number): string {
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

  /** Exhaustive over `MEDIA_ISSUES`: a new refusal code cannot compile until it has copy. */
  const messageFor = (issue: MediaIssue | 'generic', answeredMaxBytes?: number): string => {
    const limitText = formatLimit(answeredMaxBytes ?? maxBytes);
    const seconds = limit?.maxDurationSeconds ?? 0;
    const durationText = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
    const map: Record<MediaIssue | 'generic', string> = {
      type_not_allowed: t('errors.type'),
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
      reason === 'type' ? t('errors.type') : t('errors.size', { limit: formatLimit(maxBytes) }),
    );
    setState('error');
  };

  const pick = async (file: File) => {
    if (busy.current) return;
    try {
      setError(null);
      const verdict = classifyMediaFile(file, kind, purpose);
      // A wrong TYPE is refused at pick time and costs no request at all (criterion 3, first half).
      if (verdict === 'type') return fail(t('errors.type'));

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
      const completed = await completeMediaUploadAction(started.upload.assetId);
      if (!completed.ok) return fail(messageFor(completed.code, completed.maxBytes));

      busy.current = false;
      transfer.current = null;
      setProgress(100);
      setState('done');
      await onCompleted(completed.asset);
      toast.show({ tone: 'success', message: t(successKey) });
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
