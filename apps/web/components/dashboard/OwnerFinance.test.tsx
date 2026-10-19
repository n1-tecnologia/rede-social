// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ownerFinanceAnswerSchema,
  ownerFinanceBuyersAnswerSchema,
  ownerFinanceProductAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/*
 * Financeiro on the API's answer (08.7-10, INSIGHT-12, INSIGHT-14) on the REAL pt-BR catalog: the
 * tenant's money numbers, every floored group as text (D-462, UI-D-470), the live VIP names
 * (UI-D-490), "Em breve" for offers, expiring accesses and paid events (D-455, D-465), and the
 * sales after a publication or an event worded as an association (PR-6).
 */

const loaders = vi.hoisted(() => ({
  finance: { status: 'error' } as Record<string, unknown>,
}));

vi.mock('@/lib/dashboard', () => ({
  getOwnerFinance: async () => loaders.finance,
  getOwnerContent: async () => ({ status: 'error' }),
  getOwnerFinanceProduct: async () => ({ status: 'error' }),
  getOwnerFinanceBuyers: async () => ({ status: 'error' }),
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

import { financeTabView } from '@/lib/owner-finance-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerFinance } from './OwnerFinance';
import { OwnerFinanceOverview } from './OwnerFinanceOverview';
import { OwnerFinanceProducts } from './OwnerFinanceProducts';
import {
  emptyFinanceAnswer,
  FINANCE_IDS,
  FLOORED,
  financeAnswer,
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
const F = 'tenantOwner.finance';
const POST_TITLES = new Map([[FINANCE_IDS.post, 'Live de outubro']]);

function overview(answer = financeAnswer(), flags: OwnerPanelFlags = ALL_ON) {
  return render(
    <OwnerFinanceOverview t={t} answer={answer} flags={flags} postTitles={POST_TITLES} />,
  );
}

/** An element's text with every run of whitespace (the money's U+00A0 included) as one space. */
function textOf(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ');
}

/** The labels of a bar list's rows, in the order they are drawn. */
function rowLabels(list: Element | null): string[] {
  return [...(list?.querySelectorAll('li') ?? [])].map(
    (row) => row.querySelector('span')?.textContent ?? '',
  );
}

/** The disabled button with this label, and the row that holds it with its pill. */
function disabledAction(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === label,
  );
  return { button, row: button?.closest('[data-disabled-action]') ?? null };
}

describe('the test answers are the contract’s', () => {
  it('parse through the strict schemas', () => {
    expect(() => ownerFinanceAnswerSchema.parse(financeAnswer())).not.toThrow();
    expect(() => ownerFinanceAnswerSchema.parse(emptyFinanceAnswer())).not.toThrow();
    expect(() => ownerFinanceProductAnswerSchema.parse(financeProductAnswer())).not.toThrow();
    expect(() => ownerFinanceBuyersAnswerSchema.parse(financeBuyersPage())).not.toThrow();
  });
});

describe('Financeiro › Visão geral on the API answer (08.7-10)', () => {
  it('by band: the groups the API merged (C-1) by bandGroupLabel, each with its value', () => {
    const { container } = overview();
    const column = container.querySelector('[data-finance-sources="band"]');
    expect(textOf(column)).toContain('Pela faixa atual de quem comprou');
    const labels = rowLabels(column);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Superfãs');
    expect(labels[0]).toContain('engajados');
    expect(labels[1]).toBe('Novos');
    expect(column?.querySelectorAll('li[data-floored]')).toHaveLength(0);
    expect(textOf(column)).toContain('R$');
  });

  it('by band: a whole base under the floor is one floored group with no value or fill (UI-D-470)', () => {
    const { container } = overview(
      financeAnswer({
        byBand: [
          {
            bands: ['new', 'superfan', 'engaged', 'occasional', 'at_risk', 'inactive'],
            sales: FLOORED,
          },
        ],
      }),
    );
    const column = container.querySelector('[data-finance-sources="band"]');
    const floored = column?.querySelectorAll('li[data-floored]') ?? [];
    expect(floored).toHaveLength(1);
    expect(textOf(floored[0])).toContain('menos de 5 pedidos');
    expect(floored[0]?.querySelector('[data-bar-fill]')).toBeNull();
  });

  it('by product: each product with its revenue, the store leader first', () => {
    const { container } = overview();
    const column = container.querySelector('[data-finance-sources="product"]');
    expect(rowLabels(column)).toEqual(['Círculo Interno', 'Guia de Entrada', 'Mentoria Antiga']);
    expect(textOf(column)).toContain('R$ 1,2 mil');
  });

  it('the numbers: the total and its orders, the cancellations as floor text with no value', () => {
    const { container } = overview();
    const total = container.querySelector('[data-finance-total]');
    expect(textOf(total)).toContain('R$ 1.592');
    expect(textOf(total)).toContain('14 pedidos');
    const revoked = [...container.querySelectorAll('[data-kpi-card]')].find((card) =>
      card.textContent?.includes('Cancelamentos'),
    );
    expect(textOf(revoked)).toContain('menos de 5 pedidos');
    expect(textOf(revoked)).not.toContain('R$');
  });

  it('each number opens its list as a whole linked card', () => {
    const { container } = overview();
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
    }
  });

  it('WR-06: floored VIP prospects read the floor; a floored D-30 rebought drops the change chip', () => {
    const base = financeAnswer();
    const before = textOf(overview().container.querySelector('a#numero-recompra'));
    cleanup();
    const { container } = overview(
      financeAnswer({
        vip: base.vip ? { ...base.vip, prospects: { belowFloor: true } } : null,
        summary: {
          current: base.summary.current,
          previous: {
            ...base.summary.previous,
            rebought: { belowFloor: true },
            timeToSecondDays: null,
          },
        },
      }),
    );
    expect(textOf(container)).toContain(
      'menos de 5 superfãs e engajados entraram por Guia de Entrada e ainda não têm acesso a Círculo Interno.',
    );
    const rebought = textOf(container.querySelector('a#numero-recompra'));
    expect(before).toContain('%');
    expect(rebought).toContain('9');
    expect(rebought).not.toContain('%');
  });

  it('with a VIP: its blocks name the live community and product (UI-D-490)', () => {
    const { container } = overview();
    const text = container.textContent ?? '';
    expect(text).toContain('5 pagantes de Círculo Interno sem ação há mais de 30 dias');
    expect(text).toContain('3 em risco · 2 inativos · 1 com notificação ativa');
    expect(text).toContain('Círculo Interno: receita e uso');
    expect(text).toContain('Oferecer Círculo Interno a quem entrou por Guia de Entrada');
    expect(text).toContain(
      '9 superfãs e engajados entraram por Guia de Entrada e ainda não têm acesso a Círculo Interno.',
    );
    expect(text).toContain(
      '5 pagantes de Círculo Interno sem ação há mais de 30 dias, 1 com notificação ativa.',
    );
    expect(text).not.toMatch(/Comunidade VIP|\bVIP\b|E-book/);
    expect(container.querySelector('a#atencao-pagantes-sumindo')?.getAttribute('href')).toMatch(
      /&atencao=pagantes-sumindo$/,
    );
  });

  it('with no VIP: every VIP block is absent together (UI-D-490)', () => {
    const { container } = overview(
      financeAnswer({ vip: null, attention: { ...financeAnswer().attention, vipFading: null } }),
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('pagantes de');
    expect(text).not.toContain('receita e uso');
    expect(text).not.toContain('Oferecer');
    expect(text).not.toContain('Recuperar pagantes');
    expect(container.querySelector('a#atencao-pagantes-sumindo')).toBeNull();
  });

  it('with notifications off: no "com notificação ativa" fragment (UI-D-489 d)', () => {
    const { container } = overview(financeAnswer(), { ...ALL_ON, notifications: false });
    const text = container.textContent ?? '';
    expect(text).toContain('3 em risco · 2 inativos');
    expect(text).not.toContain('notificação ativa');
  });

  it('Em breve: the expiring accesses and the full events are lines, never links (D-465, D-455)', () => {
    const { container } = overview();
    for (const id of ['expiring', 'fullEvents']) {
      const line = container.querySelector(`[data-finance-attention="${id}"]`);
      expect(line, id).not.toBeNull();
      expect(textOf(line?.querySelector('[data-coming-soon]')), id).toContain('Em breve');
      expect(line?.closest('a'), id).toBeNull();
    }
    expect(textOf(container.querySelector('[data-finance-attention="expiring"]'))).toContain(
      'Acessos que vencem em 7 dias',
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => /atencao=vencendo|oferta=/.test(href))).toEqual([]);
  });

  it('"Lembrar quem tem acesso vencendo" keeps its title, reads "Medição a caminho" and its action is disabled with the pill', () => {
    const { container } = overview();
    const card = container.querySelector('[data-finance-next="expiring"]');
    expect(textOf(card)).toContain('Lembrar quem tem acesso vencendo');
    expect(textOf(card)).toContain('Medição a caminho');
    expect(textOf(card)).not.toContain('acessos vencem');
    const { button, row } = disabledAction(container, 'Enviar lembrete de renovação');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(textOf(row)).toContain('Em breve');
  });

  it('every capability action stays disabled with the Em breve pill (UI-D-478)', () => {
    const { container } = overview();
    for (const label of [
      'Enviar oferta',
      'Avisar sobre o próximo encontro',
      'Enviar lembrete de renovação',
    ]) {
      const { button, row } = disabledAction(container, label);
      expect(button?.hasAttribute('disabled'), label).toBe(true);
      expect(textOf(row), label).toContain('Em breve');
    }
  });

  it('the sales after a publication or an event read as an association (PR-6)', () => {
    const { container } = overview();
    const app = container.querySelector('[data-finance-app]');
    const text = app?.textContent ?? '';
    expect(text).toContain('depois de');
    expect(text).not.toMatch(/gerou|trouxe|venderam|vendeu/i);
    const post = [...(app?.querySelectorAll('a') ?? [])].find((a) =>
      a.textContent?.includes('Live de outubro'),
    );
    expect(post?.getAttribute('href')).toContain(`post=${FINANCE_IDS.post}`);
    expect(textOf(post)).toContain('5 pedidos');
    const event = [...(app?.querySelectorAll('li') ?? [])].find((row) =>
      row.textContent?.includes('Encontro de outubro'),
    );
    expect(textOf(event)).toContain('menos de 5 pedidos');
    expect(textOf(event)).not.toContain('R$');
  });

  it('a withheld association total (C-1) leaves its label and every row, no KPI value', () => {
    const base = financeAnswer();
    const { container } = overview(
      financeAnswer({
        contentSales: base.contentSales ? { ...base.contentSales, total: null } : undefined,
        eventSales: base.eventSales ? { ...base.eventSales, total: null } : undefined,
      }),
    );
    const app = container.querySelector('[data-finance-app]');
    expect(app?.querySelectorAll('[data-kpi-card]')).toHaveLength(1);
    expect(textOf(app)).toContain('Live de outubro');
    expect(textOf(app)).toContain('Encontro de outubro');
  });

  it('a stalled product opens its detail', () => {
    const { container } = overview();
    const row = container.querySelector(`a#produto-${FINANCE_IDS.stalled}`);
    expect(textOf(row)).toContain('Mentoria Antiga: nenhuma venda há 108 dias');
    expect(row?.getAttribute('href')).toMatch(new RegExp(`&produto=${FINANCE_IDS.stalled}$`));
  });

  it('the empty tenant: the one-sentence empties, no bars (UI-D-481)', () => {
    const { container } = overview(emptyFinanceAnswer());
    const text = container.textContent ?? '';
    expect(text).toContain('Nenhum pedido nos últimos 30 dias.');
    expect(text).toContain('Nada precisa de atenção.');
    expect(container.querySelector('[data-finance-sources="band"]')).toBeNull();
    expect(textOf(container.querySelector('[data-finance-total]'))).toContain('R$ 0');
  });

  it('no card note, no "exemplo", every KPI card with its icon', () => {
    const { container } = overview();
    expect(container.textContent).not.toMatch(/\bexemplo\b|amostra/i);
    for (const card of container.querySelectorAll('[data-kpi-card]')) {
      expect(card.querySelector('span.size-8 > svg'), card.textContent ?? '').not.toBeNull();
    }
  });
});

describe('Financeiro › Produtos on the API answer', () => {
  it('one card per product: the live name, the price, entries and add-ons, the revenue, opening &produto=', () => {
    const { container } = render(<OwnerFinanceProducts t={t} answer={financeAnswer()} />);
    const cards = container.querySelectorAll('[data-finance-products] > li');
    expect(cards).toHaveLength(3);
    const vip = container.querySelector(`li#produto-${FINANCE_IDS.vip}`);
    expect(textOf(vip)).toContain('Círculo Interno');
    expect(textOf(vip)).toContain('R$ 200,00');
    expect(vip?.querySelector('a')?.getAttribute('href')).toBe(
      `/perfil?area=financeiro&vista=produtos&produto=${FINANCE_IDS.vip}`,
    );
    const stalled = container.querySelector(`li#produto-${FINANCE_IDS.stalled}`);
    expect(textOf(stalled)).toContain('Parado');
    expect(textOf(vip)).not.toContain('Parado');
  });

  it('"Eventos pagos" is an Em breve block (D-455)', () => {
    const { container } = render(<OwnerFinanceProducts t={t} answer={financeAnswer()} />);
    const block = [...container.querySelectorAll('[data-coming-soon-block]')].find((node) =>
      node.textContent?.includes('Eventos pagos'),
    );
    expect(textOf(block)).toContain('Em breve');
  });

  it('a store with no product says so in one sentence', () => {
    const { container } = render(<OwnerFinanceProducts t={t} answer={emptyFinanceAnswer()} />);
    expect(container.textContent).toContain('Nenhum produto na loja.');
    expect(container.querySelector('[data-finance-products]')).toBeNull();
  });
});

describe('OwnerFinance reads GET /v1/dashboard/owner/finance (D-460, UI-D-469, UI-D-479)', () => {
  const view = financeTabView('overview');

  it('renders nothing when the store module is off (MODULE_DISABLED)', async () => {
    loaders.finance = { status: 'disabled' };
    expect(await OwnerFinance({ finance: view, flags: ALL_ON, timeZone: TZ })).toBeNull();
  });

  it('shows the area error card on a failed read, and the preparing card before the first build', async () => {
    loaders.finance = { status: 'error' };
    const error = (await OwnerFinance({
      finance: view,
      flags: ALL_ON,
      timeZone: TZ,
    })) as ReactElement<{
      kind: string;
    }>;
    expect(error.type).toBe(OwnerAreaState);
    expect(error.props.kind).toBe('error');
    loaders.finance = { status: 'ok', answer: { state: 'preparing' } };
    const preparing = (await OwnerFinance({
      finance: view,
      flags: ALL_ON,
      timeZone: TZ,
    })) as ReactElement<{ kind: string }>;
    expect(preparing.type).toBe(OwnerAreaState);
    expect(preparing.props.kind).toBe('preparing');
  });

  it('puts the freshness line first, then the tabs and the overview', async () => {
    loaders.finance = { status: 'ok', answer: financeAnswer() };
    const { container } = render(
      (await OwnerFinance({ finance: view, flags: ALL_ON, timeZone: TZ })) as ReactElement,
    );
    expect(container.firstElementChild?.hasAttribute('data-snapshot-freshness')).toBe(true);
    expect(container.querySelector('[data-finance-total]')).not.toBeNull();
  });
});

describe('the Financeiro files read no fixture (INSIGHT-17)', () => {
  it.each(['OwnerFinance.tsx', 'OwnerFinanceOverview.tsx', 'OwnerFinanceProducts.tsx'])(
    '%s imports nothing from the dashboard fixtures',
    (file) => {
      const source = readFileSync(join(process.cwd(), 'components', 'dashboard', file), 'utf8');
      expect(source).not.toMatch(/module-dashboard\/fixtures/);
    },
  );
});

describe('the catalog', () => {
  it('keeps no sentence of the sample or the expiring list (UI-SPEC "Copy removed from runtime")', () => {
    const has = (t as unknown as { has: (key: string) => boolean }).has;
    for (const key of [
      `${F}.lists.expiring.empty`,
      `${F}.overview.numbers.definition`,
      `${F}.overview.notice`,
      `${F}.overview.app.note`,
      `${F}.offers.note`,
      `${F}.events.exampleNote`,
    ]) {
      expect(has(key), key).toBe(false);
    }
  });
});
