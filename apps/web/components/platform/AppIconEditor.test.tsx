// @vitest-environment happy-dom
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { FormEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppIconSettings, IconImage } from '@/lib/app-icon';

/**
 * 2026-10-09 — "Ícone do app": the editor on its own, against the REAL pt-BR catalog (next-intl's
 * own translator; a missing key throws). The decoding and the composition are stubbed
 * (`app-icon-image.test.ts` covers them), so these cases read what the person sees and what the
 * caller receives:
 *
 *  1. Closed by default: today's home screen, from the logo ("Personalizar ícone"), or from the
 *     icon of its own ("Editar ícone" with the caller's "Remover"); with neither, from the set the
 *     server still serves, and with nothing at all the platform's icon is said.
 *  2. Open: "Logo e fundo", the light logo read, and the ground on the primary ("Cor principal").
 *  3. A logo that cannot be read from its URL says so, asks for the file, and nothing applies.
 *  4. "Arte única": the picked art is composed and handed over with the choices, then it closes.
 *  5. "Cancelar" drops the choices; an `onApply` that answers `false` keeps the editor open.
 *
 * Review fixes (2026-10-09):
 *
 *  6. The focus moves with the views (APPICON-2): to the open view's title, back to the button
 *     that opens it, and to that button when "Remover" leaves with the icon; a focus the person
 *     took elsewhere meanwhile stays there.
 *  7. Enter in the ground's hex or the logo's size never submits the form around the editor
 *     (APPICON-3); the colour picker and the buttons keep their own Enter.
 *  8. While the icon is prepared, its sources and settings wait (APPICON-4).
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
  icon: { title: string; remove: string };
  appIcon: {
    customize: string;
    edit: string;
    apply: string;
    cancel: string;
    preparing: string;
    mode: { logo: string; art: string };
    logo: { unreachable: string };
    background: { primary: string; image: string };
    preview: { aria: string; androidNote: string; noSource: string };
  };
};
const B = harness.messages.platformBranding as unknown as Copy;

const LOGO = 'https://bucket.test/branding/logo.svg';
const ICON = 'https://bucket.test/branding/icon.png';
const DERIVED = 'https://bucket.test/branding/icons/v3/apple-touch-icon-180.png';
const decoded: IconImage = { source: {} as CanvasImageSource, width: 320, height: 96 };

let onApply: ReturnType<typeof vi.fn<(file: File, settings: AppIconSettings) => boolean>>;

type Over = { iconUrl?: string | null; logo?: string | null; derivedIconUrl?: string | null };

function ui(over: Over = {}) {
  const logo = over.logo === undefined ? LOGO : over.logo;
  return (
    <AppIconEditor
      marker={{ 'data-upload-zone': 'icon' }}
      displayName="Clube Aurora"
      primary="#7c3aed"
      logos={{ light: logo ? { url: logo } : null, dark: null }}
      iconUrl={over.iconUrl ?? null}
      derivedIconUrl={over.derivedIconUrl ?? null}
      onApply={onApply}
      removeAction={<button type="button">{B.icon.remove}</button>}
    />
  );
}

const mount = (over: Over = {}) => render(ui(over));

const root = () => document.querySelector('[data-upload-zone="icon"]') as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const applyButton = () => button(B.appIcon.apply);
const tiles = () =>
  Array.from(
    screen.getByRole('img', { name: B.appIcon.preview.aria }).querySelectorAll('img'),
  ) as HTMLImageElement[];
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
    expect(tiles().map((img) => img.getAttribute('src'))).toEqual([LOGO, LOGO]);
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

  it('1. with neither a logo nor an icon of its own, previews the set the server still serves', () => {
    mount({ logo: null, derivedIconUrl: DERIVED });
    expect(tiles().map((img) => img.getAttribute('src'))).toEqual([DERIVED, DERIVED]);
    // A square, as the phone gets it: it covers the tile.
    for (const img of tiles()) expect(img.className).toContain('object-cover');
    expect(screen.getByText(B.appIcon.preview.androidNote)).toBeTruthy();
    expect(screen.queryByText(B.appIcon.preview.noSource)).toBeNull();
    // Still nothing of its own: "Personalizar ícone", and no "Remover".
    expect(button(B.appIcon.customize)).toBeTruthy();
    expect(screen.queryByRole('button', { name: B.icon.remove })).toBeNull();
  });

  it('1. a logo comes before that set; with nothing at all, the platform’s icon is said', () => {
    mount({ derivedIconUrl: DERIVED });
    expect(tiles().map((img) => img.getAttribute('src'))).toEqual([LOGO, LOGO]);
    for (const img of tiles()) expect(img.className).toContain('object-contain');
    cleanup();

    mount({ logo: null });
    expect(tiles()).toEqual([]);
    expect(screen.getByText(B.appIcon.preview.noSource)).toBeTruthy();
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

  it('6. the focus moves with the views: to the title on opening, back on "Cancelar"', () => {
    mount();
    // The first render leaves the focus alone.
    expect(document.activeElement).toBe(document.body);

    const open = button(B.appIcon.customize);
    open.focus();
    fireEvent.click(open);
    const title = root().querySelector('[data-app-icon-title]') as HTMLElement;
    expect(document.activeElement).toBe(title);
    expect(title.textContent).toBe(B.icon.title);
    // A focus target, never a Tab stop.
    expect(title.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(button(B.appIcon.cancel));
    expect(document.activeElement).toBe(button(B.appIcon.customize));
  });

  it('6. an applied icon closes the editor with the focus on its button', async () => {
    mount();
    fireEvent.click(button(B.appIcon.customize));
    await waitFor(() => expect(applyButton().disabled).toBe(false));

    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(root().getAttribute('data-app-icon-editor')).toBe('closed');
    expect(document.activeElement).toBe(button(B.appIcon.customize));
  });

  it('6. a focus taken elsewhere while the icon is sent stays there when the editor closes', async () => {
    let finish: (file: File) => void = () => {};
    images.compose.mockReturnValue(
      new Promise<File>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    fireEvent.click(button(B.appIcon.customize));
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(applyButton());
    });
    const elsewhere = document.body.appendChild(document.createElement('input'));
    try {
      elsewhere.focus();

      await act(async () => {
        finish(new File([new Uint8Array(8)], 'icone-do-app.png', { type: 'image/png' }));
      });

      expect(root().getAttribute('data-app-icon-editor')).toBe('closed');
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it('6. "Remover" leaving with the icon hands the focus to "Personalizar ícone"', () => {
    const { rerender } = mount({ iconUrl: ICON });
    button(B.icon.remove).focus();

    // The caller drops the icon (the wizard's "Remover"): the focused button goes with it.
    rerender(ui({ iconUrl: null }));

    expect(screen.queryByRole('button', { name: B.icon.remove })).toBeNull();
    expect(document.activeElement).toBe(button(B.appIcon.customize));
  });

  it('6. a focus held elsewhere stays there when the icon goes', () => {
    const { rerender } = mount({ iconUrl: ICON });
    const elsewhere = document.body.appendChild(document.createElement('input'));
    try {
      elsewhere.focus();
      rerender(ui({ iconUrl: null }));
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it('7. Enter in the ground’s hex or the logo’s size stays in the editor: no form submits', () => {
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(<form onSubmit={submit}>{ui()}</form>);
    fireEvent.click(button(B.appIcon.customize));
    /** Enter's keydown on `target`, cancelled or not. */
    const enterOn = (target: Element, key = 'Enter') => {
      const event = createEvent.keyDown(target, { key });
      fireEvent(target, event);
      return event.defaultPrevented;
    };
    const hex = document.getElementById('app-icon-background') as HTMLInputElement;
    const size = root().querySelector('input[type="range"]') as HTMLInputElement;

    // The implicit submission is Enter's default action there (happy-dom runs none): cancelling
    // the keydown is what keeps the step.
    expect(enterOn(hex)).toBe(true);
    expect(enterOn(size)).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(root().getAttribute('data-app-icon-editor')).toBe('open');

    // Only Enter, and only there: a letter still types, the colour picker still opens with it, and
    // Enter on a button still presses it.
    expect(enterOn(hex, 'a')).toBe(false);
    expect(enterOn(root().querySelector('input[type="color"]') as HTMLInputElement)).toBe(false);
    expect(enterOn(button(B.appIcon.mode.art))).toBe(false);
  });

  it('8. while the icon is prepared, the logo, its size, the ground and its colour wait', async () => {
    images.compose.mockReturnValue(new Promise<File>(() => {}));
    mount();
    fireEvent.click(button(B.appIcon.customize));
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    const settings = root().querySelector('fieldset') as HTMLFieldSetElement;
    expect(settings.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(screen.getByText(B.appIcon.preparing)).toBeTruthy();
    // One disabled fieldset holds every control a change would go through.
    expect(settings.hasAttribute('disabled')).toBe(true);
    for (const control of [
      screen.getByRole('combobox'),
      root().querySelector('input[type="range"]'),
      button(B.appIcon.background.image),
      document.getElementById('app-icon-background'),
    ]) {
      expect(settings.contains(control)).toBe(true);
    }
    // The ground's control looks it, as the mode's does.
    expect(button(B.appIcon.background.image).disabled).toBe(true);
    expect(button(B.appIcon.mode.art).disabled).toBe(true);
  });

  it('8. while the art is prepared, its zone takes no other file, picked or dropped', async () => {
    images.compose.mockReturnValue(new Promise<File>(() => {}));
    mount();
    fireEvent.click(button(B.appIcon.customize));
    fireEvent.click(button(B.appIcon.mode.art));
    const zone = () => root().querySelector('[data-app-icon-zone="art"]') as HTMLElement;
    const input = () => zone().querySelector('input[type="file"]') as HTMLInputElement;
    const art = new File([new Uint8Array(16)], 'arte.png', { type: 'image/png' });
    fireEvent.change(input(), { target: { files: [art] } });
    await waitFor(() => expect(applyButton().disabled).toBe(false));

    await act(async () => {
      fireEvent.click(applyButton());
    });

    expect(input().disabled).toBe(true);
    const other = new File([new Uint8Array(16)], 'outra.png', { type: 'image/png' });
    fireEvent.drop(zone().querySelector('section') as HTMLElement, {
      dataTransfer: { files: [other] },
    });
    expect(images.load).not.toHaveBeenCalledWith({ file: other });
  });
});
