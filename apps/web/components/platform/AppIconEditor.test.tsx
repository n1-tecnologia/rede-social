// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppIconSettings, IconImage } from '@/lib/app-icon';

/**
 * 2026-10-09 — "Ícone do app": the editor on its own, against the REAL pt-BR catalog (next-intl's
 * own translator; a missing key throws). The decoding and the composition are stubbed
 * (`app-icon-image.test.ts` covers them), so these cases read what the person sees and what the
 * caller receives:
 *
 *  1. Closed by default: today's home screen, from the logo ("Personalizar ícone"), or from the
 *     icon of its own ("Editar ícone" with the caller's "Remover").
 *  2. Open: "Logo e fundo", the light logo read, and the ground on the primary ("Cor principal").
 *  3. A logo that cannot be read from its URL says so, asks for the file, and nothing applies.
 *  4. "Arte única": the picked art is composed and handed over with the choices, then it closes.
 *  5. "Cancelar" drops the choices; an `onApply` that answers `false` keeps the editor open.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
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

const images = vi.hoisted(() => ({ load: vi.fn(), compose: vi.fn() }));
vi.mock('@/lib/app-icon-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-icon-image')>()),
  loadIconImage: images.load,
  composeAppIconFile: images.compose,
}));

const { AppIconEditor } = await import('./AppIconEditor');
const { AppIconError } = await import('@/lib/app-icon-image');

type Copy = {
  icon: { remove: string };
  appIcon: {
    customize: string;
    edit: string;
    apply: string;
    cancel: string;
    mode: { logo: string; art: string };
    logo: { unreachable: string };
    background: { primary: string };
    preview: { aria: string };
  };
};
const B = harness.messages.platformBranding as unknown as Copy;

const LOGO = 'https://bucket.test/branding/logo.svg';
const ICON = 'https://bucket.test/branding/icon.png';
const decoded: IconImage = { source: {} as CanvasImageSource, width: 320, height: 96 };

let onApply: ReturnType<typeof vi.fn<(file: File, settings: AppIconSettings) => boolean>>;

function mount(over: { iconUrl?: string | null; logo?: string | null } = {}) {
  const logo = over.logo === undefined ? LOGO : over.logo;
  return render(
    <AppIconEditor
      marker={{ 'data-upload-zone': 'icon' }}
      displayName="Clube Aurora"
      primary="#7c3aed"
      logos={{ light: logo ? { url: logo } : null, dark: null }}
      iconUrl={over.iconUrl ?? null}
      onApply={onApply}
      removeAction={<button type="button">{B.icon.remove}</button>}
    />,
  );
}

const root = () => document.querySelector('[data-upload-zone="icon"]') as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const applyButton = () => button(B.appIcon.apply);
const logoState = () =>
  document.querySelector('[data-app-icon-logo-state]')?.getAttribute('data-app-icon-logo-state');

beforeEach(() => {
  onApply = vi.fn<(file: File, settings: AppIconSettings) => boolean>(() => true);
  images.load.mockReset().mockResolvedValue(decoded);
  images.compose
    .mockReset()
    .mockResolvedValue(new File([new Uint8Array(8)], 'icone-do-app.png', { type: 'image/png' }));
});

afterEach(cleanup);

describe('AppIconEditor', () => {
  it('1. is closed by default and previews the logo the icons come from', () => {
    mount();
    expect(root().getAttribute('data-app-icon-editor')).toBe('closed');
    expect(button(B.appIcon.customize)).toBeTruthy();
    expect(screen.queryByRole('button', { name: B.icon.remove })).toBeNull();
    const preview = screen.getByRole('img', { name: B.appIcon.preview.aria });
    const tiles = Array.from(preview.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(tiles).toEqual([LOGO, LOGO]);
    // Nothing is read until the editor opens.
    expect(images.load).not.toHaveBeenCalled();
  });

  it('1. with an icon of its own: previews it, says "Editar ícone" and offers "Remover"', () => {
    mount({ iconUrl: ICON });
    expect(button(B.appIcon.edit)).toBeTruthy();
    expect(button(B.icon.remove)).toBeTruthy();
    const preview = screen.getByRole('img', { name: B.appIcon.preview.aria });
    expect(preview.querySelector('[data-home-tile="ios"] img')?.getAttribute('src')).toBe(ICON);
    // Android: the icon at 80% inside the circle on the primary.
    const android = preview.querySelector('[data-home-tile="android"]') as HTMLElement;
    expect(android.style.backgroundColor).not.toBe('');
  });

  it('2. opens on "Logo e fundo", reads the light logo and grounds it on the primary', async () => {
    mount();
    fireEvent.click(button(B.appIcon.customize));

    expect(root().getAttribute('data-app-icon-editor')).toBe('open');
    expect(button(B.appIcon.mode.logo).getAttribute('aria-pressed')).toBe('true');
    expect((document.getElementById('app-icon-background') as HTMLInputElement).value).toBe(
      '#7c3aed',
    );
    expect(document.querySelector('[data-preview-color-fallback]')?.textContent).toBe(
      B.appIcon.background.primary,
    );
    await waitFor(() => expect(logoState()).toBe('ready'));
    expect(images.load).toHaveBeenCalledWith({ url: LOGO });
    expect(applyButton().disabled).toBe(false);
    // The live preview is drawn on canvases, one per tile.
    expect(root().querySelectorAll('[data-home-tile] canvas')).toHaveLength(2);
  });

  it('3. a logo that cannot be read from its URL says so, asks for the file, and applies nothing', async () => {
    images.load.mockRejectedValue(new AppIconError('unreachable'));
    mount();
    fireEvent.click(button(B.appIcon.customize));

    await waitFor(() => expect(logoState()).toBe('unreachable'));
    expect(screen.getByText(B.appIcon.logo.unreachable)).toBeTruthy();
    expect(root().querySelector('[data-app-icon-zone="logo"] input[type="file"]')).not.toBeNull();
    expect(applyButton().disabled).toBe(true);
  });

  it('4. composes the picked art and hands it over with the choices, then closes', async () => {
    mount();
    fireEvent.click(button(B.appIcon.customize));
    fireEvent.click(button(B.appIcon.mode.art));
    expect(applyButton().disabled).toBe(true);

    const art = new File([new Uint8Array(16)], 'arte.png', { type: 'image/png' });
    const input = root().querySelector(
      '[data-app-icon-zone="art"] input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [art] } });
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    expect(images.load).toHaveBeenLastCalledWith({ file: art });

    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(images.compose).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ mode: 'art', art }),
        primary: '#7c3aed',
      }),
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    const [file, settings] = onApply.mock.calls[0] ?? [];
    expect(file).toBeInstanceOf(File);
    expect(settings).toMatchObject({ mode: 'art', art });
    expect(root().getAttribute('data-app-icon-editor')).toBe('closed');

    // The choices come back on the next opening.
    fireEvent.click(button(B.appIcon.customize));
    expect(button(B.appIcon.mode.art).getAttribute('aria-pressed')).toBe('true');
  });

  it('5. "Cancelar" drops the choices', () => {
    mount();
    fireEvent.click(button(B.appIcon.customize));
    fireEvent.click(button(B.appIcon.mode.art));
    fireEvent.click(button(B.appIcon.cancel));

    expect(root().getAttribute('data-app-icon-editor')).toBe('closed');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(button(B.appIcon.customize));
    expect(button(B.appIcon.mode.logo).getAttribute('aria-pressed')).toBe('true');
  });

  it('5. stays open when the caller does not take the icon', async () => {
    onApply.mockReturnValue(false);
    mount();
    fireEvent.click(button(B.appIcon.customize));
    await waitFor(() => expect(applyButton().disabled).toBe(false));

    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(root().getAttribute('data-app-icon-editor')).toBe('open');
  });

  it('5. says why when the icon cannot be prepared, and stays open', async () => {
    images.compose.mockRejectedValue(new AppIconError('size'));
    mount();
    fireEvent.click(button(B.appIcon.customize));
    await waitFor(() => expect(applyButton().disabled).toBe(false));

    await act(async () => {
      fireEvent.click(applyButton());
    });

    const errors = harness.messages.platformBranding as unknown as {
      appIcon: { errors: { size: string } };
    };
    expect(screen.getByRole('alert').textContent).toBe(errors.appIcon.errors.size);
    expect(onApply).not.toHaveBeenCalled();
    expect(root().getAttribute('data-app-icon-editor')).toBe('open');
  });
});
