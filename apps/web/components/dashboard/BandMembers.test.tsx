// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CommunityEngagement,
  EngagementBandsAnswer,
  EventEngagement,
  OwnerBandMemberRow,
} from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { OwnerMembersView } from '@/lib/owner-band-scope';
import { bandMemberRowView } from '@/lib/owner-list-view';
import type { DashboardT } from './format';

/**
 * The Membros bands on REAL data (08.7-05, INSIGHT-08, D-461, UI-D-477, UI-D-486), on the real pt-BR
 * catalog and contract-shaped rows: exact counts and shares (a share that rounds to 0% reads "menos
 * de 1%"), a band's first 10 members as cards whose "Tempo médio diário" is the "Em breve" pill, the
 * "e mais N" line and an ENABLED "Ver todos" when the band holds more, one sentence for an empty band,
 * the community and event cards from the answer's live labels, and an opened item's members.
 */

vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: vi.fn(),
}));

const { BandMembers } = await import('./BandMembers');

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
} as never) as unknown as DashboardT;

type BandView = Pick<OwnerMembersView, 'kind' | 'band' | 'itemId'>;
type Lists = Parameters<typeof BandMembers>[0]['lists'];

const TZ = 'America/Sao_Paulo';
/** 2026-10-18 12:00 in São Paulo. */
const NOW = Date.parse('2026-10-18T15:00:00Z');
const AREA = '/perfil?area=membros';
const VIP = '11111111-1111-4111-8111-111111111111';
const GERAL = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

const BANDS: EngagementBandsAnswer = {
  counts: { new: 96, superfan: 3, engaged: 41, occasional: 500, at_risk: 168, inactive: 400 },
  newActivated: 40,
};

const MEMBER: BandView = { kind: 'member', band: null, itemId: null };

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function row(n: number, extra: Partial<OwnerBandMemberRow> = {}): OwnerBandMemberRow {
  return {
    membershipId: uuid(n),
    displayName: `Membro Número ${n}`,
    avatarAssetId: null,
    joinedAt: '2026-09-02T13:00:00Z',
    lastActiveAt: '2026-10-18T12:40:00Z',
    topCommunity: { id: GERAL, name: 'Geral' },
    dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
    ...extra,
  };
}

function ready(
  view: BandView,
  band: keyof EngagementBandsAnswer['counts'],
  rows: OwnerBandMemberRow[],
  total: number,
  nextCursor: string | null,
) {
  return {
    status: 'ready' as const,
    total,
    nextCursor,
    rows: rows.map((r) => bandMemberRowView(t, r, { view, band, timeZone: TZ, nowMs: NOW })),
  };
}

const COMMUNITIES: CommunityEngagement[] = [
  {
    id: VIP,
    name: 'VIP',
    description: 'Aulas e lives para quem é VIP.',
    coverAssetId: null,
    exclusive: true,
    bands: { counts: { ...BANDS.counts, engaged: 12 }, newActivated: 3 },
    atRiskWithPush: 4,
    members: 186,
    activeWeek: 104,
    posts: 22,
    interactions: 1650,
  },
  {
    id: GERAL,
    name: 'Geral',
    description: 'Para todos.',
    coverAssetId: null,
    exclusive: false,
    bands: { counts: { ...BANDS.counts, engaged: 0 }, newActivated: 0 },
    atRiskWithPush: 0,
    members: 900,
    activeWeek: 300,
    posts: 40,
    interactions: 2000,
  },
];

const EVENTS: EventEngagement[] = [
  {
    id: EVENT,
    title: 'Encontro mensal',
    startsAt: '2026-10-24T22:00:00Z',
    endsAt: '2026-10-25T01:00:00Z',
    format: 'in_person',
    coverAssetId: null,
    bands: { counts: { ...BANDS.counts, engaged: 34 }, newActivated: 0 },
    atRiskWithPush: 2,
  },
];

function renderBands(view: BandView, lists: Lists = {}, bands = BANDS) {
  const { container } = render(
    <BandMembers
      t={t}
      bands={bands}
      view={view}
      lists={lists}
      communities={COMMUNITIES}
      events={EVENTS}
      timeZone={TZ}
    />,
  );
  return container;
}

