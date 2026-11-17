import { vi } from 'vitest';
import type { ChatComposerVoice } from '../ui/index';

/**
 * Test doubles for the voice recorder (12.5-13). happy-dom has no `MediaRecorder` and no `mediaDevices`
 * (research, "Test doubles for happy-dom"), so the recorder, the tracks and the stream are fakes, and the
 * clock is controllable: `performance.now` is a stub the test moves, and only the four timer functions are
 * faked, so microtasks and `Promise` keep running for real.
 */

/** A fake audio track: counts `stop()` calls and lets a test dispatch `ended`, `mute` and `unmute`. */
export class FakeTrack extends EventTarget {
  kind = 'audio';
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
  mute() {
    this.dispatchEvent(new Event('mute'));
  }
  unmute() {
    this.dispatchEvent(new Event('unmute'));
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack()]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

/** The recorder the hook builds. `instances` lists every one constructed in the current test. */
export class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  /** Which types `isTypeSupported` accepts (a test narrows it to prove the probe order). */
  static supportedTypes: string[] = [
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  /** Make `start(timeslice)` throw so the hook must fall back to a plain `start()` (Safari quirk). */
  static throwOnTimeslice = false;
  /** Bytes the final chunk (the one `stop()` flushes) carries; 0 makes an empty take. */
  static finalBytes = 512;

  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supportedTypes.includes(type);
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  startCalls: Array<number | undefined> = [];
  options: { mimeType?: string; audioBitsPerSecond?: number } | undefined;

  constructor(
    readonly stream: unknown,
    options?: { mimeType?: string; audioBitsPerSecond?: number },
  ) {
    super();
    this.options = options;
    this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
    FakeRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.startCalls.push(timeslice);
    if (FakeRecorder.throwOnTimeslice && timeslice !== undefined) {
      throw new Error('timeslice unsupported');
    }
    this.state = 'recording';
    queueMicrotask(() => this.dispatchEvent(new Event('start')));
  }

  /** A periodic chunk, as `start(1000)` would deliver one second in. */
  emitChunk(bytes = 256) {
    this.dispatchEvent(
      Object.assign(new Event('dataavailable'), {
        data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }),
      }),
    );
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.dispatchEvent(
      Object.assign(new Event('dataavailable'), {
        data: new Blob([new Uint8Array(FakeRecorder.finalBytes)], { type: this.mimeType }),
      }),
    );
    this.dispatchEvent(new Event('stop'));
  }

  fail() {
    this.dispatchEvent(new Event('error'));
  }
}

/** A `DOMException`-shaped error: the hook reads only `name`. */
export function domError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

export interface InstalledRecording {
  /** The spy standing in for the capture call (no call must happen before a tap). */
  getUserMedia: ReturnType<typeof vi.fn>;
  stream: FakeStream;
  track: FakeTrack;
  /** The most recent recorder the hook constructed. */
  recorder: () => FakeRecorder;
}

export interface InstallOptions {
  /** Make the capture call reject with this error instead of resolving the stream. */
  reject?: Error;
  /** Resolve the capture call only when the test calls the returned `grant`. */
  deferred?: boolean;
  tracks?: FakeTrack[];
}

/** Install the fake recording API on the global scope. Pair with {@link uninstallRecording}. */
export function installRecording(options: InstallOptions = {}): InstalledRecording & {
  grant: () => void;
} {
  FakeRecorder.instances = [];
  FakeRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
  FakeRecorder.throwOnTimeslice = false;
  FakeRecorder.finalBytes = 512;
  const stream = new FakeStream(options.tracks ?? [new FakeTrack()]);
  let grant: () => void = () => {};
  const getUserMedia = vi.fn(() => {
    if (options.reject) return Promise.reject(options.reject);
    if (options.deferred) {
      return new Promise<FakeStream>((resolve) => {
        grant = () => resolve(stream);
      });
    }
    return Promise.resolve(stream);
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  return {
    getUserMedia,
    stream,
    track: stream.tracks[0] as FakeTrack,
    recorder: () => FakeRecorder.instances[FakeRecorder.instances.length - 1] as FakeRecorder,
    grant: () => grant(),
  };
}

export function uninstallRecording() {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
}

/**
 * A clock the test moves by hand. `advance` steps in 250 ms slices (the recorder's tick), moving the stubbed
 * `performance.now` and the faked timers together; `jump` moves only the clock (a throttled background timer).
 */
export function fakeClock() {
  let now = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    advance(ms: number) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(250, left);
        now += step;
        vi.advanceTimersByTime(step);
        left -= step;
      }
    },
    jump(ms: number) {
      now += ms;
    },
    now: () => now,
    restore() {
      spy.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    },
  };
}

/** The finished-string bundle of sentinels the composer tests render with. */
export function voiceBundle(over: Partial<ChatComposerVoice> = {}): ChatComposerVoice {
  return {
    micLabel: 'mic-sentinel',
    micRequestingLabel: 'requesting-sentinel',
    recordingLabel: 'recording-sentinel',
    timerLabel: 'timer-sentinel',
    discardLabel: 'discard-sentinel',
    sendLabel: 'voice-send-sentinel',
    limitWord: 'limit-word-sentinel',
    interruptedWord: 'interrupted-word-sentinel',
    notices: {
      warning: 'warning-sentinel',
      limit: 'limit-sentinel',
      interrupted: 'interrupted-sentinel',
      tooShort: 'too-short-sentinel',
    },
    problems: {
      blocked: 'blocked-sentinel',
      missing: 'missing-sentinel',
      busy: 'busy-sentinel',
      failed: 'failed-sentinel',
    },
    live: {
      started: 'live-started-sentinel',
      minute: (count: number) => `live-minute-${count}-sentinel`,
      discarded: 'live-discarded-sentinel',
    },
    formatClock: (seconds: number) =>
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    onSendVoice: vi.fn(async () => true),
    ...over,
  };
}
