// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppIconSettings, DEFAULT_APP_ICON_SETTINGS, type IconImage } from '@/lib/app-icon';
import type { DraftAppIcon, DraftImage } from './TenantDraftProvider';

/**
 * 2026-10-09 (review APPICON-1): the wizard's app icon composed again on another primary, shared by
 * Personalização (a moment after the primary's last change) and the summary's confirmation (right
 * before the upload, for a primary changed just before the step was left). The decoding and the
 * composition are stubbed (`app-icon-image.test.ts` covers them):
 *
 *  1. Only an icon whose ground follows the primary, drawn on another one, needs it.
 *  2. A logo taken from the light or the dark mode's logo is read from that logo's FILE, and the
 *     composition gets the choices, the new primary and that decoded logo.
 *  3. That logo gone: `null`, nothing read nor composed. A picked logo file or an art is decoded
 *     by the composition itself.
 *  4. A failure to read or compose is the caller's to handle.
 */

const images = vi.hoisted(() => ({ load: vi.fn(), compose: vi.fn() }));
vi.mock('@/lib/app-icon-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-icon-image')>()),
  loadIconImage: images.load,
  composeAppIconFile: images.compose,
}));

const { needsRecompose, recomposeDraftIcon } = await import('./draft-icon');

const OLD = '#2e6fd0';
const NEW = '#0e7490';
const decoded: IconImage = { source: {} as CanvasImageSource, width: 320, height: 96 };
const composed = new File([new Uint8Array(8)], 'icone-do-app.png', { type: 'image/png' });

const image = (name: string): DraftImage => ({
  file: new File(['x'], name, { type: 'image/png' }),
  url: `blob:${name}`,
});
const drawn = (over: Partial<AppIconSettings> = {}, primary = OLD): DraftAppIcon => ({
  settings: { ...DEFAULT_APP_ICON_SETTINGS, ...over },
  primary,
});

beforeEach(() => {
  images.load.mockReset().mockResolvedValue(decoded);
  images.compose.mockReset().mockResolvedValue(composed);
});

describe('needsRecompose', () => {
  it('1. an icon on the primary, drawn on another one', () => {
    expect(needsRecompose(drawn(), NEW)).toBe(true);
    // Images sit on the primary too, which shows through their transparent pixels.
    expect(needsRecompose(drawn({ mode: 'art' }), NEW)).toBe(true);
    expect(
      needsRecompose(drawn({ backgroundKind: 'image', backgroundColor: '#e3af3f' }), NEW),
    ).toBe(true);
  });

  it('1. never without an icon, on the same primary, or on a ground colour of its own', () => {
    expect(needsRecompose(null, NEW)).toBe(false);
    expect(needsRecompose(drawn(), OLD)).toBe(false);
    expect(needsRecompose(drawn({ backgroundColor: '#e3af3f' }), NEW)).toBe(false);
  });
});

describe('recomposeDraftIcon', () => {
  it('2. reads the light logo from its file and composes on the new primary', async () => {
    const logo = image('claro.png');
    const appIcon = drawn();

    const file = await recomposeDraftIcon({ appIcon, primary: NEW, logo, logoDark: null });

    expect(file).toBe(composed);
    expect(images.load).toHaveBeenCalledExactlyOnceWith({ file: logo.file });
    expect(images.compose).toHaveBeenCalledExactlyOnceWith({
      settings: appIcon.settings,
      primary: NEW,
      logo: decoded,
    });
  });

  it('2. reads the dark logo when the icon was made from it', async () => {
    const logoDark = image('escuro.png');

    await recomposeDraftIcon({
      appIcon: drawn({ logoSource: 'dark' }),
      primary: NEW,
      logo: image('claro.png'),
      logoDark,
    });

    expect(images.load).toHaveBeenCalledExactlyOnceWith({ file: logoDark.file });
  });

  it('3. the logo it was made from is gone: null, and nothing is read nor composed', async () => {
    const lightGone = await recomposeDraftIcon({
      appIcon: drawn(),
      primary: NEW,
      logo: null,
      logoDark: image('escuro.png'),
    });
    const darkGone = await recomposeDraftIcon({
      appIcon: drawn({ logoSource: 'dark' }),
      primary: NEW,
      logo: image('claro.png'),
      logoDark: null,
    });

    expect(lightGone).toBeNull();
    expect(darkGone).toBeNull();
    expect(images.load).not.toHaveBeenCalled();
    expect(images.compose).not.toHaveBeenCalled();
  });

  it('3. a picked logo file or an art goes to the composition as it is', async () => {
    const logoFile = new File(['x'], 'outro.png', { type: 'image/png' });
    const art = new File(['x'], 'arte.png', { type: 'image/png' });

    await recomposeDraftIcon({
      appIcon: drawn({ logoSource: 'file', logoFile }),
      primary: NEW,
      logo: null,
      logoDark: null,
    });
    await recomposeDraftIcon({
      appIcon: drawn({ mode: 'art', art }),
      primary: NEW,
      logo: null,
      logoDark: null,
    });

    expect(images.load).not.toHaveBeenCalled();
    expect(images.compose).toHaveBeenNthCalledWith(1, {
      settings: expect.objectContaining({ logoSource: 'file', logoFile }),
      primary: NEW,
      logo: null,
    });
    expect(images.compose).toHaveBeenNthCalledWith(2, {
      settings: expect.objectContaining({ mode: 'art', art }),
      primary: NEW,
      logo: null,
    });
  });

  it('4. a logo that cannot be read, or an icon that cannot be composed, rejects', async () => {
    const logo = image('claro.png');
    images.load.mockRejectedValueOnce(new Error('decode'));
    await expect(
      recomposeDraftIcon({ appIcon: drawn(), primary: NEW, logo, logoDark: null }),
    ).rejects.toThrow('decode');

    images.compose.mockRejectedValueOnce(new Error('size'));
    await expect(
      recomposeDraftIcon({ appIcon: drawn(), primary: NEW, logo, logoDark: null }),
    ).rejects.toThrow('size');
  });
});
