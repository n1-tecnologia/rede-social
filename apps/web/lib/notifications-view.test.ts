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

const view = (overrides: Partial<NotificationRow> = {}, timeZone = 'America/Sao_Paulo') =>
  notificationRowView(row(overrides), {
    t,
    nowMs: NOW,
    timeZone,
    renderers: notificationRenderers,
  });

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

  it('renders a kind no renderer knows as the generic row (07-04, never filtered)', () => {
    const generic = view({ kind: 'made.up', facts: { anything: 'x' } });
    expect(generic).not.toBeNull();
    expect(generic?.href).toBe('/inicio');
    expect(generic?.glyph).toBe('Bell');
    expect(generic?.leading).toEqual({ glyph: true });
    expect(markup(generic?.sentence)).toBe('Você tem uma nova notificação.');
    expect(generic?.removed).toBe(false);
  });

  it('carries the preview ladder only when the row has one', () => {
    expect(view()?.preview).toBeNull();
    expect(view({ preview: { assetId: AVATAR, variantWidths: [320, 640] } })?.preview).toEqual({
      assetId: AVATAR,
      widths: [320, 640],
    });
  });
});

const COMMENT = '44444444-4444-4444-8444-444444444444';
const STORY = '55555555-5555-4555-8555-555555555555';

describe('notificationRowView — 07-04 kinds, expiry and the removed variant', () => {
  it('a comment like opens the post at the comment, with the like-toned heart', () => {
    const liked = view({
      kind: 'feed.comment_liked',
      object: { type: 'comment', id: COMMENT },
      facts: { postId: POST, commentId: COMMENT, excerpt: 'Vou levar as crianças' },
    });
    expect(liked?.href).toBe(`/post/${POST}?comentario=${COMMENT}`);
    expect(liked?.glyph).toBe('Heart');
    expect(liked?.glyphTone).toBe('like');
    expect(markup(liked?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> curtiu seu comentário: “Vou levar as crianças”',
    );
  });

  it('a reply opens the post at the reply, with the neutral reply glyph', () => {
    const replied = view({
      kind: 'feed.comment_replied',
      facts: { postId: POST, commentId: COMMENT, rootCommentId: POST, excerpt: 'Concordo' },
    });
    expect(replied?.href).toBe(`/post/${POST}?comentario=${COMMENT}`);
    expect(replied?.glyph).toBe('MessageCircleReply');
    expect(replied?.glyphTone).toBe('neutral');
    expect(markup(replied?.sentence)).toContain('respondeu ao seu comentário: “Concordo”');
  });

  it('09-07 (UI-D-506): a comment on my member post opens the post at the comment, with the MessageCircle glyph', () => {
    const commented = view({
      kind: 'feed.post_commented',
      object: { type: 'comment', id: COMMENT },
      facts: { postId: POST, commentId: COMMENT, excerpt: 'Que legal isso' },
    });
    expect(commented?.href).toBe(`/post/${POST}?comentario=${COMMENT}`);
    expect(commented?.glyph).toBe('MessageCircle');
    expect(commented?.glyphTone).toBe('neutral');
    expect(commented?.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Ana Souza' } });
    expect(markup(commented?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> comentou na sua publicação: “Que legal isso”',
    );
  });

  it('09-07 (UI E10): a long excerpt passes through whole for the row to wrap, and the actor stays in bold', () => {
    const excerpt = 'palavra '.repeat(9).trim();
    const commented = view({
      kind: 'feed.post_commented',
      facts: { postId: POST, commentId: COMMENT, excerpt },
    });
    expect(markup(commented?.sentence)).toContain(`“${excerpt}”`);
    expect(markup(commented?.sentence)).toContain(
      '<span class="font-bold text-text">Ana Souza</span>',
    );
  });

  it('09-07 (T-09-25): a retracted post_commented row is the removed row on the same glyph, with no link', () => {
    const removed = view({ kind: 'feed.post_commented', facts: {}, removed: true });
    expect(removed?.removed).toBe(true);
    expect(removed?.href).toBeNull();
    expect(removed?.glyph).toBe('MessageCircle');
    expect(markup(removed?.sentence)).toBe('Este conteúdo foi removido.');
  });

  it("a story opens the story until expiresAt and Início's notice from expiresAt on", () => {
    const at = (expiresAt: string) =>
      view({
        kind: 'stories.story',
        subject: { type: 'story', id: STORY },
        facts: { storyId: STORY, expiresAt, previewAssetId: null },
      });
    expect(at(new Date(NOW + 1).toISOString())?.href).toBe(`/stories/${STORY}`);
    expect(at(new Date(NOW).toISOString())?.href).toBe('/inicio?aviso=story-expirado');
    expect(at(new Date(NOW - 1).toISOString())?.href).toBe('/inicio?aviso=story-expirado');
    expect(at(new Date(NOW + 1).toISOString())?.glyph).toBe('Sparkles');
    expect(markup(at(new Date(NOW + 1).toISOString())?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> publicou um novo story.',
    );
  });

  it('a story comment follows the same expiry rule', () => {
    const commented = (expiresAt: string) =>
      view({
        kind: 'stories.story_commented',
        facts: { storyId: STORY, commentId: COMMENT, expiresAt, excerpt: 'Que foto linda!' },
      });
    expect(commented(new Date(NOW + 60_000).toISOString())?.href).toBe(`/stories/${STORY}`);
    expect(commented(new Date(NOW).toISOString())?.href).toBe('/inicio?aviso=story-expirado');
    expect(commented(new Date(NOW + 60_000).toISOString())?.glyph).toBe('MessageCircle');
    expect(markup(commented(new Date(NOW + 60_000).toISOString())?.sentence)).toContain(
      'comentou no seu story: “Que foto linda!”',
    );
  });

  it('a removed row keeps the actor and glyph, drops the preview and has no href', () => {
    const removed = view({
      kind: 'feed.comment_liked',
      facts: {},
      removed: true,
      preview: { assetId: AVATAR, variantWidths: [320] },
    });
    expect(removed?.removed).toBe(true);
    expect(removed?.href).toBeNull();
    expect(removed?.preview).toBeNull();
    expect(removed?.glyph).toBe('Heart');
    expect(removed?.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Ana Souza' } });
    expect(markup(removed?.sentence)).toBe('Este conteúdo foi removido.');
  });

  it('a removed row of an unknown kind is still the removed sentence on the Bell disc', () => {
    const removed = view({ kind: 'made.up', facts: {}, removed: true });
    expect(removed?.glyph).toBe('Bell');
    expect(removed?.href).toBeNull();
    expect(markup(removed?.sentence)).toBe('Este conteúdo foi removido.');
  });
});

const EVENT = '66666666-6666-4666-8666-666666666666';
/** Monday 12 October 2026, 22:00Z: 19:00 in São Paulo, 18:00 in Manaus. */
const EVENT_START = '2026-10-12T22:00:00.000000Z';

describe('notificationRowView — 07-05 event kinds and actor-less reminders', () => {
  const eventFacts = { eventId: EVENT, title: 'Encontro anual', startsAt: EVENT_START };

  it('a new event names its creator, quotes the title and prints the tenant-clock when-line', () => {
    const created = view({
      kind: 'events.event',
      subject: { type: 'event', id: EVENT },
      facts: { ...eventFacts, previewAssetId: null },
    });
    expect(created?.href).toBe(`/eventos/${EVENT}`);
    expect(created?.glyph).toBe('CalendarDays');
    expect(created?.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Ana Souza' } });
    expect(markup(created?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> criou o evento “Encontro anual” · seg., 12 de out. · 19:00',
    );
  });

  it('a reactivated event uses the CalendarCheck glyph and its own sentence', () => {
    const reactivated = view({
      kind: 'events.event_reactivated',
      subject: { type: 'event', id: EVENT },
      facts: { ...eventFacts, previewAssetId: null },
    });
    expect(reactivated?.href).toBe(`/eventos/${EVENT}`);
    expect(reactivated?.glyph).toBe('CalendarCheck');
    expect(markup(reactivated?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> reativou o evento “Encontro anual” · seg., 12 de out. · 19:00',
    );
  });

  it('the reminders are actor-less, on the CalendarClock disc, and open the event', () => {
    const day = view({
      kind: 'events.reminder_24h',
      subject: { type: 'event', id: EVENT },
      actor: null,
      facts: eventFacts,
    });
    const hour = view({
      kind: 'events.reminder_1h',
      subject: { type: 'event', id: EVENT },
      actor: null,
      facts: eventFacts,
    });
    for (const reminder of [day, hour]) {
      expect(reminder?.leading).toEqual({ glyph: true });
      expect(reminder?.glyph).toBe('CalendarClock');
      expect(reminder?.href).toBe(`/eventos/${EVENT}`);
    }
    expect(markup(day?.sentence)).toBe(
      'Amanhã às 19:00: “Encontro anual”. Você confirmou presença.',
    );
    expect(markup(hour?.sentence)).toBe('Daqui a 1 hora: “Encontro anual” começa às 19:00.');
  });

  it('a reminder row keeps the glyph leading even if a row ever names an actor', () => {
    const named = view({ kind: 'events.reminder_1h', facts: eventFacts });
    expect(named?.leading).toEqual({ glyph: true });
  });

  it('the tenant timezone decides the wall clock: Manaus reads 18:00 for the same instant', () => {
    const manaus = 'America/Manaus';
    expect(
      markup(
        view({ kind: 'events.reminder_1h', actor: null, facts: eventFacts }, manaus)?.sentence,
      ),
    ).toBe('Daqui a 1 hora: “Encontro anual” começa às 18:00.');
    expect(
      markup(
        view({ kind: 'events.event', facts: { ...eventFacts, previewAssetId: null } }, manaus)
          ?.sentence,
      ),
    ).toContain('“Encontro anual” · seg., 12 de out. · 18:00');
  });

  it('a missing event id degrades to Início, never a broken URL', () => {
    expect(view({ kind: 'events.reminder_24h', actor: null, facts: { title: 'x' } })?.href).toBe(
      '/inicio',
    );
  });
});

const COURSE = '77777777-7777-4777-8777-777777777777';
const LIVE = '88888888-8888-4888-8888-888888888888';
/** A lesson title the fixtures never pass in facts: no sentence may ever carry it (D-449). */
const LESSON_TITLE = 'Segredo da aula';

describe('notificationRowView — 08.6-12 the six courses kinds (UI-D-460, D-449, EP-64)', () => {
  const liveFacts = {
    liveId: LIVE,
    previewAssetId: null,
    startsAt: EVENT_START,
    title: 'Tira-dúvidas',
  };

  it('a published course names the admin, quotes the title and opens the course', () => {
    const published = view({
      kind: 'courses.course_published',
      subject: { type: 'course', id: COURSE },
      facts: { courseId: COURSE, previewAssetId: null, title: 'Olhar do zero' },
    });
    expect(published?.href).toBe(`/cursos/${COURSE}`);
    expect(published?.glyph).toBe('GraduationCap');
    expect(published?.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Ana Souza' } });
    expect(markup(published?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> publicou o curso “Olhar do zero”.',
    );
  });

  it('lessons added is actor-less on the BookOpen disc, with one and many (zero-one-many)', () => {
    const added = (count: number | null) =>
      view({
        kind: 'courses.lessons_added',
        subject: { type: 'course', id: COURSE },
        actor: null,
        facts: { count, courseId: COURSE, previewAssetId: null, title: 'Pele: protocolo' },
      });
    expect(added(1)?.leading).toEqual({ glyph: true });
    expect(added(1)?.glyph).toBe('BookOpen');
    expect(added(1)?.href).toBe(`/cursos/${COURSE}`);
    expect(markup(added(1)?.sentence)).toBe('Nova aula em “Pele: protocolo”.');
    expect(markup(added(5)?.sentence)).toBe('5 aulas novas em “Pele: protocolo”.');
    // A missing or malformed count reads as one notice's worth, never "NaN aulas".
    expect(markup(added(null)?.sentence)).toBe('Nova aula em “Pele: protocolo”.');
  });

  it('a scheduled live names the admin with the Radio disc and the tenant-clock when-line', () => {
    const scheduled = view({
      kind: 'courses.live_scheduled',
      subject: { type: 'live', id: LIVE },
      facts: { ...liveFacts, reactivated: false },
    });
    expect(scheduled?.href).toBe(`/cursos/lives/${LIVE}`);
    expect(scheduled?.glyph).toBe('Radio');
    expect(scheduled?.leading).toEqual({ avatar: { src: expect.any(String), alt: 'Ana Souza' } });
    expect(markup(scheduled?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> agendou a live “Tira-dúvidas” · seg., 12 de out. · 19:00',
    );
  });

  it('reactivated: true reads "reativou" (D-452); an actor without an avatar keeps initials', () => {
    const reactivated = view({
      kind: 'courses.live_scheduled',
      actor: { removed: false, displayName: 'Ana Souza', avatarAssetId: null },
      facts: { ...liveFacts, reactivated: true },
    });
    expect(markup(reactivated?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> reativou a live “Tira-dúvidas” · seg., 12 de out. · 19:00',
    );
    expect(reactivated?.leading).toEqual({ avatar: { src: null, alt: 'Ana Souza' } });
  });

  it('the reminder, the cancel and the replay are actor-less glyph rows to the live page', () => {
    const at = (kind: string) => view({ kind, actor: null, facts: liveFacts });
    const reminder = at('courses.live_reminder');
    const cancelled = at('courses.live_cancelled');
    const replay = view({
      kind: 'courses.replay_available',
      actor: null,
      facts: { liveId: LIVE, previewAssetId: null, title: 'Tira-dúvidas' },
    });
    expect([reminder?.glyph, cancelled?.glyph, replay?.glyph]).toEqual([
      'BellRing',
      'CalendarX2',
      'CirclePlay',
    ]);
    for (const row of [reminder, cancelled, replay]) {
      expect(row?.leading).toEqual({ glyph: true });
      expect(row?.href).toBe(`/cursos/lives/${LIVE}`);
    }
    expect(markup(reminder?.sentence)).toBe('Em 15 minutos: “Tira-dúvidas” começa às 19:00.');
    expect(markup(cancelled?.sentence)).toBe(
      'A live “Tira-dúvidas” de seg., 12 de out. · 19:00 foi cancelada.',
    );
    expect(markup(replay?.sentence)).toBe('A gravação da live “Tira-dúvidas” já está disponível.');
  });

  it('the tenant timezone decides the wall clock of a live (Manaus reads 18:00)', () => {
    const manaus = 'America/Manaus';
    expect(
      markup(
        view({ kind: 'courses.live_reminder', actor: null, facts: liveFacts }, manaus)?.sentence,
      ),
    ).toBe('Em 15 minutos: “Tira-dúvidas” começa às 18:00.');
  });

  it('EP-64: a missing or non-string id links to /area-membros, never to a broken URL', () => {
    for (const kind of ['courses.course_published', 'courses.lessons_added']) {
      expect(view({ kind, facts: { title: 'x' } })?.href).toBe('/area-membros');
      expect(view({ kind, facts: { courseId: 42, title: 'x' } })?.href).toBe('/area-membros');
    }
    for (const kind of [
      'courses.live_scheduled',
      'courses.live_reminder',
      'courses.live_cancelled',
      'courses.replay_available',
    ]) {
      expect(view({ kind, facts: { title: 'x' } })?.href).toBe('/area-membros');
      expect(view({ kind, facts: { liveId: null, title: 'x' } })?.href).toBe('/area-membros');
    }
  });

  it('EP-64: a missing title still renders the sentence with an empty title, never the generic row', () => {
    const published = view({ kind: 'courses.course_published', facts: { courseId: COURSE } });
    expect(published?.glyph).toBe('GraduationCap');
    expect(markup(published?.sentence)).toBe(
      '<span class="font-bold text-text">Ana Souza</span> publicou o curso “”.',
    );
    const replay = view({ kind: 'courses.replay_available', actor: null, facts: { liveId: LIVE } });
    expect(markup(replay?.sentence)).toBe('A gravação da live “” já está disponível.');
  });

  it('none of the six kinds falls back to the generic row', () => {
    for (const kind of [
      'courses.course_published',
      'courses.lessons_added',
      'courses.live_scheduled',
      'courses.live_reminder',
      'courses.live_cancelled',
      'courses.replay_available',
    ]) {
      const row = view({ kind, facts: { ...liveFacts, courseId: COURSE, count: 2 } });
      expect(row?.glyph).not.toBe('Bell');
      expect(markup(row?.sentence)).not.toBe('Você tem uma nova notificação.');
      // D-449: the facts never carry a lesson, so no sentence can name one.
      expect(markup(row?.sentence)).not.toContain(LESSON_TITLE);
    }
  });

  it('D-454: a retracted course notice renders the shipped removed row', () => {
    const removed = view({
      kind: 'courses.course_published',
      facts: {},
      removed: true,
    });
    expect(removed?.removed).toBe(true);
    expect(removed?.href).toBeNull();
    expect(removed?.glyph).toBe('GraduationCap');
    expect(markup(removed?.sentence)).toBe('Este conteúdo foi removido.');
  });

  it('E12 long-text: a 120-character course title passes through whole for the row to clamp', () => {
    const long = 'A'.repeat(120);
    const published = view({
      kind: 'courses.course_published',
      facts: { courseId: COURSE, title: long },
    });
    expect(long).toHaveLength(120);
    expect(markup(published?.sentence)).toBe(
      `<span class="font-bold text-text">Ana Souza</span> publicou o curso “${long}”.`,
    );
  });
});
