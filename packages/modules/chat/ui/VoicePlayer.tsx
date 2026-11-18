'use client';

import { cn } from '@rede-social/ui';
import { CircleAlert, LoaderCircle, Pause, Play, RotateCw } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from 'react';
import { playbackController } from './voice-playback-controller';

/**
 * The voice player of a bubble (D-853, D-854, UI-D-848..UI-D-851): a play disc, a native range as the bar,
 * the time line and the speed pill, in one row.
 *
 * - **Nothing loads until a tap** (VOICE-19, T-12.5-53). The bubble draws from the stored duration; the audio
 *   element has `preload="none"` and NO `src`. The first tap assigns the host-supplied same-origin path and
 *   calls `play()` in the SAME synchronous handler (WebKit wants `play()` inside the gesture; nothing is
 *   awaited first).
 * - **The bar's maximum is the stored duration**, never the element's own length (a browser recording can
 *   report none or an infinite one), and nothing here asks the element what it can decode: a refusal arrives
 *   as the element's `error` event or a rejected `play()`.
 * - **One at a time** through `playbackController`: starting any player pauses every other and each keeps its
 *   position; no autoplay, no mini-player, no Media Session handler.
 * - **No receipts** (D-855): there is no callback for "played" and nothing is stored by playing.
 *
 * Props-only: every word, number, formatter and the media path arrive from the host. On the thumb and the
 * fill there is NO transition: they move with the audio clock, which is progress, not decoration.
 */

export interface VoicePlayerLabels {
  /** Name of the disc while it can start the message. */
  play: string;
  /** Name of the disc while the message plays. */
  pause: string;
  /** Name of the disc while it waits for sound (a tap cancels). */
  loading: string;
  /** Name of the disc in the error state (a tap fetches a fresh link). */
  retry: string;
  /** Name of the bar. */
  seek: string;
  /** The time-line sentence of the error state. */
  error: string;
  /** The time-line sentence of the unsupported state. */
  unsupported: string;
  /** Name of the speed pill for a finished rate label, e.g. "Velocidade de reprodução: 1,5x". */
  speed: (rate: string) => string;
  /** `aria-valuetext` of the bar, e.g. "0:12 de 0:42". */
  seekValue: (current: string, total: string) => string;
}

export interface VoicePlayerProps {
  /** The same-origin media path the host built; assigned to the element on the first tap and never before. */
  src: string;
  /** The stored, server-checked length in seconds: draws the bubble and bounds the bar. */
  durationSeconds: number;
  /** The bubble's side: `own` sits on the brand fill, `other` on the neutral surface. */
  own: boolean;
  labels: VoicePlayerLabels;
  /** `m:ss` for a number of seconds. */
  formatClock: (seconds: number) => string;
  /** The speed after `rate` (1, 1.5, 2 and back to 1). */
  nextRate: (rate: number) => number;
  /** The finished label of a speed, "1,5x". */
  rateLabel: (rate: number) => string;
  /** Called with the new speed label after each tap on the pill; the thread's polite region speaks it. */
  onRateChange?: (label: string) => void;
  /** Disables every control (a host that cannot play right now). */
  disabled?: boolean;
}

type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'unsupported';

interface PlayerState {
  phase: Phase;
  /** Seconds, the element's clock (or the remembered position of a seek made while idle). */
  position: number;
  /** The live value of a drag in progress; the sound jumps only on release. */
  drag: number | null;
}

type PlayerEvent =
  | { type: 'loading' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'cancel' }
  | { type: 'ended' }
  | { type: 'error' }
  | { type: 'unsupported' }
  | { type: 'time'; seconds: number }
  | { type: 'seek'; seconds: number }
  | { type: 'drag'; seconds: number };

const INITIAL: PlayerState = { phase: 'idle', position: 0, drag: null };

