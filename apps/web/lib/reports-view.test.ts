import { fileURLToPath } from 'node:url';
import {
  REPORT_STATUSES,
  REPORT_SUBJECT_TYPES,
  type ReportItem,
} from '@rede-social/contracts/moderation';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  parseReportEstado,
  reportHref,
  reportRowView,
  reportSubjectView,
  resolveRowsFor,
} from './reports-view';

/**
 * 11-18 (MODER-05, D-730, D-731, D-732, UI-D-871, UI-D-873, UI-D-874) — the report views, table-driven over
 * the six subjects. The REAL pt-BR catalog through next-intl's translator, a fixed tenant zone and no clock.
 */

const catalog = loadMessages(fileURLToPath(new URL('../messages/pt-BR/', import.meta.url)));
const make = (namespace: string) =>
  createTranslator({
    locale: 'pt-BR',
    messages: catalog,
    namespace,
  } as never) as unknown as Parameters<typeof reportSubjectView>[1];
const t = make('safety');
const tMod = make('moderation');
const SP = 'America/Sao_Paulo';

const ID = '0b000000-0000-4000-8000-000000000001';
const POST = '0b000000-0000-4000-8000-0000000000a1';
const STORY = '0b000000-0000-4000-8000-0000000000a2';
const MEDIA = '0b000000-0000-4000-8000-0000000000a3';

function item(overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    id: ID,
    createdAt: '2026-11-17T17:00:00.000000Z',
    subjectType: 'feed_post',
    subjectId: POST,
    reason: 'spam',
    note: null,
    excerpt: 'Texto da publicação',
    status: 'open',
    resolvedAt: null,
    contentAvailable: true,
    reporter: { displayName: 'Ana Lima', avatarAssetId: null },
    author: { displayName: 'Bia Costa', avatarAssetId: null, isMember: true },
    ...overrides,
  };
}

const row = (overrides: Partial<ReportItem> = {}) =>
  reportRowView(item(overrides), { timeZone: SP, t });

describe('reportSubjectView (D-730, UI-D-871)', () => {
  it.each([
    ['feed_post', 'Publicação', 'Denunciar publicação', null],
    ['post_comment', 'Comentário', 'Denunciar comentário', null],
    ['story', 'Story', 'Denunciar story', null],
    ['story_comment', 'Comentário de story', 'Denunciar comentário', null],
    ['community', 'Comunidade', 'Denunciar comunidade', null],
    [
      'direct_message',
      'Mensagem',
      'Denunciar mensagem',
      'A equipe vê só esta mensagem, não o resto da conversa.',
    ],
  ] as const)('%s reads %s / %s', (subject, pill, title, privacy) => {
    expect(reportSubjectView(subject, t)).toEqual({
      subjectType: subject,
      typePill: pill,
      sheetTitle: title,
      privacy,
    });
  });

  it('a voice message has its own title and privacy line', () => {
    expect(reportSubjectView('direct_message', t, { voice: true })).toEqual({
      subjectType: 'direct_message',
      typePill: 'Mensagem',
      sheetTitle: 'Denunciar mensagem de voz',
      privacy: 'A equipe ouve só esta mensagem de voz, não o resto da conversa.',
    });
  });

  it('the voice variant changes nothing for any other subject', () => {
    for (const subject of REPORT_SUBJECT_TYPES.filter((s) => s !== 'direct_message')) {
      expect(reportSubjectView(subject, t, { voice: true })).toEqual(reportSubjectView(subject, t));
    }
  });

  it('every subject of the closed vocabulary is mapped; an unknown one throws (never guard)', () => {
    for (const subject of REPORT_SUBJECT_TYPES) {
      expect(reportSubjectView(subject, t).sheetTitle).not.toBe('');
    }
    expect(() => reportSubjectView('seventh' as never, t)).toThrow();
  });
});

