'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { isVoiceRecordingSupported } from './voiceSupport';

/**
 * The voice recorder (12.5-13; D-848, D-849, D-850, D-852; UI-D-842..UI-D-845): a `MediaRecorder` state machine
 * the shared composer drives. No kernel import and no word: every sentence the member reads is chosen by the
 * composer from the host's catalog, this file only raises closed events (`VoiceRecorderEvent`).
 *
 * Rules held here, each one tested over fakes:
 * - The permission is requested ONLY inside `start`, which only a tap on the microphone calls (T-12.5-50).
 * - The 5:00 stop is measured with `performance.now()` from the recorder's own `start` event and ALSO checked on
 *   every `dataavailable`, because a background timer may be throttled (research, Pitfall 7).
 * - A recording under the floor (1000 ms) is discarded and never handed to the host.
 * - An interruption (the audio track `ended`, a track `mute` that lasts more than 1000 ms, a recorder `error`)
 *   keeps what was recorded when it is at least the floor, and behaves like the 5:00 stop (Pitfall 8).
 * - EVERY exit stops every audio track exactly once and clears every timer (T-12.5-49, UI-D-845).
 * - The take lives in memory only; nothing survives leaving the screen.
 */

export const VOICE_MAX_SECONDS_DEFAULT = 300;
export const VOICE_MIN_SECONDS_DEFAULT = 1;
export const VOICE_WARN_AT_SECONDS_DEFAULT = 270;

/** The first supported type wins; none supported lets the browser choose and `recorder.mimeType` says which. */
const MIME_ORDER = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'] as const;
const AUDIO_BITS_PER_SECOND = 32_000;
const TIMESLICE_MS = 1000;
const TICK_MS = 250;
/** A `mute` of the capture track that lasts this long is an interruption (a call, the OS taking the microphone). */
const MUTE_INTERRUPTION_MS = 1000;
/** The status region speaks each full minute up to here (UI-D-855, A-UI-17). */
const LAST_SPOKEN_MINUTE = 4;

/** What the host receives when the member taps send. `seconds` is the measured length, a hint the server re-measures. */
export interface VoiceTake {
  /** The recorded bytes, typed with the recorder's own mime (parameters kept). */
  blob: Blob;
  /** The base mime type, parameters stripped (`audio/webm`), as the upload start expects it. */
  mime: string;
  seconds: number;
}

export type VoiceRecorderPhase = 'idle' | 'requesting' | 'recording' | 'stopped';
export type VoiceStopReason = 'limit' | 'interrupted';
/** The four sentences of a failed start, plus the too-short discard (UI-D-842, UI-D-845). */
export type VoiceProblem = 'blocked' | 'missing' | 'busy' | 'failed' | 'tooShort';

export interface VoiceRecorderState {
  phase: VoiceRecorderPhase;
  /** Whole seconds shown in the counter. */
  elapsedSeconds: number;
  /** The 30-seconds-left notice is up (it stays to the end). */
  warned: boolean;
  /** Why the recorder stopped by itself, while `phase` is `stopped`. */
  stopReason: VoiceStopReason | null;
  problem: VoiceProblem | null;
}

export type VoiceRecorderAction =
  | { type: 'request' }
  | { type: 'started' }
  | { type: 'tick'; seconds: number; warned: boolean }
  | { type: 'stopped'; reason: VoiceStopReason; seconds: number }
  | { type: 'problem'; problem: VoiceProblem }
  | { type: 'clearProblem' }
  | { type: 'reset' };

export const VOICE_RECORDER_INITIAL: VoiceRecorderState = {
  phase: 'idle',
  elapsedSeconds: 0,
  warned: false,
  stopReason: null,
  problem: null,
};

