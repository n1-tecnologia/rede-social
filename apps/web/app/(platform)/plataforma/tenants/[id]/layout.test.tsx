// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-20 Task 2 (UI-D-541, E08) - the tenant page header. A second non-interactive pill "Banco:
 * {state}" follows the Ativo/Suspenso pill only when the database is not Pronto; its tone is the one
 * `databasePillProps` gives the state (plain text with a word, never colour alone); a failed overview
 * read renders the frame without the pill; the row keeps `flex-wrap` so a long name and two pills wrap
 * at 320 px (class assertions here, the `scrollWidth <= clientWidth` measurement in the plan 28 spec).
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const platform = vi.hoisted(() => ({
  detail: vi.fn(),
  database: vi.fn(),
}));

vi.mock('next-intl/server', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
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

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual<typeof import('@/lib/platform')>('@/lib/platform');
  return {
    ...actual,
    requirePlatformTenantDetail: platform.detail,
    getTenantDatabase: platform.database,
  };
});

vi.mock('@/components/platform/FlashToast', () => ({ FlashToast: () => null }));
vi.mock('@/components/platform/TenantTabs', () => ({ TenantTabs: () => null }));

const { default: TenantLayout } = await import('./layout');

const NAME = 'Associação Brasileira de Mentoras e Mentores de Carreira do Sul do País';

function detail(over: { status?: string; displayName?: string } = {}) {
  return {
    tenant: {
      id: 't1',
      slug: 'ana',
      displayName: over.displayName ?? 'Ana Souza Mentoria',
      status: over.status ?? 'active',
    },
    domains: [],
  };
}

async function renderLayout() {
  const element = await TenantLayout({
    params: Promise.resolve({ id: 't1' }),
    children: (<p>filho</p>) as ReactNode,
  });
  return render(element);
}

beforeEach(() => {
  platform.detail.mockReset();
  platform.database.mockReset();
  platform.detail.mockResolvedValue(detail());
});
afterEach(cleanup);

