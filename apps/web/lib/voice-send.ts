/**
 * The upload-and-send orchestration of a voice recording (12.5-11, D-848, D-862, VOICE-23).
 *
 * PURE: every effect (the media start and complete actions, the PUT to Storage, the send action, the clock)
 * is injected, so the order of the three stages, the wait for the worker's normalization and the failure
 * words are all unit-tested without a browser. This file imports no server action and nothing from `next/*`.
 *
 * One take is ONE asset and ONE message: the three stages run once, in order (start, PUT, complete), then the
 * SAME send is repeated every {@link VOICE_READY_POLL_MS} while the API answers `not_ready` (`complete` leaves
 * the asset `processing` until the worker derives it), for at most {@link VOICE_READY_TIMEOUT_MS}.
 *
 * LEAVING THE SCREEN (WR-01, UI-D-847): the host may hand a `cancelled()` hook. It is read at the entry, between
 * the three stages, at the top of every send iteration and right after a `not_ready` answer (before the wait is
 * armed), so once it answers true no further stage, send or timer starts. It stops the NEXT step only: a request
 * already on the wire is not aborted (the deps take no signal). An asset a cancelled take already uploaded and
 * completed is never sent; the 24 hour orphan sweep collects it (D-856). The cancelled outcome reuses the
 * `retriable` word as a carrier; the host that cancelled returns before it ever reads it.
 *
 * Nothing here names a file, a URL, a mime, a byte count or a limit in any string it returns: the failures are
 * closed words the bubble maps to its own catalog sentences.
 */

/** Poll the send every 700 ms while the recording is still being normalized. */
export const VOICE_READY_POLL_MS = 700;
/** Stop waiting after 20 seconds: the take stays in the bubble as a retriable failure. */
export const VOICE_READY_TIMEOUT_MS = 20_000;

/** A finished recording as the recorder hands it over: its bytes (with the recorder's own type) and its length. */
export interface VoiceTake {
  blob: Blob;
  durationSeconds: number;
}

/** The closed words a failed take ends with (UI-D-847): permanent ends it, retriable lets the member tap again. */
export type VoiceFailureKind =
  | 'permanent'
  | 'retriable'
  | 'closed'
  | 'member_blocked'
  | 'member_removed'
  | 'not_found';

/** What the send answers, in the closed vocabulary of the two server actions. */
export type VoiceSendError =
  | 'not_ready'
  | 'invalid'
  | 'closed'
  | 'member_blocked'
  | 'member_removed'
  | 'not_found'
  | 'retriable';

export type VoiceSendAnswer<T> = { ok: true; sent: T } | { ok: false; error: VoiceSendError };

/** The part of the media start answer the transfer needs (no more). */
export interface VoiceUploadTarget {
  assetId: string;
  provider: string;
  signedUrl: string;
  token: string | null;
  path: string | null;
  resumableThresholdBytes: number;
}

export type VoiceStartInput = { kind: 'audio'; purpose: 'voice'; mime: string; size: number };

export interface VoiceSendDeps<T> {
  start(
    input: VoiceStartInput,
  ): Promise<{ ok: true; upload: VoiceUploadTarget } | { ok: false; code: string }>;
  put(
    target: VoiceUploadTarget,
    file: File,
    opts: { mime: string; onProgress?: (percent: number) => void },
  ): Promise<{ ok: true } | { ok: false; reason: 'transfer' | 'too_large' | 'aborted' }>;
  complete(assetId: string): Promise<{ ok: true } | { ok: false; code: string }>;
  send(mediaId: string): Promise<VoiceSendAnswer<T>>;
  sleep(ms: number): Promise<void>;
  /** The real clock, when the host has one: a slow send then counts against the 20 seconds too. */
  now?: () => number;
  /**
   * True once the caller no longer wants this take sent (the pane unmounted, the take was discarded or cleared
   * by a refusal). Read before every stage and every send; a request already on the wire is not aborted.
   */
  cancelled?: () => boolean;
}

export type VoiceSendProgress = { phase: 'uploading'; percent: number } | { phase: 'finishing' };

export interface VoiceSendHandlers {
  onProgress?: (progress: VoiceSendProgress) => void;
}

/** What a failed take hands back to try again: the asset that is already uploaded, completed and waiting. */
export interface VoiceResume {
  mediaId: string;
}

export type VoiceSendOutcome<T> =
  | { ok: true; sent: T }
  | { ok: false; kind: VoiceFailureKind; resume?: VoiceResume };

