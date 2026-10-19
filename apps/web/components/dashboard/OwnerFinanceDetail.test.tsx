// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/*
 * The screens behind Financeiro's numbers on the API's answers (08.7-10, D-461, D-462, INSIGHT-21):
 * a product's detail with its buyers by band merged under the floor and the store's buyers screen,
 * Quem compra's ladder by product and never-again bands, and the named buyers lists continued in
 * place, each row opening the panel's member detail.
 */

const loaders = vi.hoisted(() => ({
  product: { status: 'error' } as Record<string, unknown>,
  buyers: { status: 'error' } as Record<string, unknown>,
}));

vi.mock('@/lib/dashboard', () => ({
  getOwnerFinance: async () => ({ status: 'error' }),
  getOwnerContent: async () => ({ status: 'error' }),
  getOwnerFinanceProduct: async () => loaders.product,
  getOwnerFinanceBuyers: async () => loaders.buyers,
  getOwnerMemberDetail: async () => ({ status: 'error' }),
  getOwnerMemberList: async () => ({ status: 'error' }),
}));

// The buyers lists continue through the server action: no API in a component test.
vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: async () => ({ error: true }),
}));

const { messages } = await vi.hoisted(async () => {
  const { loadMessages: load } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  return { messages: load(joinPath(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'dashboard' } as never),
  };
});

import { financeBuyerRowViews } from '@/lib/owner-finance-rows';
import { financeTabView, type OwnerFinanceView } from '@/lib/owner-finance-view';
import { ownerListMoreInputSchema } from '@/lib/owner-list-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerFinanceBuyersView } from './OwnerFinanceBuyers';
import { FinanceNumberList, FinancePeopleView } from './OwnerFinancePeople';
import {
  OwnerFinanceProductDetail,
  OwnerFinanceProductDetailView,
} from './OwnerFinanceProductDetail';
import {
  FINANCE_IDS,
  financeAnswer,
  financeBuyer,
  financeBuyersPage,
  financeProductAnswer,
} from './owner-finance-test-data';

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir) as Record<string, unknown>,
  namespace: 'dashboard',
  // any: the untyped test translator stands in for the app's typed DashboardT (BandMembers.test).
} as never) as unknown as DashboardT;

const ALL_ON: OwnerPanelFlags = {
  feed: true,
  stories: true,
  communities: true,
  events: true,
  store: true,
  chat: true,
  notifications: true,
};

const TZ = 'America/Sao_Paulo';
const NOW = Date.parse('2026-10-18T15:00:00Z');
const AREA = '/perfil?area=financeiro';
const OVERVIEW = financeTabView('overview');
const POST_TITLES = new Map([[FINANCE_IDS.post, 'Live de outubro']]);

/** An element's text with every run of whitespace (the money's U+00A0 included) as one space. */
function textOf(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ');
}

/** The labels of a bar list's rows, in the order they are drawn. */
function rowLabels(list: Element | null): string[] {
  return [...(list?.querySelectorAll('li') ?? [])].map(
    (row) => row.querySelector('span.min-w-0')?.textContent ?? '',
  );
}

function detail(
  view: OwnerFinanceView = { ...financeTabView('products'), productId: FINANCE_IDS.vip },
) {
  return render(
    <OwnerFinanceProductDetailView
      t={t}
      view={{ ...view, productId: view.productId ?? FINANCE_IDS.vip }}
      answer={financeAnswer()}
      detail={financeProductAnswer()}
      postTitles={POST_TITLES}
    />,
  );
}

