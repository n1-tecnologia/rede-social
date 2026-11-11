import { MODERATION_ACTIONS, type ModerationLogEntry } from '@rede-social/contracts/moderation';
import { describe, expect, it } from 'vitest';
import catalog from '../messages/pt-BR/moderation.json';
import {
  formatLogTime,
  MODERATION_LOG_FILTERS,
  type ModerationLogLabels,
  type ModerationLogTranslator,
  moderationLogLabels,
  parseModerationAction,
  toModerationLogView,
} from './moderation-view';

/**
 * 08-01 (UI-D-278): the log row's sentence, context, excerpt and absolute time, from the REAL pt-BR
 * catalog so a reworded template is caught here, under a FIXED time zone.
 */
const log = catalog.moderation.log;
const LABELS: ModerationLogLabels = {
  rows: log.rows,
  kinds: log.kinds,
  roles: log.roles,
  you: log.you,
  removedMember: log.removedMember,
  context: log.context,
  excerpt: log.excerpt,
  reason: log.reason,
  time: log.time,
};
const TZ = 'America/Sao_Paulo';

const entry = (overrides: Partial<ModerationLogEntry> = {}): ModerationLogEntry => ({
  id: '6f1e3c2a-0b4d-4c8e-9a7f-1d2e3f4a5b6c',
  // 17:05 UTC = 14:05 in São Paulo (UTC-3, no DST since 2019).
  createdAt: '2026-10-12T17:05:00.123456Z',
  action: 'comment_removed',
  actor: {
    membershipId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
    displayName: 'Ana Souza',
    isViewer: true,
  },
  target: { membershipId: '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e', displayName: 'Bruno Lima' },
  subjectType: 'post_comment',
  excerpt: 'Texto removido\nem duas linhas',
  reason: null,
  details: null,
  ...overrides,
});

const sentence = (view: ReturnType<typeof toModerationLogView>) =>
  view.sentence.map((part) => (part.strong ? `**${part.text}**` : part.text)).join('');

