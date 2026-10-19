// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { contentTabView } from '@/lib/owner-content-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';
import { OwnerContentPostDetailView } from './OwnerContentPostDetail';
import {
  contentAnswer,
  contentDetail,
  contentHeatmap,
  contentId,
  contentPost,
  contentStory,
} from './owner-content-test-data';

/**
 * One publication's detail (08.7-07, D-455, D-458, D-461, D-462, UI-D-470, UI-D-480, UI-D-490) on
 * contract-shaped answers and the REAL pt-BR catalog.
 */

afterEach(cleanup);

vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: async () => ({ error: true }),
}));

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

const ALL_ON: OwnerPanelFlags = {
  feed: true,
  stories: true,
  communities: true,
  events: true,
  store: true,
  chat: true,
  notifications: true,
};

const COMMUNITY = contentId(7, '11111111-1111-4111-8111');

const VIDEO = contentPost(1, {
  kind: 'video',
  likes: 40,
  comments: 6,
  durationSeconds: 75,
  communityId: COMMUNITY,
  createdAt: '2026-10-01T18:00:00Z',
  commentMeta: {
    answered: 4,
    unanswered: 2,
    oldestUnansweredHours: 30,
    firstReplyMedianMinutes: 45,
  },
});
const STORY = contentStory(9, { comments: 3, viewers: 11 });

const ANSWER = contentAnswer([VIDEO, STORY], {
  byCommunity: [{ communityId: COMMUNITY, name: 'Geral', posts: 1, interactions: 46 }],
  heatmap: contentHeatmap([{ weekday: 'wed', fromHour: 12, posts: 1, interactions: 46 }]),
});

function detail(
  item: typeof VIDEO,
  answer = contentDetail(item),
  extra: { atRiskWithPush?: number | null; flags?: OwnerPanelFlags } = {},
) {
  return render(
    <OwnerContentPostDetailView
      t={t}
      view={{ ...contentTabView('posts'), postId: item.id }}
      answer={ANSWER}
      detail={answer}
      flags={extra.flags ?? ALL_ON}
      timeZone="America/Sao_Paulo"
      atRiskWithPush={extra.atRiskWithPush ?? 12}
    />,
  ).container;
}

describe('a post detail (D-455, D-461, D-462)', () => {
  it('plays on the post page, opens its likes and comments, and its saves and shares never open', () => {
    const container = detail(VIDEO);
    const play = container.querySelector('a[data-play]');
    expect(play?.getAttribute('href')).toBe(`/post/${VIDEO.id}`);
    expect(play?.getAttribute('aria-label')).toBe('Assistir');
    for (const who of ['curtidas', 'comentarios']) {
      expect(container.querySelector(`a#quem-${who}`)?.getAttribute('href'), who).toContain(
        `post=${VIDEO.id}&quem=${who}`,
      );
    }
    for (const label of ['Salvamentos', 'Compartilha']) {
      const card = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
        el.textContent?.includes(label),
      );
      expect(card, label).toBeDefined();
      expect(card?.textContent, label).toContain('Em breve');
      expect(card?.closest('a'), label).toBeNull();
    }
    expect(container.querySelector('a[href*="quem=salvamentos"]')).toBeNull();
  });

  it('draws who it reached by band, the retention and the story taps as Em breve blocks', () => {
    const container = detail(VIDEO);
    const blocks = [...container.querySelectorAll('[data-coming-soon-block]')].map(
      (el) => el.textContent ?? '',
    );
    expect(blocks.some((text) => text.includes('Quem a publicação alcançou, por faixa'))).toBe(
      true,
    );
    expect(blocks.some((text) => text.includes('Retenção do vídeo'))).toBe(true);
    expect(container.textContent).not.toContain('Toques no story');
  });

  it('floors the orders whole: "menos de 5 pedidos" and no amount', () => {
    const container = detail(
      VIDEO,
      contentDetail(VIDEO, {
        orders: { belowFloor: true },
        reactivated: { belowFloor: true },
        rsvps: [],
      }),
    );
    const sales = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
      el.textContent?.includes('Vendas até 7 dias depois'),
    );
    expect(sales?.textContent).toContain('menos de 5 pedidos');
    expect(sales?.textContent).not.toMatch(/R\$/);
    const reactivated = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
      el.textContent?.includes('Membros que voltaram'),
    );
    expect(reactivated?.textContent).toContain('menos de 5');
  });

  it('shows the orders with their value from 5, and "nenhum pedido" for 0', () => {
    const shown = detail(
      VIDEO,
      contentDetail(VIDEO, { orders: { belowFloor: false, count: 6, cents: 59_400 } }),
    );
    expect(shown.textContent).toContain('6 pedidos · R$');
    cleanup();
    const none = detail(VIDEO);
    expect(none.textContent).toContain('nenhum pedido');
  });

  it('names the exclusive community live in the vitrine line, only with a vitrine number', () => {
    const container = detail(
      VIDEO,
      contentDetail(VIDEO, { vitrine: { belowFloor: false, value: 7 } }),
    );
    expect(container.textContent).toContain('Compras de acesso a Geral enquanto era a vitrine');
    cleanup();
    expect(detail(VIDEO).textContent).not.toContain('enquanto era a vitrine');
  });

  it('the comments card says how the team answered, the push recommendation "até ontem"', () => {
    const recent = contentPost(2, {
      kind: 'photo',
      likes: 9,
      comments: 1,
      createdAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    });
    const container = detail(VIDEO);
    expect(container.textContent).toContain('4 de 6 respondidos pela equipe');
    cleanup();
    const push = detail(recent);
    expect(push.textContent).toContain('10 interações até ontem: envie um push para os 12 membros');
    const action = [...push.querySelectorAll('[data-disabled-action]')].find((el) =>
      el.textContent?.includes('Enviar push'),
    );
    expect(action?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    expect(action?.querySelector('[data-coming-soon]')?.textContent).toBe('Em breve');
  });
});

describe('a story detail (D-458, UI-D-470, UI-D-489 b)', () => {
  it('draws its floored reach by band with merged group labels, the floored row last', () => {
    const container = detail(
      STORY as typeof VIDEO,
      contentDetail(STORY, {
        reachByBand: [
          { bands: ['at_risk', 'inactive'], count: { belowFloor: true } },
          { bands: ['new', 'superfan'], count: { belowFloor: false, value: 6 } },
        ],
      }),
    );
    const rows = [...container.querySelectorAll('li')].filter((li) =>
      li.textContent?.match(/Novos e superfãs|Em risco e inativos/),
    );
    expect(rows.map((li) => li.querySelector('span')?.textContent)).toEqual([
      'Novos e superfãs',
      'Em risco e inativos',
    ]);
    expect(rows[1]?.hasAttribute('data-floored')).toBe(true);
    expect(rows[1]?.textContent).toContain('menos de 5');
    const blocks = [...container.querySelectorAll('[data-coming-soon-block]')].map(
      (el) => el.textContent ?? '',
    );
    expect(blocks.some((text) => text.includes('Toques no story'))).toBe(true);
    expect(blocks.some((text) => text.includes('Quem a publicação alcançou'))).toBe(false);
  });

  it('has its comment count only, and a disabled play with no pill', () => {
    const container = detail(STORY as typeof VIDEO);
    expect(container.textContent).not.toContain('respondidos pela equipe');
    expect(container.textContent).not.toContain('sem resposta');
    const play = container.querySelector('button[aria-label="Assistir"]');
    expect(play?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('a[data-play]')).toBeNull();
    expect(container.querySelector('a[href*="quem=salvamentos"]')).toBeNull();
  });
});
