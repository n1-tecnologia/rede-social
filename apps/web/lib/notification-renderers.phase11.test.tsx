import { fileURLToPath } from 'node:url';
import { REPORT_NOTIFICATION_KIND } from '@rede-social/contracts/moderation';
import type { NotificationRow } from '@rede-social/module-notifications/contracts';
import { SOCIAL_NOTIFICATION_KINDS } from '@rede-social/module-social/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { notificationRenderers } from '@/lib/notification-renderers';
import { type NotificationTranslator, notificationRowView } from '@/lib/notifications-view';

/**
 * Phase 11-21 (D-727, D-729, UI-D-875): the two new bell rows, on the REAL pt-BR catalog and the shipped
 * row view helpers. The follow row is the follower's avatar with the `UserPlus` badge; the report row is
 * an actor-less `Flag` disc that names nothing.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const messages = loadMessages(catalogDir) as Record<string, unknown>;

const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'notifications',
} as never) as unknown as NotificationTranslator;

const NOW = Date.parse('2026-11-19T12:05:00.000Z');
const ROW = '22222222-2222-4222-8222-222222222222';
const AVATAR = '33333333-3333-4333-8333-333333333333';
const FOLLOWER = '44444444-4444-4444-8444-444444444444';

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: ROW,
    kind: SOCIAL_NOTIFICATION_KINDS.followed,
    subject: { type: 'membership', id: FOLLOWER },
    object: null,
    actor: { removed: false, displayName: 'Marina Costa', avatarAssetId: AVATAR },
    facts: { membershipId: FOLLOWER },
    preview: null,
    removed: false,
    createdAt: '2026-11-19T12:00:00.000000Z',
    seenAt: null,
    readAt: null,
    ...overrides,
  };
}

const view = (overrides: Partial<NotificationRow> = {}) =>
  notificationRowView(row(overrides), {
    t,
    nowMs: NOW,
    timeZone: 'America/Sao_Paulo',
    renderers: notificationRenderers,
  });

const markup = (node: unknown) => renderToStaticMarkup(node as never);

const BOLD = (text: string) => `<span class="font-bold text-text">${text}</span>`;

describe('the follow row (D-727, UI-D-875)', () => {
  it('the kind constants are the ones the producers write', () => {
    expect(SOCIAL_NOTIFICATION_KINDS.followed).toBe('social.followed');
    expect(REPORT_NOTIFICATION_KIND).toBe('moderation.report_created');
  });

  it('tracer: the avatar with the UserPlus badge, the bold actor sentence, the time and the unread dot', () => {
    const v = view();
    expect(v.glyph).toBe('UserPlus');
    expect(v.glyphTone).toBe('neutral');
    expect(v.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Marina Costa' } });
    expect(markup(v.sentence)).toBe(`${BOLD('Marina Costa')} começou a te seguir.`);
    expect(v.time).toBeTruthy();
    expect(v.unread).toBe(true);
    expect(v.removed).toBe(false);
    expect(v.href).toBe(`/membros/${FOLLOWER}`);
    expect(view({ readAt: '2026-11-19T12:01:00.000000Z' }).unread).toBe(false);
  });

  it('a missing or non-uuid membership id links to /membros', () => {
    const cases: NotificationRow['facts'][] = [
      {},
      { membershipId: '' },
      { membershipId: 'not-a-uuid' },
      { membershipId: 42 },
      { membershipId: null },
    ];
    for (const facts of cases) {
      expect(view({ facts }).href).toBe('/membros');
    }
  });
});

describe('the report row (D-729, UI-D-875)', () => {
  const report = (facts: NotificationRow['facts'] = {}, overrides: Partial<NotificationRow> = {}) =>
    view({
      kind: REPORT_NOTIFICATION_KIND,
      subject: { type: 'report', id: FOLLOWER },
      actor: null,
      facts,
      ...overrides,
    });

  it('tracer: the Flag disc, the bold lead, the fixed sentence and the queue as target', () => {
    const v = report();
    expect(v.glyph).toBe('Flag');
    expect(v.glyphTone).toBe('neutral');
    expect(v.leading).toEqual({ glyph: true });
    expect(v.href).toBe('/configuracoes/denuncias');
    expect(markup(v.sentence)).toBe(`${BOLD('Nova denúncia')} para analisar.`);
    expect(v.unread).toBe(true);
    expect(v.removed).toBe(false);
  });

  it('never shows what a forged row carries (the renderer reads no fact)', () => {
    const v = report(
      {
        reportId: 'HOSTILE-REPORT',
        subjectType: 'HOSTILE-SUBJECT',
        reporter: 'HOSTILE-REPORTER',
        reported: 'HOSTILE-REPORTED',
        body: 'HOSTILE-BODY',
        membershipId: 'HOSTILE-MEMBER',
        href: 'https://evil.example/x',
      },
      { actor: { removed: false, displayName: 'HOSTILE-ACTOR', avatarAssetId: AVATAR } },
    );
    const html = markup(v.sentence);
    expect(html).toBe(`${BOLD('Nova denúncia')} para analisar.`);
    expect(html).not.toMatch(/HOSTILE/);
    expect(v.href).toBe('/configuracoes/denuncias');
    // Stays the glyph disc even if a row ever names an actor.
    expect(v.leading).toEqual({ glyph: true });
  });
});

describe('every other kind is unchanged', () => {
  it('a shipped kind still renders as before', () => {
    const v = view({
      kind: 'feed.post',
      facts: { postId: FOLLOWER, excerpt: 'Oi', communityId: null, communityName: null },
    });
    expect(v.glyph).toBe('Newspaper');
    expect(v.href).toBe(`/post/${FOLLOWER}`);
  });

  it('an unknown kind still renders the generic row', () => {
    const v = view({ kind: 'social.something_new', actor: null, facts: {} });
    expect(v.glyph).toBe('Bell');
    expect(v.href).toBe('/inicio');
    expect(markup(v.sentence)).toBe('Você tem uma nova notificação.');
  });
});
