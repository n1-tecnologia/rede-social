import { uploadBytes } from '@/lib/upload';
import type { VoiceSendAnswer, VoiceSendDeps, VoiceSendError } from '@/lib/voice-send';
import { completeMediaUploadAction, startMediaUploadAction } from '../perfil/actions';

/**
 * The real dependencies of `runVoiceSend` (12.5-11): the two media server actions that already carry the
 * signed-upload contract (`startMediaUploadAction`, `completeMediaUploadAction`), the transfer router of
 * `lib/upload.ts` (`uploadBytes`: a plain PUT at or under the 6 MiB threshold the server names) and the
 * send action of the caller (`sendSupportVoiceAction` for a member, a staff reply bound to its
 * conversation for the team). `useSignedUpload` is NOT reused: it re-encodes images, toasts and takes a
 * `File` only.
 *
 * This module holds no logic of its own: every refusal code is passed through for `runVoiceSend` to
 * classify, and nothing is logged here.
 */
export function voiceSendDeps<R extends { ok: true }>(
  sendAction: (mediaId: string) => Promise<R | { ok: false; error: VoiceSendError }>,
): VoiceSendDeps<R> {
  return {
    async start(input) {
      const started = await startMediaUploadAction(input);
      if (!started.ok) return { ok: false, code: started.code };
      const { assetId, provider, signedUrl, token, path, resumableThresholdBytes } = started.upload;
      return {
        ok: true,
        upload: { assetId, provider, signedUrl, token, path, resumableThresholdBytes },
      };
    },
    put: (target, file, opts) => uploadBytes(target, file, opts),
    async complete(assetId) {
      const done = await completeMediaUploadAction(assetId);
      return done.ok ? { ok: true } : { ok: false, code: done.code };
    },
    async send(mediaId): Promise<VoiceSendAnswer<R>> {
      const answer = await sendAction(mediaId);
      return answer.ok ? { ok: true, sent: answer } : { ok: false, error: answer.error };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
