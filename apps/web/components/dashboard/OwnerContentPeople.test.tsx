// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  OwnerContentInteractionRow,
  OwnerContentPeopleReady,
} from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { contentTabView } from '@/lib/owner-content-view';
import type { DashboardT } from './format';
import { ContentInteractionsView, OwnerContentPeopleView } from './OwnerContentPeople';
import { contentAnswer, contentId, contentPost, contentSnapshot } from './owner-content-test-data';

/**
 * Who liked and who commented a publication, and every interaction behind the number (08.7-07,
 * D-461, UI-D-477), on contract-shaped pages and the REAL pt-BR catalog: member cards that open the
 * panel's member detail, "Sem resposta" on a commenter the team has not answered, never a comment's
 * text, and "Ver todos" enabled to continue the list in place.
 */

afterEach(cleanup);

// The lists continue through the server action: no API in a component test.
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

const TZ = 'America/Sao_Paulo';
const POST = contentPost(1, { likes: 25, comments: 2, excerpt: 'O encontro de sábado' });
const NOW = Date.parse('2026-10-18T15:00:00Z');

function member(n: number, band: 'engaged' | null = 'engaged') {
  return {
    membershipId: contentId(n, '22222222-2222-4222-8222'),
    displayName: `Membro ${n}`,
    avatarAssetId: null,
    band,
  };
}

function likes(rows: number, total: number, nextCursor: string | null): OwnerContentPeopleReady {
  return {
    state: 'ready',
    snapshot: contentSnapshot(NOW),
    who: 'likes',
    total,
    nextCursor,
    rows: Array.from({ length: rows }, (_, i) => ({
      id: contentId(100 + i, '33333333-3333-4333-8333'),
      at: '2026-10-18T12:12:00Z',
      member: member(i + 1),
    })),
  };
}

function people(page: OwnerContentPeopleReady) {
  return render(
    <OwnerContentPeopleView
      t={t}
      view={{ ...contentTabView('posts'), postId: POST.id, who: page.who }}
      item={POST}
      page={page}
      timeZone={TZ}
      nowMs={NOW}
    />,
  ).container;
}

describe('OwnerContentPeople on the API (D-461, UI-D-477)', () => {
  it('lists who liked as member cards that open the panel member detail', () => {
    const container = people(likes(3, 3, null));
    expect(container.textContent).toContain('O encontro de sábado');
    expect(container.textContent).toContain('3 curtidas');
    const links = [...container.querySelectorAll('a[href*="&membro="]')];
    expect(links).toHaveLength(3);
    expect(links[0]?.getAttribute('href')).toBe(
      `/perfil?area=conteudo&vista=publicacoes&post=${POST.id}&quem=curtidas&membro=${member(1).membershipId}`,
    );
    expect(links[0]?.id).toBe(`membro-${member(1).membershipId}`);
    expect(container.textContent).toContain('Curtiu hoje às 09:12');
    expect(container.textContent).toContain('Engajados');
    expect(container.textContent).not.toContain('Ver todos');
    expect(container.textContent).not.toMatch(/amostra|exemplo/i);
  });

  it('continues in place: "e mais N" and an ENABLED "Ver todos"', () => {
    const container = people(likes(10, 25, 'next-cursor'));
    expect(container.querySelectorAll('a[href*="&membro="]')).toHaveLength(10);
    expect(container.textContent).toContain('e mais 15 curtidas');
    const seeAll = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ver todos',
    );
    expect(seeAll).toBeDefined();
    expect(seeAll?.hasAttribute('disabled')).toBe(false);
  });

  it('marks a commenter the team has not answered, and never shows the comment text', () => {
    const page: OwnerContentPeopleReady = {
      state: 'ready',
      snapshot: contentSnapshot(NOW),
      who: 'comments',
      total: 2,
      nextCursor: null,
      rows: [
        {
          id: contentId(1, '44444444-4444-4444-8444'),
          at: '2026-10-16T12:00:00Z',
          member: member(1),
          answered: false,
        },
        {
          id: contentId(2, '44444444-4444-4444-8444'),
          at: '2026-10-15T12:00:00Z',
          member: member(2, null),
          answered: true,
        },
      ],
    };
    const container = people(page);
    const cards = [...container.querySelectorAll('a[href*="&membro="]')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Sem resposta');
    expect(cards[1]?.textContent).not.toContain('Sem resposta');
    expect(cards[1]?.textContent).not.toContain('Faixa');
    expect(cards[0]?.getAttribute('href')).toContain('&quem=comentarios&membro=');
  });

  it('says nobody did it yet with an empty page', () => {
    const container = people(likes(0, 0, null));
    expect(container.textContent).toContain('Ninguém curtiu esta publicação ainda.');
    expect(container.querySelectorAll('a[href*="&membro="]')).toHaveLength(0);
  });
});

describe('the interactions behind the number (PD-7, D-461)', () => {
  const rows: OwnerContentInteractionRow[] = [
    {
      kind: 'like',
      id: contentId(1, '55555555-5555-4555-8555'),
      at: '2026-10-18T12:12:00Z',
      itemId: POST.id,
      member: member(1),
    },
    {
      kind: 'comment',
      id: contentId(2, '55555555-5555-4555-8555'),
      at: '2026-10-17T12:00:00Z',
      itemId: POST.id,
      member: member(1),
    },
    {
      kind: 'like',
      id: contentId(3, '55555555-5555-4555-8555'),
      at: '2026-10-10T12:00:00Z',
      itemId: contentId(99),
      member: member(2),
    },
  ];

  it('each row opens the member, the first of a member carrying its anchor', () => {
    const { container } = render(
      <ContentInteractionsView
        t={t}
        answer={contentAnswer([POST])}
        page={{ state: 'ready', snapshot: contentSnapshot(NOW), total: 40, nextCursor: 'c', rows }}
        timeZone={TZ}
        nowMs={NOW}
      />,
    );
    const links = [...container.querySelectorAll('a[href*="&membro="]')];
    expect(links).toHaveLength(3);
    expect(links[0]?.getAttribute('href')).toBe(
      `/perfil?area=conteudo&numero=interacoes&membro=${member(1).membershipId}`,
    );
    expect(links[0]?.id).toBe(`membro-${member(1).membershipId}`);
    expect(links[1]?.id).toBe('');
    expect(links[0]?.textContent).toContain('Engajados · curtiu hoje às 09:12');
    expect(links[0]?.textContent).toContain('O encontro de sábado');
    // A publication no longer in the answer: the row stays, with no excerpt.
    expect(links[2]?.textContent).toContain('Membro 2');
    expect(container.textContent).toContain('e mais 37 interações');
    const seeAll = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ver todas',
    );
    expect(seeAll?.hasAttribute('disabled')).toBe(false);
  });
});
