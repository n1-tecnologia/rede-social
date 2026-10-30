// @vitest-environment node

import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12-15 Task 1 (D-596, UI-D-564; T-12-33): the settings page carries the "Formulário de perfil" row only
 * for the composed PERMISSION `profile_form.manage`, never for the role: absent from the DOM (not
 * disabled) for a support user and a member, and in the order Marca, Membros, Regras da comunidade,
 * Formulário de perfil, Moderação. The settings page had no test before this one.
 */

const mocks = vi.hoisted(() => ({ requireBootstrap: vi.fn() }));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: () => mocks.requireBootstrap(),
}));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: 'tenant', host: 'comunidade.exemplo.com.br' }),
  TENANT_SLUG_COOKIE: 'tenant_slug',
}));
vi.mock('@/lib/platform', () => ({ requirePlatformTenants: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('../actions', () => ({ logout: vi.fn(), setTheme: vi.fn() }));
vi.mock('@/components/push/PushControls', () => ({ PushSettingRow: () => null }));
vi.mock('@/components/shell/LogoutForm', () => ({
  LogoutForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
}));
vi.mock('./ActionToast', () => ({ ActionToast: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { default: SettingsPage } = await import('./page');

const bootstrapFor = (role: string, permissions: string[]) => ({
  membership: { role },
  permissions,
  modules: [],
  tenant: { displayName: 'Ana Mentoria' },
});

async function html(): Promise<string> {
  const ui = await SettingsPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ROW_HREF = 'href="/configuracoes/formulario-de-perfil"';

beforeEach(() => {
  mocks.requireBootstrap.mockReset();
});

describe('/configuracoes: the Formulário de perfil row (UI-D-564)', () => {
  it('is present with profile_form.manage, links to the builder and carries the label', async () => {
    mocks.requireBootstrap.mockResolvedValue(
      bootstrapFor('admin_tenant', ['profile_form.manage', 'tenant.manage']),
    );
    const out = await html();
    expect(out).toContain(ROW_HREF);
    expect(out).toContain('Formulário de perfil');
  });

  it('sits between Regras da comunidade and Moderação, after Marca and Membros', async () => {
    mocks.requireBootstrap.mockResolvedValue(
      bootstrapFor('admin_tenant', [
        'profile_form.manage',
        'tenant.manage',
        'members.manage',
        'moderation.manage',
      ]),
    );
    const out = await html();
    const at = (href: string) => out.indexOf(`href="${href}"`);
    expect(at('/configuracoes/marca')).toBeGreaterThan(-1);
    expect(at('/configuracoes/marca')).toBeLessThan(at('/configuracoes/membros'));
    expect(at('/configuracoes/membros')).toBeLessThan(at('/configuracoes/regras'));
    expect(at('/configuracoes/regras')).toBeLessThan(at('/configuracoes/formulario-de-perfil'));
    expect(at('/configuracoes/formulario-de-perfil')).toBeLessThan(at('/configuracoes/moderacao'));
  });

  it('is absent from the DOM, not disabled, for a support user without the permission', async () => {
    mocks.requireBootstrap.mockResolvedValue(
      bootstrapFor('support_tenant', ['moderation.manage', 'members.manage']),
    );
    const out = await html();
    expect(out).not.toContain(ROW_HREF);
    expect(out).not.toContain('Formulário de perfil');
    // never rendered-and-disabled: no link to it of any kind, enabled or not
    expect(out).not.toContain('formulario-de-perfil');
    expect(out).not.toContain('aria-disabled');
    // the support user still sees the rows their permissions give
    expect(out).toContain('href="/configuracoes/moderacao"');
  });

  it('is absent for a member, and the whole Administração group is absent with it', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor('member', []));
    const out = await html();
    expect(out).not.toContain(ROW_HREF);
    expect(out).not.toContain('Administração');
  });

  it('opens the Administração group for the permission alone (the visibility list gained the flag)', async () => {
    mocks.requireBootstrap.mockResolvedValue(
      bootstrapFor('support_tenant', ['profile_form.manage']),
    );
    const out = await html();
    expect(out).toContain('Administração');
    expect(out).toContain(ROW_HREF);
  });
});
