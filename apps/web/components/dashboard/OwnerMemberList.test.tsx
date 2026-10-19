// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OwnerMemberListReady } from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { DashboardT } from './format';

/**
 * A member's lists on REAL data (08.7-05, D-461, UI-D-477), on the real pt-BR catalog and
 * contract-shaped pages: the count line from the detail's own number, a publication row that names
 * the post (its excerpt and its decorative thumbnail, never a comment's text), an active day with
 * its actions and no thumbnail, removed posts, events and products worded as such, and "Ver todos"
 * continuing in place only while the API has a next page.
 */

vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({ loadMoreOwnerListAction: vi.fn() }));
// The loaders read the API through the server env; the views under test take the answers as props.
vi.mock('@/lib/dashboard', () => ({}));

const { OwnerMemberListView } = await import('./OwnerMemberList');

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

const SNAPSHOT = {
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
};

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function post(n: number) {
  return {
    id: uuid(100 + n),
    kind: 'video' as const,
    excerpt: `Aula ${n}: como começar`,
    createdAt: '2026-10-01T12:00:00Z',
    coverAssetId: null,
  };
}

function renderList(list: OwnerMemberListReady, total: number) {
  const { container } = render(
    <OwnerMemberListView
      t={t}
      list={list}
      total={total}
      name="Ana Souza"
      membershipId={MEMBER}
      timeZone={TZ}
      nowMs={NOW}
      backHref="/voltar"
    />,
  );
  return container;
}

describe('OwnerMemberList on real rows (D-461)', () => {
  it('names the post of each comment, with its thumbnail, never the comment’s text', () => {
    const container = renderList(
      {
        state: 'ready',
        snapshot: SNAPSHOT,
        list: 'comments',
        nextCursor: null,
        rows: [
          { id: uuid(1), at: '2026-10-18T12:12:00Z', post: post(1), storyId: null },
          { id: uuid(2), at: '2026-10-16T12:00:00Z', post: null, storyId: null },
        ],
      },
      2,
    );
    expect(container.textContent).toContain('2 comentários · mais recentes primeiro');
    expect(container.textContent).toContain('Ana Souza · últimos 30 dias');
    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Aula 1: como começar');
    expect(rows[0]?.textContent).toContain('Comentado hoje às 09:12');
    expect(rows[0]?.querySelectorAll('[data-testid="cover-thumb"]')).toHaveLength(1);
    expect(rows[1]?.textContent).toContain('Publicação removida');
  });

  it('lists the active days with their actions and no thumbnail', () => {
    const container = renderList(
      {
        state: 'ready',
        snapshot: SNAPSHOT,
        list: 'active-days',
        nextCursor: null,
        rows: [
          { day: '2026-10-17', actions: 3 },
          { day: '2026-10-10', actions: 1 },
        ],
      },
      2,
    );
    const rows = container.querySelectorAll('li');
    expect(rows[0]?.textContent).toContain('ontem');
    expect(rows[0]?.textContent).toContain('3 ações');
    expect(rows[1]?.textContent).toContain('há 8 dias');
    expect(rows[1]?.textContent).toContain('1 ação');
    expect(container.querySelectorAll('[data-testid="cover-thumb"]')).toHaveLength(0);
  });

  it('merges comments, check-ins and orders in the strong actions, a gone event worded as such', () => {
    const container = renderList(
      {
        state: 'ready',
        snapshot: SNAPSHOT,
        list: 'strong-actions',
        nextCursor: null,
        rows: [
          {
            kind: 'comment',
            id: uuid(1),
            at: '2026-10-18T12:12:00Z',
            post: post(1),
            storyId: null,
          },
          {
            kind: 'check_in',
            id: uuid(2),
            at: '2026-10-12T23:00:00Z',
            eventId: uuid(3),
            eventTitle: null,
          },
          {
            kind: 'order',
            id: uuid(4),
            at: '2026-10-01T12:00:00Z',
            productId: uuid(5),
            productName: 'Curso de entrada',
            cents: 19900,
          },
        ],
      },
      3,
    );
    const thumbs = [...container.querySelectorAll<HTMLElement>('[data-testid="cover-thumb"]')];
    expect(thumbs.map((thumb) => thumb.dataset.kind)).toEqual(['video', 'event', 'order']);
    expect(container.textContent).toContain('Evento removido');
    expect(container.textContent).toContain('Curso de entrada');
    expect(container.textContent).toMatch(/Compra · R\$\s?199,00 · há 17 dias/);
  });

  it('continues in place with "Ver todos" only while the API has a next page (UI-D-477)', () => {
    const page = (nextCursor: string | null): OwnerMemberListReady => ({
      state: 'ready',
      snapshot: SNAPSHOT,
      list: 'likes',
      nextCursor,
      rows: [
        {
          id: uuid(1),
          at: '2026-10-18T12:12:00Z',
          target: { kind: 'post', postId: post(1).id, storyId: null },
          post: post(1),
        },
        {
          id: uuid(2),
          at: '2026-10-17T12:12:00Z',
          target: { kind: 'story', postId: null, storyId: uuid(9) },
          post: null,
        },
      ],
    });
    const more = renderList(page('cursor-1'), 45);
    expect(more.textContent).toContain('45 curtidas · mais recentes primeiro');
    expect(more.textContent).toContain('Story');
    const seeAll = [...more.querySelectorAll('button')].find((b) => b.textContent === 'Ver todos');
    expect(seeAll?.disabled).toBe(false);
    cleanup();
    const end = renderList(page(null), 2);
    expect([...end.querySelectorAll('button')].some((b) => b.textContent === 'Ver todos')).toBe(
      false,
    );
  });

  it('says so in one sentence for an empty list', () => {
    const container = renderList(
      { state: 'ready', snapshot: SNAPSHOT, list: 'likes', nextCursor: null, rows: [] },
      0,
    );
    expect(container.textContent).toContain('Nenhuma curtida nos últimos 30 dias.');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
