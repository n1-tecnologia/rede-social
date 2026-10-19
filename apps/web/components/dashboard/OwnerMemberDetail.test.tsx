// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OwnerMemberDetailReady } from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';

/**
 * The member detail on REAL data (08.7-05, D-461, D-458, UI-D-473, UI-D-478, UI-D-480), on the real
 * pt-BR catalog and a contract-shaped answer: the band history ending in "Última atualização (base
 * toda)", the measured 30-day tiles linking their lists, "Tempo médio diário" and "Publicações vistas"
 * as "Em breve" tiles that never open, "Onde interage" only with `communities`, purchases without a
 * "Vence em" line, and every suggestion action disabled with the "Em breve" pill.
 */

vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({ loadMoreOwnerListAction: vi.fn() }));

const { OwnerMemberDetailView } = await import('./OwnerMemberDetail');

afterEach(cleanup);

const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
} as never) as unknown as DashboardT;

const TZ = 'America/Sao_Paulo';
const NOW = Date.parse('2026-10-18T15:00:00Z');
const MEMBER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const GERAL = '22222222-2222-4222-8222-222222222222';

const ALL_ON: OwnerPanelFlags = {
  feed: true,
  stories: true,
  communities: true,
  events: true,
  store: true,
  chat: true,
  notifications: true,
};

const DETAIL: OwnerMemberDetailReady = {
  state: 'ready',
  snapshot: {
    day: '2026-10-17',
    builtAt: '2026-10-18T03:30:00Z',
    windows: {
      day: '2026-10-17',
      from30: '2026-09-18',
      prev30From: '2026-08-19',
      from7: '2026-10-11',
      prev7From: '2026-10-04',
      from30At: '2026-09-18T03:00:00Z',
      prev30At: '2026-08-19T03:00:00Z',
      untilAt: '2026-10-18T03:00:00Z',
    },
  },
  member: {
    membershipId: MEMBER,
    displayName: 'Ana Souza',
    avatarAssetId: null,
    joinedAt: '2026-08-10T13:00:00Z',
    lastActiveAt: '2026-10-17T20:00:00Z',
    band: 'engaged',
  },
  topCommunity: { id: GERAL, name: 'Geral' },
  bandHistory: [
    { month: '2026-08', band: null },
    { month: '2026-09', band: 'occasional' },
    { month: '2026-10', band: 'engaged' },
  ],
  last30: {
    activeDays: 9,
    likes: 14,
    comments: 3,
    checkIns: 1,
    orders: 1,
    strongActions: 5,
    dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
    postsSeen: { measured: false, reason: 'needs_post_views' },
  },
  weeklyActiveDays: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3],
  communities: [
    { communityId: GERAL, name: 'Geral', actions: 10 },
    { communityId: null, name: null, actions: 4 },
  ],
  postTypes: [
    { type: 'video', interactions: 8 },
    { type: 'gallery', interactions: 3 },
  ],
  events: [
    {
      eventId: '44444444-4444-4444-8444-444444444444',
      title: 'Encontro de setembro',
      startsAt: '2026-09-20T22:00:00Z',
      attended: true,
    },
    {
      eventId: '55555555-5555-4555-8555-555555555555',
      title: 'Live de outubro',
      startsAt: '2026-10-25T22:00:00Z',
      attended: null,
    },
  ],
  purchases: [
    {
      orderId: '66666666-6666-4666-8666-666666666666',
      productId: '77777777-7777-4777-8777-777777777777',
      productName: 'Curso de entrada',
      kind: 'primary',
      paidAt: '2026-09-01T12:00:00Z',
      cents: 19900,
      expiresAt: { measured: false, reason: 'needs_access_expiry' },
    },
  ],
  support: { conversations: 2, lastDaysAgo: 3, medianResponseMinutes: 30 },
  suggestion: { kind: 'engaged', days: 1 },
};

function renderDetail(detail: OwnerMemberDetailReady = DETAIL, flags: OwnerPanelFlags = ALL_ON) {
  const { container } = render(
    <OwnerMemberDetailView
      t={t}
      detail={detail}
      flags={flags}
      timeZone={TZ}
      nowMs={NOW}
      scopeKind="member"
      nextEvent={{ title: 'Encontro mensal', startsAt: '2026-10-24T22:00:00Z' }}
      backHref="/perfil?area=membros&faixa=engajados#faixas"
      listHref={(slug: string) => `/perfil?area=membros&membro=${MEMBER}&lista=${slug}#lista`}
    />,
  );
  return container;
}

