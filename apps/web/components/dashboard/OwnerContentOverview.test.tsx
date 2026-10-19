// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

// The publication lists continue through the server action: no API in a component test.
vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: async () => ({ error: true }),
}));

import { contentPostRowView } from '@/lib/owner-content-rows';
import { contentTabView } from '@/lib/owner-content-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';
import { OwnerContentOverview } from './OwnerContentOverview';
import { ContentPostCard } from './OwnerContentPostCard';
import { OwnerContentTypes } from './OwnerContentTypes';
import {
  contentAnswer,
  contentHeatmap,
  contentId,
  contentPost,
  contentStory,
} from './owner-content-test-data';

/**
 * Conteúdo on the API's answer (08.7-07, INSIGHT-10) on the REAL pt-BR catalog: the measured
 * numbers, the "Em breve" tiles and lines where nothing is measured (D-455, D-458), the full-day
 * heatmap (UI-D-488), the empty sentences (UI-D-481) and the module gating (UI-D-473).
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

function overview(answer = contentAnswer(), flags: OwnerPanelFlags = ALL_ON) {
  return render(
    <OwnerContentOverview
      t={t}
      answer={answer}
      view={contentTabView('overview')}
      flags={flags}
      timeZone={TZ}
    />,
  );
}

/** A tenant with three posts of the window, one of them waiting for the team for 30 hours. */
function busy() {
  const posts = [
    contentPost(1, { kind: 'video', likes: 30, comments: 6, durationSeconds: 75 }),
    contentPost(2, {
      kind: 'text',
      likes: 4,
      comments: 8,
      commentMeta: {
        answered: 5,
        unanswered: 3,
        oldestUnansweredHours: 30,
        firstReplyMedianMinutes: 40,
      },
    }),
    contentPost(3, { kind: 'photo', likes: 10, comments: 0 }),
  ];
  const weekly = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? 0 : 2));
  return contentAnswer([...posts, contentStory(9, { viewers: 12, comments: 2 })], {
    kpis: {
      posts: { current: 3, previous: 2 },
      interactions: { current: 58, previous: 40 },
      members: { current: 14, previous: 10 },
      rate: { measured: false, reason: 'needs_post_views' },
      views: { measured: false, reason: 'needs_post_views' },
      reach: { measured: false, reason: 'needs_post_views' },
    },
    interactorsByBand: { new: 2, superfan: 4, engaged: 6, occasional: 2, at_risk: 0, inactive: 0 },
    weeklyPerPost: {
      interactions: weekly.map((posts) => posts * 9),
      posts: weekly,
      previousInteractions: weekly.map((posts) => posts * 5),
      previousPosts: weekly,
    },
    heatmap: contentHeatmap([{ weekday: 'wed', fromHour: 12, posts: 3, interactions: 58 }]),
  });
}

