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

// The dialog animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const { IconOverrideUpload } = await import('./IconOverrideUpload');

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
});
