// @vitest-environment happy-dom
import type { PlatformTenantDetail } from '@rede-social/contracts';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BrandingView, toBrandingView } from '@/lib/branding-view';

/**
 * 2026-10-05 — the dark mode's logo on a tenant that ALREADY EXISTS (the Marca tab), as in the
 * wizard: the uploaded logo is the light mode's, and the dark one is picked for the previews only.
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws); the
 * upload actions are spies that are never reached (picking the dark logo uploads nothing).
 *
 * Claims:
 *  1. The assets card reads "Logo do modo claro", "Logo do modo escuro (opcional)" and the square
 *     icon, in that order, and the dark logo's hint says it is not saved yet.
 *  2. A picked dark logo shows on a dark ground and in the DARK frame only; the light frame keeps
 *     the saved logo. "Remover" puts the saved logo back in both.
 *  3. A refused file type picks nothing and says why.
 *  4. The picked logo survives a remount of the form (a save or an upload remounts it).
 *  5. Without the provider (another caller of the form) there is no dark zone at all.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const key = namespace ?? '';
      let tr = byNamespace.get(key);
      if (!tr) {
        tr = actual.createTranslator({
          locale: 'pt-BR',
          messages: harness.messages,
          namespace,
          onError: (error) => {
            throw error;
          },
        });
        byNamespace.set(key, tr);
      }
      return tr;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

MotionGlobalConfig.skipAnimations = true;

const { BrandingForm } = await import('./BrandingForm');
const { DarkLogoProvider } = await import('./DarkLogoDraft');

type Copy = {
  logo: { title: string };
  logoDark: { title: string; upload: string; replace: string; hint: string; alt: string };
  icon: { title: string; remove: string };
  errors: { type: string };
};
const B = harness.messages.platformBranding as unknown as Copy;

const TENANT = '6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';
const SAVED_LOGO = 'https://cdn.exemplo.test/logo-claro.svg';

/** The real mapper fills the colours and the look; the saved logo and a READY icon set (no polling). */
const VIEW: BrandingView = {
  ...toBrandingView({
    tenant: {
      id: TENANT,
      slug: 'clube',
      displayName: 'Clube Aurora',
      status: 'active',
      timezone: 'America/Sao_Paulo',
      createdAt: '2026-10-03T00:00:00.000Z',
      branding: { colors: { primary: '#7c3aed', secondary: '#a78bfa' } },
      contrast: {
        onPrimary: { ratio: 5.7, ok: true },
        lightSurface: { ratio: 5.4, ok: true },
        darkSurface: { ratio: 4.2, ok: true },
      },
    },
    modules: [],
    domains: [],
    invites: [],
    admins: [],
  } as unknown as PlatformTenantDetail),
  logoUrl: SAVED_LOGO,
  hasSource: true,
  iconsReady: true,
};

function form(key = 'a') {
  return (
    <BrandingForm
      key={key}
      tenantId={TENANT}
      view={VIEW}
      previewLabels={{
        light: 'Claro',
        dark: 'Escuro',
        lightAria: 'Prévia clara',
        darkAria: 'Prévia escura',
        login: 'Entrar',
      }}
      actions={
        {
          saveColors: vi.fn(),
          status: vi.fn(),
          start: vi.fn(),
          complete: vi.fn(),
          removeIcon: vi.fn(),
        } as never
      }
    />
  );
}

const zone = (name: string) =>
  document.querySelector(`[data-upload-zone="${name}"]`) as HTMLElement;
const frame = (theme: 'light' | 'dark') =>
  document.querySelector(`[data-brand-scope][data-theme="${theme}"]`) as HTMLElement;
const logosIn = (theme: 'light' | 'dark') =>
  Array.from(frame(theme).querySelectorAll('img')).map((img) => img.getAttribute('src'));

function pickDark(file = new File(['png'], 'escuro.png', { type: 'image/png' })) {
  const input = zone('logoDark').querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const revoked: string[] = [];

beforeEach(() => {
  let made = 0;
  revoked.length = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => {
      made += 1;
      return `blob:logo-escuro-${made}`;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => revoked.push(url),
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originals.create,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originals.revoke,
  });
});

