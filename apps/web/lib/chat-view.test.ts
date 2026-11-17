import { fileURLToPath } from 'node:url';
import type {
  CaseCard,
  InboxRow,
  MemberCase,
  MessageRow,
  StaffCase,
} from '@rede-social/module-chat/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  type ChatMessageView,
  caseCardView,
  caseEventSentence,
  caseHeaderView,
  caseMetaText,
  casePriorityView,
  caseStateView,
  caseSubjectLine,
  caseTitle,
  chatDayLabel,
  chatMessageView,
  chatRuns,
  firstNameOf,
  inboxRowView,
  inboxTime,
  reconcileInboxPage,
  tenantDayKeys,
} from './chat-view';

/**
 * UI-D-259 / UI-D-14: the chat formatter under a fixed clock and fixed timezones. Every instant is a
 * literal and every `nowMs` is passed in. Strings come from the REAL catalog through next-intl's own
 * translator, so a copy change in `messages/pt-BR/chat.json` is caught here too.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
  namespace: 'chat',
}) as unknown as Parameters<typeof chatMessageView>[1]['t'];

const SP = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';
const at = (iso: string) => Date.parse(iso);
const words = { today: 'Hoje', yesterday: 'Ontem', pending: 'Enviando…' };

let nextSeq = 1;
function row(overrides: Partial<MessageRow> = {}): MessageRow {
  const seq = overrides.seq ?? nextSeq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    side: 'member',
    body: 'Oi',
    createdAt: '2026-09-30T17:00:00.000000Z',
    author: null,
    authorIsViewer: true,
    ...overrides,
  };
}

const staffRow = (overrides: Partial<MessageRow> = {}) =>
  row({ side: 'staff', author: { firstName: 'Carla' }, authorIsViewer: false, ...overrides });

describe('tenantDayKeys / chatDayLabel — tenant-local days, not UTC days', () => {
  it('1. at 01:30Z the UTC day is already the 1st, but São Paulo is still on the 30th', () => {
    const now = at('2026-10-01T01:30:00Z');
    expect(tenantDayKeys(now, SP)).toEqual({
      todayKey: '2026-09-30',
      yesterdayKey: '2026-09-29',
    });
    expect(tenantDayKeys(now, 'UTC')).toEqual({
      todayKey: '2026-10-01',
      yesterdayKey: '2026-09-30',
    });
  });

  it('2. "Hoje" and "Ontem" follow the tenant day across the UTC midnight', () => {
    const keys = tenantDayKeys(at('2026-10-01T01:30:00Z'), SP);
    // 22:00 local on the 30th is 01:00Z on the 1st: still "Hoje" for the tenant.
    const late = chatMessageView(row({ createdAt: '2026-10-01T01:00:00.000000Z' }), {
      timeZone: SP,
      viewer: 'member',
      t,
    });
    expect(late.dayKey).toBe('2026-09-30');
    expect(chatDayLabel(late.dayKey, keys, words)).toBe('Hoje');
    expect(chatDayLabel('2026-09-29', keys, words)).toBe('Ontem');
  });

  it('3. an older day reads `sáb., 12 de set.`, with the year only when it differs', () => {
    const keys = tenantDayKeys(at('2026-09-30T15:00:00Z'), SP);
    expect(chatDayLabel('2026-09-12', keys, words)).toBe('sáb., 12 de set.');
    expect(chatDayLabel('2025-12-31', keys, words)).toBe('qua., 31 de dez. de 2025');
  });

  it('4. the year boundary: 1 January reads "Ontem" for 31 December', () => {
    const keys = tenantDayKeys(at('2027-01-01T12:00:00Z'), SP);
    expect(keys).toEqual({ todayKey: '2027-01-01', yesterdayKey: '2026-12-31' });
  });
});

describe('chatMessageView — times in the tenant zone, labels per viewer', () => {
  it('5. the same instant is 14:05 in São Paulo and 13:05 in Manaus (h23)', () => {
    const r = row({ createdAt: '2026-09-30T17:05:00.000000Z' });
    expect(chatMessageView(r, { timeZone: SP, viewer: 'member', t }).time).toBe('14:05');
    expect(chatMessageView(r, { timeZone: MANAUS, viewer: 'member', t }).time).toBe('13:05');
    const evening = row({ createdAt: '2026-10-01T02:00:00.000000Z' });
    expect(chatMessageView(evening, { timeZone: SP, viewer: 'member', t }).time).toBe('23:00');
  });

  it('6. member view: own messages right with no label, every staff bubble labelled', () => {
    const own = chatMessageView(row(), { timeZone: SP, viewer: 'member', t });
    expect(own.side).toBe('own');
    expect(own.label).toBeNull();
    const staff = chatMessageView(staffRow(), { timeZone: SP, viewer: 'member', t });
    expect(staff.side).toBe('other');
    expect(staff.label).toEqual({ firstName: 'Carla', srSuffix: ', da equipe', icon: 'shield' });
  });

  it('7. staff view: team messages right, "Você" for the viewer, member bubbles unlabelled', () => {
    const mine = chatMessageView(staffRow({ authorIsViewer: true }), {
      timeZone: SP,
      viewer: 'staff',
      t,
    });
    expect(mine.side).toBe('own');
    expect(mine.label).toEqual({ firstName: 'Você', srSuffix: '', icon: null });
    const colleague = chatMessageView(staffRow({ author: { firstName: 'Bruno' } }), {
      timeZone: SP,
      viewer: 'staff',
      t,
    });
    expect(colleague.side).toBe('own');
    expect(colleague.label).toEqual({ firstName: 'Bruno', srSuffix: '', icon: null });
    const member = chatMessageView(row({ authorIsViewer: false }), {
      timeZone: SP,
      viewer: 'staff',
      t,
    });
    expect(member.side).toBe('other');
    expect(member.label).toBeNull();
  });

  it('8. a view carries no identity field beyond the first name', () => {
    const view = chatMessageView(staffRow(), { timeZone: SP, viewer: 'member', t });
    expect(Object.keys(view).sort()).toEqual(
      ['authorKey', 'body', 'createdAtMs', 'dayKey', 'id', 'label', 'seq', 'side', 'time'].sort(),
    );
  });
});

describe('chatRuns — separators, runs and the time on the last bubble', () => {
  const keys = tenantDayKeys(at('2026-09-30T18:00:00Z'), SP);
  const view = (r: MessageRow): ChatMessageView =>
    chatMessageView(r, { timeZone: SP, viewer: 'member', t });

  it('9. 4:59 apart is one run (one time), 5:01 apart is two runs (two times)', () => {
    const items = chatRuns(
      [
        view(row({ seq: 1, createdAt: '2026-09-30T17:00:00.000000Z' })),
        view(row({ seq: 2, createdAt: '2026-09-30T17:04:59.000000Z' })),
        view(row({ seq: 3, createdAt: '2026-09-30T17:10:00.000000Z' })),
      ],
      keys,
      words,
    );
    const times = items.flatMap((item) => (item.kind === 'message' ? [item.time ?? null] : []));
    expect(times).toEqual([null, '14:04', '14:10']);
  });

  it('10. a change of side ends a run even within five minutes', () => {
    const items = chatRuns(
      [
        view(row({ seq: 1, createdAt: '2026-09-30T17:00:00.000000Z' })),
        view(staffRow({ seq: 2, createdAt: '2026-09-30T17:01:00.000000Z' })),
        view(staffRow({ seq: 3, createdAt: '2026-09-30T17:02:00.000000Z' })),
      ],
      keys,
      words,
    );
    const messages = items.filter((item) => item.kind === 'message');
    expect(messages.map((item) => (item.kind === 'message' ? item.time : null))).toEqual([
      '14:00',
      null,
      '14:02',
    ]);
    // D-222: the label repeats on EVERY staff bubble, not once per run.
    expect(
      messages.map((item) => (item.kind === 'message' ? item.label?.firstName : null)),
    ).toEqual([undefined, 'Carla', 'Carla']);
  });

  it('11. day separators are inserted per tenant-local day and the list is seq-ordered', () => {
    const items = chatRuns(
      [
        view(row({ seq: 3, createdAt: '2026-09-30T17:00:00.000000Z' })),
        view(staffRow({ seq: 1, createdAt: '2026-09-12T15:00:00.000000Z' })),
        view(row({ seq: 2, createdAt: '2026-09-29T15:00:00.000000Z' })),
      ],
      keys,
      words,
    );
    expect(
      items.map((item) =>
        item.kind === 'day' ? `day:${item.label}` : `msg:${item.key.slice(-1)}`,
      ),
    ).toEqual(['day:sáb., 12 de set.', 'msg:1', 'day:Ontem', 'msg:2', 'day:Hoje', 'msg:3']);
  });

  it('12. a pending bubble follows the settled ones with the sending label and no time', () => {
    const settled = view(row({ seq: 1 }));
    const optimistic: ChatMessageView = { ...settled, id: 'pending-1', seq: 0, pending: true };
    const items = chatRuns([optimistic, settled], keys, words);
    const last = items.at(-1);
    expect(last).toMatchObject({ kind: 'message', key: 'pending-1', pending: true });
    expect(last && last.kind === 'message' ? last.pendingLabel : null).toBe('Enviando…');
  });
});

const MEMBERSHIP = '2a000000-0000-4000-8000-000000000001';
const AVATAR = '3a000000-0000-4000-8000-000000000001';

function inboxRow(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    conversationId: '1d000000-0000-4000-8000-000000000001',
    member: {
      membershipId: MEMBERSHIP,
      displayName: 'Ana Souza',
      avatarAssetId: AVATAR,
      state: 'active',
    },
    lastMessage: {
      seq: 3,
      preview: 'Quero trocar meu e-mail.',
      side: 'member',
      authorFirstName: null,
    },
    lastMessageAt: '2026-09-30T17:02:00.000000Z',
    awaiting: true,
    ...overrides,
  };
}

describe('inboxTime / inboxRowView — the staff inbox row (UI-D-262)', () => {
  // "Now" is 01:30Z on Oct 1st: São Paulo is still on Sep 30th (22:30), Manaus on Sep 30th (21:30).
  const now = at('2026-10-01T01:30:00Z');
  const keys = tenantDayKeys(now, SP);
  const ontem = { yesterday: 'Ontem' };

  it('13. today is HH:mm in the tenant clock, even past the UTC midnight', () => {
    // 01:10Z on the 1st is 22:10 on the 30th in São Paulo: still today for the tenant.
    expect(inboxTime('2026-10-01T01:10:00Z', keys, SP, ontem)).toBe('22:10');
    expect(inboxTime('2026-09-30T12:05:00Z', keys, SP, ontem)).toBe('09:05');
  });

  it('14. the tenant yesterday is the catalog word, and older days are dd/MM', () => {
    // 02:59Z on the 30th is 23:59 on the 29th in São Paulo.
    expect(inboxTime('2026-09-30T02:59:00Z', keys, SP, ontem)).toBe('Ontem');
    expect(inboxTime('2026-09-29T03:00:00Z', keys, SP, ontem)).toBe('Ontem');
    // 02:59Z on the 29th is 23:59 on the 28th: two tenant days ago.
    expect(inboxTime('2026-09-29T02:59:00Z', keys, SP, ontem)).toBe('28/09');
    expect(inboxTime('2026-01-05T15:00:00Z', keys, SP, ontem)).toBe('05/01');
  });

  it('15. the same instants in a Manaus tenant follow the Manaus clock', () => {
    const manausKeys = tenantDayKeys(now, MANAUS);
    expect(inboxTime('2026-10-01T01:10:00Z', manausKeys, MANAUS, ontem)).toBe('21:10');
    expect(inboxTime('2026-09-30T03:30:00Z', manausKeys, MANAUS, ontem)).toBe('Ontem');
  });

  it('15b. the API instant rides along unchanged as the order key (WR-01), null when the API sent null', () => {
    const withInstant = inboxRowView(inboxRow(), { timeZone: SP, keys, t });
    expect(withInstant.lastMessageAt).toBe('2026-09-30T17:02:00.000000Z');
    const none = inboxRowView(inboxRow({ lastMessage: null, lastMessageAt: null }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(none.lastMessageAt).toBeNull();
  });

  it('16. a member message previews as-is; a team message is prefixed with the first name', () => {
    const member = inboxRowView(inboxRow(), { timeZone: SP, keys, t });
    expect(member).toMatchObject({
      href: '/suporte/1d000000-0000-4000-8000-000000000001',
      name: 'Ana Souza',
      avatar: `/v1/media/${AVATAR}/w128`,
      preview: 'Quero trocar meu e-mail.',
      time: '14:02',
      awaiting: true,
      state: 'active',
    });
    const team = inboxRowView(
      inboxRow({
        lastMessage: { seq: 4, preview: 'Pronto!', side: 'staff', authorFirstName: 'Carla' },
        awaiting: false,
      }),
      { timeZone: SP, keys, t },
    );
    expect(team.preview).toBe('Carla: Pronto!');
    expect(team.awaiting).toBe(false);
    // An agent who left the tenant has no first name: the text alone, never ": Pronto!".
    const gone = inboxRowView(
      inboxRow({
        lastMessage: { seq: 4, preview: 'Pronto!', side: 'staff', authorFirstName: '' },
      }),
      { timeZone: SP, keys, t },
    );
    expect(gone.preview).toBe('Pronto!');
  });

  it('17. a multi-line preview is one line, and a departed member is "Membro removido" with no photo', () => {
    const multi = inboxRowView(
      inboxRow({
        lastMessage: {
          seq: 5,
          preview: 'Segue a lista:\n1. crachá\r\n2. estacionamento',
          side: 'member',
          authorFirstName: null,
        },
      }),
      { timeZone: SP, keys, t },
    );
    expect(multi.preview).toBe('Segue a lista: 1. crachá 2. estacionamento');

    const departed = inboxRowView(
      inboxRow({
        member: { membershipId: null, displayName: null, avatarAssetId: null, state: 'removed' },
      }),
      { timeZone: SP, keys, t },
    );
    expect(departed).toMatchObject({ name: 'Membro removido', avatar: null, state: 'removed' });

    const blocked = inboxRowView(inboxRow({ member: { ...inboxRow().member, state: 'blocked' } }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(blocked).toMatchObject({ name: 'Ana Souza', state: 'blocked' });
    expect(blocked.avatar).not.toBeNull();
  });

  it('18. a conversation with no message yet has no preview and no time', () => {
    const empty = inboxRowView(
      inboxRow({ lastMessage: null, lastMessageAt: null, awaiting: false }),
      {
        timeZone: SP,
        keys,
        t,
      },
    );
    expect(empty.preview).toBe('');
    expect(empty.time).toBe('');
  });
});

/**
 * 12.4-11 tracer (UI-D-816, UI-D-817, UI-D-818, UI-D-835): one path through the view layer, from an API
 * case to the finished header a screen draws, for a team member and for a member, over the REAL catalog.
 */