describe('Financeiro › a product on GET …/finance/products/{productId} (D-461, UI-D-470)', () => {
  it('splits its buyers by band, merged groups by bandGroupLabel and floored groups last as text', () => {
    const { container } = detail();
    const bands = container.querySelector('[data-finance-product-bands]');
    expect(rowLabels(bands)).toEqual([
      'Superfãs',
      'Em risco e inativos',
      'Novos, engajados e ocasionais',
    ]);
    const floored = bands?.querySelectorAll('li[data-floored]') ?? [];
    expect(floored).toHaveLength(2);
    for (const row of floored) {
      expect(textOf(row)).toContain('menos de 5 pedidos');
      expect(row.querySelector('[data-bar-fill]')).toBeNull();
    }
    expect(textOf(bands?.querySelector('li:not([data-floored])'))).toContain('R$ 1 mil');
  });

  it('opens its buyers on the store’s screen (D-461)', () => {
    const { container } = detail();
    const link = container.querySelector('a[data-finance-buyers-link]');
    expect(link?.getAttribute('href')).toBe(`/loja/${FINANCE_IDS.vip}/compradores`);
    expect(textOf(link)).toContain('Ver compradores');
  });

  it('shows "Ofertas" as an Em breve block (D-455)', () => {
    const { container } = detail();
    const block = [...container.querySelectorAll('[data-coming-soon-block]')].find((node) =>
      node.textContent?.includes('Ofertas'),
    );
    expect(textOf(block)).toContain('Em breve');
  });

  it('names the publications before its sales as an association, floored, opening Conteúdo (PR-6)', () => {
    const { container } = detail();
    const posts = container.querySelector('[data-finance-product-posts]')?.closest('section');
    expect(textOf(posts)).toContain('Compras depois de uma publicação');
    expect(textOf(posts)).not.toMatch(/venderam|gerou|trouxe/i);
    const row = posts?.querySelector('a');
    expect(textOf(row)).toContain('Live de outubro');
    expect(textOf(row)).toContain('menos de 5 pedidos');
    expect(row?.getAttribute('href')).toContain(
      `area=conteudo&vista=publicacoes&post=${FINANCE_IDS.post}`,
    );
  });

  it('reads its numbers from the answer: revenue, orders, buyers, the cancellations floored', () => {
    const { container } = detail();
    const text = textOf(container);
    expect(text).toContain('Círculo Interno');
    expect(text).toContain('R$ 1.800');
    const revoked = [...container.querySelectorAll('[data-kpi-card]')].find((card) =>
      card.textContent?.includes('Cancelamentos'),
    );
    expect(textOf(revoked)).toContain('menos de 5 pedidos');
    expect(textOf(revoked)).not.toContain('R$');
  });

  it('a stalled product says how long it has gone unsold, with the "Parado" pill', () => {
    const answer = financeProductAnswer({
      product: {
        ...financeProductAnswer().product,
        productId: FINANCE_IDS.stalled,
        name: 'Mentoria Antiga',
      },
    });
    const { container } = render(
      <OwnerFinanceProductDetailView
        t={t}
        view={{ ...OVERVIEW, productId: FINANCE_IDS.stalled }}
        answer={financeAnswer()}
        detail={answer}
        postTitles={POST_TITLES}
      />,
    );
    expect(textOf(container)).toContain('Parado');
    expect(textOf(container)).toContain('Nenhuma venda há 108 dias.');
  });

  it('a product the API does not know falls back to the level above; a failed read is its error card', async () => {
    const props = {
      t,
      view: { ...financeTabView('products'), productId: FINANCE_IDS.vip },
      answer: financeAnswer(),
      flags: ALL_ON,
      timeZone: TZ,
      postTitles: POST_TITLES,
      fallback: 'fallback-sentinel',
    };
    loaders.product = { status: 'notFound' };
    expect(await OwnerFinanceProductDetail(props)).toBe('fallback-sentinel');
    loaders.product = { status: 'error' };
    const error = (await OwnerFinanceProductDetail(props)) as ReactElement<{ kind: string }>;
    expect(error.type).toBe(OwnerAreaState);
    expect(error.props.kind).toBe('error');
  });
});

