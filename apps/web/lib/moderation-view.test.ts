import type { ModerationLogEntry } from '@rede-social/contracts/moderation';
import { describe, expect, it } from 'vitest';
import catalog from '../messages/pt-BR/moderation.json';
import { formatLogTime, type ModerationLogLabels, toModerationLogView } from './moderation-view';

/**
 * 08-01 (UI-D-278): the log row's sentence, context, excerpt and absolute time, from the REAL pt-BR
 * catalog so a reworded template is caught here, under a FIXED time zone.
 */
const log = catalog.moderation.log;
const LABELS: ModerationLogLabels = {
  rows: log.rows,
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