const CASE_ID = '1d000000-0000-4000-8000-0000000000c1';
const OWNER_ID = '1d000000-0000-4000-8000-0000000000a1';

function staffCase(overrides: Partial<StaffCase> = {}): StaffCase {
  return {
    id: CASE_ID,
    number: 42,
    state: 'in_progress',
    subject: 'Cobrança duplicada',
    subjectLabel: 'Cobrança duplicada',
    category: 'payment',
    openedAt: '2026-09-30T17:00:00.000000Z',
    priority: 'normal',
    ownerUserId: OWNER_ID,
    ownerName: 'Carla Souza',
    ownerIsViewer: false,
    resolvedAt: null,
    closedAt: null,
    actions: ['take', 'resolve', 'close', 'edit'],
    ...overrides,
  };
}

function memberCase(overrides: Partial<MemberCase> = {}): MemberCase {
  return {
    id: CASE_ID,
    number: 42,
    state: 'in_progress',
    subject: 'Cobrança duplicada',
    subjectLabel: 'Cobrança duplicada',
    category: 'payment',
    openedAt: '2026-09-30T17:00:00.000000Z',
    ...overrides,
  };
}

describe('12.4-11 tracer — caseStateView, caseTitle and caseHeaderView', () => {
  it('1. the four states map to their catalog label, tone and glyph (UI-D-817)', () => {
    expect(caseStateView('open', t)).toEqual({
      state: 'open',
      label: 'Aberto',
      tone: 'warning',
      glyph: 'CircleDot',
    });
    expect(caseStateView('in_progress', t)).toEqual({
      state: 'in_progress',
      label: 'Em atendimento',
      tone: 'brand',
      glyph: 'UserCheck',
    });
    expect(caseStateView('resolved', t)).toEqual({
      state: 'resolved',
      label: 'Resolvido',
      tone: 'success',
      glyph: 'CircleCheck',
    });
    expect(caseStateView('closed', t)).toEqual({
      state: 'closed',
      label: 'Fechado',
      tone: 'neutral',
      glyph: 'Lock',
    });
  });

  it('2. the case number is a plain integer: no thousands separator (A-UI-25)', () => {
    expect(caseTitle(t, 1)).toBe('Chamado #1');
    expect(caseTitle(t, 42)).toBe('Chamado #42');
    expect(caseTitle(t, 1204)).toBe('Chamado #1204');
  });

  it('3. a staff answer for an in_progress case owned by someone else gives the finished header', () => {
    const header = caseHeaderView(staffCase(), { viewer: 'staff', t });
    expect(header).toMatchObject({
      viewer: 'staff',
      id: CASE_ID,
      number: 42,
      title: 'Chamado #42',
      state: { label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
      subject: 'Cobrança duplicada',
      subjectLine: '#42 · Cobrança duplicada',
      meta: 'Pagamento · Normal · Com Carla',
    });
    // The action list is the server's, in the server's order, untouched.
    expect(header.viewer === 'staff' && header.actions).toEqual([
      'take',
      'resolve',
      'close',
      'edit',
    ]);
  });

  it("3b. 12.4-19: the staff header carries the sheets' facts: category, priority, the TYPED subject and the opening instant", () => {
    const typed = caseHeaderView(staffCase(), { viewer: 'staff', t });
    expect(typed).toMatchObject({
      category: 'payment',
      priority: 'normal',
      typedSubject: 'Cobrança duplicada',
      openedAt: '2026-09-30T17:00:00.000000Z',
    });
    // A case with no typed subject keeps `null` there while `subject` is the server's fallback label.
    const fallback = caseHeaderView(
      staffCase({ subject: null, subjectLabel: 'Meu ingresso não chegou' }),
      { viewer: 'staff', t },
    );
    expect(fallback).toMatchObject({ typedSubject: null, subject: 'Meu ingresso não chegou' });
    // The member header never carries any of it.
    const member = caseHeaderView(staffCase(), { viewer: 'member', t });
    for (const key of ['category', 'priority', 'typedSubject', 'openedAt']) {
      expect(member).not.toHaveProperty(key);
    }
  });

  it('4. the same case read by its owner says "Com você"; no owner says "Sem responsável"', () => {
    const mine = caseHeaderView(staffCase({ ownerIsViewer: true }), { viewer: 'staff', t });
    expect(mine.viewer === 'staff' && mine.meta).toBe('Pagamento · Normal · Com você');
    const nobody = caseHeaderView(
      staffCase({ state: 'open', ownerUserId: null, ownerName: null, priority: 'high' }),
      { viewer: 'staff', t },
    );
    expect(nobody.viewer === 'staff' && nobody.meta).toBe('Pagamento · Alta · Sem responsável');
  });

  it('5. a member answer gives title, state and subject only (T-12.4-50)', () => {
    const header = caseHeaderView(memberCase(), { viewer: 'member', t });
    expect(header).toEqual({
      viewer: 'member',
      id: CASE_ID,
      number: 42,
      title: 'Chamado #42',
      state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
      subject: 'Cobrança duplicada',
      subjectLine: '#42 · Cobrança duplicada',
    });
  });

  it('6. a member-shaped input that wrongly carries staff facts never leaks them (T-12.4-50)', () => {
    const hostile = {
      ...memberCase(),
      priority: 'high',
      ownerName: 'Carla Souza',
      ownerUserId: OWNER_ID,
      ownerIsViewer: false,
      actions: ['assign'],
    } as unknown as MemberCase;
    const header = caseHeaderView(hostile, { viewer: 'member', t });
    expect(header).not.toHaveProperty('priority');
    expect(header).not.toHaveProperty('ownerName');
    expect(header).not.toHaveProperty('ownerUserId');
    expect(header).not.toHaveProperty('actions');
    expect(header).not.toHaveProperty('meta');
    expect(JSON.stringify(header)).not.toContain('Carla');
    expect(JSON.stringify(header)).not.toContain('Alta');
  });

  it('7. a case with no typed subject still has a subject line, from the server label (UI-D-818)', () => {
    const header = caseHeaderView(
      memberCase({ subject: null, subjectLabel: 'Não consigo entrar na minha conta desde ontem…' }),
      { viewer: 'member', t },
    );
    expect(header.subject).toBe('Não consigo entrar na minha conta desde ontem…');
    expect(header.subjectLine).toBe('#42 · Não consigo entrar na minha conta desde ontem…');
  });
});

describe('12.4-11 — caseSubjectLine, caseMetaText and casePriorityView (UI-D-824, UI-D-825)', () => {
  it('1. the subject line is "#number · subject" on one line', () => {
    expect(caseSubjectLine(t, 42, 'Cobrança duplicada')).toBe('#42 · Cobrança duplicada');
    expect(caseSubjectLine(t, 1204, 'Duas\nlinhas   aqui')).toBe('#1204 · Duas linhas aqui');
  });

  it("2. the inbox meta text: owned (first name only), unowned and the viewer's own", () => {
    const base = { category: 'check_in' as const };
    expect(caseMetaText(t, { ...base, ownerName: 'Carla Souza', ownerIsViewer: false })).toBe(
      'Check-in · Com Carla',
    );
    expect(caseMetaText(t, { ...base, ownerName: null, ownerIsViewer: false })).toBe(
      'Check-in · Sem responsável',
    );
    expect(caseMetaText(t, { ...base, ownerName: 'Carla Souza', ownerIsViewer: true })).toBe(
      'Check-in · Com você',
    );
    // An owner who is no longer live staff has no name: nobody, not an empty "Com ".
    expect(caseMetaText(t, { ...base, ownerName: '   ', ownerIsViewer: false })).toBe(
      'Check-in · Sem responsável',
    );
  });

  it('3. the staff bar writes the priority out, Normal included', () => {
    const base = { category: 'account' as const, ownerName: null, ownerIsViewer: false };
    expect(caseMetaText(t, { ...base, priority: 'normal' })).toBe(
      'Conta · Normal · Sem responsável',
    );
    expect(caseMetaText(t, { ...base, priority: 'low', ownerName: 'Bruno Lima' })).toBe(
      'Conta · Baixa · Com Bruno',
    );
    expect(caseMetaText(t, { ...base, priority: 'high', ownerIsViewer: true })).toBe(
      'Conta · Alta · Com você',
    );
  });

  it('4. the priority pill is drawn for Alta (danger) and Baixa (neutral), never for Normal (A-UI-7)', () => {
    expect(casePriorityView('high', t)).toEqual({
      priority: 'high',
      label: 'Alta',
      tone: 'danger',
      pill: true,
    });
    expect(casePriorityView('low', t)).toEqual({
      priority: 'low',
      label: 'Baixa',
      tone: 'neutral',
      pill: true,
    });
    expect(casePriorityView('normal', t).pill).toBe(false);
  });
});

describe('12.4-11 — caseEventSentence (UI-D-829, D-810)', () => {
  const at = '2026-09-30T17:00:00.000000Z';
  const sentence = (event: Parameters<typeof caseEventSentence>[1]) =>
    caseEventSentence(t, event).text;

  it('1. one sentence per event kind, the actor in the catalog slot', () => {
    expect(sentence({ kind: 'opened', at, actorName: 'Ana Souza' })).toBe(
      'Ana Souza abriu o chamado.',
    );
    expect(sentence({ kind: 'taken', at, actorName: 'Carla Souza' })).toBe(
      'Carla Souza assumiu o chamado.',
    );
    expect(
      sentence({ kind: 'assigned', at, actorName: 'Diego Reis', targetName: 'Carla Souza' }),
    ).toBe('Diego Reis atribuiu o chamado a Carla Souza.');
    expect(sentence({ kind: 'resolved', at, actorName: 'Carla Souza' })).toBe(
      'Carla Souza marcou como resolvido.',
    );
    expect(sentence({ kind: 'closed', at, actorName: 'Carla Souza' })).toBe(
      'Carla Souza fechou o chamado.',
    );
    expect(sentence({ kind: 'reopened', at, actorName: 'Carla Souza' })).toBe(
      'Carla Souza reabriu o chamado.',
    );
  });

  it('2. the actor is the bold part and nothing else is', () => {
    const { parts } = caseEventSentence(t, { kind: 'taken', at, actorName: 'Carla Souza' });
    expect(parts).toEqual([
      { text: 'Carla Souza', strong: true },
      { text: ' assumiu o chamado.', strong: false },
    ]);
    const assigned = caseEventSentence(t, {
      kind: 'assigned',
      at,
      actorName: 'Diego Reis',
      targetName: 'Carla Souza',
    });
    expect(assigned.parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'Diego Reis',
    ]);
    expect(assigned.parts.map((part) => part.text).join('')).toBe(assigned.text);
  });

  it('3. the automatic close has no actor and its own sentence', () => {
    const auto = caseEventSentence(t, { kind: 'closed', at, fromState: 'resolved' });
    expect(auto.text).toBe('O chamado foi fechado automaticamente após 7 dias resolvido.');
    expect(auto.parts.some((part) => part.strong)).toBe(false);
  });

  it('4. a team actor who left the tenant reads "Alguém da equipe" (A-12.4-ACTOR-GONE)', () => {
    expect(sentence({ kind: 'taken', at })).toBe('Alguém da equipe assumiu o chamado.');
    expect(sentence({ kind: 'resolved', at })).toBe('Alguém da equipe marcou como resolvido.');
    // A close with no actor is the automatic one unless the host says the actor is gone.
    expect(sentence({ kind: 'closed', at, actorGone: true })).toBe(
      'Alguém da equipe fechou o chamado.',
    );
    expect(sentence({ kind: 'assigned', at, actorName: 'Diego Reis' })).toBe(
      'Diego Reis atribuiu o chamado a Alguém da equipe.',
    );
  });

  it('5. a member who left reads "Membro removido" in the member slots', () => {
    expect(sentence({ kind: 'opened', at })).toBe('Membro removido abriu o chamado.');
    expect(sentence({ kind: 'reopened', at, byMember: true })).toBe(
      'Membro removido respondeu e o chamado foi reaberto.',
    );
  });

  it('6. the member reply that reopens has its own sentence', () => {
    expect(sentence({ kind: 'reopened', at, actorName: 'Ana Souza', byMember: true })).toBe(
      'Ana Souza respondeu e o chamado foi reaberto.',
    );
  });

  it('7. an edit names the field: the category and the priority with their words, the subject alone', () => {
    expect(
      sentence({
        kind: 'edited',
        at,
        actorName: 'Carla Souza',
        field: 'category',
        from: 'account',
        to: 'payment',
      }),
    ).toBe('Carla Souza mudou a categoria de Conta para Pagamento.');
    expect(
      sentence({
        kind: 'edited',
        at,
        actorName: 'Carla Souza',
        field: 'priority',
        from: 'normal',
        to: 'high',
      }),
    ).toBe('Carla Souza mudou a prioridade de Normal para Alta.');
    expect(
      sentence({
        kind: 'edited',
        at,
        actorName: 'Carla Souza',
        field: 'subject',
        from: 'a',
        to: 'b',
      }),
    ).toBe('Carla Souza mudou o assunto.');
  });

  it('8. a name carrying the split markers cannot forge a bold run', () => {
    const { parts } = caseEventSentence(t, {
      kind: 'taken',
      at,
      actorName: '\uE000Fake\uE001 Name',
    });
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual(['Fake Name']);
  });
});

