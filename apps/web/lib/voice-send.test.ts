import { describe, expect, it, vi } from 'vitest';
import {
  runVoiceSend,
  type VoiceSendAnswer,
  type VoiceSendDeps,
  type VoiceSendProgress,
  type VoiceTake,
} from './voice-send';

/**
 * 12.5-11 (D-848, D-862, VOICE-23): the pure upload-and-send orchestration of a recording. Every
 * dependency is a fake, the clock is the injected `sleep`, so a case runs in microseconds.
 *
 * Task 1 (the tracer): the three stages run once, in order, with the codec parameters stripped from
 * the mime, and the send repeats the SAME asset every 700 ms while the API answers `not_ready`.
 */

const MEDIA = '0b000000-0000-4000-8000-0000000000b1';
const VIEW = { id: 'view-1' };

const take = (over: Partial<{ type: string; size: number; seconds: number }> = {}): VoiceTake => ({
  blob: new Blob([new Uint8Array(over.size ?? 40_000)], {
    type: over.type ?? 'audio/webm;codecs=opus',
  }),
  durationSeconds: over.seconds ?? 7,
});

interface Fakes {
  deps: VoiceSendDeps<{ view: typeof VIEW }>;
  calls: string[];
  start: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
}

function fakes(
  sendAnswers: VoiceSendAnswer<{ view: typeof VIEW }>[],
  over: Partial<VoiceSendDeps<{ view: typeof VIEW }>> = {},
): Fakes {
  const calls: string[] = [];
  const queue = [...sendAnswers];
  const start = vi.fn(async (input: unknown) => {
    calls.push('start');
    void input;
    return {
      ok: true as const,
      upload: {
        assetId: MEDIA,
        provider: 'supabase',
        signedUrl: 'https://signed.test/put',
        token: null,
        path: null,
        resumableThresholdBytes: 6 * 1024 * 1024,
      },
    };
  });
  const put = vi.fn(
    async (_target: unknown, file: File, opts: { onProgress?: (p: number) => void }) => {
      calls.push('put');
      opts.onProgress?.(0);
      opts.onProgress?.(50);
      opts.onProgress?.(100);
      void file;
      return { ok: true as const };
    },
  );
  const complete = vi.fn(async (_assetId: string) => {
    calls.push('complete');
    return { ok: true as const };
  });
  const send = vi.fn(async (_mediaId: string) => {
    calls.push('send');
    return queue.shift() ?? { ok: false as const, error: 'retriable' as const };
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return {
    deps: { start, put, complete, send, sleep, ...over },
    calls,
    start,
    put,
    complete,
    send,
    sleep,
  };
}

describe('runVoiceSend (12.5-11 tracer)', () => {
  it('uploads, completes and sends a take, waiting for the normalization', async () => {
    const f = fakes([
      { ok: false, error: 'not_ready' },
      { ok: false, error: 'not_ready' },
      { ok: true, sent: { view: VIEW } },
    ]);
    const progress: VoiceSendProgress[] = [];

    const outcome = await runVoiceSend(f.deps, take(), { onProgress: (p) => progress.push(p) });

    expect(outcome).toEqual({ ok: true, sent: { view: VIEW } });

    // The codec parameters never leave the recorder: the start input and the PUT's type are bare.
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenCalledWith({
      kind: 'audio',
      purpose: 'voice',
      mime: 'audio/webm',
      size: 40_000,
    });
    expect(f.put).toHaveBeenCalledTimes(1);
    const putFile = f.put.mock.calls[0]?.[1] as File;
    expect(putFile.type).toBe('audio/webm');
    expect(putFile.size).toBe(40_000);
    const putOpts = f.put.mock.calls[0]?.[2] as { mime: string } | undefined;
    expect(putOpts?.mime).toBe('audio/webm');

    // Three stages, in order, once each; then the SAME asset sent three times (two waits).
    expect(f.calls).toEqual(['start', 'put', 'complete', 'send', 'send', 'send']);
    expect(f.complete).toHaveBeenCalledWith(MEDIA);
    expect(f.send.mock.calls.map((c) => c[0])).toEqual([MEDIA, MEDIA, MEDIA]);
    expect(f.sleep.mock.calls.map((c) => c[0])).toEqual([700, 700]);

    // Progress: uploading 0..100, then finishing.
    const phases = progress.map((p) => p.phase);
    expect(phases.filter((p) => p === 'uploading').length).toBeGreaterThanOrEqual(3);
    expect(phases.at(-1)).toBe('finishing');
    expect(phases.indexOf('finishing')).toBeGreaterThan(phases.lastIndexOf('uploading'));
    const percents = progress.flatMap((p) => (p.phase === 'uploading' ? [p.percent] : []));
    expect(percents[0]).toBe(0);
    expect(percents.at(-1)).toBe(100);
    expect(percents).toContain(50);
  });
});
