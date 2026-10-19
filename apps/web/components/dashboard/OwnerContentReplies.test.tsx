// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OwnerContentUnansweredRow } from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { contentTabView } from '@/lib/owner-content-view';
import type { DashboardT } from './format';
import { OwnerContentRepliesView } from './OwnerContentReplies';
import { contentAnswer, contentId, contentPost, contentSnapshot } from './owner-content-test-data';

/**
 * The comments waiting for the team (08.7-07, D-461, P4) on contract-shaped rows and the REAL pt-BR
 * catalog: oldest first, each with who wrote it, their band, the text, when, the publication, and
 * "Responder" linking the post page.
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

const NOW = Date.parse('2026-10-18T15:00:00Z');
const POST = contentPost(1, { excerpt: 'O encontro de sábado' });
const OTHER = contentId(98);

function row(n: number, at: string, postId: string, text: string): OwnerContentUnansweredRow {
  return {
    id: contentId(n, '66666666-6666-4666-8666'),
    postId,
    at,
    text,
    member: {
      membershipId: contentId(n, '22222222-2222-4222-8222'),
      displayName: `Membro ${n}`,
      avatarAssetId: null,
      band: n === 2 ? null : 'occasional',
    },
  };
}

function replies(
  rows: OwnerContentUnansweredRow[],
  total = rows.length,
  next: string | null = null,
) {
  return render(
    <OwnerContentRepliesView
      t={t}
      view={{ ...contentTabView('overview'), replies: true }}
      answer={contentAnswer([POST])}
      page={{ state: 'ready', snapshot: contentSnapshot(NOW), total, nextCursor: next, rows }}
      timeZone="America/Sao_Paulo"
      nowMs={NOW}
    />,
  ).container;
}

describe('OwnerContentReplies on the API (D-461)', () => {
  it('lists the waiting comments oldest first with their text, and Responder opens /post/<id>', () => {
    const container = replies([
      row(1, '2026-10-14T12:00:00Z', POST.id, 'Quando é o próximo?'),
      row(2, '2026-10-16T12:00:00Z', OTHER, 'Tem gravação?'),
    ]);
    const cards = [...container.querySelectorAll('li')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Membro 1');
    expect(cards[0]?.textContent).toContain('Ocasional');
    expect(cards[0]?.textContent).toContain('Quando é o próximo?');
    expect(cards[0]?.textContent).toContain('Comentou há 4 dias');
    expect(cards[0]?.textContent).toContain('O encontro de sábado');
    const reply = cards[0]?.querySelector('a[data-reply]');
    expect(reply?.textContent).toBe('Responder');
    expect(reply?.getAttribute('href')).toBe(`/post/${POST.id}`);
    expect(cards[1]?.querySelector('a[data-reply]')?.getAttribute('href')).toBe(`/post/${OTHER}`);
    expect(cards[1]?.textContent).toContain('Tem gravação?');
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });

  it('goes back to "Precisa de atenção" and continues in place', () => {
    const container = replies([row(1, '2026-10-14T12:00:00Z', POST.id, 'a')], 30, 'next');
    const back = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Voltar'),
    );
    expect(back?.getAttribute('href')).toBe('/perfil?area=conteudo#precisa-de-atencao');
    expect(container.textContent).toContain('Comentários sem resposta');
    const seeAll = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ver todos',
    );
    expect(seeAll?.hasAttribute('disabled')).toBe(false);
  });

  it('says so when nothing waits', () => {
    const container = replies([]);
    expect(container.textContent).toContain(
      'Nenhum comentário esperando resposta há mais de 24 h.',
    );
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
