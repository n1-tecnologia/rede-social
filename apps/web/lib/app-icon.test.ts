import { describe, expect, it } from 'vitest';
import {
  ANDROID_SAFE_ZONE,
  APP_ICON_SIZE,
  type AppIconSettings,
  appIconSpec,
  clampLogoScale,
  containRect,
  coverCrop,
  DEFAULT_APP_ICON_SETTINGS,
  drawAppIcon,
  followsPrimary,
  HOME_SCREEN_LABEL_MAX,
  homeScreenLabel,
  type IconContext,
  type IconImage,
  LOGO_SCALE,
  resolveBackground,
} from './app-icon';
import { SHORT_NAME_MAX, shortName } from './manifest';

/**
 * 2026-10-09 — the app icon's pure half: the geometry (contain for the logo, a centred cover crop
 * for the images), the size slider's bounds, the drawing ORDER on a recording context (the ground
 * always first, over the whole square, so iOS never shows black through it), what follows the
 * primary, and the home screen's name, which must stay the manifest's `short_name` rule although
 * it is copied (the manifest module is server-only).
 */

type Call = [string, ...unknown[]];

/** A context that records what is drawn, and the fill colour of every `fillRect`. */
function recorder(): IconContext & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    fillRect(...args: number[]) {
      calls.push(['fillRect', this.fillStyle, ...args]);
    },
    drawImage(image: unknown, ...args: number[]) {
      calls.push(['drawImage', image, ...args]);
    },
  };
}

const image = (name: string, width: number, height: number): IconImage => ({
  source: name as unknown as CanvasImageSource,
  width,
  height,
});

const settings = (over: Partial<AppIconSettings> = {}): AppIconSettings => ({
  ...DEFAULT_APP_ICON_SETTINGS,
  ...over,
});

describe('containRect and coverCrop', () => {
  it('fits a wide logo whole in the centred box, at the chosen share of the side', () => {
    const rect = containRect({ width: 320, height: 96 }, 1024, 0.7);
    expect(rect.width).toBeCloseTo(716.8);
    expect(rect.height).toBeCloseTo(215.04);
    expect(rect.x).toBeCloseTo(153.6);
    expect(rect.y).toBeCloseTo(404.48);
  });

  it('fits a tall logo by its height, and a square one exactly in the box', () => {
    expect(containRect({ width: 100, height: 400 }, 1024, 1)).toEqual({
      x: 384,
      y: 0,
      width: 256,
      height: 1024,
    });
    expect(containRect({ width: 50, height: 50 }, 1024, 0.5)).toEqual({
      x: 256,
      y: 256,
      width: 512,
      height: 512,
    });
  });

  it('lands an empty source as an empty rect in the centre', () => {
    expect(containRect({ width: 0, height: 10 }, 1024, 0.7)).toEqual({
      x: 512,
      y: 512,
      width: 0,
      height: 0,
    });
  });

  it('crops the centred square of a landscape, a portrait and a square image', () => {
    expect(coverCrop({ width: 1600, height: 900 })).toEqual({
      x: 350,
      y: 0,
      width: 900,
      height: 900,
    });
    expect(coverCrop({ width: 900, height: 1600 })).toEqual({
      x: 0,
      y: 350,
      width: 900,
      height: 900,
    });
    expect(coverCrop({ width: 512, height: 512 })).toEqual({ x: 0, y: 0, width: 512, height: 512 });
  });
});

describe('clampLogoScale', () => {
  it('keeps the share between 30% and 100%, and reads anything not a number as 70%', () => {
    expect(clampLogoScale(0.55)).toBe(0.55);
    expect(clampLogoScale(0.1)).toBe(LOGO_SCALE.min);
    expect(clampLogoScale(3)).toBe(LOGO_SCALE.max);
    expect(clampLogoScale(Number.POSITIVE_INFINITY)).toBe(LOGO_SCALE.max);
    expect(clampLogoScale(Number.NEGATIVE_INFINITY)).toBe(LOGO_SCALE.min);
    expect(clampLogoScale(Number.NaN)).toBe(LOGO_SCALE.default);
    expect(LOGO_SCALE.default).toBe(0.7);
  });
});