describe('12.4-11 — caseCardView, the "Meus chamados" card (UI-D-821)', () => {
  const now = at('2026-10-01T01:30:00Z');
  const keys = tenantDayKeys(now, SP);

  function card(overrides: Partial<CaseCard> = {}): CaseCard {
    return {
      ...memberCase({ state: 'resolved', category: 'events' }),
      lastMessage: { preview: 'Obrigada!', side: 'member' },
      lastMessageAt: '2026-10-01T01:10:00Z',
      ...overrides,
    };
  }

  it('1. the finished card: number, state, subject, own-prefixed preview, category and tenant time', () => {
    expect(caseCardView(card(), { timeZone: SP, keys, t })).toEqual({
      id: CASE_ID,
      href: `/suporte/${CASE_ID}`,
      number: 42,
      title: 'Chamado #42',
      state: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
      subject: 'Cobrança duplicada',
      hasSubject: true,
      preview: 'Você: Obrigada!',
      category: 'Eventos',
      time: '22:10',
      closed: false,
    });
  });

  it('2. a team message previews with "Equipe: " and a closed case is marked closed', () => {
    const view = caseCardView(
      card({
        state: 'closed',
        lastMessage: { preview: 'Resolvido por aqui', side: 'staff' },
        lastMessageAt: '2026-09-20T15:00:00Z',
      }),
      { timeZone: SP, keys, t },
    );
    expect(view.preview).toBe('Equipe: Resolvido por aqui');
    expect(view.closed).toBe(true);
    expect(view.time).toBe('20/09');
  });

  it('3. a case with no typed subject shows its label, flagged so the card renders it in regular weight', () => {
    const view = caseCardView(card({ subject: null, subjectLabel: 'Não consigo entrar…' }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(view.subject).toBe('Não consigo entrar…');
    expect(view.hasSubject).toBe(false);
  });

  it('4. no message yet: an empty preview and the opening instant as the time', () => {
    const view = caseCardView(
      card({ lastMessage: null, lastMessageAt: null, openedAt: '2026-10-01T01:00:00Z' }),
      { timeZone: SP, keys, t },
    );
    expect(view.preview).toBe('');
    expect(view.time).toBe('22:00');
  });

  it('5. a newline in the preview is one line, and a member-shaped card carries no staff fact', () => {
    const view = caseCardView(card({ lastMessage: { preview: 'a\nb', side: 'member' } }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(view.preview).toBe('Você: a b');
    expect(view).not.toHaveProperty('priority');
    expect(view).not.toHaveProperty('ownerName');
  });
});

// The server helper `firstNameOf` lives in packages/modules/chat/server/first-name.ts and the web
// cannot import it (boundaries: apps/web stays inside its package). The two twins agree through
// ONE golden table: this test and packages/modules/chat/tests/first-name.test.ts assert the same
// input to output pairs.
describe('12.4-11 — firstNameOf agrees with the server helper through a shared golden table (D-222)', () => {
  const GOLDEN: [string | null | undefined, string][] = [
    ['Carla Rocha', 'Carla'],
    ['Ana Carolina Albuquerque de Vasconcellos', 'Ana'],
    ['  Íris   Muñoz ', 'Íris'],
    ['Bruno\tLima', 'Bruno'],
    ['Sofia\nD’Ávila', 'Sofia'],
    ['Carla', 'Carla'],
    ["D'Ávila", "D'Ávila"],
    ['', ''],
    ['   \n ', ''],
    [null, ''],
    [undefined, ''],
    ['Zoë\u00A0Lima', 'Zoë'],
    ['\u3000Yuki Tanaka', 'Yuki'],
  ];

  it.each(GOLDEN.map(([name, first]) => [JSON.stringify(name), name, first] as const))(
    '%s',
    (_label, name, first) => {
      expect(firstNameOf(name)).toBe(first);
    },
  );
});

describe('12.4-11 — the inbox row gains the case facts as finished strings (UI-D-824)', () => {
  const keys = tenantDayKeys(at('2026-10-01T01:30:00Z'), SP);
  const base = (): InboxRow =>
    ({
      conversationId: CASE_ID,
      member: {
        membershipId: OWNER_ID,
        displayName: 'Ana Souza',
        avatarAssetId: null,
        state: 'active',
      },
      lastMessage: {
        seq: 3,
        preview: 'Quero trocar meu e-mail.',
        side: 'member',
        authorFirstName: null,
      },
      lastMessageAt: '2026-09-30T17:02:00Z',
      awaiting: true,
    }) as InboxRow;
  const inbox = (kase: NonNullable<InboxRow['case']>): InboxRow => ({ ...base(), case: kase });
  const kase = (overrides: Partial<NonNullable<InboxRow['case']>> = {}) => ({
    number: 42,
    state: 'open' as const,
    subjectLabel: 'Cobrança duplicada',
    category: 'payment' as const,
    priority: 'high' as const,
    ownerName: null,
    ownerIsViewer: false,
    ...overrides,
  });

  it('1. an unowned open case with Alta priority', () => {
    const view = inboxRowView(inbox(kase()), { timeZone: SP, keys, t });
    expect(view.case).toEqual({
      number: 42,
      subjectLine: '#42 · Cobrança duplicada',
      state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
      priority: { priority: 'high', label: 'Alta', tone: 'danger', pill: true },
      meta: 'Pagamento · Sem responsável',
    });
  });

  it('2. Normal priority draws no pill; Baixa draws a neutral one', () => {
    const normal = inboxRowView(inbox(kase({ priority: 'normal' })), { timeZone: SP, keys, t });
    expect(normal.case?.priority).toBeNull();
    const low = inboxRowView(inbox(kase({ priority: 'low' })), { timeZone: SP, keys, t });
    expect(low.case?.priority).toMatchObject({ label: 'Baixa', tone: 'neutral' });
  });

  it('3. an owned case reads "Com {first name}" and the viewer\'s own reads "Com você"', () => {
    const owned = inboxRowView(inbox(kase({ state: 'in_progress', ownerName: 'Carla Souza' })), {
      timeZone: SP,
      keys,
      t,
    });
    expect(owned.case?.meta).toBe('Pagamento · Com Carla');
    expect(owned.case?.state.label).toBe('Em atendimento');
    const mine = inboxRowView(
      inbox(kase({ state: 'in_progress', ownerName: 'Carla Souza', ownerIsViewer: true })),
      { timeZone: SP, keys, t },
    );
    expect(mine.case?.meta).toBe('Pagamento · Com você');
  });

  it('4. the previous API (no case key) gives a row with no case facts, and the old fields stay', () => {
    const view = inboxRowView(base(), { timeZone: SP, keys, t });
    expect(view.case).toBeNull();
    expect(view).toMatchObject({ name: 'Ana Souza', preview: 'Quero trocar meu e-mail.' });
  });
});

describe('reconcileInboxPage (WR-01): what a fresh page 1 replaces', () => {
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const instant = (minute: number) => `2026-09-30T17:${String(minute).padStart(2, '0')}:00.000000Z`;
  const r = (n: number, minute: number | null, preview = `p${n}`) => ({
    conversationId: ID(n),
    lastMessageAt: minute === null ? null : instant(minute),
    preview,
  });
  const ids = (rows: readonly { conversationId: string }[]) =>
    rows.map((row) => Number(row.conversationId.slice(-12)));

  it('holding only page 1: the list is exactly the fresh page, in its order, a row in both once', () => {
    const current = [r(1, 50), r(2, 40), r(3, 30)];
    const fresh = [r(1, 55, 'novo'), r(3, 30, 'novo3')];
    const out = reconcileInboxPage(current, fresh, { holdsOnlyPage1: true, hasMore: true });
    expect(out.whole).toBe(true);
    expect(ids(out.items)).toEqual([1, 3]);
    expect(out.items[0]?.preview).toBe('novo');
  });

  it('the answer ends the view: whole, even with several pages loaded', () => {
    const current = [r(1, 50), r(2, 40), r(3, 30), r(4, 20)];
    const fresh = [r(2, 41)];
    const out = reconcileInboxPage(current, fresh, { holdsOnlyPage1: false, hasMore: false });
    expect(out.whole).toBe(true);
    expect(ids(out.items)).toEqual([2]);
  });

  it('an empty fresh answer empties the list and is whole', () => {
    const out = reconcileInboxPage([r(1, 50), r(2, 40)], [], {
      holdsOnlyPage1: false,
      hasMore: true,
    });
    expect(out).toEqual({ items: [], whole: true });
  });

  it('an empty current returns the fresh page', () => {
    const fresh = [r(1, 50), r(2, 40)];
    const out = reconcileInboxPage([], fresh, { holdsOnlyPage1: false, hasMore: true });
    expect(ids(out.items)).toEqual([1, 2]);
  });

  it('several pages, the page does not end the view: rows the fresh page covers but lacks are dropped, deeper ones stay', () => {
    // Loaded r1..r6 (newest first). Fresh page 1: r2 (moved up), r1, r4. r3 sorts before r4 (the tail): gone.
    const current = [r(1, 60), r(2, 50), r(3, 40), r(4, 30), r(5, 20), r(6, 10)];
    const fresh = [r(2, 61, 'novo2'), r(1, 60), r(4, 30)];
    const out = reconcileInboxPage(current, fresh, { holdsOnlyPage1: false, hasMore: true });
    expect(out.whole).toBe(false);
    expect(ids(out.items)).toEqual([2, 1, 4, 5, 6]);
    expect(out.items[0]?.preview).toBe('novo2');
  });

  it('equal instants: a smaller id sorts after the tail and is kept, a larger id sorts before and is dropped', () => {
    const tail = r(5, 30);
    const smaller = r(4, 30);
    const larger = r(6, 30);
    const out = reconcileInboxPage([larger, tail, smaller], [tail], {
      holdsOnlyPage1: false,
      hasMore: true,
    });
    expect(ids(out.items)).toEqual([5, 4]);
  });

  it('a null instant sorts first: an absent null row is dropped, two null instants order by id descending', () => {
    const tail = r(2, 30);
    const out = reconcileInboxPage([r(7, null), r(1, null), tail, r(3, 20)], [r(9, null), tail], {
      holdsOnlyPage1: false,
      hasMore: true,
    });
    expect(ids(out.items)).toEqual([9, 2, 3]);
    // Two null instants: the larger id sorts first, so with the tail null the smaller id is kept.
    const nullTail = r(5, null);
    const out2 = reconcileInboxPage([r(6, null), nullTail, r(4, null)], [nullTail], {
      holdsOnlyPage1: false,
      hasMore: true,
    });
    expect(ids(out2.items)).toEqual([5, 4]);
  });

  it('never mutates its inputs', () => {
    const current = [r(1, 50), r(2, 40), r(3, 30)];
    const fresh = [r(2, 41), r(1, 50)];
    const a = JSON.stringify(current);
    const b = JSON.stringify(fresh);
    reconcileInboxPage(current, fresh, { holdsOnlyPage1: false, hasMore: true });
    reconcileInboxPage(current, fresh, { holdsOnlyPage1: true, hasMore: true });
    expect(JSON.stringify(current)).toBe(a);
    expect(JSON.stringify(fresh)).toBe(b);
  });
});