/** Pure: every transition of the recorder's visible state. A second `request` while busy changes nothing. */
export function voiceRecorderReducer(
  state: VoiceRecorderState,
  action: VoiceRecorderAction,
): VoiceRecorderState {
  switch (action.type) {
    case 'request':
      if (state.phase !== 'idle') return state;
      return { ...VOICE_RECORDER_INITIAL, phase: 'requesting' };
    case 'started':
      if (state.phase !== 'requesting') return state;
      return { ...VOICE_RECORDER_INITIAL, phase: 'recording' };
    case 'tick':
      if (state.phase !== 'recording') return state;
      if (state.elapsedSeconds === action.seconds && state.warned === action.warned) return state;
      return { ...state, elapsedSeconds: action.seconds, warned: action.warned };
    case 'stopped':
      if (state.phase !== 'recording') return state;
      return {
        ...state,
        phase: 'stopped',
        stopReason: action.reason,
        elapsedSeconds: action.seconds,
      };
    case 'problem':
      return { ...VOICE_RECORDER_INITIAL, problem: action.problem };
    case 'clearProblem':
      return state.problem === null ? state : { ...state, problem: null };
    case 'reset':
      return VOICE_RECORDER_INITIAL;
  }
}

/** The closed events the composer turns into its polite spoken sentences. */
export type VoiceRecorderEvent =
  | { type: 'started' }
  | { type: 'minute'; count: number }
  | { type: 'warning' }
  | { type: 'limit' }
  | { type: 'interrupted' }
  | { type: 'discarded' }
  | { type: 'problem'; problem: VoiceProblem };

export interface UseVoiceRecorderOptions {
  /**
   * False makes the hook inert: no voice bundle, or a disabled composer. Turning it false in the middle of a
   * recording discards the take and releases the microphone (the composer was replaced, UI-D-845).
   */
  active: boolean;
  maxSeconds?: number;
  minSeconds?: number;
  warnAtSeconds?: number;
  onEvent?: (event: VoiceRecorderEvent) => void;
  /** Called once per start, right before recording begins, so every playing voice message pauses (A-UI-9). */
  onRecordingStart?: () => void;
}

export interface VoiceRecorderApi {
  state: VoiceRecorderState;
  /** False after mount when the browser cannot record (the microphone is then withdrawn). True on the server. */
  supported: boolean;
  /** Ask for the microphone and record. Only the tap on the microphone calls this. */
  start: () => Promise<void>;
  /** Stop, and resolve the take; null when it was too short, empty or torn down. */
  send: () => Promise<VoiceTake | null>;
  discard: () => void;
  clearProblem: () => void;
}