describe('toModerationLogView', () => {
  it('the viewer reads "Você", the target is bold, the excerpt is quoted whole', () => {
    const view = toModerationLogView(entry(), { timezone: TZ, labels: LABELS });
    expect(sentence(view)).toBe('**Você** removeu um comentário de **Bruno Lima**');
    expect(view.context).toBe('Comentário em um post');
    expect(view.excerpt).toBe('“Texto removido\nem duas linhas”');
    expect(view.reason).toBeNull();
    expect(view.time).toBe('12/10/2026 às 14:05');
  });

  it('another actor reads by name; a departed party reads "Membro removido"', () => {
    const view = toModerationLogView(
      entry({
        actor: { membershipId: entry().actor.membershipId, displayName: null, isViewer: false },
        target: { membershipId: entry().target.membershipId, displayName: null },
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Membro removido** removeu um comentário de **Membro removido**');
    const named = toModerationLogView(entry({ actor: { ...entry().actor, isViewer: false } }), {
      timezone: TZ,
      labels: LABELS,
    });
    expect(sentence(named)).toBe('**Ana Souza** removeu um comentário de **Bruno Lima**');
  });

  it('a story comment gets the story context line', () => {
    const view = toModerationLogView(entry({ subjectType: 'story_comment' }), {
      timezone: TZ,
      labels: LABELS,
    });
    expect(view.context).toBe('Comentário em um story');
  });

  it('09-07 (UI-D-507): a post removal reads "removeu uma publicação de", with the context line and the caption excerpt', () => {
    const view = toModerationLogView(
      entry({ action: 'post_removed', subjectType: 'feed_post', excerpt: 'Legenda da publicação' }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Você** removeu uma publicação de **Bruno Lima**');
    expect(view.action).toBe('post_removed');
    expect(view.context).toBe('Publicação removida');
    expect(view.excerpt).toBe('“Legenda da publicação”');
    expect(view.reason).toBeNull();
    const other = toModerationLogView(
      entry({
        action: 'post_removed',
        subjectType: 'feed_post',
        actor: { ...entry().actor, isViewer: false },
        target: { membershipId: entry().target.membershipId, displayName: null },
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(other)).toBe('**Ana Souza** removeu uma publicação de **Membro removido**');
  });

  it('09-07 (EP-23): a media-only post (empty excerpt) omits the excerpt block and keeps the context', () => {
    const view = toModerationLogView(
      entry({ action: 'post_removed', subjectType: 'feed_post', excerpt: '' }),
      { timezone: TZ, labels: LABELS },
    );
    expect(view.excerpt).toBeNull();
    expect(view.context).toBe('Publicação removida');
  });

  it('12-10 (D-595, A-12-MOD): an export reads with the actor only, no target, no context, no excerpt', () => {
    const exported = entry({
      action: 'profile_form_exported',
      subjectType: null,
      excerpt: null,
      // Actor and target are the same membership: the row names no one else.
      target: { membershipId: entry().actor.membershipId, displayName: 'Ana Souza' },
    });
    const view = toModerationLogView(exported, { timezone: TZ, labels: LABELS });
    expect(sentence(view)).toBe('**Você** exportou as respostas do formulário de perfil');
    expect(view.action).toBe('profile_form_exported');
    expect(view.context).toBeNull();
    expect(view.excerpt).toBeNull();
    expect(view.reason).toBeNull();
    const other = toModerationLogView(
      { ...exported, actor: { ...exported.actor, isViewer: false } },
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(other)).toBe('**Ana Souza** exportou as respostas do formulário de perfil');
    const departed = toModerationLogView(
      { ...exported, actor: { ...exported.actor, isViewer: false, displayName: null } },
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(departed)).toBe(
      '**Membro removido** exportou as respostas do formulário de perfil',
    );
  });

  it('a block carries its reason and no context or excerpt', () => {
    const view = toModerationLogView(
      entry({
        action: 'member_blocked',
        subjectType: null,
        excerpt: null,
        reason: 'mensagens ofensivas repetidas',
        actor: { ...entry().actor, isViewer: false },
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Ana Souza** bloqueou o acesso de **Bruno Lima**');
    expect(view.context).toBeNull();
    expect(view.excerpt).toBeNull();
    expect(view.reason).toBe('Motivo: mensagens ofensivas repetidas');
  });

  it('a role change names both roles from the catalog, unbolded', () => {
    const view = toModerationLogView(
      entry({
        action: 'role_changed',
        subjectType: null,
        excerpt: null,
        details: { from: 'member', to: 'admin_tenant' },
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe(
      '**Você** mudou o papel de **Bruno Lima** de Membro para Administrador',
    );
  });

  it('an excerpt carrying a placeholder-looking text is shown verbatim', () => {
    const view = toModerationLogView(entry({ excerpt: 'olha {reason} aqui' }), {
      timezone: TZ,
      labels: LABELS,
    });
    expect(view.excerpt).toBe('“olha {reason} aqui”');
  });
});

describe('formatLogTime (tenant time zone, h23, explicit 2-digit fields)', () => {
  it('23:59 and 00:00 fall on their own São Paulo days, never the UTC ones', () => {
    // 02:59 UTC on the 13th is 23:59 on the 12th in São Paulo.
    expect(formatLogTime('2026-10-13T02:59:00.000000Z', TZ, LABELS.time)).toBe(
      '12/10/2026 às 23:59',
    );
    // One minute later is midnight on the 13th, written 00:00 (h23), never 24:00.
    expect(formatLogTime('2026-10-13T03:00:00.000000Z', TZ, LABELS.time)).toBe(
      '13/10/2026 às 00:00',
    );
  });

  it('pads single-digit days, months and hours', () => {
    expect(formatLogTime('2026-01-05T10:07:00.000000Z', TZ, LABELS.time)).toBe(
      '05/01/2026 às 07:07',
    );
  });
});

/** 08-03 (D-337, UI-D-277/278): every action, the defensive blanks, the filter and the label builder. */
describe('08-03 — every row variant and the filter', () => {
  it('an unblock reads "desbloqueou o acesso", with its reason and no context or excerpt', () => {
    const view = toModerationLogView(
      entry({
        action: 'member_unblocked',
        subjectType: null,
        excerpt: null,
        reason: 'conversamos e está tudo certo',
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Você** desbloqueou o acesso de **Bruno Lima**');
    expect(view.context).toBeNull();
    expect(view.excerpt).toBeNull();
    expect(view.reason).toBe('Motivo: conversamos e está tudo certo');
  });

  it('a block with NO reason has no "Motivo" line; a blank or whitespace reason is no reason', () => {
    for (const reason of [null, '', '   ', '\n\t ']) {
      const view = toModerationLogView(
        entry({ action: 'member_blocked', subjectType: null, excerpt: null, reason }),
        { timezone: TZ, labels: LABELS },
      );
      expect(view.reason).toBeNull();
      expect(view.context).toBeNull();
    }
  });

  it('E10/empty: an empty stored excerpt omits the block, and the context line still renders', () => {
    for (const excerpt of ['', '   ', null]) {
      const view = toModerationLogView(entry({ excerpt }), { timezone: TZ, labels: LABELS });
      expect(view.excerpt).toBeNull();
      expect(view.context).toBe('Comentário em um post');
    }
  });

  it('a 280-character excerpt with line breaks and a 500-character reason come through whole', () => {
    const excerpt = `${'a'.repeat(139)}\n${'b'.repeat(140)}`;
    const reason = 'r'.repeat(500);
    const view = toModerationLogView(entry({ excerpt }), { timezone: TZ, labels: LABELS });
    expect(view.excerpt).toBe(`“${excerpt}”`);
    const blocked = toModerationLogView(
      entry({ action: 'member_blocked', subjectType: null, excerpt: null, reason }),
      { timezone: TZ, labels: LABELS },
    );
    expect(blocked.reason).toBe(`Motivo: ${reason}`);
  });

  it('a role change from Administrador to Suporte by someone else', () => {
    const view = toModerationLogView(
      entry({
        action: 'role_changed',
        subjectType: null,
        excerpt: null,
        actor: { ...entry().actor, isViewer: false },
        details: { from: 'admin_tenant', to: 'support_tenant' },
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe(
      '**Ana Souza** mudou o papel de **Bruno Lima** de Administrador para Suporte',
    );
  });

  it('parseModerationAction: every API value passes; anything else reads as "Tudo"', () => {
    for (const action of [
      'comment_removed',
      'member_blocked',
      'member_unblocked',
      'role_changed',
      'post_removed',
      'profile_form_exported',
      'story_removed',
      'community_archived',
      'community_removed',
    ])
      expect(parseModerationAction(action)).toBe(action);
    for (const raw of [
      undefined,
      '',
      'tudo',
      'COMMENT_REMOVED',
      'comentarios',
      'POST_REMOVED',
      'PROFILE_FORM_EXPORTED',
      'exportacoes',
      'post_hidden',
      ['member_blocked'],
    ])
      expect(parseModerationAction(raw)).toBeNull();
  });

  it('the chip row is "Tudo · Comentários · Publicações · Bloqueios · Desbloqueios · Papéis · Exportações" then the three Phase 10 kinds, in that order', () => {
    expect(MODERATION_LOG_FILTERS.map((filter) => log.filters[filter.key])).toEqual([
      'Tudo',
      'Comentários',
      'Publicações',
      'Bloqueios',
      'Desbloqueios',
      'Papéis',
      'Exportações',
      'Story removido',
      'Comunidade arquivada',
      'Comunidade removida',
    ]);
    expect(MODERATION_LOG_FILTERS.map((filter) => filter.action)).toEqual([
      null,
      'comment_removed',
      'post_removed',
      'member_blocked',
      'member_unblocked',
      'role_changed',
      'profile_form_exported',
      'story_removed',
      'community_archived',
      'community_removed',
    ]);
  });

  it('moderationLogLabels reads raw templates, so the slots survive for the view', () => {
    const lookup = (key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], log);
    const t = Object.assign((key: string) => String(lookup(key)), {
      raw: (key: string) => lookup(key),
    }) as ModerationLogTranslator;
    expect(moderationLogLabels(t)).toEqual(LABELS);
  });
});

/**
 * 10-11 (UI-D-714, D-711, MCOMM-10, MSTORY-09): the moderator's removal of a member's story and the
 * archive / removal of a member's community, in the existing row geometry. The copy is the UI-SPEC's,
 * verbatim, from the real catalog.
 */
describe('10-11 - the three member-content entry kinds', () => {
  const other = { ...entry().actor, isViewer: false, displayName: 'Marcos' };
  const helena = { membershipId: entry().target.membershipId, displayName: 'Helena' };

  it('story_removed: "removeu um story de", the kind label and the caption as the excerpt line', () => {
    const view = toModerationLogView(
      entry({
        action: 'story_removed',
        subjectType: 'story',
        actor: other,
        target: helena,
        excerpt: 'Sábado teve feira de mudas na praça',
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Marcos** removeu um story de **Helena**');
    expect(view.action).toBe('story_removed');
    expect(view.kind).toBe('Story removido');
    expect(view.excerpt).toBe('“Sábado teve feira de mudas na praça”');
    expect(view.context).toBeNull();
    expect(view.reason).toBeNull();
  });

  it('story_removed: the excerpt line is the caption first 80 characters, with an ellipsis when cut', () => {
    const caption = `${'a'.repeat(79)} ${'b'.repeat(120)}`;
    const view = toModerationLogView(
      entry({ action: 'story_removed', subjectType: 'story', excerpt: caption }),
      { timezone: TZ, labels: LABELS },
    );
    const shown = (view.excerpt ?? '').replace(/^“|”$/g, '');
    expect(Array.from(shown).length).toBeLessThanOrEqual(81);
    expect(shown.startsWith('a'.repeat(79))).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
    const exact = 'c'.repeat(80);
    const whole = toModerationLogView(
      entry({ action: 'story_removed', subjectType: 'story', excerpt: exact }),
      { timezone: TZ, labels: LABELS },
    );
    expect(whole.excerpt).toBe(`“${exact}”`);
  });

  it('story_removed: a story with no caption has no excerpt block', () => {
    for (const excerpt of ['', null]) {
      const view = toModerationLogView(
        entry({ action: 'story_removed', subjectType: 'story', excerpt }),
        { timezone: TZ, labels: LABELS },
      );
      expect(view.excerpt).toBeNull();
      expect(view.kind).toBe('Story removido');
    }
  });

  it('community_archived: "arquivou a comunidade {community} de {target}" with the name bold, no excerpt', () => {
    const view = toModerationLogView(
      entry({
        action: 'community_archived',
        subjectType: 'community',
        actor: other,
        target: helena,
        excerpt: 'Horta em casa',
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Marcos** arquivou a comunidade **Horta em casa** de **Helena**');
    expect(view.kind).toBe('Comunidade arquivada');
    expect(view.excerpt).toBeNull();
    expect(view.context).toBeNull();
  });

  it('community_removed: "removeu a comunidade {community} de {target}", the viewer reads "Você"', () => {
    const view = toModerationLogView(
      entry({
        action: 'community_removed',
        subjectType: 'community',
        target: helena,
        excerpt: 'Horta em casa',
      }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe('**Você** removeu a comunidade **Horta em casa** de **Helena**');
    expect(view.kind).toBe('Comunidade removida');
    expect(view.excerpt).toBeNull();
  });

  it('a community name that looks like a placeholder is shown verbatim', () => {
    const view = toModerationLogView(
      entry({ action: 'community_removed', subjectType: 'community', excerpt: '{target} {actor}' }),
      { timezone: TZ, labels: LABELS },
    );
    expect(sentence(view)).toBe(
      '**Você** removeu a comunidade **{target} {actor}** de **Bruno Lima**',
    );
  });

  it('the older kinds carry no kind label (their row is unchanged)', () => {
    for (const action of ['comment_removed', 'post_removed', 'member_blocked'] as const) {
      expect(
        toModerationLogView(entry({ action }), { timezone: TZ, labels: LABELS }).kind,
      ).toBeNull();
    }
  });

  it('every value of MODERATION_ACTIONS has a sentence with no unresolved slot and a filter chip', () => {
    for (const action of MODERATION_ACTIONS) {
      const view = toModerationLogView(
        entry({ action, details: { from: 'member', to: 'admin_tenant' } }),
        { timezone: TZ, labels: LABELS },
      );
      expect(sentence(view), action).not.toMatch(/\{\w+\}/);
      expect(sentence(view).length, action).toBeGreaterThan(0);
      expect(
        MODERATION_LOG_FILTERS.some((filter) => filter.action === action),
        `${action} has a filter chip`,
      ).toBe(true);
    }
    for (const filter of MODERATION_LOG_FILTERS) {
      expect(log.filters[filter.key], filter.key).toBeTruthy();
    }
  });
});