/** A band's `<details>`, by its summary's exact bold title (closed details stay in the DOM). */
function band(container: HTMLElement, label: string): HTMLDetailsElement {
  const details = [...container.querySelectorAll('details')].find(
    (el) => el.querySelector('summary span.font-bold')?.textContent?.trim() === label,
  );
  if (!details) throw new Error(`no band ${label}`);
  return details;
}

function seeAll(details: HTMLElement): HTMLButtonElement | undefined {
  return [...details.querySelectorAll('button')].find((el) => el.textContent === 'Ver todos');
}

/** The dd next to a card's dt `label`. */
function cell(root: Element, label: string): Element | undefined {
  const term = [...root.querySelectorAll('dt')].find((el) => el.textContent?.trim() === label);
  return term?.nextElementSibling ?? undefined;
}

const TEN = Array.from({ length: 10 }, (_, i) => row(i + 1));

describe('the bands read the snapshot’s exact counts (UI-D-486)', () => {
  it('shows each band’s count and share, "menos de 1%" for a tiny one with a visible bar', () => {
    const container = renderBands(MEMBER);
    const superfans = band(container, 'Superfãs');
    expect(superfans.querySelector('summary')?.textContent).toContain('3 · menos de 1%');
    expect(band(container, 'Em risco').querySelector('summary')?.textContent).toContain(
      '168 · 14%',
    );
    const bar = superfans.querySelector('summary span[aria-hidden="true"] > span');
    expect(bar?.classList.contains('min-w-1.5')).toBe(true);
  });
});

