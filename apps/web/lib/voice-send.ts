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
}

export type VoiceSendProgress = { phase: 'uploading'; percent: number } | { phase: 'finishing' };

export interface VoiceSendHandlers {
  onProgress?: (progress: VoiceSendProgress) => void;
}

export type VoiceSendOutcome<T> =
  | { ok: true; sent: T }
  | { ok: false; kind: VoiceFailureKind; resume?: { mediaId: string } };

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

export async function runVoiceSend<T>(
  deps: VoiceSendDeps<T>,
  take: VoiceTake,
  handlers: VoiceSendHandlers = {},
): Promise<VoiceSendOutcome<T>> {
  const report = (progress: VoiceSendProgress) => handlers.onProgress?.(progress);
  try {
    const file = voiceFileOf(take);
    const mime = file.type;

    report({ phase: 'uploading', percent: 0 });
    const started = await deps.start({ kind: 'audio', purpose: 'voice', mime, size: file.size });
    if (!started.ok) return { ok: false, kind: 'retriable' };

    const put = await deps.put(started.upload, file, {
      mime,
      onProgress: (percent) => report({ phase: 'uploading', percent }),
    });
    if (!put.ok) return { ok: false, kind: 'retriable' };

    const completed = await deps.complete(started.upload.assetId);
    if (!completed.ok) return { ok: false, kind: 'retriable' };

    report({ phase: 'finishing' });
    const mediaId = started.upload.assetId;

    // The take is stored once (the unique index of the API), so repeating the same send is safe.
    let waited = 0;
    for (;;) {
      const answer = await deps.send(mediaId);
      if (answer.ok) return { ok: true, sent: answer.sent };
      if (answer.error !== 'not_ready') return { ok: false, kind: 'retriable' };
      if (waited + VOICE_READY_POLL_MS > VOICE_READY_TIMEOUT_MS) {
        return { ok: false, kind: 'retriable' };
      }
      await deps.sleep(VOICE_READY_POLL_MS);
      waited += VOICE_READY_POLL_MS;
    }
  } catch {
    return { ok: false, kind: 'retriable' };
  }
}
