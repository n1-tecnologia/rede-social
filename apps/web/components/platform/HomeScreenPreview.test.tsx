// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeScreenPreview, type HomeScreenTile } from './HomeScreenPreview';

/**
 * The home-screen preview's Android tile (2026-10-20, the client's request): by default the
 * worker's maskable look, the icon at 80% (`ANDROID_SAFE_ZONE`) inside a circle of the primary; with
 * `androidFill`, the art takes the whole circle, with no inset and no ground that could show as a
 * ring of another colour. The iPhone tile is the same either way.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const LABELS = { aria: 'Prévia', ios: 'iPhone', android: 'Android' };

function preview(androidFill?: boolean) {
  return render(
    <HomeScreenPreview
      displayName="Clube Aurora"
      primary="#7c3aed"
      labels={LABELS}
      androidFill={androidFill}
      renderIcon={(tile: HomeScreenTile) => <span data-icon={tile} className="size-full" />}
    />,
  );
}

const tile = (name: HomeScreenTile) =>
  document.querySelector(`[data-home-tile="${name}"]`) as HTMLElement;

afterEach(cleanup);

describe('HomeScreenPreview — the Android tile', () => {
  it('by default the icon sits at 80% inside the primary’s circle', () => {
    preview();
    const android = tile('android');
    expect(android.getAttribute('data-android-icon')).toBe('safe-zone');
    expect(android.style.backgroundColor).not.toBe('');
    const box = android.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('80%');
    expect(box.style.height).toBe('80%');
  });

  it('with androidFill the art takes the whole circle, with no inset and no ground', () => {
    preview(true);
    const android = tile('android');
    expect(android.getAttribute('data-android-icon')).toBe('fill');
    expect(android.className).toContain('rounded-full');
    expect(android.style.backgroundColor).toBe('');
    const box = android.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('');
    expect(box.className).toContain('size-full');
    expect(box.querySelector('[data-icon="android"]')).not.toBeNull();
  });

  it('the iPhone tile is the same either way', () => {
    preview();
    const before = tile('ios').outerHTML;
    cleanup();
    preview(true);
    expect(tile('ios').outerHTML).toBe(before);
  });
});