describe('drawAppIcon', () => {
  it('paints the ground over the whole square first, then the ground image, then the logo', () => {
    const ctx = recorder();
    const backgroundImage = image('ground', 1600, 900);
    const logo = image('logo', 320, 96);
    drawAppIcon(
      ctx,
      { mode: 'logo', background: '#0e7490', backgroundImage, logo, logoScale: 0.7 },
      APP_ICON_SIZE,
    );

    expect(ctx.calls.map(([name]) => name)).toEqual(['fillRect', 'drawImage', 'drawImage']);
    expect(ctx.calls[0]).toEqual(['fillRect', '#0e7490', 0, 0, 1024, 1024]);
    expect(ctx.calls[1]).toEqual(['drawImage', 'ground', 350, 0, 900, 900, 0, 0, 1024, 1024]);
    const [, source, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.calls[2] as [string, ...number[]];
    expect([source, sx, sy, sw, sh]).toEqual(['logo', 0, 0, 320, 96]);
    expect(dx).toBeCloseTo(153.6);
    expect(dy).toBeCloseTo(404.48);
    expect(dw).toBeCloseTo(716.8);
    expect(dh).toBeCloseTo(215.04);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
  });

  it('draws the ground alone while the logo loads, and clamps the logo’s share', () => {
    const waiting = recorder();
    drawAppIcon(
      waiting,
      { mode: 'logo', background: '#123456', backgroundImage: null, logo: null, logoScale: 0.7 },
      192,
    );
    expect(waiting.calls).toEqual([['fillRect', '#123456', 0, 0, 192, 192]]);

    const huge = recorder();
    drawAppIcon(
      huge,
      {
        mode: 'logo',
        background: '#123456',
        backgroundImage: null,
        logo: image('logo', 10, 10),
        logoScale: 5,
      },
      100,
    );
    expect(huge.calls[1]).toEqual(['drawImage', 'logo', 0, 0, 10, 10, 0, 0, 100, 100]);
  });

  it('covers the whole square with the art, over the ground', () => {
    const ctx = recorder();
    drawAppIcon(
      ctx,
      { mode: 'art', background: '#2e6fd0', art: image('art', 900, 1600) },
      APP_ICON_SIZE,
    );
    expect(ctx.calls).toEqual([
      ['fillRect', '#2e6fd0', 0, 0, 1024, 1024],
      ['drawImage', 'art', 0, 350, 900, 900, 0, 0, 1024, 1024],
    ]);
  });
});

describe('the ground and the primary', () => {
  it('follows the primary by default, and stops only for a colour of its own as the ground', () => {
    expect(followsPrimary(DEFAULT_APP_ICON_SETTINGS)).toBe(true);
    expect(resolveBackground(DEFAULT_APP_ICON_SETTINGS, '#7C3AED')).toBe('#7c3aed');

    const own = settings({ backgroundColor: '#E3AF3F' });
    expect(followsPrimary(own)).toBe(false);
    expect(resolveBackground(own, '#7c3aed')).toBe('#e3af3f');

    // An image (the ground image, the art) sits on the primary, whatever colour was picked before.
    const ground = settings({ backgroundColor: '#e3af3f', backgroundKind: 'image' });
    expect(followsPrimary(ground)).toBe(true);
    expect(resolveBackground(ground, '#7c3aed')).toBe('#7c3aed');
    const art = settings({ backgroundColor: '#e3af3f', mode: 'art' });
    expect(followsPrimary(art)).toBe(true);
    expect(resolveBackground(art, '#7c3aed')).toBe('#7c3aed');

    // A half-typed colour is no colour; a broken primary falls back to the neutral one.
    expect(followsPrimary(settings({ backgroundColor: '#e3a' }))).toBe(true);
    expect(resolveBackground(DEFAULT_APP_ICON_SETTINGS, 'red')).toBe('#2e6fd0');
  });

  it('describes the drawing of each mode with the images it uses', () => {
    const images = {
      logo: image('logo', 10, 10),
      backgroundImage: image('ground', 10, 10),
      art: image('art', 10, 10),
    };
    expect(appIconSpec(DEFAULT_APP_ICON_SETTINGS, '#7c3aed', images)).toEqual({
      mode: 'logo',
      background: '#7c3aed',
      backgroundImage: null,
      logo: images.logo,
      logoScale: 0.7,
    });
    expect(
      appIconSpec(settings({ backgroundKind: 'image', logoScale: 0.2 }), '#7c3aed', images),
    ).toMatchObject({ backgroundImage: images.backgroundImage, logoScale: 0.3 });
    expect(appIconSpec(settings({ mode: 'art' }), '#7c3aed', images)).toEqual({
      mode: 'art',
      background: '#7c3aed',
      art: images.art,
    });
  });
});

describe('homeScreenLabel', () => {
  it('is the manifest’s short_name rule, name for name', () => {
    expect(HOME_SCREEN_LABEL_MAX).toBe(SHORT_NAME_MAX);
    for (const name of [
      'Associação Beneficente São José',
      'Associação  Beneficente',
      'Rede Demo',
      '  Rede Social  ',
      'Clube 123456789',
      '',
    ]) {
      expect(homeScreenLabel(name)).toBe(shortName(name));
    }
    expect(homeScreenLabel('Associação Beneficente São José')).toBe('Associação B');
  });

  it('keeps the maskable safe zone the worker draws (80%)', () => {
    expect(ANDROID_SAFE_ZONE).toBe(0.8);
  });
});