/** `audio/webm;codecs=opus` becomes `audio/webm`: the recorder's parameters are not part of the contract's mime. */
export function stripMimeParams(type: string): string {
  return (type.split(';')[0] ?? '').trim().toLowerCase();
}

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

/** The take as the `File` the transfer router takes, typed with the bare mime. */
export function voiceFileOf(take: VoiceTake): File {
  const mime = stripMimeParams(take.blob.type);
  return new File([take.blob], `voice.${EXTENSIONS[mime] ?? 'bin'}`, { type: mime });
}

/**
 * No retry can help these: the file or the member's own limits are the cause, and the sentence the bubble
 * shows never names a size, a quota or a number. `invalid` is the send's 400 (an unusable asset).
 */
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  'too_large',
  'type_not_allowed',
  'format_mismatch',
  'duration_too_long',
  'quota_exceeded',
  'transcode_failed',
  'not_an_image',
  'heic_unsupported',
  'invalid',
]);

/** The refusals that are their own kind: the screen answers each with its own sentence. */
const OWN_KINDS: ReadonlySet<string> = new Set([
  'closed',
  'member_blocked',
  'member_removed',
  'not_found',
]);

/**
 * One closed word (a media refusal code or a send's error word) to the kind the bubble needs. A network or
 * timeout failure, a 5xx, the 20 second wait and ANY unknown code are `retriable`: a retry costs the member
 * one tap, while calling a recoverable failure permanent would throw their take away.
 */
export function classifyVoiceFailure(code: string): VoiceFailureKind {
  if (PERMANENT_CODES.has(code)) return 'permanent';
  if (OWN_KINDS.has(code)) return code as VoiceFailureKind;
  return 'retriable';
}

/**
 * Runs a take to a stored message. `resume` is the asset a previous attempt already uploaded and completed:
 * the three stages are skipped and the SAME asset is sent again, so a retry never makes a second message
 * (the unique index of the API makes the send idempotent per asset).
 */
export async function runVoiceSend<T>(
  deps: VoiceSendDeps<T>,
  take: VoiceTake,
  handlers: VoiceSendHandlers = {},
  resume?: VoiceResume,
): Promise<VoiceSendOutcome<T>> {
  const report = (progress: VoiceSendProgress) => handlers.onProgress?.(progress);
  // Set once `complete` succeeds: from then on EVERY failure carries it.
  let mediaId: string | null = resume?.mediaId ?? null;
  const failed = (kind: VoiceFailureKind): VoiceSendOutcome<T> =>
    mediaId ? { ok: false, kind, resume: { mediaId } } : { ok: false, kind };

  // Only a true answer cancels: a hook that is absent, or answers anything else, never stops a take.
  const gone = () => deps.cancelled?.() === true;

  try {
    if (gone()) return failed('retriable');
    if (!mediaId) {
      const file = voiceFileOf(take);
      const mime = file.type;

      report({ phase: 'uploading', percent: 0 });
      const started = await deps.start({ kind: 'audio', purpose: 'voice', mime, size: file.size });
      if (!started.ok) return failed(classifyVoiceFailure(started.code));
      if (gone()) return failed('retriable');

      const put = await deps.put(started.upload, file, {
        mime,
        onProgress: (percent) => report({ phase: 'uploading', percent }),
      });
      if (!put.ok) return failed(put.reason === 'too_large' ? 'permanent' : 'retriable');
      if (gone()) return failed('retriable');

      const completed = await deps.complete(started.upload.assetId);
      if (!completed.ok) return failed(classifyVoiceFailure(completed.code));
      mediaId = started.upload.assetId;
    }

    report({ phase: 'finishing' });

    // The send repeats while the worker normalizes the take; any other answer ends the loop.
    const startedAt = deps.now?.() ?? 0;
    let waited = 0;
    for (;;) {
      if (gone()) return failed('retriable');
      const answer = await deps.send(mediaId);
      if (answer.ok) return { ok: true, sent: answer.sent };
      if (answer.error !== 'not_ready') return failed(classifyVoiceFailure(answer.error));
      // No wait is armed for a caller that is gone.
      if (gone()) return failed('retriable');
      const elapsed = deps.now ? Math.max(waited, deps.now() - startedAt) : waited;
      if (elapsed + VOICE_READY_POLL_MS > VOICE_READY_TIMEOUT_MS) return failed('retriable');
      await deps.sleep(VOICE_READY_POLL_MS);
      waited += VOICE_READY_POLL_MS;
    }
  } catch {
    return failed('retriable');
  }
}