function reducer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case 'loading':
      return state.phase === 'idle' || state.phase === 'paused' || state.phase === 'error'
        ? { ...state, phase: 'loading', drag: null }
        : state;
    case 'playing':
      // A late `playing` after a cancel (phase idle) or after a failure changes nothing.
      return state.phase === 'loading' || state.phase === 'paused' || state.phase === 'playing'
        ? { ...state, phase: 'playing' }
        : state;
    case 'paused':
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'cancel':
      return state.phase === 'loading' ? { ...state, phase: 'idle' } : state;
    case 'ended':
      return { phase: 'idle', position: 0, drag: null };
    case 'error':
      return state.phase === 'unsupported' ? state : { ...state, phase: 'error', drag: null };
    case 'unsupported':
      return { ...state, phase: 'unsupported', drag: null };
    case 'time':
      // After an end (idle) or a failure a stray tick must not move the thumb.
      return state.phase === 'idle' || state.phase === 'error' || state.phase === 'unsupported'
        ? state
        : { ...state, position: event.seconds };
    case 'seek':
      return state.phase === 'error' || state.phase === 'unsupported'
        ? state
        : { ...state, position: event.seconds, drag: null };
    case 'drag':
      return state.phase === 'error' || state.phase === 'unsupported' || state.phase === 'loading'
        ? state
        : { ...state, drag: event.seconds };
  }
}

/** No sound within this long after a tap is the error state (UI-D-849). */
const LOADING_TIMEOUT_MS = 15_000;
/** Arrow keys on the bar, and the page keys (UI-D-849). */
const KEY_STEP_SECONDS = 5;
const KEY_PAGE_SECONDS = 15;

const OWN_RING = 'focus-visible:ring-on-brand focus-visible:ring-offset-brand';
const OTHER_RING = 'focus-visible:ring-brand focus-visible:ring-offset-bg-secondary';

/** A fresh link: the same path with a changing query, so the browser's cached private redirect is bypassed. */
function withCacheBuster(path: string, attempt: number): string {
  return `${path}${path.includes('?') ? '&' : '?'}r=${attempt}-${Date.now()}`;
}

/** The play disc: 40px visual, 44px touch area (the shipped hit-area technique). */
function discClass(own: boolean): string {
  return cn(
    'relative grid h-10 w-10 shrink-0 place-items-center rounded-full after:absolute after:-inset-0.5',
    own ? 'bg-on-brand text-brand' : 'bg-button bg-(image:--button-image) text-on-button',
  );
}

/** The 4px track (the unplayed colour; the played fill sits inside). */
function trackClass(own: boolean, off: boolean): string {
  return cn(
    'absolute inset-x-0 top-1/2 -mt-0.5 h-1 overflow-hidden rounded-full',
    own ? 'bg-on-brand/30' : 'bg-bg-tertiary',
    off && 'opacity-50',
  );
}

/** The played part of the track. No transition: it moves with the audio clock. */
function fillClass(own: boolean): string {
  return cn('h-full rounded-full', own ? 'bg-on-brand' : 'bg-text');
}

/** The 40x32 speed pill with a 44px touch area. */
function pillClass(own: boolean): string {
  return cn(
    'relative grid h-8 w-10 shrink-0 place-items-center whitespace-nowrap rounded-full text-sm font-bold leading-none tabular-nums after:absolute after:-inset-x-0.5 after:-inset-y-1.5',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    own ? 'bg-on-brand/20 text-on-brand' : 'bg-bg-tertiary text-text-secondary',
    own ? OWN_RING : OTHER_RING,
  );
}

function timeClass(own: boolean, wraps: boolean): string {
  return cn(
    'min-w-0 text-sm font-normal leading-5 tabular-nums',
    wraps ? 'break-words' : 'truncate',
    own ? 'text-on-brand' : 'text-text-secondary',
  );
}

