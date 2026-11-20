// @vitest-environment node

import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-25 (MODER-05, UI-D-637): the settings page's "Denúncias" row sits in the Administração group right under
 * "Moderação", only for a holder of `moderation.manage` (the composed permission, never a role), and never on the
 * platform host. Its own file so the shipped settings tests keep their mocks untouched.
 */

const mocks = vi.hoisted(() => ({
  requireBootstrap: vi.fn(),
  mode: 'tenant' as 'tenant' | 'platform',
}));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: () => mocks.requireBootstrap(),
}));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: mocks.mode, host: 'comunidade.exemplo.com.br' }),
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

async function html(): Promise<string> {
  const ui = await SettingsPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ROW = 'href="/configuracoes/denuncias"';

const bootstrapFor = (role: string, permissions: string[]) => ({
  membership: { role },
  permissions,
  modules: [],
  tenant: { displayName: 'Ana Mentoria' },
});

beforeEach(() => {
  mocks.requireBootstrap.mockReset();
  mocks.mode = 'tenant';
});

describe('/configuracoes: the Denúncias row (UI-D-637)', () => {
  it.each(['admin_tenant', 'support_tenant', 'member'])(
    'is present for a %s holding moderation.manage, right under Moderação',
    async (role) => {
      mocks.requireBootstrap.mockResolvedValue(bootstrapFor(role, ['moderation.manage']));
      const out = await html();
      expect(out).toContain(ROW);
      expect(out).toContain('Denúncias');
      expect(out.indexOf('href="/configuracoes/moderacao"')).toBeGreaterThan(-1);
      expect(out.indexOf('href="/configuracoes/moderacao"')).toBeLessThan(out.indexOf(ROW));
    },
  );

  it.each([
    ['admin_tenant', ['tenant.manage', 'members.manage']],
    ['support_tenant', []],
    ['member', []],
  ])('is absent from the DOM for a %s without moderation.manage', async (role, permissions) => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor(role, permissions));
    const out = await html();
    expect(out).not.toContain(ROW);
    expect(out).not.toContain('Denúncias');
  });

  it('is absent on the platform host', async () => {
    mocks.mode = 'platform';
    const out = await html();
    expect(out).not.toContain(ROW);
  });
});