describe('a band’s members (D-461, UI-D-477)', () => {
  const lists = (): Lists => ({ at_risk: ready(MEMBER, 'at_risk', TEN, 168, 'cursor-1') });

  it('draws each member as a card linking the panel’s member detail', () => {
    const atRisk = band(renderBands(MEMBER, lists()), 'Em risco');
    const first = atRisk.querySelector('li');
    if (!first) throw new Error('no member card');
    const text = first.textContent ?? '';
    for (const part of [
      'Membro Número 1',
      'Membro desde: set. de 2026',
      'Última atividade: hoje às 09:40',
      'Comunidade que mais interage: Geral',
    ]) {
      expect(text, part).toContain(part);
    }
    expect(first.querySelector('a')?.getAttribute('href')).toBe(
      `${AREA}&faixa=em-risco&membro=${uuid(1)}`,
    );
    expect(first.querySelector('[aria-hidden="true"]')?.textContent).toBe('M1');
  });

  it('reads "Tempo médio diário:" as the "Em breve" pill, never a number (D-458)', () => {
    const first = band(renderBands(MEMBER, lists()), 'Em risco').querySelector('li');
    const value = first ? cell(first, 'Tempo médio diário:') : undefined;
    expect(value?.querySelector('[data-coming-soon]')?.textContent).toBe('Em breve');
  });

  it('keeps the first 10, the "e mais N" line and an enabled "Ver todos" for a capped band', () => {
    const atRisk = band(renderBands(MEMBER, lists()), 'Em risco');
    expect(atRisk.querySelectorAll('li')).toHaveLength(10);
    expect(atRisk.textContent).toContain('Os 10 com atividade mais recente');
    expect(atRisk.textContent).toContain('e mais 158 membros');
    expect(seeAll(atRisk)?.disabled).toBe(false);
  });

  it('says nothing of a cap when the band fits', () => {
    const container = renderBands(MEMBER, {
      superfan: ready(MEMBER, 'superfan', TEN.slice(0, 3), 3, null),
    });
    const superfans = band(container, 'Superfãs');
    expect(superfans.querySelectorAll('li')).toHaveLength(3);
    expect(superfans.textContent).not.toContain('Os 10 com atividade mais recente');
    expect(superfans.textContent).not.toMatch(/e mais \d/);
    expect(seeAll(superfans)).toBeUndefined();
  });

  it('opens an empty band to one sentence (UI-D-481)', () => {
    const empty = { ...BANDS, counts: { ...BANDS.counts, at_risk: 0 } };
    const atRisk = band(renderBands(MEMBER, {}, empty), 'Em risco');
    expect(atRisk.querySelector('summary')?.textContent).toContain('0 · 0%');
    expect(atRisk.querySelector('summary + div')?.textContent).toBe('Nenhum membro nesta faixa.');
    expect(atRisk.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows the list error card for a failed first read (UI-D-479)', () => {
    const atRisk = band(renderBands(MEMBER, { at_risk: { status: 'error' } }), 'Em risco');
    expect(atRisk.textContent).toContain('Não foi possível carregar esta lista agora.');
    expect(atRisk.querySelectorAll('li')).toHaveLength(0);
  });

  it('drops "Comunidade que mais interage:" for a member with none, and wraps a long name', () => {
    const long = 'Maria Aparecida Conceição dos Santos Albuquerque de Oliveira';
    const container = renderBands(MEMBER, {
      engaged: ready(
        MEMBER,
        'engaged',
        [row(1, { topCommunity: null, displayName: long })],
        1,
        null,
      ),
    });
    const card = band(container, 'Engajados').querySelector('li');
    expect(card?.textContent).not.toContain('Comunidade que mais interage:');
    expect(card?.textContent).toContain(long);
    expect(card?.querySelector('[class*="overflow-wrap:anywhere"]')).not.toBeNull();
  });

  it('reads "Última atividade" for a member who never acted', () => {
    const container = renderBands(MEMBER, {
      inactive: ready(MEMBER, 'inactive', [row(1, { lastActiveAt: null })], 1, null),
    });
    const card = band(container, 'Inativos').querySelector('li');
    expect(card?.textContent).toContain('Última atividade: nenhuma ainda');
  });
});

describe('Por comunidade and Por evento list the answer’s live cards (D-460)', () => {
  it('lists the communities with their live labels, linked by uuid when the band has members', () => {
    const engaged = band(
      renderBands({ kind: 'community', band: 'engaged', itemId: null }),
      'Engajados',
    );
    const [vip, geral] = engaged.querySelectorAll('li');
    if (!vip || !geral) throw new Error('no community cards');
    expect(vip.textContent).toContain('Comunidade VIP');
    expect(vip.textContent).toContain('Aulas e lives para quem é VIP.');
    expect(cell(vip, 'Membros')?.textContent).toBe('186');
    expect(cell(vip, 'Interações no mês')?.textContent).toBe('1.650');
    expect(vip.textContent).toContain('12 nesta faixa');
    expect(vip.querySelector('a')?.getAttribute('href')).toBe(
      `${AREA}&recorte=comunidade&comunidade=${VIP}&faixa=engajados#faixas`,
    );
    expect(geral.textContent).toContain('0 nesta faixa');
    expect(geral.querySelector('a')).toBeNull();
  });

  it('lists the events with date and duration, and "Receita" as the "Em breve" line (D-455)', () => {
    const engaged = band(
      renderBands({ kind: 'event', band: 'engaged', itemId: null }),
      'Engajados',
    );
    const [card] = engaged.querySelectorAll('li');
    if (!card) throw new Error('no event card');
    expect(card.textContent).toContain('Encontro mensal');
    expect(card.textContent).toContain('Presencial');
    expect(cell(card, 'Data')?.textContent).toBe('24/10');
    expect(cell(card, 'Duração')?.textContent).toBe('3h00');
    expect(cell(card, 'Receita')?.querySelector('[data-coming-soon]')?.textContent).toBe(
      'Em breve',
    );
    expect(card.textContent).toContain('34 nesta faixa');
  });

  it('opens a community in place with its members in the band', () => {
    const view: BandView = { kind: 'community', band: 'engaged', itemId: VIP };
    const engaged = band(
      renderBands(view, { engaged: ready(view, 'engaged', TEN, 12, 'cursor-1') }),
      'Engajados',
    );
    const back = [...engaged.querySelectorAll('a')].find(
      (el) => el.textContent?.trim() === 'Voltar às comunidades',
    );
    expect(back?.getAttribute('href')).toBe(`${AREA}&recorte=comunidade&faixa=engajados#faixas`);
    expect(engaged.textContent).toContain('Engajados em Comunidade VIP');
    expect(engaged.querySelectorAll('li')).toHaveLength(10);
    expect(engaged.textContent).toContain('e mais 2 membros');
    expect(engaged.querySelector('li a')?.getAttribute('href')).toBe(
      `${AREA}&recorte=comunidade&comunidade=${VIP}&faixa=engajados&membro=${uuid(1)}`,
    );
  });
});