/** Map a capture error to the sentence it earns (UI-D-842). Only `name` is read. */
export function classifyVoiceError(error: unknown): VoiceProblem {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'blocked';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

function baseMime(type: string): string {
  return (type.split(';')[0] ?? '').trim();
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_ORDER.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

interface Capture {
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
  chunks: Blob[];
  /** `performance.now()` at the recorder's own `start` event. */
  t0: number | null;
  /** Set when the recording ends (any reason): the length is final from then on. */
  frozenMs: number | null;
  tracksReleased: boolean;
  stopPromise: Promise<void> | null;
  sending: boolean;
  lastSeconds: number;
  warned: boolean;
  minutesSpoken: number;
  tickTimer: ReturnType<typeof setInterval> | null;
  muteTimer: ReturnType<typeof setTimeout> | null;
  detachTracks: () => void;
}

interface Controller {
  start: () => Promise<void>;
  send: () => Promise<VoiceTake | null>;
  discard: () => void;
  /** Discard whatever is in flight; true when there was something (a prompt or a take). */
  teardown: () => boolean;
}

function createController(
  dispatch: (action: VoiceRecorderAction) => void,
  getOptions: () => UseVoiceRecorderOptions,
): Controller {
  let cap: Capture | null = null;
  let session = 0;
  let starting = false;

  const limits = () => {
    const o = getOptions();
    return {
      maxMs: (o.maxSeconds ?? VOICE_MAX_SECONDS_DEFAULT) * 1000,
      minMs: (o.minSeconds ?? VOICE_MIN_SECONDS_DEFAULT) * 1000,
      warnAt: o.warnAtSeconds ?? VOICE_WARN_AT_SECONDS_DEFAULT,
    };
  };
  const emit = (event: VoiceRecorderEvent) => getOptions().onEvent?.(event);

  const clearTimers = (c: Capture) => {
    if (c.tickTimer !== null) clearInterval(c.tickTimer);
    if (c.muteTimer !== null) clearTimeout(c.muteTimer);
    c.tickTimer = null;
    c.muteTimer = null;
  };

  /** Stop every audio track exactly once (T-12.5-49). */
  const releaseTracks = (c: Capture) => {
    if (c.tracksReleased) return;
    c.tracksReleased = true;
    c.detachTracks();
    stopTracks(c.stream);
  };

  /** Resolves when the recorder has flushed its last chunk (immediately when it is already inactive). */
  const requestStop = (c: Capture): Promise<void> => {
    if (c.stopPromise) return c.stopPromise;
    c.stopPromise = new Promise<void>((resolve) => {
      if (c.recorder.state === 'inactive') {
        resolve();
        return;
      }
      c.recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        c.recorder.stop();
      } catch {
        resolve();
      }
    });
    return c.stopPromise;
  };

  /** Stop the recorder and release the microphone; the returned promise settles once the data is in. */
  const finalize = (c: Capture): Promise<void> => {
    const stopped = requestStop(c);
    releaseTracks(c);
    return stopped;
  };

  const raise = (problem: VoiceProblem) => {
    dispatch({ type: 'problem', problem });
    emit({ type: 'problem', problem });
  };

  /** Throw the take away: the trash, a too-short end, the composer being replaced. */
  const discardCapture = (c: Capture, problem: 'tooShort' | null) => {
    if (cap === c) cap = null;
    clearTimers(c);
    void finalize(c);
    if (problem) {
      raise(problem);
    } else {
      dispatch({ type: 'reset' });
      emit({ type: 'discarded' });
    }
  };

  /** The recorder stops by itself: the 5:00 limit or an interruption. Nothing is sent. */
  const endByItself = (c: Capture, reason: VoiceStopReason) => {
    if (cap !== c || c.frozenMs !== null) return;
    const { maxMs, minMs } = limits();
    const raw = c.t0 === null ? 0 : performance.now() - c.t0;
    const ms = reason === 'limit' ? maxMs : Math.min(raw, maxMs);
    if (reason === 'interrupted' && ms < minMs) {
      discardCapture(c, 'tooShort');
      return;
    }
    c.frozenMs = ms;
    clearTimers(c);
    void finalize(c);
    dispatch({ type: 'stopped', reason, seconds: Math.floor(ms / 1000) });
    emit({ type: reason });
  };

  /** The clock: the counter, the 4:30 notice, the spoken minutes and the 5:00 limit. */
  const tick = (c: Capture) => {
    if (cap !== c || c.frozenMs !== null || c.t0 === null) return;
    const { maxMs, warnAt } = limits();
    const ms = performance.now() - c.t0;
    if (ms >= maxMs) {
      endByItself(c, 'limit');
      return;
    }
    const seconds = Math.floor(ms / 1000);
    const warned = seconds >= warnAt;
    if (warned && !c.warned) {
      c.warned = true;
      emit({ type: 'warning' });
    }
    const minute = Math.floor(seconds / 60);
    while (c.minutesSpoken < minute && c.minutesSpoken < LAST_SPOKEN_MINUTE) {
      c.minutesSpoken += 1;
      emit({ type: 'minute', count: c.minutesSpoken });
    }
    if (seconds !== c.lastSeconds || warned) {
      c.lastSeconds = seconds;
      dispatch({ type: 'tick', seconds, warned });
    }
  };

  const wire = (c: Capture) => {
    const { recorder } = c;
    recorder.addEventListener('start', () => {
      if (c.t0 === null) c.t0 = performance.now();
    });
    recorder.addEventListener('dataavailable', (event) => {
      const data = (event as BlobEvent).data;
      if (data && data.size > 0) c.chunks.push(data);
      tick(c);
    });
    recorder.addEventListener('error', () => endByItself(c, 'interrupted'));

    const tracks = c.stream.getAudioTracks();
    const onEnded = () => endByItself(c, 'interrupted');
    const onMute = () => {
      if (c.muteTimer !== null) return;
      c.muteTimer = setTimeout(() => {
        c.muteTimer = null;
        endByItself(c, 'interrupted');
      }, MUTE_INTERRUPTION_MS);
    };
    const onUnmute = () => {
      if (c.muteTimer !== null) clearTimeout(c.muteTimer);
      c.muteTimer = null;
    };
    for (const track of tracks) {
      track.addEventListener('ended', onEnded);
      track.addEventListener('mute', onMute);
      track.addEventListener('unmute', onUnmute);
    }
    c.detachTracks = () => {
      for (const track of tracks) {
        track.removeEventListener('ended', onEnded);
        track.removeEventListener('mute', onMute);
        track.removeEventListener('unmute', onUnmute);
      }
    };
    c.tickTimer = setInterval(() => tick(c), TICK_MS);
  };

  const start = async () => {
    if (!getOptions().active || starting || cap) return;
    starting = true;
    const token = ++session;
    dispatch({ type: 'request' });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      if (token !== session) return;
      starting = false;
      raise(classifyVoiceError(error));
      return;
    }
    if (token !== session || !getOptions().active) {
      // Torn down while the prompt was open: the microphone was granted for nothing, give it back at once.
      stopTracks(stream);
      return;
    }
    starting = false;

    const mimeType = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      stopTracks(stream);
      raise('failed');
      return;
    }

    const c: Capture = {
      recorder,
      stream,
      mimeType: mimeType ?? '',
      chunks: [],
      t0: null,
      frozenMs: null,
      tracksReleased: false,
      stopPromise: null,
      sending: false,
      lastSeconds: 0,
      warned: false,
      minutesSpoken: 0,
      tickTimer: null,
      muteTimer: null,
      detachTracks: () => {},
    };
    cap = c;
    wire(c);

    getOptions().onRecordingStart?.();
    try {
      try {
        recorder.start(TIMESLICE_MS);
      } catch {
        // Safari quirk (research, Pitfall 8.4): without a timeslice the whole take arrives in one chunk at stop.
        recorder.start();
      }
    } catch {
      cap = null;
      clearTimers(c);
      releaseTracks(c);
      raise('failed');
      return;
    }
    dispatch({ type: 'started' });
    emit({ type: 'started' });
  };

  const send = async (): Promise<VoiceTake | null> => {
    const c = cap;
    if (!c || c.sending) return null;
    const { maxMs, minMs } = limits();
    if (c.frozenMs === null) {
      const raw = c.t0 === null ? 0 : performance.now() - c.t0;
      if (raw < minMs) {
        discardCapture(c, 'tooShort');
        return null;
      }
      c.frozenMs = Math.min(raw, maxMs);
      clearTimers(c);
    }
    c.sending = true;
    await finalize(c);
    if (cap !== c) return null; // torn down while the last chunk was flushing
    cap = null;

    const size = c.chunks.reduce((total, chunk) => total + chunk.size, 0);
    if (size === 0) {
      raise('failed');
      return null;
    }
    dispatch({ type: 'reset' });
    const type = c.recorder.mimeType || c.mimeType || c.chunks[0]?.type || '';
    return {
      blob: new Blob(c.chunks, { type }),
      mime: baseMime(type),
      seconds: Math.min(maxMs / 1000, Math.max(1, Math.round((c.frozenMs ?? 0) / 1000))),
    };
  };

  const discard = () => {
    if (cap) discardCapture(cap, null);
  };

  const teardown = (): boolean => {
    session += 1;
    const hadPrompt = starting;
    starting = false;
    const c = cap;
    cap = null;
    if (c) {
      clearTimers(c);
      void finalize(c);
    }
    return c !== null || hadPrompt;
  };

  return { start, send, discard, teardown };
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions): VoiceRecorderApi {
  const [state, dispatch] = useReducer(voiceRecorderReducer, VOICE_RECORDER_INITIAL);
  // The server render and the first client render draw the microphone, so the markup never differs; support is
  // read after mount and the microphone is withdrawn then when the browser cannot record (UI-D-841, A-UI-6).
  const [supported, setSupported] = useState(true);
  const optionsRef = useRef(options);
  const controllerRef = useRef<Controller | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createController(dispatch, () => optionsRef.current);
  }
  const controller = controllerRef.current;

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    setSupported(isVoiceRecordingSupported());
  }, []);

  const { active } = options;
  // A composer that stops being active mid-recording (disabled, replaced by a strip) discards the take at once.
  useEffect(() => {
    if (active) return;
    if (controller.teardown()) {
      dispatch({ type: 'reset' });
      optionsRef.current.onEvent?.({ type: 'discarded' });
    }
  }, [active, controller]);

  // Leaving the screen: release the microphone and drop the take.
  useEffect(() => () => void controller.teardown(), [controller]);

  return {
    state,
    supported,
    start: controller.start,
    send: controller.send,
    discard: controller.discard,
    clearProblem: () => dispatch({ type: 'clearProblem' }),
  };
}