describe('Marca tab — the dark mode logo of an existing tenant', () => {
  it('reads light logo, dark logo and square icon, in order, and says the dark one is not saved', () => {
    render(
      <ToastProvider>
        <DarkLogoProvider>{form()}</DarkLogoProvider>
      </ToastProvider>,
    );
    const zones = Array.from(document.querySelectorAll('[data-upload-zone]')).map((node) =>
      node.getAttribute('data-upload-zone'),
    );
    expect(zones).toEqual(['logo', 'logoDark', 'icon']);
    expect(within(zone('logo')).getByText(B.logo.title)).toBeTruthy();
    expect(within(zone('logoDark')).getByText(B.logoDark.title)).toBeTruthy();
    expect(within(zone('logoDark')).getByText(B.logoDark.upload)).toBeTruthy();
    expect(within(zone('logoDark')).getByText(B.logoDark.hint)).toBeTruthy();
    expect(B.logoDark.hint).toContain('só na prévia');
    // Nothing picked: both frames show the saved logo.
    expect(logosIn('light').every((src) => src === SAVED_LOGO)).toBe(true);
    expect(logosIn('dark').every((src) => src === SAVED_LOGO)).toBe(true);
  });

  it('a picked dark logo shows on a dark ground and in the dark frame only; Remover undoes it', () => {
    render(
      <ToastProvider>
        <DarkLogoProvider>{form()}</DarkLogoProvider>
      </ToastProvider>,
    );
    pickDark();

    const picked = within(zone('logoDark')).getByAltText('Logo de Clube Aurora no modo escuro');
    expect(picked.getAttribute('src')).toBe('blob:logo-escuro-1');
    expect(picked.closest('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
    expect(within(zone('logoDark')).getByText(B.logoDark.replace)).toBeTruthy();
    expect(logosIn('dark').every((src) => src === 'blob:logo-escuro-1')).toBe(true);
    expect(logosIn('light').every((src) => src === SAVED_LOGO)).toBe(true);
    // Picking the dark logo never reaches the upload actions: the brand scopes stay two.
    expect(document.querySelectorAll('[data-brand-scope]')).toHaveLength(2);

    fireEvent.click(within(zone('logoDark')).getByRole('button', { name: B.icon.remove }));
    expect(within(zone('logoDark')).queryByRole('img')).toBeNull();
    expect(revoked).toContain('blob:logo-escuro-1');
    expect(logosIn('dark').every((src) => src === SAVED_LOGO)).toBe(true);
  });

  it('a refused file type picks nothing and says why', () => {
    render(
      <ToastProvider>
        <DarkLogoProvider>{form()}</DarkLogoProvider>
      </ToastProvider>,
    );
    pickDark(new File(['gif'], 'anim.gif', { type: 'image/gif' }));
    expect(within(zone('logoDark')).getByRole('alert').textContent).toBe(B.errors.type);
    expect(logosIn('dark').every((src) => src === SAVED_LOGO)).toBe(true);
  });

  it('keeps the picked logo when the form remounts after a save or an upload', () => {
    const { rerender } = render(
      <ToastProvider>
        <DarkLogoProvider>{form('a')}</DarkLogoProvider>
      </ToastProvider>,
    );
    pickDark();
    rerender(
      <ToastProvider>
        <DarkLogoProvider>{form('b')}</DarkLogoProvider>
      </ToastProvider>,
    );
    expect(logosIn('dark').every((src) => src === 'blob:logo-escuro-1')).toBe(true);
    expect(within(zone('logoDark')).getByRole('img').getAttribute('src')).toBe(
      'blob:logo-escuro-1',
    );
  });

  it('without the provider there is no dark zone and both frames use the one logo', () => {
    render(<ToastProvider>{form()}</ToastProvider>);
    expect(zone('logoDark')).toBeNull();
    expect(zone('logo')).not.toBeNull();
    expect(logosIn('dark').every((src) => src === SAVED_LOGO)).toBe(true);
  });
});