describe('Financeiro › Quem compra on the API answer (D-09, D-462)', () => {
  function buyers(answer = financeAnswer()) {
    return render(
      <OwnerFinanceBuyersView
        t={t}
        view={financeTabView('buyers')}
        answer={answer}
        lists={{
          new: {
            status: 'ready',
            total: 1,
            nextCursor: null,
            rows: financeBuyerRowViews(t, financeBuyersPage({ list: 'band', band: 'new' }), {
              timeZone: TZ,
              nowMs: NOW,
            }),
          },
        }}
      />,
    );
  }

  it('the ladder by product: a path by its live names, the small paths summed and floored last (UI-D-470)', () => {
    const { container } = buyers();
    const ladder = container.querySelector('[data-finance-ladder]');
    expect(rowLabels(ladder)).toEqual([
      'Guia de Entrada de entrada → Círculo Interno',
      'Outros caminhos (2 caminhos)',
    ]);
    const others = ladder?.querySelector('li[data-floored]');
    expect(textOf(others)).toContain('menos de 5 pessoas');
    expect(others?.querySelector('[data-bar-fill]')).toBeNull();
    expect(textOf(ladder)).toContain('6 pessoas');
  });

  it('an empty ladder says so in one sentence (UI-D-481)', () => {
    const { container } = buyers(financeAnswer({ ladder: { paths: [], others: null } }));
    expect(textOf(container)).toContain('Ninguém fez uma segunda compra ainda.');
    expect(container.querySelector('[data-finance-ladder]')).toBeNull();
  });

  it('never again by band: floored as "menos de 5", zero as "nenhum membro", each band with someone opening its list', () => {
    const { container } = buyers();
    const never = container.querySelector('[data-finance-never]');
    const rows = [...(never?.querySelectorAll('li') ?? [])];
    const row = (label: string) => rows.find((li) => li.textContent?.startsWith(label));
    expect(textOf(row('Superfãs'))).toContain('menos de 5');
    expect(row('Superfãs')?.querySelector('a')?.getAttribute('href')).toBe(
      `${AREA}&vista=quem-compra&nunca=superfas`,
    );
    expect(textOf(row('Ocasionais'))).toContain('12 membros');
    expect(textOf(row('Engajados'))).toContain('nenhum membro');
    expect(row('Engajados')?.querySelector('a')).toBeNull();
  });

  it('a band’s buyers open the panel’s member detail; a floored band reads the floor, a band of 0 opens nothing', () => {
    const { container } = buyers();
    const text = textOf(container);
    expect(text).toContain('menos de 5 pedidos');
    const member = container.querySelector(`a[href*="membro="]`);
    expect(member?.getAttribute('href')).toBe(
      `${AREA}&vista=quem-compra&faixa=novos&membro=${financeBuyer(1).membershipId}`,
    );
  });
});

