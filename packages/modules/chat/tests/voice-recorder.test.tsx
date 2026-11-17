// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatComposer,
  classifyVoiceError,
  type UseVoiceRecorderOptions,
  useVoiceRecorder,
  VOICE_RECORDER_INITIAL,
  type VoiceRecorderEvent,
  voiceRecorderReducer,
} from '../ui/index';
import {
  domError,
  FakeRecorder,
  FakeTrack,
  fakeClock,
  installRecording,
  uninstallRecording,
  voiceBundle,
} from './voice-fakes';

/**
 * 12.5-13 task 2: the limits, the floor, the interruptions, the four problems and the release on every exit
 * (D-848, D-850, D-852, VOICE-08, VOICE-10, VOICE-11, VOICE-12). Hook-level over fakes; the composer wiring is
 * checked where a test needs the composer itself (a disabled or replaced composer mid-recording).
 */

let clock: ReturnType<typeof fakeClock>;
let rec: ReturnType<typeof installRecording>;

function setup(options?: Parameters<typeof installRecording>[0]) {
  rec = installRecording(options);
}

beforeEach(() => {
  clock = fakeClock();
  setup();
});

afterEach(() => {
  cleanup();
  clock.restore();
  uninstallRecording();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mountHook(extra: Partial<UseVoiceRecorderOptions> = {}) {
  const events: VoiceRecorderEvent[] = [];
  const onRecordingStart = vi.fn();
  const view = renderHook((props: UseVoiceRecorderOptions) => useVoiceRecorder(props), {
    initialProps: {
      active: true,
      onEvent: (event: VoiceRecorderEvent) => events.push(event),
      onRecordingStart,
      ...extra,
    } as UseVoiceRecorderOptions,
  });
  return { ...view, events, onRecordingStart };
}

type Mounted = ReturnType<typeof mountHook>;

async function begin(view: Mounted) {
  await act(async () => {
    void view.result.current.start();
  });
  await settle();
}

async function sendNow(view: Mounted) {
  let take: Awaited<ReturnType<Mounted['result']['current']['send']>> = null;
  await act(async () => {
    take = await view.result.current.send();
  });
  return take as { blob: Blob; mime: string; seconds: number } | null;
}

function advance(ms: number) {
  act(() => clock.advance(ms));
}

/** Every track stopped exactly once and no timer left behind (T-12.5-49, UI-D-845). */
function expectReleased() {
  for (const track of rec.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  expect(rec.stream.tracks.length).toBeGreaterThan(0);
  expect(vi.getTimerCount()).toBe(0);
}

describe('voiceRecorderReducer (pure)', () => {
  const idle = VOICE_RECORDER_INITIAL;

  it('ignores a second request while busy and only a request from idle starts one', () => {
    const requesting = voiceRecorderReducer(idle, { type: 'request' });
    expect(requesting.phase).toBe('requesting');
    expect(voiceRecorderReducer(requesting, { type: 'request' })).toBe(requesting);
  });

  it('walks request, started, tick, stopped and clears everything at reset', () => {
    let state = voiceRecorderReducer(idle, { type: 'request' });
    state = voiceRecorderReducer(state, { type: 'started' });
    state = voiceRecorderReducer(state, { type: 'tick', seconds: 271, warned: true });
    expect(state).toMatchObject({ phase: 'recording', elapsedSeconds: 271, warned: true });
    state = voiceRecorderReducer(state, { type: 'stopped', reason: 'limit', seconds: 300 });
    expect(state).toMatchObject({ phase: 'stopped', stopReason: 'limit', elapsedSeconds: 300 });
    expect(voiceRecorderReducer(state, { type: 'tick', seconds: 5, warned: false })).toBe(state);
    expect(voiceRecorderReducer(state, { type: 'reset' })).toEqual(idle);
  });

  it('a problem returns to idle and a request clears it', () => {
    const problem = voiceRecorderReducer(idle, { type: 'problem', problem: 'tooShort' });
    expect(problem).toMatchObject({ phase: 'idle', problem: 'tooShort' });
    expect(voiceRecorderReducer(problem, { type: 'clearProblem' }).problem).toBeNull();
    expect(voiceRecorderReducer(problem, { type: 'request' }).problem).toBeNull();
  });
});

describe('the capture request (D-852, VOICE-08)', () => {
  it('asks for one mono stream with the three processing flags, only after start', async () => {
    const view = mountHook();
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    await begin(view);
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(rec.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['NotFoundError', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['Error', 'failed'],
    ['TypeError', 'failed'],
  ] as const)(
    '%s maps to the %s problem and the microphone stays tappable',
    async (name, problem) => {
      setup({ reject: domError(name) });
      const view = mountHook();
      await begin(view);
      expect(classifyVoiceError(domError(name))).toBe(problem);
      expect(view.result.current.state).toMatchObject({ phase: 'idle', problem });
      expect(view.events).toContainEqual({ type: 'problem', problem });
      expect(FakeRecorder.instances).toHaveLength(0);

      // Tappable again: the next start asks again and clears the line.
      await begin(view);
      expect(rec.getUserMedia).toHaveBeenCalledTimes(2);
    },
  );

  it('a second tap while the prompt is open is ignored', async () => {
    setup({ deferred: true });
    const view = mountHook();
    await begin(view);
    expect(view.result.current.state.phase).toBe('requesting');
    await begin(view);
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => rec.grant());
    await settle();
    expect(view.result.current.state.phase).toBe('recording');
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it('calls onRecordingStart once per start', async () => {
    const view = mountHook();
    await begin(view);
    expect(view.onRecordingStart).toHaveBeenCalledTimes(1);
    act(() => view.result.current.discard());
    await begin(view);
    expect(view.onRecordingStart).toHaveBeenCalledTimes(2);
  });
});

describe('the recorder setup (the research skeleton)', () => {
  it('probes webm, then mp4, then ogg, and asks for 32 kbit/s with a 1 s timeslice', async () => {
    FakeRecorder.supportedTypes = ['audio/mp4'];
    const view = mountHook();
    await begin(view);
    const recorder = rec.recorder();
    expect(recorder.options).toEqual({ mimeType: 'audio/mp4', audioBitsPerSecond: 32000 });
    expect(recorder.startCalls).toEqual([1000]);
  });

  it('with no supported type lets the browser choose and reads the recorder mime', async () => {
    FakeRecorder.supportedTypes = [];
    const view = mountHook();
    await begin(view);
    expect(rec.recorder().options).toEqual({ audioBitsPerSecond: 32000 });
    advance(2000);
    const take = await sendNow(view);
    expect(take?.mime).toBe('audio/webm');
  });

  it('falls back to a plain start() when the timeslice start throws', async () => {
    FakeRecorder.throwOnTimeslice = true;
    const view = mountHook();
    await begin(view);
    expect(rec.recorder().startCalls).toEqual([1000, undefined]);
    expect(view.result.current.state.phase).toBe('recording');
    advance(2000);
    expect((await sendNow(view))?.blob.size).toBeGreaterThan(0);
  });

  it('works when no periodic chunk ever arrives: the stop delivers the whole take', async () => {
    const view = mountHook();
    await begin(view);
    advance(4000);
    const take = await sendNow(view);
    expect(take?.blob.size).toBe(512);
    expectReleased();
  });

  it('ignores zero-size chunks', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    rec.recorder().emitChunk(100);
    rec.recorder().emitChunk(0);
    const take = await sendNow(view);
    expect(take?.blob.size).toBe(100 + 512);
  });
});

describe('the 4:30 notice, the 5:00 stop and the spoken minutes (D-850, VOICE-10)', () => {
  it('turns the warning on at exactly 270 seconds and keeps it to the end', async () => {
    const view = mountHook();
    await begin(view);
    advance(269_750);
    expect(view.result.current.state).toMatchObject({ phase: 'recording', warned: false });
    advance(250);
    expect(view.result.current.state).toMatchObject({ elapsedSeconds: 270, warned: true });
    advance(20_000);
    expect(view.result.current.state.warned).toBe(true);
    expect(view.events.filter((e) => e.type === 'warning')).toHaveLength(1);
  });

  it('speaks each full minute up to four and never the fifth', async () => {
    const view = mountHook();
    await begin(view);
    advance(299_000);
    const minutes = view.events.filter((e) => e.type === 'minute');
    expect(minutes).toEqual([1, 2, 3, 4].map((count) => ({ type: 'minute', count })));
  });

  it('stops by itself at 300 seconds, sends nothing, and the take goes out with 300 seconds', async () => {
    const view = mountHook();
    await begin(view);
    advance(299_750);
    expect(view.result.current.state.phase).toBe('recording');
    advance(250);
    expect(view.result.current.state).toMatchObject({
      phase: 'stopped',
      stopReason: 'limit',
      elapsedSeconds: 300,
    });
    expect(rec.recorder().state).toBe('inactive');
    expect(view.events).toContainEqual({ type: 'limit' });
    // The microphone is already released at the stop; nothing is sent until the member chooses.
    expectReleased();
    advance(60_000);
    expect(view.result.current.state.phase).toBe('stopped');

    const take = await sendNow(view);
    expect(take?.seconds).toBe(300);
    expect(take?.blob.size).toBeGreaterThan(0);
    expectReleased();
  });

  it('also stops when a chunk arrives after the limit on a throttled timer', async () => {
    const view = mountHook();
    await begin(view);
    advance(10_000);
    // The background tab froze the interval: the clock moved on, no tick ran.
    act(() => {
      clock.jump(295_000);
      rec.recorder().emitChunk(200);
    });
    expect(view.result.current.state).toMatchObject({ phase: 'stopped', stopReason: 'limit' });
  });

  it('the trash after the limit stop discards the take', async () => {
    const view = mountHook();
    await begin(view);
    advance(300_000);
    act(() => view.result.current.discard());
    expect(view.result.current.state.phase).toBe('idle');
    expect(await sendNow(view)).toBeNull();
    expectReleased();
  });
});

describe('the 1-second floor and the empty take (D-848, VOICE-11)', () => {
  it('a tap on send at 999 ms is a discard with the too-short problem and nothing is sent', async () => {
    const view = mountHook();
    await begin(view);
    advance(999);
    expect(await sendNow(view)).toBeNull();
    expect(view.result.current.state).toMatchObject({ phase: 'idle', problem: 'tooShort' });
    expect(view.events).toContainEqual({ type: 'problem', problem: 'tooShort' });
    expectReleased();
  });

  it('at 1000 ms it sends', async () => {
    const view = mountHook();
    await begin(view);
    advance(1000);
    const take = await sendNow(view);
    expect(take?.seconds).toBe(1);
    expectReleased();
  });

  it('a zero-byte take is the generic problem and nothing is sent', async () => {
    FakeRecorder.finalBytes = 0;
    const view = mountHook();
    await begin(view);
    advance(3000);
    expect(await sendNow(view)).toBeNull();
    expect(view.result.current.state).toMatchObject({ phase: 'idle', problem: 'failed' });
    expectReleased();
  });
});

describe('interruptions (A-UI-7, research Pitfall 8)', () => {
  it('the track ending at 5 seconds keeps the take as an interruption', async () => {
    const view = mountHook();
    await begin(view);
    advance(5000);
    act(() => rec.track.end());
    expect(view.result.current.state).toMatchObject({
      phase: 'stopped',
      stopReason: 'interrupted',
      elapsedSeconds: 5,
    });
    expect(view.events).toContainEqual({ type: 'interrupted' });
    expectReleased();
    const take = await sendNow(view);
    expect(take?.seconds).toBe(5);
  });

  it('the track ending at 600 ms is discarded as too short', async () => {
    const view = mountHook();
    await begin(view);
    advance(600);
    act(() => rec.track.end());
    expect(view.result.current.state).toMatchObject({ phase: 'idle', problem: 'tooShort' });
    expectReleased();
  });

  it('a mute followed by an unmute within 1000 ms changes nothing', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    act(() => rec.track.mute());
    advance(900);
    act(() => rec.track.unmute());
    advance(5000);
    expect(view.result.current.state.phase).toBe('recording');
  });

  it('a mute held past 1000 ms is an interruption', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    act(() => rec.track.mute());
    advance(1000);
    expect(view.result.current.state).toMatchObject({
      phase: 'stopped',
      stopReason: 'interrupted',
    });
    expectReleased();
  });

  it('a recorder error is an interruption', async () => {
    const view = mountHook();
    await begin(view);
    advance(3000);
    act(() => rec.recorder().fail());
    expect(view.result.current.state).toMatchObject({
      phase: 'stopped',
      stopReason: 'interrupted',
    });
    expectReleased();
  });

  it('hiding the tab alone never stops a recording', async () => {
    const view = mountHook();
    await begin(view);
    advance(3000);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(3000);
    expect(view.result.current.state.phase).toBe('recording');
    Reflect.deleteProperty(document, 'visibilityState');
  });
});

describe('the microphone is released on every exit (UI-D-845, VOICE-12, T-12.5-49)', () => {
  beforeEach(() => {
    cleanup();
    uninstallRecording();
    setup({ tracks: [new FakeTrack(), new FakeTrack()] });
  });

  it('send', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    await sendNow(view);
    expectReleased();
  });

  it('trash', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    act(() => view.result.current.discard());
    expect(view.events).toContainEqual({ type: 'discarded' });
    expectReleased();
  });

  it('too short', async () => {
    const view = mountHook();
    await begin(view);
    advance(200);
    await sendNow(view);
    expectReleased();
  });

  it('interruption, then the trash', async () => {
    const view = mountHook();
    await begin(view);
    advance(3000);
    act(() => rec.stream.tracks[0]?.end());
    act(() => view.result.current.discard());
    expectReleased();
  });

  it('limit, then send', async () => {
    const view = mountHook();
    await begin(view);
    advance(300_000);
    await sendNow(view);
    expectReleased();
  });

  it('unmount while recording', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    view.unmount();
    expectReleased();
    expect(rec.recorder().state).toBe('inactive');
  });

  it('unmount while the prompt is open: the late grant is given back at once', async () => {
    setup({ deferred: true, tracks: [new FakeTrack(), new FakeTrack()] });
    const view = mountHook();
    await begin(view);
    view.unmount();
    await act(async () => rec.grant());
    await settle();
    expectReleased();
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('the hook turning inactive mid-recording discards the take', async () => {
    const view = mountHook();
    await begin(view);
    advance(2000);
    view.rerender({ active: false });
    expect(view.result.current.state.phase).toBe('idle');
    expectReleased();
  });
});

describe('the composer being replaced mid-recording (V09, V10)', () => {
  function composer(props: {
    disabled?: boolean;
    withVoice?: boolean;
    onRecordingStart?: () => void;
  }) {
    return (
      <ChatComposer
        label="field-sentinel"
        placeholder="placeholder-sentinel"
        sendLabel="send-sentinel"
        counterTemplate={(count) => `counter-${count}`}
        errorText="error-sentinel"
        onSend={vi.fn(async () => true)}
        disabled={props.disabled}
        voice={
          props.withVoice === false
            ? undefined
            : voiceBundle({ onRecordingStart: props.onRecordingStart })
        }
      />
    );
  }

  async function startRecording() {
    await act(async () => {
      screen.getByRole('button', { name: 'mic-sentinel' }).click();
    });
    await settle();
    expect(screen.getByRole('button', { name: 'discard-sentinel' })).toBeInTheDocument();
  }

  it('the composer turning disabled mid-recording discards the take with no prompt', async () => {
    const view = render(composer({}));
    await startRecording();
    advance(2000);
    view.rerender(composer({ disabled: true }));
    expect(screen.queryByRole('button', { name: 'discard-sentinel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'mic-sentinel' })).toBeDisabled();
    expectReleased();
  });

  it("the voice bundle disappearing mid-recording discards the take and gives today's composer", async () => {
    const view = render(composer({}));
    await startRecording();
    advance(2000);
    view.rerender(composer({ withVoice: false }));
    expect(screen.queryByRole('button', { name: 'discard-sentinel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'send-sentinel' })).toBeDisabled();
    expectReleased();
  });

  it('unmounting the composer mid-recording releases the microphone', async () => {
    const view = render(composer({}));
    await startRecording();
    advance(2000);
    view.unmount();
    expectReleased();
  });

  it('starting a recording calls onRecordingStart so a playing message pauses', async () => {
    const onRecordingStart = vi.fn();
    render(composer({ onRecordingStart }));
    await startRecording();
    expect(onRecordingStart).toHaveBeenCalledTimes(1);
  });
});
