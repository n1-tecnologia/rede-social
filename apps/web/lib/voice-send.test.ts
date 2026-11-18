import { describe, expect, it, vi } from 'vitest';
import {
  classifyVoiceFailure,
  runVoiceSend,
  VOICE_READY_POLL_MS,
  VOICE_READY_TIMEOUT_MS,
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

/**
 * Task 2: which failures end a take and which can be retried (UI-D-847), the resume that makes a retry
 * re-send the SAME asset (VOICE-23), and the 20 second wait.
 */
describe('classifyVoiceFailure (12.5-11 task 2)', () => {
  it.each([
    'too_large',
    'type_not_allowed',
    'format_mismatch',
    'duration_too_long',
    'quota_exceeded',
    'transcode_failed',
    'not_an_image',
    'heic_unsupported',
    'invalid',
  ])('%s is permanent', (code) => {
    expect(classifyVoiceFailure(code)).toBe('permanent');
  });

  it.each(['member_blocked', 'member_removed', 'not_found', 'closed'])(
    '%s passes through as its own kind',
    (code) => {
      expect(classifyVoiceFailure(code)).toBe(code);
    },
  );

  it.each([
    'retriable',
    'not_ready',
    'generic',
    'object_missing',
    'video_provider_missing',
    'zzz',
    '',
  ])('%j is retriable (a network, a timeout or anything unknown)', (code) => {
    expect(classifyVoiceFailure(code)).toBe('retriable');
  });
});

describe('runVoiceSend failures (12.5-11 task 2)', () => {
  it.each([
    'too_large',
    'type_not_allowed',
    'format_mismatch',
    'duration_too_long',
    'quota_exceeded',
    'transcode_failed',
    'not_an_image',
    'heic_unsupported',
  ])('a %s refusal of start is permanent and nothing after it runs', async (code) => {
    const f = fakes([], { start: vi.fn(async () => ({ ok: false as const, code })) });
    expect(await runVoiceSend(f.deps, take())).toEqual({ ok: false, kind: 'permanent' });
    expect(f.put).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a refusal of complete after a good PUT is classified by its code and has no resume', async () => {
    const f = fakes([], {
      complete: vi.fn(async () => ({ ok: false as const, code: 'format_mismatch' })),
    });
    expect(await runVoiceSend(f.deps, take())).toEqual({ ok: false, kind: 'permanent' });
    expect(f.send).not.toHaveBeenCalled();

    const g = fakes([], { complete: vi.fn(async () => ({ ok: false as const, code: 'generic' })) });
    expect(await runVoiceSend(g.deps, take())).toEqual({ ok: false, kind: 'retriable' });
  });

  it('a PUT that fails to transfer is retriable with NO resume; too_large is permanent; aborted is retriable', async () => {
    for (const [reason, kind] of [
      ['transfer', 'retriable'],
      ['too_large', 'permanent'],
      ['aborted', 'retriable'],
    ] as const) {
      const f = fakes([], { put: vi.fn(async () => ({ ok: false as const, reason })) });
      const outcome = await runVoiceSend(f.deps, take());
      expect(outcome).toEqual({ ok: false, kind });
      expect(outcome).not.toHaveProperty('resume');
      expect(f.complete).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['invalid', 'permanent'],
    ['closed', 'closed'],
    ['member_blocked', 'member_blocked'],
    ['member_removed', 'member_removed'],
    ['not_found', 'not_found'],
    ['retriable', 'retriable'],
  ] as const)(
    'a send answering %s ends as %s, is never retried and keeps the asset to resume',
    async (error, kind) => {
      const f = fakes([{ ok: false, error }]);
      const outcome = await runVoiceSend(f.deps, take());
      expect(outcome).toEqual({ ok: false, kind, resume: { mediaId: MEDIA } });
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.sleep).not.toHaveBeenCalled();
    },
  );

  it('after complete succeeds, a resume sends the SAME asset and performs no start, PUT or complete', async () => {
    const first = fakes([{ ok: false, error: 'retriable' }]);
    const failed = await runVoiceSend(first.deps, take());
    expect(failed).toEqual({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(first.start).toHaveBeenCalledTimes(1);
    expect(first.put).toHaveBeenCalledTimes(1);
    expect(first.complete).toHaveBeenCalledTimes(1);

    const second = fakes([{ ok: true, sent: { view: VIEW } }]);
    const progress: VoiceSendProgress[] = [];
    const outcome = await runVoiceSend(
      second.deps,
      take(),
      { onProgress: (p) => progress.push(p) },
      failed.ok ? undefined : failed.resume,
    );
    expect(outcome).toEqual({ ok: true, sent: { view: VIEW } });
    expect(second.start).not.toHaveBeenCalled();
    expect(second.put).not.toHaveBeenCalled();
    expect(second.complete).not.toHaveBeenCalled();
    expect(second.send.mock.calls.map((c) => c[0])).toEqual([MEDIA]);
    expect(progress).toEqual([{ phase: 'finishing' }]);
  });

  it('a send that keeps answering not_ready stops after 20 seconds of waiting, retriable with resume', async () => {
    const f = fakes(
      Array.from({ length: 60 }, () => ({ ok: false as const, error: 'not_ready' as const })),
    );
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toEqual({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(f.send).toHaveBeenCalledTimes(29);
    expect(f.sleep).toHaveBeenCalledTimes(28);
    const slept = f.sleep.mock.calls.reduce((sum, c) => sum + (c[0] as number), 0);
    expect(slept).toBeLessThanOrEqual(VOICE_READY_TIMEOUT_MS);
    expect(f.sleep.mock.calls.every((c) => c[0] === VOICE_READY_POLL_MS)).toBe(true);
  });

  it('a slow send counts against the 20 seconds too (the real clock, when given)', async () => {
    let clock = 0;
    const f = fakes(
      Array.from({ length: 60 }, () => ({ ok: false as const, error: 'not_ready' as const })),
      {
        now: () => clock,
        sleep: vi.fn(async (ms: number) => {
          clock += ms + 600; // each round trip adds 600 ms the sleeps do not count
        }),
      },
    );
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toMatchObject({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(f.send.mock.calls.length).toBeLessThan(29);
  });

  it('a dependency that throws is retriable, with the resume only once the take is completed', async () => {
    const early = fakes([], {
      start: vi.fn(async () => {
        throw new Error('boom https://secret.test');
      }),
    });
    const earlyOutcome = await runVoiceSend(early.deps, take());
    expect(earlyOutcome).toEqual({ ok: false, kind: 'retriable' });
    expect(JSON.stringify(earlyOutcome)).not.toContain('secret');

    const late = fakes([], {
      send: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await runVoiceSend(late.deps, take())).toEqual({
      ok: false,
      kind: 'retriable',
      resume: { mediaId: MEDIA },
    });
  });

  it('never logs: the orchestration has no console call', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakes([{ ok: false, error: 'invalid' }]);
    await runVoiceSend(f.deps, take());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * WR-01 (quick 261117-w3z): leaving the screen starts no further stage and no further send. The host hands
 * a `cancelled()` hook; it is read at the entry, between the stages, at the top of every send iteration and
 * right after a not_ready answer (before the 700 ms sleep is armed).
 */
describe('runVoiceSend cancellation (WR-01)', () => {
  it('WR-01: cancelled from the start runs no stage, no send and no sleep', async () => {
    const f = fakes([{ ok: true, sent: { view: VIEW } }], { cancelled: () => true });
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome.ok).toBe(false);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('WR-01: the flag flipping after start stops before the PUT', async () => {
    let gone = false;
    const f = fakes([{ ok: true, sent: { view: VIEW } }]);
    const realStart = f.start.getMockImplementation();
    f.start.mockImplementation(async (input: unknown) => {
      const answer = await realStart?.(input);
      gone = true;
      return answer as never;
    });
    f.deps.cancelled = () => gone;
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome.ok).toBe(false);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('WR-01: the flag flipping after the PUT stops before complete', async () => {
    let gone = false;
    const f = fakes([{ ok: true, sent: { view: VIEW } }]);
    f.put.mockImplementation(async () => {
      gone = true;
      return { ok: true as const };
    });
    f.deps.cancelled = () => gone;
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome.ok).toBe(false);
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('WR-01: the flag flipping after complete never sends, and the unsent asset is the resume', async () => {
    let gone = false;
    const f = fakes([{ ok: true, sent: { view: VIEW } }]);
    f.complete.mockImplementation(async () => {
      gone = true;
      return { ok: true as const };
    });
    f.deps.cancelled = () => gone;
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toEqual({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('WR-01: the flag flipping on a not_ready answer arms no sleep and sends no more', async () => {
    let gone = false;
    const f = fakes([
      { ok: false, error: 'not_ready' },
      { ok: false, error: 'not_ready' },
      { ok: true, sent: { view: VIEW } },
    ]);
    const realSend = f.send.getMockImplementation();
    f.send.mockImplementation(async (mediaId: string) => {
      const answer = await realSend?.(mediaId);
      if (f.send.mock.calls.length === 2) gone = true;
      return answer as never;
    });
    f.deps.cancelled = () => gone;
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toEqual({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(f.send).toHaveBeenCalledTimes(2);
    // Only the wait between send 1 and send 2 was armed; none after the second answer.
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });

  it('WR-01: the flag flipping inside the sleep stops before the next send', async () => {
    let gone = false;
    const f = fakes([
      { ok: false, error: 'not_ready' },
      { ok: true, sent: { view: VIEW } },
    ]);
    f.sleep.mockImplementation(async () => {
      gone = true;
    });
    f.deps.cancelled = () => gone;
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toEqual({ ok: false, kind: 'retriable', resume: { mediaId: MEDIA } });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });

  it('WR-01: a hook that is always false changes nothing', async () => {
    const f = fakes(
      [
        { ok: false, error: 'not_ready' },
        { ok: true, sent: { view: VIEW } },
      ],
      { cancelled: () => false },
    );
    const outcome = await runVoiceSend(f.deps, take());
    expect(outcome).toEqual({ ok: true, sent: { view: VIEW } });
    expect(f.calls).toEqual(['start', 'put', 'complete', 'send', 'send']);
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });
});
