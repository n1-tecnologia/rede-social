import { fileURLToPath } from 'node:url';
import type { NotificationRow } from '@rede-social/module-notifications/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { notificationRenderers } from '@/lib/notification-renderers';
import { type NotificationTranslator, notificationRowView } from '@/lib/notifications-view';

/**
 * 07-01 — notification row → `NotificationItem` props, on a FIXED clock and the REAL pt-BR catalog:
 * the relative time, the href per kind, the unread flag, the departed-actor fallback, the curly
 * quotes around the excerpt, the `plain` variant and the community sentence. Rendered to static
 * markup, so the bold actor span is asserted as markup, not as a React tree shape.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const messages = loadMessages(catalogDir) as Record<string, unknown>;

const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'notifications',
} as never) as unknown as NotificationTranslator;

const NOW = Date.parse('2026-09-30T12:05:00.000Z');
const POST = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const AVATAR = '33333333-3333-4333-8333-333333333333';

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: ROW,
    kind: 'feed.post',
    subject: { type: 'post', id: POST },
    object: null,
    actor: { removed: false, displayName: 'Ana Souza', avatarAssetId: AVATAR },
    facts: { postId: POST, excerpt: 'Encontro no sábado', communityId: null, communityName: null },
    preview: null,
    removed: false,
    createdAt: '2026-09-30T12:00:00.000000Z',
    seenAt: null,
    readAt: null,
    ...overrides,
  };
}

const view = (overrides: Partial<NotificationRow> = {}) =>
  notificationRowView(row(overrides), { t, nowMs: NOW, renderers: notificationRenderers });

const markup = (node: unknown) => renderToStaticMarkup(node as never);

describe('notificationRowView (07-01, UI-D-251)', () => {
  it('computes the relative time from the ONE request instant (5 minutes ago)', () => {
    const expected = new Intl.RelativeTimeFormat('pt-BR', {
      numeric: 'auto',
      style: 'narrow',
    }).format(-5, 'minute');
    expect(view()?.time).toBe(expected);
  });

  it('opens the post for every feed post kind (D-232)', () => {
    for (const kind of ['feed.post', 'feed.community_post', 'feed.reel']) {
      expect(view({ kind })?.href).toBe(`/post/${POST}`);
    }
  });

  it('is unread exactly while readAt is null', () => {
    expect(view()?.unread).toBe(true);
    expect(view({ readAt: '2026-09-30T12:01:00.000000Z' })?.unread).toBe(false);
  });

  it('renders the actor in a leading bold span and the excerpt in curly quotes', () => {
    const html = markup(view()?.sentence);
    expect(html).toBe(
      '<span class="font-bold text-text">Ana Souza</span> publicou um novo post: “Encontro no sábado”',
    );
  });

  it('uses the plain variant when there is no excerpt', () => {
    const html = markup(view({ facts: { postId: POST, excerpt: null } })?.sentence);
    expect(html).toBe('<span class="font-bold text-text">Ana Souza</span> publicou um novo post.');
  });

  it('names the community for a community post', () => {
    const html = markup(
      view({
        kind: 'feed.community_post',
        facts: { postId: POST, excerpt: 'Treino', communityId: POST, communityName: 'Corredores' },
      })?.sentence,
    );
    expect(html).toContain('publicou em Corredores: “Treino”');
  });

  it('a departed actor renders "Membro removido" with no avatar', () => {
    const departed = view({ actor: { removed: true, displayName: null, avatarAssetId: null } });
    expect(markup(departed?.sentence)).toContain(
      '<span class="font-bold text-text">Membro removido</span>',
    );
    expect(departed?.leading).toEqual({ avatar: { src: null, alt: 'Membro removido' } });
  });

  it('uses the reel glyph for a reel and the post glyph otherwise', () => {
    expect(view({ kind: 'feed.reel' })?.glyph).toBe('Film');
    expect(view()?.glyph).toBe('Newspaper');
  });

  it('filters out a kind no renderer knows (07-04 adds the generic row)', () => {
    expect(view({ kind: 'stories.story' })).toBeNull();
  });

  it('carries the preview ladder only when the row has one', () => {
    expect(view()?.preview).toBeNull();
    expect(view({ preview: { assetId: AVATAR, variantWidths: [320, 640] } })?.preview).toEqual({
      assetId: AVATAR,
      widths: [320, 640],
    });
  });
});
