import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRowExtras } from '@/components/platform/ModuleToggles';

/**
 * 09.1-16 (UI-D-527, A-UI-6, PAY-32, flagged assumption P74) - the platform Módulos page builds the
 * `payments` row's extras from catalog strings and the tenant's facts: the store-off note only while
 * `store` is off, `confirmDisable` with the tenant's display name, and neither a locked switch nor an
 * enable confirmation (the row requires nothing; enabling is silent). The page is an async server
 * component, so it is called directly with its collaborators mocked and the `extras` it hands to
 * `ModuleToggles` inspected. The catalog is the REAL pt-BR one through next-intl's own translator.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const mocks = vi.hoisted(() => ({ enabled: [] as string[] }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace }),
  };
});
vi.mock('@/lib/platform', async () => {
  const { TOGGLEABLE_MODULES } = await import('@rede-social/contracts');
  return {
    requirePlatformTenantDetail: async () => ({
      tenant: { displayName: 'Rede Demo' },
      modules: TOGGLEABLE_MODULES.map((key) => ({ key, enabled: mocks.enabled.includes(key) })),
    }),
    getSocialSettings: async () => null,
  };
});
vi.mock('./actions', () => ({ saveSocialLimitsAction: vi.fn(), setModuleAction: vi.fn() }));
vi.mock('@/components/platform/ModuleToggles', () => ({ ModuleToggles: () => null }));
vi.mock('@/components/platform/SocialLimitsSheet', () => ({ SocialLimitsSheet: () => null }));
vi.mock('@rede-social/ui', () => ({ SectionTitle: () => null }));

const { default: TenantModulesPage } = await import('./page');

type TogglesProps = {
  extras: Record<string, ModuleRowExtras>;
  rows: { key: string; name: string; description: string }[];
};

/** The props the page hands to `ModuleToggles`. */
async function togglesProps(): Promise<TogglesProps> {
  const tree = (await TenantModulesPage({
    params: Promise.resolve({ id: 'tenant-1' }),
  })) as ReactElement<{ children: ReactElement<TogglesProps>[] }>;
  return tree.props.children[1]?.props as TogglesProps;
}

beforeEach(() => {
  mocks.enabled = [];
});

describe('Módulos page - the payments row (UI-D-527)', () => {
  it('lists Pagamentos like any module, with the catalog name and description', async () => {
    const { rows } = await togglesProps();
    const row = rows.find((candidate) => candidate.key === 'payments');
    expect(row?.name).toBe('Pagamentos');
    expect(row?.description).toBe(
      'Controla a entrada e as compras pela plataforma de pagamento do tenant.',
    );
  });

  it('with store off: the note, the tenant-named danger copy, no lock and no enable confirmation', async () => {
    mocks.enabled = ['feed', 'payments'];
    const { extras } = await togglesProps();
    const payments = extras.payments;
    expect(payments?.note).toBe('Sem o módulo Loja, só a entrada é controlada.');
    expect(payments?.disabled).toBeUndefined();
    expect(payments?.confirmEnable).toBeUndefined();
    expect(payments?.confirmDisable).toEqual({
      title: 'Desativar Pagamentos em Rede Demo?',
      body: 'Se Rede Demo exige assinatura para entrar, o acesso volta a ficar aberto a qualquer pessoa, e quem estava com assinatura pendente volta a entrar. A loja volta a liberar compras sem cobrança.',
      confirm: 'Desativar Pagamentos',
      cancel: 'Cancelar',
      icon: 'credit-card',
    });
  });

  it('with store on: no note, the same confirmation', async () => {
    mocks.enabled = ['feed', 'store', 'payments'];
    const { extras } = await togglesProps();
    expect(extras.payments?.note).toBeUndefined();
    expect(extras.payments?.disabled).toBeUndefined();
    expect(extras.payments?.confirmDisable?.title).toBe('Desativar Pagamentos em Rede Demo?');
  });

  it('carries the extras whether or not the module is on, so a later switch-on is silent and a later switch-off confirms', async () => {
    mocks.enabled = ['store'];
    const { extras } = await togglesProps();
    expect(extras.payments?.confirmDisable).toBeDefined();
    expect(extras.payments?.confirmEnable).toBeUndefined();
  });

  it('leaves the social row as it was', async () => {
    mocks.enabled = ['feed'];
    const { extras } = await togglesProps();
    expect(extras.social?.confirmEnable).toBeDefined();
    expect(extras.social?.confirmDisable).toBeUndefined();
  });
});