/** The KPI card whose label is exactly `label`. */
function tile(container: HTMLElement, label: string): HTMLElement {
  const card = [...container.querySelectorAll<HTMLElement>('[data-kpi-card]')].find((el) =>
    [...el.querySelectorAll('*')].some((node) => node.textContent?.trim() === label),
  );
  if (!card) throw new Error(`no tile ${label}`);
  return card;
}

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h3, h4')].map((el) => el.textContent?.trim() ?? '');
}

describe('the member detail on real data (D-461)', () => {
  it('reads the band history, the current point as "Última atualização (base toda)" (UI-D-480)', () => {
    const text = renderDetail().textContent ?? '';
    expect(text).toContain('ago. (há 60 dias): ainda não era membro');
    expect(text).toContain('set. (há 30 dias): Ocasional');
    expect(text).toContain('Última atualização (base toda): Engajado');
    expect(text).not.toContain('Hoje (base toda)');
  });

  it('links each measured 30-day tile to its list', () => {
    const container = renderDetail();
    for (const [label, slug, value] of [
      ['Dias ativos', 'dias-ativos', '9'],
      ['Curtidas', 'curtidas', '14'],
      ['Comentários', 'comentarios', '3'],
      ['Ações fortes', 'acoes-fortes', '5'],
    ] as const) {
      const card = tile(container, label);
      expect(card.closest('a')?.getAttribute('href'), label).toContain(`&lista=${slug}`);
      expect(card.textContent, label).toContain(value);
    }
  });

  it('draws "Tempo médio diário" and "Publicações vistas" as "Em breve" tiles that never open (D-458)', () => {
    const container = renderDetail();
    for (const label of ['Tempo médio diário', 'Publicações vistas']) {
      const card = tile(container, label);
      expect(card.className, label).toContain('border-dashed');
      expect(card.textContent, label).toContain('Em breve');
      expect(card.textContent, label).toContain('Medição a caminho');
      expect(card.closest('a'), label).toBeNull();
    }
    expect(renderDetail().innerHTML).not.toContain('lista=posts-vistos');
  });

  it('shows "Onde interage" and the top community with communities on, "Início" for the feed', () => {
    const container = renderDetail();
    expect(headings(container)).toContain('Onde interage');
    expect(container.textContent).toContain('Comunidade que mais interage:');
    expect(container.textContent).toContain('Início');
  });

  it('drops "Onde interage" and the top community line with communities off (UI-D-473)', () => {
    const container = renderDetail(DETAIL, { ...ALL_ON, communities: false });
    expect(headings(container)).not.toContain('Onde interage');
    expect(container.textContent).not.toContain('Comunidade que mais interage:');
  });

  it('drops the purchases block with store off, and a purchase has no "Vence em" line', () => {
    const on = renderDetail();
    expect(headings(on)).toContain('Compras');
    expect(on.textContent).toContain('Curso de entrada');
    expect(on.textContent).toContain('Entrada');
    expect(on.textContent).not.toContain('Vence em');
    cleanup();
    const { purchases: _, ...withoutPurchases } = DETAIL;
    const off = renderDetail(withoutPurchases, { ...ALL_ON, store: false });
    expect(headings(off)).not.toContain('Compras');
  });

  it('lists the events with their state and the support counts, never a message', () => {
    const text = renderDetail().textContent ?? '';
    expect(text).toContain('Encontro de setembro · 20/09');
    expect(text).toContain('Foi');
    expect(text).toContain('Inscrito');
    expect(text).toContain('2 conversas em 8 semanas');
  });

  it('keeps every suggestion action disabled, with the "Em breve" pill after it (UI-D-478)', () => {
    const container = renderDetail();
    const actions = [...container.querySelectorAll('[data-disabled-action]')];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      const button = action.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(action.querySelector('[data-coming-soon]')?.textContent).toBe('Em breve');
      expect(
        button?.compareDocumentPosition(action.querySelector('[data-coming-soon]') as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(container.textContent).toContain('Avisar sobre o evento');
    expect(container.textContent).toContain('Encontro mensal · 24/10');
  });

  it('shows measured zeros for a member with no activity, never "Em breve" on a measured tile', () => {
    const empty: OwnerMemberDetailReady = {
      ...DETAIL,
      last30: { ...DETAIL.last30, activeDays: 0, likes: 0, comments: 0, strongActions: 0 },
      events: [],
      purchases: [],
      support: { conversations: 0, lastDaysAgo: null, medianResponseMinutes: null },
    };
    const container = renderDetail(empty);
    expect(tile(container, 'Curtidas').textContent).toContain('0');
    expect(tile(container, 'Curtidas').textContent).not.toContain('Em breve');
    expect(container.textContent).toContain('Nenhuma inscrição em eventos.');
    expect(container.textContent).toContain('Nenhuma compra.');
    expect(container.textContent).toContain('Nenhuma conversa com o atendimento em 8 semanas.');
  });
});
