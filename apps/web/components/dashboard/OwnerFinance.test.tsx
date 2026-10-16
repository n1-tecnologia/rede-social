// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerFinanceProductDetail } from '@rede-social/module-dashboard/fixtures';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { financeTabView, type OwnerFinanceView } from '@/lib/owner-finance-view';
import type { DashboardT } from './format';
import { OwnerFinanceBuyers } from './OwnerFinanceBuyers';
import { OwnerFinanceOverview } from './OwnerFinanceOverview';
import { FinanceNumberList, NeverList, OwnerFinancePeople } from './OwnerFinancePeople';
import { OwnerFinanceProductDetail } from './OwnerFinanceProductDetail';
import { OwnerFinanceProducts } from './OwnerFinanceProducts';

/**
 * The Financeiro on the member report's rules (the owner panel's redesign of 2026-10-15), on the
 * REAL pt-BR catalog: every KPI card leads with an icon and carries no note, no "exemplo" anywhere,
 * no explanatory sentence, the revenue charts inside their cards at a fixed height, and the cards
 * that open a list are whole links.
 */

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
  // any: the untyped test translator stands in for the app's typed DashboardT (BandMembers.test).
} as never) as unknown as DashboardT;

const F = 'tenantOwner.finance';
const OVERVIEW = financeTabView('overview');

/**
 * The sentences the redesign took off the screen (rule: no explanations). The app's catalog carries
 * only the keys the panel reads, so they are not even in it (see the last test).
 */
const REMOVED_KEYS = [
  `${F}.overview.numbers.definition`,
  `${F}.overview.notice`,
  `${F}.overview.attention.expiringNote`,
  `${F}.overview.attention.stalledNote`,
  `${F}.overview.sources.idle`,
  `${F}.overview.app.note`,
  `${F}.products.order`,
  `${F}.events.note`,
  `${F}.events.exampleNote`,
  `${F}.offers.note`,
  `${F}.detail.bands.note`,
  `${F}.detail.posts.note`,
  `${F}.buyers.bands.note`,
  `${F}.buyers.bands.idle`,
  `${F}.buyers.ladder.note`,
  `${F}.buyers.never.note`,
  `${F}.lists.share.note`,
];

const VIEWS: [string, () => ReactElement][] = [
  ['Visão geral', () => <OwnerFinanceOverview t={t} />],
  ['Produtos', () => <OwnerFinanceProducts t={t} view={financeTabView('products')} />],
  [
    'Produto (VIP)',
    () => <OwnerFinanceProductDetail t={t} view={{ ...OVERVIEW, productId: 's2' }} />,
  ],
  [
    'Produto parado',
    () => <OwnerFinanceProductDetail t={t} view={{ ...OVERVIEW, productId: 's4' }} />,
  ],
  ['Quem compra', () => <OwnerFinanceBuyers t={t} view={financeTabView('buyers')} />],
  [
    'Parte da secundária',
    () => <FinanceNumberList t={t} view={{ ...OVERVIEW, number: 'share' }} />,
  ],
  [
    'Acessos vencendo',
    () => <FinanceNumberList t={t} view={{ ...OVERVIEW, attention: 'expiring' }} />,
  ],
  [
    'Nunca compraram de novo',
    () => (
      <NeverList t={t} view={{ ...financeTabView('buyers'), neverBand: 'occasional' } as const} />
    ),
  ],
  [
    'Compradores de uma oferta',
    () => (
      <OwnerFinancePeople
        t={t}
        view={
          {
            ...financeTabView('products'),
            productId: 's2',
            offerId: 'vip-entrada',
          } satisfies OwnerFinanceView
        }
      />
    ),
  ],
];

describe('Financeiro on the member report’s rules', () => {
  for (const [name, view] of VIEWS) {
    it(`${name}: icons on every card, no note, no "exemplo", no explanation`, () => {
      const { container } = render(view());
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\bexemplo\b/i);
      for (const card of container.querySelectorAll('[data-kpi-card]')) {
        expect(card.querySelector('span.size-8 > svg'), card.textContent ?? '').not.toBeNull();
        // A KPI note is the two-line clamp with its tooltip: none is left.
        expect(card.querySelector('span.line-clamp-2[title]')).toBeNull();
      }
      // Every block is a surface that rises in.
      for (const card of container.querySelectorAll('[data-kpi-card]')) {
        expect(card.classList.contains('dash-reveal')).toBe(true);
      }
    });
  }

  it('Visão geral: the revenue charts sit inside their wide cards, at the member’s height', () => {
    const { container } = render(<OwnerFinanceOverview t={t} />);
    for (const slug of ['primaria', 'secundaria']) {
      const link = container.querySelector(`a#numero-${slug}`);
      expect(link, slug).not.toBeNull();
      const chart = link?.querySelector('[data-kpi-card] svg[role="img"]');
      expect(chart?.getAttribute('height'), slug).toBe('150');
      expect(link?.textContent).toContain(t('tenantOwner.weekly.previous'));
    }
  });

  it('Visão geral: each number opens its list as a whole linked card', () => {
    const { container } = render(<OwnerFinanceOverview t={t} />);
    const seeList = t('tenantOwner.seeList');
    for (const slug of [
      'primaria',
      'secundaria',
      'parte-secundaria',
      'recompra',
      'tempo-recompra',
      'por-membro',
    ]) {
      const link = container.querySelector(`a#numero-${slug}`);
      expect(link?.getAttribute('href'), slug).toMatch(new RegExp(`&numero=${slug}$`));
      expect(link?.querySelector('[data-kpi-card]'), slug).not.toBeNull();
      expect(link?.textContent, slug).toContain(seeList);
    }
    // The total and the cancellations are cards too, not links.
    expect(container.querySelector('[data-finance-total] [data-kpi-card]')).not.toBeNull();
    expect(container.textContent).toContain(t(`${F}.detail.numbers.revoked`));
  });

  it('Visão geral: the attention rows and the VIP open what they name', () => {
    const { container } = render(<OwnerFinanceOverview t={t} />);
    expect(container.querySelector('a#atencao-pagantes-sumindo')).not.toBeNull();
    expect(container.querySelector('a#atencao-vencendo')).not.toBeNull();
    expect(container.querySelector('a#produto-s4')?.getAttribute('href')).toMatch(/&produto=s4$/);
    expect(container.querySelector('a#produto-s2')?.getAttribute('href')).toMatch(/&produto=s2$/);
  });

  it('Produto parado: the revenue beside its weeks, how long it has been unsold', () => {
    const { container } = render(
      <OwnerFinanceProductDetail t={t} view={{ ...OVERVIEW, productId: 's4' }} />,
    );
    expect(container.querySelector('[data-kpi-card] svg[role="img"]')?.getAttribute('height')).toBe(
      '150',
    );
    const days = ownerFinanceProductDetail('s4').lastSaleDaysAgo;
    if (days === null) throw new Error('s4 must be a product with no sale yet');
    expect(container.textContent).toContain(t(`${F}.detail.numbers.unsold`, { days }));
  });

  it('keeps no explanatory sentence in the catalog', () => {
    const has = (t as unknown as { has: (key: string) => boolean }).has;
    for (const key of REMOVED_KEYS) expect(has(key), key).toBe(false);
  });
});
