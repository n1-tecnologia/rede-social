// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppIconSettings, DEFAULT_APP_ICON_SETTINGS, type IconImage } from '@/lib/app-icon';

/**
 * 2026-10-05 — two logos in the wizard: the light mode's (the one the tenant is created with) and
 * the dark mode's own, optional and PREVIEW ONLY, then the app icon. The real catalog, a stub
 * draft whose `setImage` and `setAppIcon` are spied.
 *
 * 2026-10-09 — the app icon is COMPOSED here (`AppIconEditor`, the decoding and composition
 * stubbed): applying keeps the composed file as the draft's icon with its choices, "Remover" drops
 * both, and while the icon's ground follows the primary a new primary composes it again (from the
 * logo's FILE, never its object URL); a ground of its own is never redone.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    value: null as unknown,
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: 'pt-BR',
        messages: harness.messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
  };
});

vi.mock('./TenantDraftProvider', () => ({ useTenantDraft: () => harness.value }));

const images = vi.hoisted(() => ({ load: vi.fn(), compose: vi.fn() }));
vi.mock('@/lib/app-icon-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-icon-image')>()),
  loadIconImage: images.load,
  composeAppIconFile: images.compose,
}));

const { WizardBrandPicker } = await import('./WizardBrandPicker');

type DarkCopy = { title: string; upload: string; hint: string; alt: string };
const W = (
  harness.messages.platform as unknown as {
    wizard: { brand: { logoLight: { title: string }; logoDark: DarkCopy } };
  }
).wizard.brand;
const B = harness.messages.platformBranding as unknown as {
  icon: { remove: string };
  appIcon: { customize: string; apply: string };
};

const image = (name: string) => ({
  file: new File(['x'], name, { type: 'image/png' }),
  url: `blob:${name}`,
});
const decoded: IconImage = { source: {} as CanvasImageSource, width: 320, height: 96 };
const composed = new File([new Uint8Array(8)], 'icone-do-app.png', { type: 'image/png' });

type Stage = {
  logo?: boolean;
  logoDark?: boolean;
  icon?: boolean;
  primary?: string;
  appIcon?: { settings: AppIconSettings; primary: string } | null;
};

function stage(over: Stage = {}) {
  const setImage = vi.fn();
  const setAppIcon = vi.fn();
  const logo = over.logo ? image('claro.png') : null;
  harness.value = {
    draft: { displayName: 'Clube Aurora' },
    colors: { primary: over.primary ?? '#2e6fd0', secondary: '#5b9cf8' },
    logo,
    logoDark: over.logoDark ? image('escuro.png') : null,
    icon: over.icon ? image('icone.png') : null,
    appIcon: over.appIcon ?? null,
    setImage,
    setAppIcon,
  };
  render(<WizardBrandPicker />);
  return { setImage, setAppIcon, logo };
}

const picker = (kind: string) =>
  document.querySelector(`[data-wizard-image="${kind}"]`) as HTMLElement;

beforeEach(() => {
  images.load.mockReset().mockResolvedValue(decoded);
  images.compose.mockReset().mockResolvedValue(composed);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WizardBrandPicker — a logo per mode', () => {
  it('offers the light logo, the dark logo and the icon, in that order', () => {
    stage();
    const kinds = Array.from(document.querySelectorAll('[data-wizard-image]')).map((node) =>
      node.getAttribute('data-wizard-image'),
    );
    expect(kinds).toEqual(['logo', 'logoDark', 'icon']);
    expect(within(picker('logo')).getByText(W.logoLight.title)).toBeTruthy();
    expect(within(picker('logoDark')).getByText(W.logoDark.title)).toBeTruthy();
    expect(within(picker('logoDark')).getByText(W.logoDark.upload)).toBeTruthy();
    // Honest about it: the dark logo is not sent when the tenant is created.
    expect(within(picker('logoDark')).getByText(W.logoDark.hint)).toBeTruthy();
    expect(W.logoDark.hint).toContain('não é enviado');
  });

  it('a picked dark logo goes to the draft as the dark one, never as the logo', () => {
    const { setImage } = stage();
    const input = picker('logoDark').querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png'], 'escuro.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(setImage).toHaveBeenCalledWith('logoDark', file);
    expect(setImage).not.toHaveBeenCalledWith('logo', expect.anything());
  });

  it('shows the dark logo on the dark ground and the light one on the light ground', () => {
    stage({ logo: true, logoDark: true });
    const dark = screen.getByAltText('Logo de Clube Aurora no modo escuro');
    expect(dark.getAttribute('src')).toBe('blob:escuro.png');
    expect(dark.closest('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
    const light = within(picker('logo')).getByRole('img');
    expect(light.getAttribute('src')).toBe('blob:claro.png');
    expect(light.closest('[data-theme]')).toBeNull();
  });
});

describe('WizardBrandPicker — the app icon', () => {
  it('keeps the composed icon as the draft’s icon, with its choices and the primary', async () => {
    const { setImage, setAppIcon, logo } = stage({ logo: true });
    fireEvent.click(within(picker('icon')).getByRole('button', { name: B.appIcon.customize }));
    const apply = within(picker('icon')).getByRole('button', {
      name: B.appIcon.apply,
    }) as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    // The picked logo is read from its file: a blob URL would need the CSP's connect-src.
    expect(images.load).toHaveBeenCalledWith({ file: logo?.file });

    await act(async () => {
      fireEvent.click(apply);
    });

    expect(setImage).toHaveBeenCalledWith('icon', composed);
    expect(setAppIcon).toHaveBeenCalledWith({
      settings: expect.objectContaining({ mode: 'logo', logoSource: 'light' }),
      primary: '#2e6fd0',
    });
  });

  it('"Remover" drops the icon and its choices', () => {
    const { setImage, setAppIcon } = stage({ logo: true, icon: true });
    fireEvent.click(within(picker('icon')).getByRole('button', { name: B.icon.remove }));
    expect(setImage).toHaveBeenCalledWith('icon', null);
    expect(setAppIcon).toHaveBeenCalledWith(null);
  });

  it('composes the icon again on a new primary while its ground follows it', async () => {
    const { setImage, setAppIcon, logo } = stage({
      logo: true,
      icon: true,
      primary: '#0e7490',
      appIcon: { settings: DEFAULT_APP_ICON_SETTINGS, primary: '#2e6fd0' },
    });

    await waitFor(() => expect(setImage).toHaveBeenCalledWith('icon', composed));
    expect(images.load).toHaveBeenCalledWith({ file: logo?.file });
    expect(images.compose).toHaveBeenCalledWith({
      settings: DEFAULT_APP_ICON_SETTINGS,
      primary: '#0e7490',
      logo: decoded,
    });
    expect(setAppIcon).toHaveBeenCalledWith({
      settings: DEFAULT_APP_ICON_SETTINGS,
      primary: '#0e7490',
    });
  });

  it('never composes again a ground of its own, nor an icon whose logo is gone', async () => {
    vi.useFakeTimers();
    stage({
      logo: true,
      icon: true,
      primary: '#0e7490',
      appIcon: {
        settings: { ...DEFAULT_APP_ICON_SETTINGS, backgroundColor: '#e3af3f' },
        primary: '#2e6fd0',
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(images.compose).not.toHaveBeenCalled();
    cleanup();

    stage({
      icon: true,
      primary: '#0e7490',
      appIcon: { settings: DEFAULT_APP_ICON_SETTINGS, primary: '#2e6fd0' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(images.compose).not.toHaveBeenCalled();
  });
});