export function VoicePlayer({
  src,
  durationSeconds,
  own,
  labels,
  formatClock,
  nextRate,
  rateLabel,
  onRateChange,
  disabled = false,
}: VoicePlayerProps) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [rate, setRate] = useState(1);
  const phaseRef = useRef<Phase>('idle');
  const positionRef = useRef(0);
  const rateRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const retriesRef = useRef(0);
  /** True once the element reported metadata for the CURRENT source (reset by a fresh link). */
  const loadedRef = useRef(false);
  /** True once this element ever played: a later code 4 is then the link, not the format. */
  const everLoadedRef = useRef(false);
  /** A position to apply when the file loads (a seek made while idle, or the resume after an error). */
  const pendingSeekRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragValueRef = useRef(0);
  phaseRef.current = state.phase;
  positionRef.current = state.position;
  rateRef.current = rate;

  const total = Math.max(0, Math.round(durationSeconds));
  const totalRef = useRef(total);
  totalRef.current = total;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Leave the loading state without sound: pause the element and forget the attempt. */
  const cancel = useCallback(() => {
    attemptRef.current += 1;
    clearTimer();
    audioRef.current?.pause();
    dispatch({ type: 'cancel' });
  }, [clearTimer]);

  /** A failure: stop the element, forget the attempt, keep the position (the thumb stays). */
  const fail = useCallback(
    (kind: 'error' | 'unsupported') => {
      attemptRef.current += 1;
      clearTimer();
      audioRef.current?.pause();
      dispatch({ type: kind });
    },
    [clearTimer],
  );

  // The controller's way to quiet this player: a playing one pauses (and keeps its place), a loading one
  // goes back to idle, anything else has nothing to do. Unmounting pauses, releases and drops the download.
  useEffect(() => {
    const audio = audioRef.current;
    const release = playbackController.register(id, () => {
      if (phaseRef.current === 'loading') cancel();
      else if (phaseRef.current === 'playing') audioRef.current?.pause();
    });
    return () => {
      release();
      clearTimer();
      attemptRef.current += 1;
      if (audio) {
        audio.pause();
        if (audio.hasAttribute('src')) {
          audio.removeAttribute('src');
          audio.load();
        }
      }
    };
  }, [id, cancel, clearTimer]);

  function applyPendingSeek() {
    const audio = audioRef.current;
    const pending = pendingSeekRef.current;
    if (audio && pending !== null) {
      audio.currentTime = pending;
      pendingSeekRef.current = null;
    }
  }

  function start(fresh: boolean) {
    const audio = audioRef.current;
    if (!audio) return;
    playbackController.activate(id);
    if (fresh) {
      // A fresh link resumes from the position the failure left (the thumb stayed there).
      retriesRef.current += 1;
      loadedRef.current = false;
      audio.src = withCacheBuster(src, retriesRef.current);
    } else if (!audio.hasAttribute('src')) {
      // The first tap hands the element its source, and `play()` follows in the SAME synchronous handler.
      audio.src = src;
    }
    if (!loadedRef.current && positionRef.current > 0) pendingSeekRef.current = positionRef.current;
    audio.defaultPlaybackRate = rateRef.current;
    audio.playbackRate = rateRef.current;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    let promise: Promise<void> | undefined;
    try {
      promise = audio.play() as Promise<void> | undefined;
    } catch {
      fail('error');
      return;
    }
    if (loadedRef.current) {
      dispatch({ type: 'playing' });
    } else {
      dispatch({ type: 'loading' });
      clearTimer();
      timerRef.current = setTimeout(() => fail('error'), LOADING_TIMEOUT_MS);
    }
    promise?.catch((reason: unknown) => {
      // A pause (a cancel, another player starting) rejects the play it interrupts: that is not a failure.
      if (attempt !== attemptRef.current) return;
      const name = (reason as { name?: string } | null)?.name;
      if (name === 'AbortError') return;
      fail(name === 'NotSupportedError' ? 'unsupported' : 'error');
    });
  }

  function onDisc() {
    const audio = audioRef.current;
    if (!audio || disabled) return;
    switch (phaseRef.current) {
      case 'loading':
        cancel();
        break;
      case 'playing':
        audio.pause();
        break;
      case 'error':
        start(true);
        break;
      case 'unsupported':
        break;
      default:
        start(false);
    }
  }

  /** Move to `seconds`: the element when its file is loaded, else remembered for the load. */
  function commitSeek(seconds: number) {
    const value = Math.min(Math.max(Math.round(seconds), 0), totalRef.current);
    const audio = audioRef.current;
    if (loadedRef.current && audio) audio.currentTime = value;
    else pendingSeekRef.current = value;
    dispatch({ type: 'seek', seconds: value });
  }

  function endDrag() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    commitSeek(dragValueRef.current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const here = positionRef.current;
    let target: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        target = here + KEY_STEP_SECONDS;
        break;
      case 'ArrowLeft':
        target = here - KEY_STEP_SECONDS;
        break;
      case 'PageUp':
        target = here + KEY_PAGE_SECONDS;
        break;
      case 'PageDown':
        target = here - KEY_PAGE_SECONDS;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = totalRef.current;
        break;
    }
    if (target === null) return;
    event.preventDefault();
    commitSeek(target);
  }

  function cycleRate() {
    const next = nextRate(rate);
    setRate(next);
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = next;
      audio.playbackRate = next;
    }
    onRateChange?.(rateLabel(next));
  }

  const { phase } = state;
  const loading = phase === 'loading';
  const playing = phase === 'playing';
  const failed = phase === 'error';
  const unsupported = phase === 'unsupported';
  const shown = Math.min(Math.max(Math.floor(state.drag ?? state.position), 0), total);
  const ratio = total > 0 ? shown / total : 0;
  const started = phase !== 'idle' || state.position > 0;
  const barOff = disabled || loading || failed || unsupported;
  const rateText = rateLabel(rate);
  const message = failed ? labels.error : unsupported ? labels.unsupported : null;
  const timeLine =
    message ?? (started ? `${formatClock(shown)} / ${formatClock(total)}` : formatClock(total));
  const ring = own ? OWN_RING : OTHER_RING;
  const discBase = discClass(own);

  return (
    <div className="flex items-center gap-2">
      {/* A voice message has no transcript by decision (D-855), so there is no caption track to offer. */}
      {/* biome-ignore lint/a11y/useMediaCaption: no transcript exists for a voice message (D-855, UI-D-857) */}
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={() => {
          loadedRef.current = true;
          everLoadedRef.current = true;
          const audio = audioRef.current;
          // Loading a source resets the speed to the default one: put the member's choice back.
          if (audio) audio.playbackRate = rateRef.current;
          applyPendingSeek();
        }}
        onPlaying={() => {
          clearTimer();
          loadedRef.current = true;
          everLoadedRef.current = true;
          applyPendingSeek();
          dispatch({ type: 'playing' });
        }}
        onPause={() => dispatch({ type: 'paused' })}
        onEnded={() => {
          clearTimer();
          const audio = audioRef.current;
          if (audio) audio.currentTime = 0;
          pendingSeekRef.current = null;
          dispatch({ type: 'ended' });
        }}
        onTimeUpdate={(event) =>
          dispatch({ type: 'time', seconds: event.currentTarget.currentTime })
        }
        onError={(event) => {
          const code = event.currentTarget.error?.code;
          // Code 1 is our own abort (a changed source); ignore it.
          if (code === 1) return;
          // Code 4 is "cannot decode", but only before this element ever played: after that it is the
          // link (an expired or refused one), which a tap can fix.
          fail(code === 4 && !everLoadedRef.current ? 'unsupported' : 'error');
        }}
      />
      {unsupported ? (
        <span aria-hidden className={cn(discBase, 'opacity-50')}>
          <CircleAlert size={20} aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          aria-label={
            failed ? labels.retry : loading ? labels.loading : playing ? labels.pause : labels.play
          }
          aria-busy={loading || undefined}
          disabled={disabled}
          onClick={onDisc}
          className={cn(
            discBase,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
            ring,
          )}
        >
          {failed ? (
            <RotateCw size={20} aria-hidden />
          ) : loading ? (
            <>
              <LoaderCircle
                size={20}
                aria-hidden
                className="hidden motion-safe:block motion-safe:animate-spin"
              />
              <Play size={20} aria-hidden className="fill-current opacity-50 motion-safe:hidden" />
            </>
          ) : playing ? (
            <Pause size={20} aria-hidden className="fill-current" />
          ) : (
            <Play size={20} aria-hidden className="fill-current" />
          )}
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative h-4">
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={shown}
            aria-label={labels.seek}
            aria-valuetext={labels.seekValue(formatClock(shown), formatClock(total))}
            disabled={barOff}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (draggingRef.current) {
                dragValueRef.current = value;
                dispatch({ type: 'drag', seconds: value });
              } else {
                commitSeek(value);
              }
            }}
            onPointerDown={() => {
              draggingRef.current = true;
              dragValueRef.current = shown;
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onBlur={endDrag}
            onKeyDown={onKeyDown}
            className="peer absolute inset-x-0 top-1/2 z-10 m-0 h-11 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none"
          />
          <div aria-hidden className={trackClass(own, barOff)}>
            <div
              className={fillClass(own)}
              style={{ width: `calc(8px + ${ratio} * (100% - 16px))` }}
            />
          </div>
          <div
            aria-hidden
            className={cn(
              'absolute top-0 h-4 w-4 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
              own
                ? 'bg-on-brand peer-focus-visible:ring-on-brand peer-focus-visible:ring-offset-brand'
                : 'bg-text peer-focus-visible:ring-brand peer-focus-visible:ring-offset-bg-secondary',
              barOff && 'opacity-50',
            )}
            style={{ left: `calc(${ratio} * (100% - 16px))` }}
          />
        </div>
        <span className={timeClass(own, message !== null)}>{timeLine}</span>
      </div>
      <button
        type="button"
        aria-label={labels.speed(rateText)}
        disabled={disabled || loading || failed || unsupported}
        onClick={cycleRate}
        className={pillClass(own)}
      >
        {rateText}
      </button>
    </div>
  );
}

export interface VoicePlayerGhostProps {
  /** The stored length: the time line already shows it while the file is not on the server yet or failed. */
  durationSeconds: number;
  own: boolean;
  labels: Pick<VoicePlayerLabels, 'play' | 'seek' | 'speed'>;
  formatClock: (seconds: number) => string;
  /** The finished label of the first speed, "1x": the pill is drawn but cannot be used. */
  rateLabel: (rate: number) => string;
  /**
   * An upload in flight (UI-D-846): the bar becomes a determinate `role="progressbar"` named by the host,
   * `percent` null while the first byte has not moved (an indeterminate, empty bar). Absent on a failed
   * bubble (UI-D-847), whose bar is empty and disabled: a frozen partial fill would read as "62% uploaded".
   */
  progress?: { percent: number | null; label: string };
}

/**
 * The player's exact geometry with nothing to play (UI-D-846, UI-D-847): the pending upload and the failed
 * send. The disc, the bar and the speed pill are all disabled, there is no audio element and no media
 * request, and nothing here can start a sound.
 */
export function VoicePlayerGhost({
  durationSeconds,
  own,
  labels,
  formatClock,
  rateLabel,
  progress,
}: VoicePlayerGhostProps) {
  const total = Math.max(0, Math.round(durationSeconds));
  const percent = progress?.percent == null ? null : Math.min(Math.max(progress.percent, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={labels.play}
        disabled
        className={cn(discClass(own), 'disabled:pointer-events-none disabled:opacity-50')}
      >
        <Play size={20} aria-hidden className="fill-current" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative h-4">
          {progress ? (
            <div
              role="progressbar"
              aria-label={progress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="absolute inset-0"
            >
              <div aria-hidden className={trackClass(own, false)}>
                <div className={fillClass(own)} style={{ width: `${percent ?? 0}%` }} />
              </div>
            </div>
          ) : (
            <>
              <input
                type="range"
                min={0}
                max={total}
                value={0}
                aria-label={labels.seek}
                disabled
                readOnly
                className="absolute inset-x-0 top-1/2 m-0 h-11 w-full -translate-y-1/2 appearance-none bg-transparent opacity-0"
              />
              <div aria-hidden className={trackClass(own, true)} />
              <div
                aria-hidden
                className={cn(
                  'absolute left-0 top-0 h-4 w-4 rounded-full opacity-50',
                  own ? 'bg-on-brand' : 'bg-text',
                )}
              />
            </>
          )}
        </div>
        <span className={timeClass(own, false)}>{formatClock(total)}</span>
      </div>
      <button
        type="button"
        aria-label={labels.speed(rateLabel(1))}
        disabled
        className={pillClass(own)}
      >
        {rateLabel(1)}
      </button>
    </div>
  );
}