describe('reportRowView (UI-D-873)', () => {
  it('a post: the excerpt as clamped text, the pills, the meta line and the own href', () => {
    const view = row({ ref: { postId: POST } });
    expect(view).toMatchObject({
      id: ID,
      subjectType: 'feed_post',
      typePill: 'Publicação',
      statePill: { label: 'Aberta', tone: 'neutral' },
      body: { kind: 'text', text: 'Texto da publicação', clamp: 3 },
      meta: 'Motivo: Spam ou propaganda · por Ana Lima · 17/11/2026',
      author: 'Bia Costa',
      open: true,
      viewHref: `/post/${POST}`,
      viewLabel: 'Ver conteúdo',
    });
  });

  it('a post comment links to the post with ?comentario=', () => {
    const view = row({ subjectType: 'post_comment', subjectId: ID, ref: { postId: POST } });
    expect(view.viewHref).toBe(`/post/${POST}?comentario=${ID}`);
    expect(view.typePill).toBe('Comentário');
  });

  it('a story shows the caption cut to 120 graphemes, or "Story sem texto."', () => {
    const long = row({
      subjectType: 'story',
      subjectId: STORY,
      excerpt: '👩🏽‍💻'.repeat(150),
      ref: { storyId: STORY },
    });
    expect(long.body.kind).toBe('story');
    const text = (long.body as { text: string }).text;
    expect([...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].length).toBe(
      121,
    );
    expect(text.endsWith('…')).toBe(true);
    expect(long.viewHref).toBe(`/stories/${STORY}`);

    const none = row({
      subjectType: 'story',
      subjectId: STORY,
      excerpt: '',
      ref: { storyId: STORY },
    });
    expect(none.body).toEqual({ kind: 'story', text: 'Story sem texto.', clamp: 3 });
  });

  it('a story comment reads as a comment of a story and links to the story', () => {
    const view = row({ subjectType: 'story_comment', ref: { storyId: STORY } });
    expect(view).toMatchObject({
      typePill: 'Comentário de story',
      body: { kind: 'text', text: 'Texto da publicação', clamp: 3 },
      viewHref: `/stories/${STORY}`,
    });
  });

  it('a community shows the name and the description, and its removal is "Comunidade arquivada"', () => {
    const view = row({
      subjectType: 'community',
      subjectId: STORY,
      excerpt: 'Clube de leitura\nLivros todo mês',
      status: 'content_removed',
      community: { name: 'Clube de leitura', description: 'Livros todo mês' },
    });
    expect(view.body).toEqual({
      kind: 'community',
      name: 'Clube de leitura',
      description: 'Livros todo mês',
    });
    expect(view.statePill).toEqual({ label: 'Comunidade arquivada', tone: 'success' });
    expect(view.viewHref).toBe(`/comunidades/${STORY}`);
  });

  it('a community with no community key reads the first line of its excerpt as the name', () => {
    const view = row({ subjectType: 'community', subjectId: STORY, excerpt: 'Clube\nDescrição' });
    expect(view.body).toEqual({ kind: 'community', name: 'Clube', description: 'Descrição' });
  });

  it('a text message keeps the WHOLE 280-character copy, no clamp flag, no link', () => {
    const copy = `${'palavra '.repeat(40)}`.trim().slice(0, 280);
    const view = row({
      subjectType: 'direct_message',
      subjectId: STORY,
      excerpt: copy,
      ref: { postId: POST },
    });
    expect(view.body).toEqual({
      kind: 'message',
      text: copy,
      note: 'Só esta mensagem é mostrada.',
    });
    expect(view.body).not.toHaveProperty('clamp');
    expect(view.viewHref).toBeNull();
    expect(view.viewLabel).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/conversa/i);
  });

  it('a voice message carries its recording and length; a retired one reads "Mensagem de voz apagada"', () => {
    const voice = row({
      subjectType: 'direct_message',
      excerpt: '',
      voice: { mediaId: MEDIA, durationSeconds: 42, gone: false },
    });
    expect(voice.body).toEqual({
      kind: 'voice',
      mediaId: MEDIA,
      durationSeconds: 42,
      durationLabel: '0:42',
      note: 'Só esta mensagem é mostrada.',
    });
    const gone = row({
      subjectType: 'direct_message',
      excerpt: '',
      voice: { mediaId: MEDIA, durationSeconds: 42, gone: true },
    });
    expect(gone.body).toEqual({
      kind: 'voiceGone',
      text: 'Mensagem de voz apagada',
      note: 'Só esta mensagem é mostrada.',
    });
    expect(JSON.stringify(gone)).not.toContain(MEDIA);
  });

  it('an item that no longer exists reads the shipped line and has no link', () => {
    const view = row({ contentAvailable: false, ref: { postId: POST } });
    expect(view.body).toEqual({ kind: 'unavailable', text: 'Conteúdo não está mais disponível' });
    expect(view.viewHref).toBeNull();
  });

  it('a departed reporter and a departed author read "Membro removido"', () => {
    const view = row({
      reporter: { displayName: null, avatarAssetId: null },
      author: { displayName: null, avatarAssetId: null, isMember: false },
    });
    expect(view.meta).toBe('Motivo: Spam ou propaganda · por Membro removido · 17/11/2026');
    expect(view.author).toBe('Membro removido');
  });

  it.each([
    ['open', 'Aberta', 'neutral', true],
    ['dismissed', 'Ignorada', 'neutral', false],
    ['content_removed', 'Conteúdo removido', 'success', false],
    ['author_blocked', 'Autor bloqueado', 'success', false],
  ] as const)('status %s reads "%s" (%s), Resolver %s', (status, label, tone, open) => {
    const view = row({ status });
    expect(view.statePill).toEqual({ label, tone });
    expect(view.open).toBe(open);
  });

  it('every subject and every status builds a row (the table is total)', () => {
    for (const subjectType of REPORT_SUBJECT_TYPES) {
      for (const status of REPORT_STATUSES) {
        expect(() => row({ subjectType, status })).not.toThrow();
      }
    }
  });

  it('the note of a reporter is never part of the row', () => {
    expect(JSON.stringify(row({ note: 'segredo do denunciante' }))).not.toContain('segredo');
  });
});

