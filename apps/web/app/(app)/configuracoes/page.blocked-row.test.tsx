// @vitest-environment node

import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-20 (CHAT-07, UI-D-635): the settings page's "Membros bloqueados" row sits right under "Editar perfil", is not
 * gated by a permission (the report and block slice is in the browser on purpose, D-616) and is absent on the
 * platform host. Its own file so the shipped settings test keeps its tenant-host mock untouched.
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

const ROW = 'href="/configuracoes/bloqueados"';

beforeEach(() => {
  mocks.requireBootstrap.mockReset();
  mocks.mode = 'tenant';
});

describe('/configuracoes: the Membros bloqueados row (UI-D-635)', () => {
  it.each(['member', 'support_tenant', 'admin_tenant'])(
    'is present for a %s with no permission at all',
    async (role) => {
      mocks.requireBootstrap.mockResolvedValue({
        membership: { role },
        permissions: [],
        modules: [],
        tenant: { displayName: 'Ana Mentoria' },
      });
      const out = await html();
      expect(out).toContain(ROW);
      expect(out).toContain('Membros bloqueados');
    },
  );

  it('sits right under Editar perfil', async () => {
    mocks.requireBootstrap.mockResolvedValue({
      membership: { role: 'member' },
      permissions: [],
      modules: [],
      tenant: { displayName: 'Ana Mentoria' },
    });
    const out = await html();
    expect(out.indexOf('href="/perfil/editar"')).toBeGreaterThan(-1);
    expect(out.indexOf('href="/perfil/editar"')).toBeLessThan(out.indexOf(ROW));
  });

  it('is absent on the platform host', async () => {
    mocks.mode = 'platform';
    const out = await html();
    expect(out).not.toContain(ROW);
    expect(out).not.toContain('Membros bloqueados');
  });
});
