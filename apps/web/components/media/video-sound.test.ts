// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetVideo,
  pauseVideo,
  playVideo,
  resetVideoSound,
  type SoundPlayable,
  setVideoSoundWanted,
  subscribeVideoSound,
  useVideoSoundAudible,
  useVideoSoundWanted,
  VENDOR_SOUND_PREF_KEYS,
  videoSoundAudible,
  videoSoundWanted,
} from './video-sound';

/**
 * 2026-10-20 — the one playback rule every video of the app follows (`video-sound.ts`): sound on by
 * default for the visit, a refusal keeps the video PLAYING muted until the next touch on a video,
 * a refusal even muted is the surface's tap-to-play, and nothing is ever stored.
 *
 * The "video" is a plain element whose `play` answers from a queue of outcomes (`ok` by default) and
 * records the mute it was asked with, so each case reads as the browser's answers in order. A touch
 * is a real `click`/`touchend` dispatched on the DOM, which the module hears on the document.
 */

type Outcome = 'ok' | 'NotAllowedError' | 'AbortError' | 'NotSupportedError';
type FakeVideo = SoundPlayable & { mutedAtPlay: boolean[]; pauses: number };

function fakeVideo(...outcomes: Outcome[]): FakeVideo {
  const element = document.createElement('div') as unknown as FakeVideo;
  element.muted = false;
  element.paused = true;
  element.mutedAtPlay = [];
  element.pauses = 0;
  element.play = () => {
    element.mutedAtPlay.push(element.muted === true);
    const outcome = outcomes.shift() ?? 'ok';
    if (outcome === 'ok') {
      element.paused = false;
      return Promise.resolve();
    }
    return Promise.reject(Object.assign(new Error(outcome), { name: outcome }));
  };
  element.pause = () => {
    element.pauses += 1;
    element.paused = true;
  };
  return element;
}

async function settle() {
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
}

/** A video surface on the page with a sound control and a child to touch. */
function surface() {
  const stage = document.createElement('div');
  stage.setAttribute('data-video-surface', '');
  const inside = document.createElement('span');
  const sound = document.createElement('button');
  sound.setAttribute('data-video-sound', '');
  stage.append(inside, sound);
  const outside = document.createElement('p');
  document.body.append(stage, outside);
  return { inside, sound, outside };
}

const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const touchEnd = (target: Element) =>
  target.dispatchEvent(new Event('touchend', { bubbles: true }));
const wanted = () => true;

beforeEach(() => {
  resetVideoSound();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'userActivation');
});