describe('Financeiro › the buyers lists (D-461, UI-D-477)', () => {
  it('a number’s buyers: the count line, member cards opening &membro=, and Ver todos continuing in place', () => {
    const page = financeBuyersPage({ nextCursor: 'cursor-1', total: 8 });
    const { container } = render(
      <FinancePeopleView
        t={t}
        view={{ ...OVERVIEW, number: 'primary' }}
        answer={financeAnswer()}
        flags={ALL_ON}
        page={page}
        timeZone={TZ}
        nowMs={NOW}
      />,
    );
    const text = textOf(container);
    expect(text).toContain('Receita primária');
    expect(text).toContain('R$ 792 em 8 entradas nos últimos 30 dias');
    expect(text).toContain('Entrou há 3 dias · R$ 49,00');
    const first = container.querySelector(`a[href*="membro=${financeBuyer(1).membershipId}"]`);
    expect(first?.getAttribute('href')).toBe(
      `${AREA}&numero=primaria&membro=${financeBuyer(1).membershipId}`,
    );
    expect(text).toContain('e mais 6 entradas');
    const seeAll = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ver todos',
    );
    expect(seeAll?.hasAttribute('disabled')).toBe(false);
  });

  it('the VIP payers fading: the live community, last activity, the action disabled with the pill', () => {
    const page = financeBuyersPage({
      list: 'vip-fading',
      rows: [financeBuyer(3, { band: 'at_risk', cents: 60000, orders: 3 })],
      total: 1,
    });
    const { container } = render(
      <FinancePeopleView
        t={t}
        view={{ ...OVERVIEW, attention: 'vipFading' }}
        answer={financeAnswer()}
        flags={{ ...ALL_ON, notifications: false }}
        page={page}
        timeZone={TZ}
        nowMs={NOW}
      />,
    );
    const text = textOf(container);
    expect(text).toContain('Pagantes de Círculo Interno que sumiram');
    expect(text).toContain('5 pagantes de Círculo Interno sem ação há mais de 30 dias');
    expect(text).toContain('Última atividade:');
    expect(text).not.toContain('notificação ativa');
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Avisar sobre o próximo encontro',
    );
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(textOf(button?.closest('[data-disabled-action]'))).toContain('Em breve');
    expect(text).not.toMatch(/\bVIP\b|Comunidade VIP/);
  });

  it('the never-again list of a band: its rows open &nunca=…&membro=, the action disabled with the pill', () => {
    const page = financeBuyersPage({ list: 'never', band: 'occasional', total: 2 });
    const { container } = render(
      <FinancePeopleView
        t={t}
        view={{ ...financeTabView('buyers'), neverBand: 'occasional' }}
        answer={financeAnswer()}
        flags={ALL_ON}
        page={page}
        timeZone={TZ}
        nowMs={NOW}
      />,
    );
    expect(textOf(container)).toContain('Ocasionais: entraram e nunca compraram de novo');
    expect(container.querySelector('a[href*="membro="]')?.getAttribute('href')).toBe(
      `${AREA}&vista=quem-compra&nunca=ocasionais&membro=${financeBuyer(1).membershipId}`,
    );
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Montar oferta',
    );
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(textOf(button?.closest('[data-disabled-action]'))).toContain('Em breve');
  });

  it('the share of add-ons lists products, never people', () => {
    const { container } = render(
      <FinancePeopleView
        t={t}
        view={{ ...OVERVIEW, number: 'share' }}
        answer={financeAnswer()}
        flags={ALL_ON}
        page={null}
        timeZone={TZ}
        nowMs={NOW}
      />,
    );
    const text = textOf(container);
    expect(text).toContain('Compras adicionais, por produto');
    expect(text).toContain('Círculo Interno');
    expect(container.querySelector('a[href*="membro="]')).toBeNull();
  });

  it('with no VIP the fading list falls back to the overview', async () => {
    const result = await FinanceNumberList({
      t,
      view: { ...OVERVIEW, attention: 'vipFading' },
      answer: financeAnswer({ vip: null }),
      flags: ALL_ON,
      timeZone: TZ,
      postTitles: POST_TITLES,
      fallback: 'fallback-sentinel',
    });
    expect(result).toBe('fallback-sentinel');
  });
});

describe('the finance-buyers page action’s params (T-08.7-16)', () => {
  it('accepts a panel list with its band and a bounded cursor', () => {
    expect(
      ownerListMoreInputSchema.safeParse({ kind: 'finance-buyers', list: 'primary', cursor: 'c1' })
        .success,
    ).toBe(true);
    expect(
      ownerListMoreInputSchema.safeParse({
        kind: 'finance-buyers',
        list: 'band',
        band: 'engaged',
        cursor: 'c1',
      }).success,
    ).toBe(true);
  });

  it('refuses the lists the panel never pages, an unknown band and an extra key', () => {
    for (const input of [
      { kind: 'finance-buyers', list: 'expiring', cursor: 'c1' },
      { kind: 'finance-buyers', list: 'offer', cursor: 'c1' },
      { kind: 'finance-buyers', list: 'product', cursor: 'c1' },
      { kind: 'finance-buyers', list: 'band', band: 'vip', cursor: 'c1' },
      { kind: 'finance-buyers', list: 'primary', cursor: 'c1', tenantId: FINANCE_IDS.member },
      { kind: 'finance-buyers', list: 'primary' },
    ]) {
      expect(ownerListMoreInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

describe('the Financeiro detail files read no fixture (INSIGHT-17)', () => {
  it.each(['OwnerFinanceProductDetail.tsx', 'OwnerFinanceBuyers.tsx', 'OwnerFinancePeople.tsx'])(
    '%s imports nothing from the dashboard fixtures',
    (file) => {
      const source = readFileSync(join(process.cwd(), 'components', 'dashboard', file), 'utf8');
      expect(source).not.toMatch(/module-dashboard\/fixtures/);
    },
  );
});