describe('Visão geral on the API answer', () => {
  it('links the measured lists, shows the members number, and the three unmeasured KPIs as unlinked Em breve tiles', () => {
    const { container } = overview(busy());
    for (const slug of ['publicacoes', 'interacoes']) {
      const link = container.querySelector(`a#numero-${slug}`);
      expect(link?.getAttribute('href'), slug).toBe(`/perfil?area=conteudo&numero=${slug}`);
      expect(link?.querySelector('[data-kpi-card]')).not.toBeNull();
    }
    expect(container.querySelector('a#numero-publicacoes')?.textContent).toContain('3');
    expect(container.querySelector('a#numero-interacoes')?.textContent).toContain('58');
    for (const label of ['Taxa de engajamento', 'Visualizações', 'Alcance por publicação']) {
      const card = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
        el.textContent?.includes(label),
      );
      expect(card, label).toBeDefined();
      expect(card?.textContent, label).toContain('Em breve');
      expect(card?.closest('a'), label).toBeNull();
    }
    const members = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
      el.textContent?.includes('Membros que interagiram'),
    );
    expect(members?.textContent).toContain('14');
    expect(members?.closest('a')).toBeNull();
    for (const slug of ['taxa', 'visualizacoes', 'alcance', 'membros']) {
      expect(container.querySelector(`a[href*="numero=${slug}"]`), slug).toBeNull();
    }
    expect(container.textContent).not.toMatch(/exemplo|amostra/i);
  });

  it('draws the 12-week trend per post from the raw sums, a week with no post a gap', () => {
    const { container } = overview(busy());
    const chart = container.querySelector('[data-kpi-card] svg[role="img"]');
    expect(chart?.getAttribute('height')).toBe('150');
    const current = container.querySelector('[data-series="current"]')?.getAttribute('d') ?? '';
    // Weeks 1, 4, 7 and 10 had no post: four gaps cut the line into four runs.
    expect(current.match(/M/g)).toHaveLength(4);
  });

  it('fills the 12h–18h cell of a 15:00 post and leaves the others blank and named "nenhuma publicação"', () => {
    const { container } = overview(busy());
    const header = container.querySelector('[data-heat-slots]')?.textContent ?? '';
    for (const slot of ['0h–6h', '6h–12h', '12h–18h', '18h–24h']) expect(header).toContain(slot);
    const cells = container.querySelectorAll('[data-heat-cell]');
    expect(cells).toHaveLength(28);
    const filled = container.querySelector('[data-heat-cell="wed-12"]');
    expect(filled?.querySelector('[data-countup]')).not.toBeNull();
    expect(filled?.textContent).toContain('19');
    const blank = container.querySelector('[data-heat-cell="mon-0"]');
    expect(blank?.hasAttribute('data-heat-empty')).toBe(true);
    expect(blank?.className).toContain('bg-bg-tertiary');
    expect(blank?.querySelector('[data-countup]')).toBeNull();
    expect(blank?.textContent).toBe('Segunda, 0h–6h: nenhuma publicação');
    expect(container.querySelectorAll('[data-heat-empty]')).toHaveLength(27);
  });

  it('shows the empty sentences and no chart when nothing was published (UI-D-481)', () => {
    const { container } = overview(contentAnswer());
    const text = container.textContent ?? '';
    expect(text).toContain('A tendência aparece depois das primeiras publicações.');
    expect(text).toContain('O melhor dia e horário aparece depois das primeiras publicações.');
    expect(text).toContain('Nenhuma publicação nos últimos 30 dias.');
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(container.querySelectorAll('[data-heat-cell]')).toHaveLength(0);
    // A real zero is a number, never Em breve.
    expect(container.querySelector('a#numero-publicacoes')?.textContent).toContain('0');
  });

  it('lists the post waiting for the team, links "Responder comentários" to the unanswered screen and keeps the capability actions disabled with the pill', () => {
    const { container } = overview(busy());
    const attention = container.querySelector('#precisa-de-atencao');
    expect(attention?.textContent).toContain('3 comentários sem resposta');
    expect(attention?.querySelector('a')?.getAttribute('href')).toBe(
      '/perfil?area=conteudo&responder=comentarios',
    );
    const answer = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Responder comentários',
    );
    expect(answer?.getAttribute('href')).toBe('/perfil?area=conteudo&responder=comentarios');
    for (const action of ['Agendar publicação', 'Criar série']) {
      const wrap = [...container.querySelectorAll('[data-disabled-action]')].find((el) =>
        el.textContent?.includes(action),
      );
      expect(wrap, action).toBeDefined();
      expect(wrap?.querySelector('button')?.hasAttribute('disabled'), action).toBe(true);
      expect(wrap?.querySelector('[data-coming-soon]')?.textContent, action).toBe('Em breve');
    }
  });

  it('the best publications open the panel post detail, best first', () => {
    const { container } = overview(busy());
    const best = [...container.querySelectorAll('[id^="post-"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(best[0]).toBe(`/perfil?area=conteudo&post=${contentId(1)}`);
    expect(best).toHaveLength(3);
  });

  it('who interacts by band shows the exact counts with interactors only', () => {
    const { container } = overview(busy());
    const bands = container.querySelector('#quem-interage')?.textContent ?? '';
    expect(bands).toContain('Superfãs');
    expect(bands).toContain('6 membros');
    expect(bands).not.toContain('Em risco');
  });
});

