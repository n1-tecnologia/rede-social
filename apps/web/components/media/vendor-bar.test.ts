// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { isVendorBarEvent, PLAYBACK_RATES, SEEK_STEP_SECONDS } from './vendor-bar';

/**
 * 2026-11-18 — the origin rule the feed video and `video-sound` share: an event that comes from the
 * vendor's own bar (anything inside a `mux-player` except the video, the controller and the host) is
 * the bar's, never a tap on the video surface. The vendor's own gesture layer reads the same rule.
 */

/** What the rule answers while a composed, bubbling event from `target` passes the document. */
function ruleFor(target: Element, type = 'click'): boolean {
  let answer: boolean | null = null;
  const listener = (event: Event) => {
    answer = isVendorBarEvent(event);
  };
  document.addEventListener(type, listener, { once: true });
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  if (answer === null) throw new Error('the event never reached the document');
  return answer;
}

function player() {
  const host = document.createElement('mux-player');
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('vendor-bar constants', () => {
  it('the bar jumps 10 s and offers the 0.5 to 2 speeds the lessons use', () => {
    expect(SEEK_STEP_SECONDS).toBe(10);
    expect(PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});

describe('isVendorBarEvent', () => {
  it('is true for a control inside the player', () => {
    const host = player();
    const button = document.createElement('button');
    host.append(button);
    expect(ruleFor(button)).toBe(true);
  });

  it('is true for a control inside a shadow root inside the player', () => {
    const host = player();
    const wrapper = document.createElement('div');
    host.append(wrapper);
    const shadow = wrapper.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    shadow.append(button);
    expect(ruleFor(button)).toBe(true);
  });

  it('is false on the host itself, the video and the media controller', () => {
    const host = player();
    const video = document.createElement('video');
    const controller = document.createElement('media-controller');
    host.append(video, controller);
    expect(ruleFor(host)).toBe(false);
    expect(ruleFor(video)).toBe(false);
    expect(ruleFor(controller)).toBe(false);
  });

  it('is false outside any player', () => {
    const lone = document.createElement('button');
    document.body.append(lone);
    expect(ruleFor(lone)).toBe(false);
  });

  it('is false for an event with no usable composed path', () => {
    expect(isVendorBarEvent({} as Event)).toBe(false);
    expect(isVendorBarEvent({ composedPath: () => [] } as unknown as Event)).toBe(false);
    expect(isVendorBarEvent({ composedPath: () => [window] } as unknown as Event)).toBe(false);
  });
});