describe('video-sound', () => {
  it('plays with sound by default and drops the vendor stored mute once', async () => {
    window.localStorage.setItem(VENDOR_SOUND_PREF_KEYS[0] as string, 'true');
    window.localStorage.setItem(VENDOR_SOUND_PREF_KEYS[1] as string, '0');
    window.localStorage.setItem('unrelated', 'kept');
    const video = fakeVideo();

    playVideo(video, { stillWanted: wanted });
    await settle();

    expect(video.mutedAtPlay).toEqual([false]);
    expect(video.muted).toBe(false);
    expect(videoSoundWanted()).toBe(true);
    expect(videoSoundAudible()).toBe(true);
    for (const key of VENDOR_SOUND_PREF_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('kept');
  });

  it('keeps playing muted when the browser refuses the sound, never paused nor blocked', async () => {
    const video = fakeVideo('NotAllowedError');
    const onBlocked = vi.fn();

    playVideo(video, { stillWanted: wanted, onBlocked });
    await settle();

    expect(video.mutedAtPlay).toEqual([false, true]);
    expect(video.muted).toBe(true);
    expect(video.paused).toBe(false);
    expect(video.pauses).toBe(0);
    expect(onBlocked).not.toHaveBeenCalled();
    // The member still wants sound; the controls honestly read "Ativar som".
    expect(videoSoundWanted()).toBe(true);
    expect(videoSoundAudible()).toBe(false);
  });

  it('turns the sound on at the next touch inside a video, not outside nor on the sound control', async () => {
    const { inside, sound, outside } = surface();
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: wanted });
    await settle();

    click(outside);
    click(sound);
    await settle();
    expect(video.mutedAtPlay).toEqual([false, true]);

    touchEnd(inside);
    await settle();
    expect(video.mutedAtPlay).toEqual([false, true, false]);
    expect(video.muted).toBe(false);
    expect(videoSoundAudible()).toBe(true);
  });

  it('a click inside a video is a gesture too', async () => {
    const { inside } = surface();
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: wanted });
    await settle();

    click(inside);
    await settle();
    expect(video.muted).toBe(false);
    expect(videoSoundAudible()).toBe(true);
  });

  it('reports a refusal even muted as blocked, retried at the next touch only when asked', async () => {
    const { inside } = surface();
    const retried = fakeVideo('NotAllowedError', 'NotAllowedError');
    const once = fakeVideo('NotAllowedError', 'NotAllowedError');
    const onBlockedRetried = vi.fn();
    const onBlockedOnce = vi.fn();

    playVideo(retried, { stillWanted: wanted, onBlocked: onBlockedRetried, retryOnGesture: true });
    playVideo(once, { stillWanted: wanted, onBlocked: onBlockedOnce });
    await settle();

    expect(onBlockedRetried).toHaveBeenCalledOnce();
    expect(onBlockedOnce).toHaveBeenCalledOnce();
    // A blocked video is not "held back": the controls do not blame the sound.
    expect(videoSoundAudible()).toBe(true);

    touchEnd(inside);
    await settle();
    expect(retried.mutedAtPlay).toEqual([false, true, false]);
    expect(retried.paused).toBe(false);
    expect(once.mutedAtPlay).toEqual([false, true]);
  });

  it('re-issues a play aborted by the vendor at most twice, and not once the surface moved on', async () => {
    const video = fakeVideo('AbortError', 'AbortError', 'AbortError');
    const onBlocked = vi.fn();
    playVideo(video, { stillWanted: wanted, onBlocked });
    await settle();
    expect(video.mutedAtPlay).toEqual([false, false, false]);
    expect(onBlocked).not.toHaveBeenCalled();

    let still = true;
    const gone = fakeVideo('AbortError');
    playVideo(gone, { stillWanted: () => still });
    still = false;
    await settle();
    expect(gone.mutedAtPlay).toEqual([false]);
  });

  it('ignores a late refusal once a newer play replaced it', async () => {
    let refuse: (error: Error) => void = () => {};
    const video = fakeVideo();
    video.play = () => {
      video.mutedAtPlay.push(video.muted === true);
      if (video.mutedAtPlay.length === 1) {
        return new Promise<void>((_, reject) => {
          refuse = reject;
        });
      }
      return Promise.resolve();
    };

    playVideo(video, { stillWanted: wanted });
    playVideo(video, { stillWanted: wanted });
    refuse(Object.assign(new Error('late'), { name: 'NotAllowedError' }));
    await settle();

    expect(video.mutedAtPlay).toEqual([false, false]);
    expect(video.muted).toBe(false);
    expect(videoSoundAudible()).toBe(true);
  });

  it('muting reaches every playing video at once, and the sound comes back on all of them', async () => {
    const first = fakeVideo();
    const heldBack = fakeVideo('NotAllowedError');
    const blocked = fakeVideo('NotAllowedError', 'NotAllowedError');
    playVideo(first, { stillWanted: wanted });
    playVideo(heldBack, { stillWanted: wanted });
    playVideo(blocked, { stillWanted: wanted });
    await settle();

    act(() => setVideoSoundWanted(false));
    expect(videoSoundWanted()).toBe(false);
    expect(videoSoundAudible()).toBe(false);
    expect(first.muted).toBe(true);
    expect(heldBack.muted).toBe(true);

    // The next video of the visit starts muted too.
    const next = fakeVideo();
    playVideo(next, { stillWanted: wanted });
    await settle();
    expect(next.mutedAtPlay).toEqual([true]);

    act(() => setVideoSoundWanted(true));
    await settle();
    expect(first.muted).toBe(false);
    expect(heldBack.muted).toBe(false);
    expect(next.muted).toBe(false);
    expect(blocked.mutedAtPlay).toEqual([false, true]);
    expect(videoSoundAudible()).toBe(true);
  });

  it('keeps a held-back video muted (and playing) when asked for sound outside a gesture', async () => {
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: wanted });
    await settle();

    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: false },
    });
    playVideo(video, { stillWanted: wanted });
    await settle();

    expect(video.mutedAtPlay).toEqual([false, true, true]);
    expect(video.paused).toBe(false);
    expect(videoSoundAudible()).toBe(false);
  });

  it('ignores a touch the page has no activation for (a scripted click)', async () => {
    const { inside } = surface();
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: wanted });
    await settle();

    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: false },
    });
    click(inside);
    await settle();
    expect(video.mutedAtPlay).toEqual([false, true]);
  });

  it('a paused or forgotten video no longer counts, and pausing pauses it', async () => {
    const paused = fakeVideo('NotAllowedError');
    const forgotten = fakeVideo('NotAllowedError');
    playVideo(paused, { stillWanted: wanted });
    playVideo(forgotten, { stillWanted: wanted });
    await settle();
    expect(videoSoundAudible()).toBe(false);

    pauseVideo(paused);
    expect(paused.pauses).toBe(1);
    expect(videoSoundAudible()).toBe(false);

    forgetVideo(forgotten);
    expect(forgotten.pauses).toBe(0);
    expect(videoSoundAudible()).toBe(true);
  });

  it('a video whose surface moved on stops counting as held back', async () => {
    let still = true;
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: () => still });
    await settle();
    expect(videoSoundAudible()).toBe(false);

    still = false;
    expect(videoSoundAudible()).toBe(true);
  });

  it('stores nothing: the choice lives for the visit only', async () => {
    const video = fakeVideo('NotAllowedError');
    playVideo(video, { stillWanted: wanted });
    await settle();
    act(() => setVideoSoundWanted(false));
    act(() => setVideoSoundWanted(true));
    await settle();

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    resetVideoSound();
    expect(videoSoundWanted()).toBe(true);
  });

  it('tells its subscribers and the hooks about every change', async () => {
    const listener = vi.fn();
    const stop = subscribeVideoSound(listener);
    const { result } = renderHook(() => [useVideoSoundWanted(), useVideoSoundAudible()]);
    expect(result.current).toEqual([true, true]);

    const video = fakeVideo('NotAllowedError');
    await act(async () => {
      playVideo(video, { stillWanted: wanted });
      await settle();
    });
    expect(result.current).toEqual([true, false]);
    expect(listener).toHaveBeenCalled();

    act(() => setVideoSoundWanted(false));
    expect(result.current).toEqual([false, false]);

    listener.mockClear();
    stop();
    act(() => setVideoSoundWanted(true));
    expect(listener).not.toHaveBeenCalled();
    await settle();
  });
});