describe('Por tipo on the API answer (D-458, UI-D-473)', () => {
  it('one card per kind, the unmeasured metric a line pill, text comments real', () => {
    const { container } = render(
      <OwnerContentTypes
        t={t}
        answer={busy()}
        view={contentTabView('types')}
        flags={ALL_ON}
        timeZone={TZ}
      />,
    );
    const cards = container.querySelectorAll('[id^="tipo-"]');
    expect(cards).toHaveLength(6);
    for (const slug of ['video', 'foto', 'carrossel', 'link', 'story']) {
      const card = container.querySelector(`#tipo-${slug}`);
      expect(card?.querySelector('[data-coming-soon]'), slug).not.toBeNull();
    }
    const text = container.querySelector('#tipo-texto');
    expect(text?.querySelector('[data-coming-soon]')).toBeNull();
    expect(text?.textContent).toContain('% de comentários');
    expect(text?.textContent).toContain('67%');
    expect(container.querySelector('#tipo-video a')?.getAttribute('href')).toBe(
      '/perfil?area=conteudo&vista=tipos&tipo=video',
    );
  });

  it('with stories off the Story kind is absent; with feed off only stories remain', () => {
    const noStories = busy();
    noStories.kinds = noStories.kinds.filter((kind) => kind !== 'story');
    const first = render(
      <OwnerContentTypes
        t={t}
        answer={noStories}
        view={contentTabView('types')}
        flags={{ ...ALL_ON, stories: false }}
        timeZone={TZ}
      />,
    );
    expect(first.container.querySelector('#tipo-story')).toBeNull();
    expect(first.container.querySelectorAll('[id^="tipo-"]')).toHaveLength(5);
    cleanup();
    const storiesOnly = contentAnswer([contentStory(9, { viewers: 3 })], { kinds: ['story'] });
    const second = render(
      <OwnerContentTypes
        t={t}
        answer={storiesOnly}
        view={contentTabView('types')}
        flags={{ ...ALL_ON, feed: false }}
        timeZone={TZ}
      />,
    );
    expect(second.container.querySelectorAll('[id^="tipo-"]')).toHaveLength(1);
    expect(second.container.querySelector('#tipo-story')).not.toBeNull();
  });

  it('an opened kind shows its numbers and its publications best first', () => {
    const { container } = render(
      <OwnerContentTypes
        t={t}
        answer={busy()}
        view={{ ...contentTabView('types'), kind: 'video' }}
        flags={ALL_ON}
        timeZone={TZ}
      />,
    );
    expect(container.querySelectorAll('[data-kpi-card]')).toHaveLength(3);
    const missing = [...container.querySelectorAll('[data-kpi-card]')].find((el) =>
      el.textContent?.includes('% assistido'),
    );
    expect(missing?.textContent).toContain('Em breve');
    expect(container.querySelectorAll('[id^="post-"]')).toHaveLength(1);
  });
});

describe('a publication card (D-455, UI-D-473, UI-D-489 b)', () => {
  function card(item: Parameters<typeof contentPostRowView>[1], flags = ALL_ON, names = {}) {
    const row = contentPostRowView(t, item, {
      href: '/perfil?area=conteudo&post=x',
      flags,
      communities: names,
      timeZone: TZ,
    });
    return render(<ContentPostCard row={row} />).container;
  }

  it('shows the likes and comments, and saves and shares in the compact line form', () => {
    const container = card(contentPost(1, { likes: 12, comments: 3 }));
    expect(container.querySelector('[data-count="likes"]')?.textContent).toContain('12');
    expect(container.querySelector('[data-count="comments"]')?.textContent).toContain('3');
    expect(container.textContent).toContain('salvamentos em breve');
    expect(container.textContent).toContain('compartilhamentos em breve');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/perfil?area=conteudo&post=x');
  });

  it('a story card shows its comment count only: no saves, no thread line', () => {
    const container = card(contentStory(9, { comments: 2, viewers: 7 }));
    expect(container.querySelector('[data-count="comments"]')?.textContent).toContain('2');
    expect(container.textContent).not.toContain('salvamentos');
    expect(container.textContent).not.toContain('respondidos');
    expect(container.textContent).not.toContain('sem resposta');
  });

  it('names the community live, and drops it with communities off', () => {
    const community = contentId(77, '11111111-1111-4111-8111');
    const item = contentPost(1, { communityId: community, createdAt: '2026-10-08T18:00:00Z' });
    expect(card(item, ALL_ON, { [community]: 'Geral' }).textContent).toContain(
      '08/10 · Geral · Foto',
    );
    cleanup();
    const off = card(item, { ...ALL_ON, communities: false }, { [community]: 'Geral' });
    expect(off.textContent).toContain('08/10 · Foto');
    expect(off.textContent).not.toContain('Geral');
  });
});