describe('reportHref (UI-D-873, A-UI-14)', () => {
  it('builds the item page from the API ref, and null when the ref is missing or the item is gone', () => {
    expect(reportHref(item({ ref: { postId: POST } }))).toBe(`/post/${POST}`);
    expect(reportHref(item({ subjectType: 'post_comment' }))).toBeNull();
    expect(reportHref(item({ subjectType: 'story_comment' }))).toBeNull();
    expect(reportHref(item({ subjectType: 'story', subjectId: STORY }))).toBe(`/stories/${STORY}`);
    expect(reportHref(item({ subjectType: 'direct_message' }))).toBeNull();
    expect(reportHref(item({ contentAvailable: false }))).toBeNull();
  });
});

describe('resolveRowsFor (UI-D-874): the legal actions only, never a disabled one', () => {
  const kinds = (it: ReportItem) => resolveRowsFor(it, tMod).rows.map((r) => r.kind);

  it('a post, a comment, a story and a story comment: ignore, remove, block (a member author)', () => {
    for (const subjectType of ['feed_post', 'post_comment', 'story', 'story_comment'] as const) {
      expect(kinds(item({ subjectType }))).toEqual(['dismiss', 'remove', 'block']);
    }
    const { rows, helper } = resolveRowsFor(item(), tMod);
    expect(rows).toEqual([
      {
        action: 'dismiss',
        kind: 'dismiss',
        label: 'Ignorar denúncia',
        glyph: 'Check',
        danger: false,
      },
      {
        action: 'remove_content',
        kind: 'remove',
        label: 'Remover conteúdo',
        glyph: 'Trash2',
        danger: true,
      },
      {
        action: 'block_author',
        kind: 'block',
        label: 'Bloquear autor',
        glyph: 'Ban',
        danger: true,
      },
    ]);
    expect(helper).toBeNull();
  });

  it('a community archives (never "remover"), reversible, with the archive glyph', () => {
    const { rows } = resolveRowsFor(item({ subjectType: 'community' }), tMod);
    expect(rows.map((r) => r.kind)).toEqual(['dismiss', 'archive', 'block']);
    expect(rows[1]).toEqual({
      action: 'remove_content',
      kind: 'archive',
      label: 'Arquivar comunidade',
      glyph: 'Archive',
      danger: true,
    });
    expect(JSON.stringify(rows)).not.toContain('Remover');
  });

  it('"Bloquear autor" is offered only for a member author', () => {
    const author = { displayName: null, avatarAssetId: null, isMember: false };
    for (const subjectType of REPORT_SUBJECT_TYPES) {
      expect(kinds(item({ subjectType, author }))).not.toContain('block');
    }
  });

  it('a direct message offers ONLY ignore and block, with the helper line', () => {
    const message = item({ subjectType: 'direct_message' });
    const { rows, helper } = resolveRowsFor(message, tMod);
    expect(rows.map((r) => r.action)).toEqual(['dismiss', 'block_author']);
    expect(helper).toBe('Uma mensagem enviada não pode ser removida.');
    expect(JSON.stringify(rows)).not.toMatch(/remov|arquiv/i);
    // a sender whose account was deleted: ignore alone, the helper stays
    const gone = resolveRowsFor(
      item({
        subjectType: 'direct_message',
        author: { displayName: null, avatarAssetId: null, isMember: false },
      }),
      tMod,
    );
    expect(gone.rows.map((r) => r.action)).toEqual(['dismiss']);
    expect(gone.helper).toBe('Uma mensagem enviada não pode ser removida.');
  });

  it('a report that is not open has nothing to resolve', () => {
    for (const status of ['dismissed', 'content_removed', 'author_blocked'] as const) {
      expect(resolveRowsFor(item({ status }), tMod)).toEqual({ rows: [], helper: null });
    }
  });

  it('no row carries a disabled flag', () => {
    for (const subjectType of REPORT_SUBJECT_TYPES) {
      expect(JSON.stringify(resolveRowsFor(item({ subjectType }), tMod))).not.toContain('disabled');
    }
  });
});

describe('parseReportEstado (UI-D-637)', () => {
  it('reads the three closed values and falls back to "abertas"', () => {
    expect(parseReportEstado('abertas')).toBe('abertas');
    expect(parseReportEstado('resolvidas')).toBe('resolvidas');
    expect(parseReportEstado('todas')).toBe('todas');
    expect(parseReportEstado(undefined)).toBe('abertas');
    expect(parseReportEstado('ABERTAS')).toBe('abertas');
    expect(parseReportEstado('lixo')).toBe('abertas');
    expect(parseReportEstado(['todas'])).toBe('abertas');
  });
});
