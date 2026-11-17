import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadBytes } from '@/lib/upload';
import { runVoiceSend, type VoiceTake } from '@/lib/voice-send';
import { completeMediaUploadAction, startMediaUploadAction } from '../perfil/actions';
import { voiceSendDeps } from './voice-deps';

/**
 * 12.5-11: the real wiring of the orchestration's dependencies. The three modules it talks to (the two
 * media server actions and the transfer router) are mocked; the orchestration and the wiring are real.
 */

vi.mock('../perfil/actions', () => ({
  startMediaUploadAction: vi.fn(),
  completeMediaUploadAction: vi.fn(),
}));
vi.mock('@/lib/upload', () => ({ uploadBytes: vi.fn() }));

const MEDIA = '0b000000-0000-4000-8000-0000000000b1';
const take: VoiceTake = {
  blob: new Blob([new Uint8Array(1_000)], { type: 'audio/webm;codecs=opus' }),
  durationSeconds: 3,
};
const upload = {
  assetId: MEDIA,
  provider: 'supabase',
  signedUrl: 'https://signed.test/put',
  token: 'tok',
  path: 'a/b',
  resumableThresholdBytes: 6_291_456,
  maxBytes: 99,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('voiceSendDeps', () => {
  it('wires the three stages and the send, and a good take is ok with the action result', async () => {
    vi.mocked(startMediaUploadAction).mockResolvedValue({ ok: true, upload });
    vi.mocked(uploadBytes).mockResolvedValue({ ok: true });
    vi.mocked(completeMediaUploadAction).mockResolvedValue({ ok: true, asset: {} as never });
    const sendAction = vi.fn(async (_id: string) => ({ ok: true as const, view: { id: 'v' } }));

    const outcome = await runVoiceSend(voiceSendDeps(sendAction), take);

    expect(outcome).toEqual({ ok: true, sent: { ok: true, view: { id: 'v' } } });
    expect(startMediaUploadAction).toHaveBeenCalledWith({
      kind: 'audio',
      purpose: 'voice',
      mime: 'audio/webm',
      size: 1_000,
    });
    // The transfer router receives the started target and the bare-typed file.
    const [started, file, opts] = vi.mocked(uploadBytes).mock.calls[0] ?? [];
    expect(started).toMatchObject({ assetId: MEDIA, provider: 'supabase', token: 'tok' });
    expect((file as File).type).toBe('audio/webm');
    expect(opts).toMatchObject({ mime: 'audio/webm' });
    expect(completeMediaUploadAction).toHaveBeenCalledWith(MEDIA);
    expect(sendAction).toHaveBeenCalledWith(MEDIA);
  });

  it('a start refusal code is handed over as is and nothing else runs', async () => {
    vi.mocked(startMediaUploadAction).mockResolvedValue({ ok: false, code: 'duration_too_long' });
    const sendAction = vi.fn();
    const deps = voiceSendDeps(sendAction);
    expect(
      await deps.start({ kind: 'audio', purpose: 'voice', mime: 'audio/webm', size: 10 }),
    ).toEqual({ ok: false, code: 'duration_too_long' });
    expect(uploadBytes).not.toHaveBeenCalled();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('a transfer outcome of the router is "retriable" and the take is never completed', async () => {
    vi.mocked(startMediaUploadAction).mockResolvedValue({ ok: true, upload });
    vi.mocked(uploadBytes).mockResolvedValue({ ok: false, reason: 'transfer' });
    const sendAction = vi.fn();
    expect(await runVoiceSend(voiceSendDeps(sendAction), take)).toEqual({
      ok: false,
      kind: 'retriable',
    });
    expect(completeMediaUploadAction).not.toHaveBeenCalled();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('the send passes the action result through and the sleep is a real timer', async () => {
    vi.mocked(startMediaUploadAction).mockResolvedValue({ ok: true, upload });
    vi.mocked(uploadBytes).mockResolvedValue({ ok: true });
    vi.mocked(completeMediaUploadAction).mockResolvedValue({ ok: true, asset: {} as never });
    const deps = voiceSendDeps(async () => ({
      ok: false as const,
      error: 'member_blocked' as const,
    }));
    expect(await deps.send(MEDIA)).toEqual({ ok: false, error: 'member_blocked' });
    vi.useFakeTimers();
    const slept = deps.sleep(700);
    await vi.advanceTimersByTimeAsync(700);
    await expect(slept).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
