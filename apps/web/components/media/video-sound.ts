import { useSyncExternalStore } from 'react';

/**
 * 2026-10-20 — ONE playback rule for every video of the app (the client's "FRONT.pdf"): stories,
 * the feed, Reels, the media library and the composers' previews all play through here.
 *
 * - **Sound on by default.** A video plays WITH sound unless the member muted one. That choice is
 *   the visit's (every surface shares it) and is never stored: a reload means sound again.
 * - **Never paused by a refusal.** A browser that refuses sound outside a gesture (iOS always, Chrome
 *   before the page's first interaction) answers `play()` with `NotAllowedError`: the video then keeps
 *   PLAYING muted, marked "held back", so every sound control honestly reads "Ativar som". The next
 *   touch or click inside a video surface (`[data-video-surface]`, outside the sound control itself,
 *   `[data-video-sound]`) replays it with sound INSIDE that gesture, which is what iOS needs
 *   (`touchend` there, since `pointerup` does not count as a media gesture in WebKit).
 * - **Refused even muted** (Low Power Mode, data saver): `onBlocked`, the surface's tap-to-play is
 *   the one exception. With `retryOnGesture` the next surface touch tries again.
 * - **Held back stays muted outside a gesture.** Unmuting a playing element without user activation
 *   makes WebKit and Chrome PAUSE it, so a held-back element asked for sound when the page has no
 *   activation (`navigator.userActivation.isActive === false`) keeps playing muted instead.
 *
 * `noMutedPref` does not reach media-chrome's controller in mux-player 3.13.4, so a mute the
 * vendor's own button once stored (`media-chrome-pref-muted`) would silence every player that
 * attaches unmuted: `forgetVendorSoundPrefs` drops both vendor keys once per page.
 */

/** The media-element surface used on the vendor node (or a plain `<video>`). */
export type SoundPlayable = HTMLElement & {
  play?: () => Promise<void> | void;
  pause?: () => void;
  muted?: boolean;
  paused?: boolean;
};

export type PlayVideoOptions = {
  /** Play with sound; defaults to the member's choice for the visit (`videoSoundWanted()`). */
  sound?: boolean;
  /** False once the surface paused, moved on or unmounted: a late rejection then changes nothing. */
  stillWanted: () => boolean;
  /** The browser refused even a muted play: the surface shows its tap-to-play. */
  onBlocked?: () => void;
  /** A blocked element plays again at the next touch on a video surface (stories, composer). */
  retryOnGesture?: boolean;
};

type EntryState = 'playing' | 'heldBack' | 'blocked';
type Entry = { state: EntryState; options: PlayVideoOptions };

/** An `AbortError` from the vendor attaching its source is re-issued this many times (05.3-09). */
const PLAY_ABORT_RETRIES = 2;
/** media-chrome's own stored preferences (`state-mediator.js`), which would re-mute a player. */
export const VENDOR_SOUND_PREF_KEYS = ['media-chrome-pref-muted', 'media-chrome-pref-volume'];

let wanted = true;
const entries = new Map<SoundPlayable, Entry>();
const listeners = new Set<() => void>();
let gestureInstalled = false;
let prefsForgotten = false;

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