describe('TenantLayout - the database pill in the header', () => {
  it('shows no database pill for a Pronto tenant', async () => {
    platform.database.mockResolvedValue({ state: 'ready', moving: false });
    await renderLayout();
    expect(screen.queryByTestId('tenant-database-pill')).toBeNull();
    expect(screen.getByTestId('tenant-status-pill').textContent).toBe('Ativo');
  });

  it('shows "Banco: Atrasado" with the warning tone after the status pill', async () => {
    platform.database.mockResolvedValue({ state: 'behind', moving: false });
    await renderLayout();
    const pill = screen.getByTestId('tenant-database-pill');
    expect(pill.textContent).toBe('Banco: Atrasado');
    expect(pill.className).toContain('warning');
    const status = screen.getByTestId('tenant-status-pill');
    expect(status.nextElementSibling).toBe(pill);
  });

  it('shows "Banco: Inacessível" as plain danger-toned text with a word', async () => {
    platform.database.mockResolvedValue({ state: 'unreachable', moving: false });
    await renderLayout();
    const pill = screen.getByTestId('tenant-database-pill');
    expect(pill.textContent).toBe('Banco: Inacessível');
    expect(pill.className).toContain('danger');
    expect(pill.closest('a')).toBeNull();
    expect(pill.closest('button')).toBeNull();
    expect(pill.getAttribute('role')).toBeNull();
  });

  it.each([
    ['preparing', 'Banco: Em preparação'],
    ['preparation_failed', 'Banco: Preparação falhou'],
    ['paused', 'Banco: Pausado'],
    ['moving', 'Banco: Em mudança'],
    ['unchecked', 'Banco: Não verificado'],
  ])('writes the %s state as "%s"', async (state, text) => {
    platform.database.mockResolvedValue({ state, moving: false });
    await renderLayout();
    expect(screen.getByTestId('tenant-database-pill').textContent).toBe(text);
  });

  it('renders the frame without the pill when the overview read fails', async () => {
    platform.database.mockRejectedValue(new Error('boom'));
    await renderLayout();
    expect(screen.queryByTestId('tenant-database-pill')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana Souza Mentoria');
    expect(screen.getByText('filho')).not.toBeNull();
  });

  it('keeps the title row wrapping a 60-plus-character name and two pills', async () => {
    platform.detail.mockResolvedValue(detail({ displayName: NAME, status: 'suspended' }));
    platform.database.mockResolvedValue({ state: 'preparation_failed', moving: false });
    await renderLayout();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe(NAME);
    expect(NAME.length).toBeGreaterThan(60);
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('break-words');
    const row = title.parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('gap-3');
    expect(row.contains(screen.getByTestId('tenant-status-pill'))).toBe(true);
    expect(row.contains(screen.getByTestId('tenant-database-pill'))).toBe(true);
  });
});

/**
 * 09.4-16 Task 3 (UI-D-560, CTK-41; E08) - the third header pill. After Ativo/Suspenso and "Banco: {state}",
 * a non-interactive "Token: {state}" shows ONLY for a customer project whose token needs attention
 * (Vencendo, Vencido, Inválido, Sem permissão, Organização diferente): never for Válido, never for
 * Não verificado, never for a platform project, and never when the read fails. It reuses the ONE
 * `getTenantDatabase` call the header already makes.
 */
describe('TenantLayout - the token pill in the header', () => {
  const customer = (state: string, over: Record<string, unknown> = {}) => ({
    state: 'ready',
    moving: false,
    owner: 'customer',
    organization: 'acme-corp',
    token: { state, expiresAt: null, checkedAt: null },
    ...over,
  });

  it('shows "Token: Vencendo" with the warning tone after the status pill', async () => {
    platform.database.mockResolvedValue(customer('expiring'));
    await renderLayout();
    const pill = screen.getByTestId('tenant-token-pill');
    expect(pill.textContent).toBe('Token: Vencendo');
    expect(pill.className).toContain('warning');
    expect(screen.getByTestId('tenant-status-pill').nextElementSibling).toBe(pill);
  });

  it('puts the pills in the order name, Ativo, Banco, Token when the database also needs a pill', async () => {
    platform.database.mockResolvedValue(customer('expired', { state: 'behind' }));
    await renderLayout();
    const row = screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement;
    expect(
      Array.from(row.children).map((child) => child.getAttribute('data-testid') ?? child.tagName),
    ).toEqual(['H1', 'tenant-status-pill', 'tenant-database-pill', 'tenant-token-pill']);
    expect(screen.getByTestId('tenant-token-pill').textContent).toBe('Token: Vencido');
  });

  it.each([
    ['expiring', 'Token: Vencendo', 'warning'],
    ['expired', 'Token: Vencido', 'danger'],
    ['invalid', 'Token: Inválido', 'danger'],
    ['no_permission', 'Token: Sem permissão', 'danger'],
    ['org_mismatch', 'Token: Organização diferente', 'danger'],
  ])(
    'writes the %s state as "%s" in the %s tone, as plain text with a word',
    async (state, text, tone) => {
      platform.database.mockResolvedValue(customer(state));
      await renderLayout();
      const pill = screen.getByTestId('tenant-token-pill');
      expect(pill.textContent).toBe(text);
      expect(pill.className).toContain(tone);
      expect(pill.closest('a')).toBeNull();
      expect(pill.closest('button')).toBeNull();
      expect(pill.getAttribute('role')).toBeNull();
    },
  );

  it.each(['valid', 'unchecked'])(
    'shows no token pill for a customer project in the %s state (E08 partial)',
    async (state) => {
      platform.database.mockResolvedValue(customer(state));
      await renderLayout();
      expect(screen.queryByTestId('tenant-token-pill')).toBeNull();
    },
  );

  it('shows no token pill for a platform project, for a missing token or for an older API', async () => {
    platform.database.mockResolvedValue(customer('expired', { owner: 'platform', token: null }));
    await renderLayout();
    expect(screen.queryByTestId('tenant-token-pill')).toBeNull();
    cleanup();
    platform.database.mockResolvedValue(customer('expired', { token: null }));
    await renderLayout();
    expect(screen.queryByTestId('tenant-token-pill')).toBeNull();
    cleanup();
    platform.database.mockResolvedValue({ state: 'ready', moving: false });
    await renderLayout();
    expect(screen.queryByTestId('tenant-token-pill')).toBeNull();
  });

  it('shows no token pill and keeps the frame when the overview read fails', async () => {
    platform.database.mockRejectedValue(new Error('boom'));
    await renderLayout();
    expect(screen.queryByTestId('tenant-token-pill')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana Souza Mentoria');
  });

  it('makes one overview read for both pills', async () => {
    platform.database.mockResolvedValue(customer('expired', { state: 'behind' }));
    await renderLayout();
    expect(platform.database).toHaveBeenCalledTimes(1);
  });

  it('keeps the title row wrapping a 60-plus-character name and three pills (E08 overflow, long-text)', async () => {
    platform.detail.mockResolvedValue(detail({ displayName: NAME, status: 'suspended' }));
    platform.database.mockResolvedValue(customer('org_mismatch', { state: 'preparation_failed' }));
    await renderLayout();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe(NAME);
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('break-words');
    const row = title.parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('gap-3');
    for (const id of ['tenant-status-pill', 'tenant-database-pill', 'tenant-token-pill']) {
      expect(row.contains(screen.getByTestId(id))).toBe(true);
    }
    expect(screen.getByTestId('tenant-token-pill').textContent).toBe(
      'Token: Organização diferente',
    );
  });
});
