// @vitest-environment happy-dom
import { contrastReport, deriveBrandColors, emptyBrandLook } from '@rede-social/contracts/branding';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandingView } from '@/lib/branding-view';

/**
 * 2026-10-09 (review APPICON-2, APPICON-6): the Marca tab's "Ícone do app" over the real editor and
 * the real `ConfirmDialog` (its focus trap included), against the REAL pt-BR catalog. Stubbed: the
 * server actions and the toast; the tab around it adopts the view `onCompleted` hands back, as
 * `BrandingForm` does.
 *
 *  1. A tenant with neither a logo nor an icon of its own whose derived set is still served (an
 *     override removed, the worker deriving again from the previous render): the closed editor
 *     previews that set's Apple icon, never empty tiles.
 *  3. (09.3, D-562) The editor's apply sends the composed art as upload kind `icon_art` (the marker
 *     the worker reads); the logo zone still sends `logo`.
 *  2. A confirmed "Remover" leaves with the icon, so the dialog's trap has no opener to return the
 *     focus to: once the dialog has closed, "Personalizar ícone" holds it, never `<body>`. A
 *     refused removal keeps "Remover", where the trap returns it.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    toast: { show: vi.fn(), dismiss: vi.fn() },
    onApply: null as null | ((file: File, settings: never) => boolean | Promise<boolean>),
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

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => harness.toast,
}));

// The real editor, with its `onApply` captured: the canvas composition itself is not under test here,
// what `onApply` hands to the upload is.
vi.mock('./AppIconEditor', async (orig) => {
  const actual = await orig<typeof import('./AppIconEditor')>();
  return {
    ...actual,
    AppIconEditor: (props: React.ComponentProps<typeof actual.AppIconEditor>) => {
      harness.onApply = props.onApply;
      return <actual.AppIconEditor {...props} />;
    },
  };
});

// The dialog animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const { IconOverrideUpload } = await import('./IconOverrideUpload');
const { LogoUpload } = await import('./LogoUpload');

type Copy = {
  icon: { remove: string; confirm: string };
  appIcon: { customize: string; preview: { aria: string; noSource: string } };
};
const B = harness.messages.platformBranding as unknown as Copy;

const TENANT = '33333333-3333-4333-8333-333333333371';
const ICON = 'https://bucket.test/branding/icon.png';
const SET = {
  i192: 'https://bucket.test/branding/icons/v3/icon-192.png',
  i512: 'https://bucket.test/branding/icons/v3/icon-512.png',
  maskable512: 'https://bucket.test/branding/icons/v3/maskable-512.png',
  apple180: 'https://bucket.test/branding/icons/v3/apple-touch-icon-180.png',
};

function makeView(over: Partial<BrandingView> = {}): BrandingView {
  const colors = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });
  return {
    displayName: 'Clube Aurora',
    logoUrl: null,
    iconUrl: null,
    faviconUrl: null,
    iconUrls: null,
    iconVersion: 3,
    iconsReady: true,
    hasSource: false,
    colors,
    contrast: contrastReport(colors),
    look: emptyBrandLook(),
    ...over,
  };
}

const removeIcon = vi.fn();
const actions = {
  start: vi.fn(),
  complete: vi.fn(),
  removeIcon,
} as unknown as Parameters<typeof IconOverrideUpload>[0]['actions'];

/** The Marca tab around it: the view `onCompleted` hands back is the one it shows next. */
function Tab({ initial }: { initial: BrandingView }) {
  const [view, setView] = useState(initial);
  return (
    <IconOverrideUpload
      tenantId={TENANT}
      view={view}
      primary={view.colors.primary}
      actions={actions}
      onCompleted={setView}
    />
  );
}

const tiles = () =>
  Array.from(screen.getByRole('img', { name: B.appIcon.preview.aria }).querySelectorAll('img'));

beforeEach(() => {
  removeIcon.mockReset();
  vi.mocked(actions.start).mockReset().mockResolvedValue({ ok: false, code: 'generic' });
  harness.onApply = null;
  harness.toast.show.mockReset();
});
afterEach(cleanup);

describe('IconOverrideUpload', () => {
  it('1. previews the set still served to a tenant with neither a logo nor an icon of its own', () => {
    render(<Tab initial={makeView({ iconUrls: SET })} />);

    expect(tiles().map((img) => img.getAttribute('src'))).toEqual([SET.apple180, SET.apple180]);
    expect(screen.queryByText(B.appIcon.preview.noSource)).toBeNull();
  });

  it('2. a confirmed "Remover" hands the focus to "Personalizar ícone" once its dialog closed', async () => {
    removeIcon.mockResolvedValue({ ok: true, view: makeView({ iconUrls: SET, iconVersion: 4 }) });
    render(<Tab initial={makeView({ iconUrl: ICON, iconUrls: SET, hasSource: true })} />);
    const remove = screen.getByRole('button', { name: B.icon.remove });
    remove.focus();
    fireEvent.click(remove);

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: B.icon.confirm }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(removeIcon).toHaveBeenCalledWith(TENANT);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: B.appIcon.customize }));
    // No logo: the set derived before still shows, not empty tiles.
    expect(tiles().map((img) => img.getAttribute('src'))).toEqual([SET.apple180, SET.apple180]);
  });

  it('2. a refused removal keeps "Remover", and the focus goes back to it', async () => {
    removeIcon.mockResolvedValue({ ok: false, code: 'generic' });
    render(<Tab initial={makeView({ iconUrl: ICON, iconUrls: SET, hasSource: true })} />);
    const remove = screen.getByRole('button', { name: B.icon.remove });
    remove.focus();
    fireEvent.click(remove);

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: B.icon.confirm }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(harness.toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: B.icon.remove }));
  });

  it('3. the editor apply starts the upload with kind icon_art, and the logo zone still sends logo', async () => {
    render(<Tab initial={makeView({ iconUrls: SET })} />);
    const art = new File([new Uint8Array(32)], 'icone-do-app.png', { type: 'image/png' });
    await act(async () => {
      await harness.onApply?.(art, undefined as never);
    });
    expect(actions.start).toHaveBeenCalledExactlyOnceWith(TENANT, {
      kind: 'icon_art',
      mime: 'image/png',
      size: 32,
    });
    cleanup();

    vi.mocked(actions.start).mockClear();
    const { container } = render(
      <LogoUpload tenantId={TENANT} view={makeView()} actions={actions} onCompleted={() => {}} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File([new Uint8Array(16)], 'logo.png', { type: 'image/png' })] },
      });
    });
    await waitFor(() =>
      expect(actions.start).toHaveBeenCalledExactlyOnceWith(TENANT, {
        kind: 'logo',
        mime: 'image/png',
        size: 16,
      }),
    );
  });
});