/** `false` only when the browser says the page has NO user activation right now. */
function activationAllows(): boolean {
  if (typeof navigator === 'undefined') return true;
  const activation = (navigator as { userActivation?: { isActive?: boolean } }).userActivation;
  return activation?.isActive !== false;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Drops the vendor's stored mute and volume (best effort: storage may be blocked). */
export function forgetVendorSoundPrefs(): void {
  try {
    for (const key of VENDOR_SOUND_PREF_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage blocked (private mode, a sandbox): nothing was stored either.
  }
}

/** Every held-back element (and every blocked one that asked to) replays with sound in the gesture. */
function onGesture(event: Event): void {
  if (!wanted) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('[data-video-surface]') || target.closest('[data-video-sound]')) return;
  if (!activationAllows()) return;
  for (const [element, entry] of [...entries]) {
    if (!entry.options.stillWanted()) {
      entries.delete(element);
      continue;
    }
    if (entry.state === 'heldBack' || (entry.state === 'blocked' && entry.options.retryOnGesture)) {
      playVideo(element, { ...entry.options, sound: true });
    }
  }
}

function setUp(): void {
  if (typeof document === 'undefined') return;
  if (!prefsForgotten) {
    prefsForgotten = true;
    forgetVendorSoundPrefs();
  }
  if (gestureInstalled) return;
  gestureInstalled = true;
  document.addEventListener('touchend', onGesture, { capture: true, passive: true });
  document.addEventListener('click', onGesture, { capture: true });
}

function attempt(target: SoundPlayable, entry: Entry, withSound: boolean, aborted: number): void {
  target.muted = !withSound;
  let result: Promise<void> | void;
  try {
    result = target.play?.();
  } catch (error) {
    result = Promise.reject(error);
  }
  if (!result || typeof result.then !== 'function') return;
  result.then(undefined, (error: unknown) => {
    // A newer play (or a pause) replaced this one, or the surface moved on: nothing to fix.
    if (entries.get(target) !== entry || !entry.options.stillWanted()) return;
    const name = errorName(error);
    if (name === 'AbortError') {
      // Re-issued with the CURRENT mute: the member may have silenced every video meanwhile.
      if (aborted < PLAY_ABORT_RETRIES) attempt(target, entry, withSound && wanted, aborted + 1);
      return;
    }
    if (name === 'NotAllowedError' && withSound) {
      entry.state = 'heldBack';
      notify();
      attempt(target, entry, false, aborted);
      return;
    }
    entry.state = 'blocked';
    notify();
    entry.options.onBlocked?.();
  });
}

/**
 * Plays `target` under the rule above (sound by default, muted when refused, `onBlocked` when even
 * that fails). Safe to call again on the same element: the newest call wins.
 */
export function playVideo(target: SoundPlayable, options: PlayVideoOptions): void {
  setUp();
  const sound = options.sound ?? wanted;
  const previous = entries.get(target);
  // Unmuting a held-back element without activation would pause it: it stays muted until a touch.
  const askSound = sound && !(previous?.state === 'heldBack' && !activationAllows());
  const entry: Entry = { state: sound && !askSound ? 'heldBack' : 'playing', options };
  entries.set(target, entry);
  attempt(target, entry, askSound, 0);
  notify();
}

/** Pauses `target` and stops tracking it (a paused video is never "held back"). */
export function pauseVideo(target: SoundPlayable): void {
  entries.delete(target);
  target.pause?.();
  notify();
}

/** Stops tracking `target` (it detached or unmounted) without touching it. */
export function forgetVideo(target: SoundPlayable): void {
  if (!entries.delete(target)) return;
  notify();
}

/** The member's choice for the visit: `true` until they mute a video. */
export function videoSoundWanted(): boolean {
  return wanted;
}

/** What the sound controls show: wanted, and no playing video held back by the browser. */
export function videoSoundAudible(): boolean {
  if (!wanted) return false;
  for (const entry of entries.values()) {
    if (entry.state === 'heldBack' && entry.options.stillWanted()) return false;
  }
  return true;
}

/**
 * The member turns the sound on or off. Call it INSIDE the sound control's click: turning it on
 * replays every playing video with sound in that gesture (held-back ones included), turning it off
 * mutes them all at once.
 */
export function setVideoSoundWanted(next: boolean): void {
  wanted = next;
  for (const [element, entry] of [...entries]) {
    if (!entry.options.stillWanted()) {
      entries.delete(element);
      continue;
    }
    if (entry.state === 'blocked') continue;
    if (next) {
      playVideo(element, { ...entry.options, sound: true });
    } else {
      element.muted = true;
      entry.state = 'playing';
    }
  }
  notify();
}

/** For non-React readers (refs in hosts): called whenever the choice or a video's state changes. */
export function subscribeVideoSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSound = () => true;

export function useVideoSoundWanted(): boolean {
  return useSyncExternalStore(subscribeVideoSound, videoSoundWanted, serverSound);
}

export function useVideoSoundAudible(): boolean {
  return useSyncExternalStore(subscribeVideoSound, videoSoundAudible, serverSound);
}

/** Tests: the sound on again, nothing tracked. */
export function resetVideoSound(): void {
  wanted = true;
  entries.clear();
  prefsForgotten = false;
  notify();
}
