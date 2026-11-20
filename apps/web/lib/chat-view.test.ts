import { fileURLToPath } from 'node:url';
import type {
  CaseCard,
  DirectDetail,
  DirectListRow,
  DirectSupportSummary,
  DirectWithAnswer,
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
  composerStateView,
  conversationRowView,
  directDetailView,
  directWithView,
  firstNameOf,
  formatVoiceDuration,
  inboxRowView,
  inboxTime,
  nextPlaybackRate,
  playbackRateLabel,
  reconcileInboxPage,
  spokenVoiceDuration,
  supportRowView,
  tenantDayKeys,
  voiceDeletedText,
  voicePreviewText,
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

  it('7b. a direct conversation: the member-side row the viewer did not write is the OTHER bubble (11-22, D-720)', () => {
    const theirs = chatMessageView(row({ authorIsViewer: false }), {
      timeZone: SP,
      viewer: 'member',
      t,
    });
    expect(theirs.side).toBe('other');
    expect(theirs.label).toBeNull();
    expect(theirs.authorKey).toBe('member:other');
    const mine = chatMessageView(row({ authorIsViewer: true }), {
      timeZone: SP,
      viewer: 'member',
      t,
    });
    expect(mine.side).toBe('own');
    expect(mine.authorKey).toBe('member');
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
      previewKind: 'text',
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

describe('12.5-10 voice view functions — duration labels, spoken phrase and the voice message view (D-853, D-846)', () => {
  const MEDIA = '5e000000-0000-4000-8000-000000000001';

  it('1. formatVoiceDuration is m:ss with no leading zero on the minutes, clamped to 0..300 and rounded', () => {
    const table: [number, string][] = [
      [0, '0:00'],
      [1, '0:01'],
      [9, '0:09'],
      [59, '0:59'],
      [60, '1:00'],
      [61, '1:01'],
      [65, '1:05'],
      [300, '5:00'],
      [301, '5:00'],
      [9999, '5:00'],
      [-4, '0:00'],
      [41.6, '0:42'],
      [41.4, '0:41'],
      [Number.NaN, '0:00'],
    ];
    for (const [seconds, label] of table) expect(formatVoiceDuration(seconds)).toBe(label);
  });

  it('2. spokenVoiceDuration reads the length for a screen reader, and 5:00 is never "e 0 segundo" (sketch 024 #2)', () => {
    const table: [number, string][] = [
      [0, '0 segundos'],
      [1, '1 segundo'],
      [42, '42 segundos'],
      [59, '59 segundos'],
      [60, '1 minuto'],
      [61, '1 minuto e 1 segundo'],
      [65, '1 minuto e 5 segundos'],
      [120, '2 minutos'],
      [125, '2 minutos e 5 segundos'],
      [300, '5 minutos'],
    ];
    for (const [seconds, words] of table) expect(spokenVoiceDuration(seconds, t)).toBe(words);
    expect(spokenVoiceDuration(300, t)).not.toMatch(/e 0/);
  });

  it('3. the preview and the deleted words come from the catalog', () => {
    expect(voicePreviewText(42, t)).toBe('Mensagem de voz · 0:42');
    expect(voicePreviewText(300, t)).toBe('Mensagem de voz · 5:00');
    expect(voiceDeletedText(t)).toBe('Mensagem de voz apagada');
  });

  it('4. a voice API row becomes a finished view with its length, for each viewer; body stays empty', () => {
    const voiceRow = (overrides: Partial<MessageRow> = {}) =>
      row({ body: '', voice: { mediaId: MEDIA, durationSeconds: 42 }, ...overrides });
    for (const viewer of ['member', 'staff'] as const) {
      const view = chatMessageView(voiceRow(), { timeZone: SP, viewer, t });
      expect(view.body).toBe('');
      expect(view.voice).toEqual({
        mediaId: MEDIA,
        durationSeconds: 42,
        durationLabel: '0:42',
        spokenLabel: '42 segundos',
      });
      expect(view).toMatchObject({ side: viewer === 'member' ? 'own' : 'other', time: '14:00' });
    }
    const staffVoice = chatMessageView(
      staffRow({ body: '', voice: { mediaId: MEDIA, durationSeconds: 65 } }),
      { timeZone: SP, viewer: 'member', t },
    );
    expect(staffVoice.label).toEqual({
      firstName: 'Carla',
      srSuffix: ', da equipe',
      icon: 'shield',
    });
    expect(staffVoice.voice).toMatchObject({
      durationLabel: '1:05',
      spokenLabel: '1 minuto e 5 segundos',
    });
  });

  it('5. a deleted recording says so, and the voice view has exactly the documented keys (no URL, file name or mime)', () => {
    const view = chatMessageView(
      row({ body: '', voice: { mediaId: MEDIA, durationSeconds: 42, deleted: true } }),
      { timeZone: SP, viewer: 'staff', t },
    );
    expect(view.voice?.deleted).toBe(true);
    expect(Object.keys(view.voice ?? {}).sort()).toEqual(
      ['deleted', 'durationLabel', 'durationSeconds', 'mediaId', 'spokenLabel'].sort(),
    );
    const live = chatMessageView(
      row({ body: '', voice: { mediaId: MEDIA, durationSeconds: 42 } }),
      {
        timeZone: SP,
        viewer: 'staff',
        t,
      },
    );
    expect(live.voice).not.toHaveProperty('deleted');
    expect(Object.keys(live.voice ?? {}).sort()).toEqual(
      ['durationLabel', 'durationSeconds', 'mediaId', 'spokenLabel'].sort(),
    );
  });

  it('6. a text row has no voice key and the same keys as before', () => {
    const view = chatMessageView(row(), { timeZone: SP, viewer: 'member', t });
    expect(view).not.toHaveProperty('voice');
    expect(Object.keys(view).sort()).toEqual(
      ['authorKey', 'body', 'createdAtMs', 'dayKey', 'id', 'label', 'seq', 'side', 'time'].sort(),
    );
  });
});

describe('12.5-10 voice previews and rates (D-860, D-868, D-854)', () => {
  const keys = tenantDayKeys(at('2026-10-01T01:30:00Z'), SP);
  const voiceMessage = (side: 'member' | 'staff', extra: Record<string, unknown> = {}) => ({
    seq: 4,
    preview: '',
    side,
    authorFirstName: side === 'staff' ? 'Ana' : null,
    ...extra,
  });
  const inbox = (lastMessage: InboxRow['lastMessage']) =>
    inboxRowView(inboxRow({ lastMessage }), { timeZone: SP, keys, t });

  it('1. an inbox voice preview carries the shipped prefixes and the kind the glyph reads', () => {
    const team = inbox(voiceMessage('staff', { voiceSeconds: 42 }));
    expect(team).toMatchObject({ preview: 'Ana: Mensagem de voz · 0:42', previewKind: 'voice' });
    const member = inbox(voiceMessage('member', { voiceSeconds: 42 }));
    expect(member).toMatchObject({ preview: 'Mensagem de voz · 0:42', previewKind: 'voice' });
    const gone = inbox(voiceMessage('staff', { voiceSeconds: 42, authorFirstName: '' }));
    expect(gone.preview).toBe('Mensagem de voz · 0:42');
  });

  it('2. a deleted recording previews with no duration, the team prefix still applies', () => {
    const member = inbox(voiceMessage('member', { voiceDeleted: true }));
    expect(member).toMatchObject({
      preview: 'Mensagem de voz apagada',
      previewKind: 'voiceDeleted',
    });
    const team = inbox(voiceMessage('staff', { voiceSeconds: 42, voiceDeleted: true }));
    expect(team).toMatchObject({
      preview: 'Ana: Mensagem de voz apagada',
      previewKind: 'voiceDeleted',
    });
  });

  it('3. a text row is unchanged and has the text kind; a row with no message has the text kind and no words', () => {
    const text = inbox({ seq: 3, preview: 'Oi', side: 'member', authorFirstName: null });
    expect(text).toMatchObject({ preview: 'Oi', previewKind: 'text' });
    const none = inboxRowView(inboxRow({ lastMessage: null, lastMessageAt: null }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(none).toMatchObject({ preview: '', previewKind: 'text' });
  });

  it('4. the card previews "Você: " and "Equipe: " with the voice words, and the deleted variant', () => {
    const base = memberCase({ state: 'open', category: 'events' });
    const card = (lastMessage: CaseCard['lastMessage']): CaseCard => ({
      ...base,
      lastMessage,
      lastMessageAt: '2026-10-01T01:10:00Z',
    });
    const own = caseCardView(card({ preview: '', side: 'member', voiceSeconds: 42 }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(own).toMatchObject({ preview: 'Você: Mensagem de voz · 0:42', previewKind: 'voice' });
    const team = caseCardView(card({ preview: '', side: 'staff', voiceSeconds: 42 }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(team.preview).toBe('Equipe: Mensagem de voz · 0:42');
    const gone = caseCardView(card({ preview: '', side: 'member', voiceDeleted: true }), {
      timeZone: SP,
      keys,
      t,
    });
    expect(gone).toMatchObject({
      preview: 'Você: Mensagem de voz apagada',
      previewKind: 'voiceDeleted',
    });
    const text = caseCardView(card({ preview: 'Oi', side: 'member' }), { timeZone: SP, keys, t });
    expect(text.previewKind).toBe('text');
    const empty = caseCardView(card(null), { timeZone: SP, keys, t });
    expect(empty).toMatchObject({ preview: '', previewKind: 'text' });
  });

  it('5. the speed cycle is 1, 1.5, 2, 1 and any unknown value restarts at 1', () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
    expect(nextPlaybackRate(0.75)).toBe(1);
    expect(nextPlaybackRate(Number.NaN)).toBe(1);
    expect(nextPlaybackRate(undefined)).toBe(1);
  });

  it('6. the speed labels use the pt-BR decimal comma', () => {
    expect(playbackRateLabel(1, t)).toBe('1x');
    expect(playbackRateLabel(1.5, t)).toBe('1,5x');
    expect(playbackRateLabel(2, t)).toBe('2x');
    expect(playbackRateLabel(0.75, t)).toBe('1x');
  });
});

describe('12.5-10 voice catalog guard rails (UI-D-840, UI-D-856, D-850, D-852, D-868)', () => {
  const messages = loadMessages(catalogDir) as { chat: { voice: Record<string, unknown> } };
  const voice = messages.chat.voice;

  const leaves = (node: unknown, path: string): [string, string][] => {
    if (typeof node === 'string') return [[path, node]];
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
    }
    return [[path, String(node)]];
  };
  const all = leaves(voice, 'voice');

  it('1. every leaf of the voice subtree is a non-empty string', () => {
    expect(all.length).toBe(44);
    for (const [path, text] of all) {
      expect(typeof text, path).toBe('string');
      expect(text.trim().length, path).toBeGreaterThan(0);
    }
  });

  it('2. none of the forbidden words appears, and "áudio" only in the unsupported sentence', () => {
    const forbidden = [
      /nota de voz/i,
      /\bPTT\b/i,
      /segure/i,
      /arraste/i,
      /ouvir antes/i,
      /transcri[çc][ãa]o/i,
      /\blido\b/i,
      /\bouvido\b/i,
    ];
    for (const [path, text] of all) {
      for (const word of forbidden) expect(text, `${path} ${word}`).not.toMatch(word);
    }
    const withAudio = all.filter(([, text]) => /[áa]udio/i.test(text)).map(([path]) => path);
    expect(withAudio).toEqual(['voice.player.unsupported']);
  });

  it('3. every placeholder is one of the documented set', () => {
    const documented = new Set([
      'minutes',
      'seconds',
      'count',
      'percent',
      'rate',
      'duration',
      'current',
      'total',
      'spoken',
    ]);
    for (const [path, text] of all) {
      for (const match of text.matchAll(/\{(\w+)(?:,|\})/g)) {
        expect(documented.has(match[1] ?? ''), `${path} {${match[1]}}`).toBe(true);
      }
    }
  });

  it('4. the plurals read 0, 1 and many right (the pt-BR plural rule reads zero as singular)', () => {
    expect(t('voice.spokenSeconds', { seconds: 0 })).toBe('0 segundos');
    expect(t('voice.spokenSeconds', { seconds: 1 })).toBe('1 segundo');
    expect(t('voice.spokenSeconds', { seconds: 42 })).toBe('42 segundos');
    expect(t('voice.spokenMinutes', { minutes: 1 })).toBe('1 minuto');
    expect(t('voice.spokenMinutes', { minutes: 5 })).toBe('5 minutos');
    expect(t('voice.spoken', { minutes: 1, seconds: 1 })).toBe('1 minuto e 1 segundo');
    expect(t('voice.spoken', { minutes: 2, seconds: 5 })).toBe('2 minutos e 5 segundos');
    expect(t('voice.spoken', { minutes: 0, seconds: 42 })).toBe('42 segundos');
    expect(t('voice.live.minute', { count: 1 })).toBe('1 minuto de gravação.');
    expect(t('voice.live.minute', { count: 2 })).toBe('2 minutos de gravação.');
    expect(t('voice.live.minute', { count: 4 })).toBe('4 minutos de gravação.');
  });

  it('5. the group name, the live rate, the seek value and the upload progress fill their placeholders', () => {
    expect(t('voice.group', { spoken: '42 segundos' })).toBe('Mensagem de voz, 42 segundos');
    expect(t('voice.live.rate', { rate: '1,5x' })).toBe('Velocidade 1,5x.');
    expect(t('voice.player.speed', { rate: '2x' })).toBe('Velocidade de reprodução: 2x');
    expect(t('voice.player.seekValue', { current: '0:12', total: '4:59' })).toBe('0:12 de 4:59');
    expect(t('voice.upload.progress', { percent: 62 })).toBe('Enviando… 62%');
  });

  it('6. the microphone problems, the notices and the recording words equal the UI-SPEC copy table', () => {
    expect({
      message: t('voice.message'),
      deleted: t('voice.deleted'),
      mic: [t('voice.mic.label'), t('voice.mic.requesting')],
      recording: [
        t('voice.recording.status'),
        t('voice.recording.timer'),
        t('voice.recording.discard'),
        t('voice.recording.send'),
        t('voice.recording.sendNew'),
        t('voice.recording.limitWord'),
        t('voice.recording.interruptedWord'),
      ],
      notice: [
        t('voice.notice.warning'),
        t('voice.notice.limit'),
        t('voice.notice.interrupted'),
        t('voice.notice.tooShort'),
      ],
      problem: [
        t('voice.problem.blocked'),
        t('voice.problem.missing'),
        t('voice.problem.busy'),
        t('voice.problem.failed'),
      ],
      live: [t('voice.live.started'), t('voice.live.discarded')],
      player: [
        t('voice.player.play'),
        t('voice.player.pause'),
        t('voice.player.seek'),
        t('voice.player.loading'),
        t('voice.player.error'),
        t('voice.player.unsupported'),
      ],
      rate: [t('voice.rate.one'), t('voice.rate.oneHalf'), t('voice.rate.two')],
      upload: t('voice.upload.label'),
      failed: [t('voice.failed.retriable'), t('voice.failed.permanent'), t('voice.failed.discard')],
    }).toEqual({
      message: 'Mensagem de voz',
      deleted: 'Mensagem de voz apagada',
      mic: ['Gravar mensagem de voz', 'Aguardando permissão do microfone'],
      recording: [
        'Gravando',
        'Tempo de gravação',
        'Descartar gravação',
        'Enviar mensagem de voz',
        'Abrir chamado com a mensagem de voz',
        'Limite atingido',
        'Interrompida',
      ],
      notice: [
        'Faltam 30 segundos para o limite de 5 minutos.',
        'Você chegou ao limite de 5 minutos. Envie ou descarte a gravação.',
        'A gravação foi interrompida. Envie o que foi gravado ou descarte.',
        'A gravação ficou muito curta e foi descartada. Toque no microfone e fale de novo.',
      ],
      problem: [
        'O acesso ao microfone está bloqueado. Libere nas configurações e toque no microfone de novo. Você também pode escrever sua mensagem.',
        'Não encontramos um microfone neste aparelho. Você pode escrever sua mensagem.',
        'O microfone está em uso por outro app. Feche-o e tente de novo.',
        'Não foi possível gravar. Tente de novo.',
      ],
      live: ['Gravando.', 'Gravação descartada.'],
      player: [
        'Tocar mensagem de voz',
        'Pausar mensagem de voz',
        'Posição da mensagem de voz',
        'Carregando mensagem de voz',
        'Não foi possível carregar a mensagem de voz.',
        'Este aparelho não toca este tipo de áudio.',
      ],
      rate: ['1x', '1,5x', '2x'],
      upload: 'Enviando mensagem de voz',
      failed: [
        'Não foi possível enviar.',
        'Não foi possível enviar esta mensagem de voz. Escreva sua mensagem.',
        'Descartar',
      ],
    });
  });
});

describe('12.5-15 chatRuns with recordings and the member-side blocked sentence', () => {
  const keys = { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' };
  const base = (over: Partial<ChatMessageView>): ChatMessageView => ({
    id: 'v-1',
    seq: 1,
    side: 'own',
    authorKey: 'member',
    body: '',
    label: null,
    time: '10:00',
    dayKey: '2026-11-17',
    createdAtMs: at('2026-11-17T10:00:00Z'),
    voice: { mediaId: 'm-1', durationSeconds: 3, durationLabel: '0:03', spokenLabel: '3 segundos' },
    ...over,
  });
  const ready = { status: 'deleted', text: 'voice-sentinel' } as const;

  it('1. a view with a recording gets the mapper voice props and no body; a text view is unchanged', () => {
    const items = chatRuns(
      [base({}), base({ id: 't-1', seq: 2, body: 'oi', voice: undefined })],
      keys,
      words,
      (view) => (view.voice ? ready : undefined),
    );
    const messages = items.filter((item) => item.kind === 'message');
    expect(messages[0]).toMatchObject({ key: 'v-1', voice: ready });
    expect(messages[0]).not.toHaveProperty('body');
    expect(messages[1]).toMatchObject({ key: 't-1', body: 'oi' });
    expect(messages[1]).not.toHaveProperty('voice');
  });

  it('2. without a mapper a recording is drawn exactly as before (an empty text bubble)', () => {
    const items = chatRuns([base({})], keys, words);
    expect(items.at(-1)).toMatchObject({ key: 'v-1', body: '' });
  });

  it('3. a pending recording carries its percent in the footer only when it has one', () => {
    const voiceProgress = (percent: number) => `Enviando… ${percent}%`;
    const pending = (id: string, percent: number | null) =>
      base({ id, seq: 0, pending: true, voiceUpload: { percent } });
    const items = chatRuns(
      [pending('p-1', 62), pending('p-2', null), pending('p-3', 0)],
      keys,
      { ...words, voiceProgress },
      () => ready,
    );
    const footers = items.flatMap((item) =>
      item.kind === 'message' ? [(item as { pendingLabel?: string }).pendingLabel] : [],
    );
    expect(footers).toEqual(['Enviando… 62%', 'Enviando…', 'Enviando… 0%']);
    for (const item of items) expect(item).toMatchObject({ pending: true });
  });

  it('4. a failed recording keeps its place at the end but is not in flight', () => {
    const items = chatRuns(
      [base({ id: 'p-1', seq: 0, pending: true, voiceFailed: 'retriable' })],
      keys,
      words,
      () => ready,
    );
    const failed = items.at(-1);
    expect(failed).toMatchObject({ key: 'p-1' });
    expect(failed).not.toHaveProperty('pending');
  });

  it("5. the member-side blocked sentence is exactly Igor's words and has no placeholder", () => {
    expect(t('blocked.memberNotice')).toBe('Você não pode enviar mensagens neste chat.');
    // The sentence the team reads stays the shipped one.
    expect(t('blocked.notice', { name: 'Marina Costa' })).toBe(
      'Marina Costa está bloqueado. A conversa fica disponível só para leitura.',
    );
  });
});

/**
 * Phase 11-18 (CHAT-06, D-719, UI-D-862, UI-D-866) — the Conversas rows as FINISHED views. The real
 * catalog, the real translator, a fixed clock: nothing here reads the system time.
 */
describe('conversationRowView (UI-D-866)', () => {
  const NOW = at('2026-11-17T20:00:00Z');
  const ctx = () => ({ timeZone: SP, keys: tenantDayKeys(NOW, SP), t });
  const ID = '0d000000-0000-4000-8000-000000000001';
  const MEMBER = '0e000000-0000-4000-8000-000000000001';
  const AVATAR = '0f000000-0000-4000-8000-000000000001';

  function directRow(overrides: Partial<DirectListRow> = {}): DirectListRow {
    return {
      conversationId: ID,
      other: {
        membershipId: MEMBER,
        displayName: 'Ana Lima',
        avatarAssetId: AVATAR,
        removed: false,
      },
      lastPreview: { kind: 'text', text: 'Oi, tudo bem?', own: false },
      lastMessageAt: '2026-11-17T17:30:00.000000Z',
      unreadCount: 0,
      ...overrides,
    };
  }

  it('1. the other member text carries NO prefix, the own text carries "Você: "', () => {
    expect(conversationRowView(directRow(), ctx())).toMatchObject({
      preview: 'Oi, tudo bem?',
      previewKind: 'text',
    });
    expect(
      conversationRowView(
        directRow({ lastPreview: { kind: 'text', text: 'Oi, tudo bem?', own: true } }),
        ctx(),
      ),
    ).toMatchObject({ preview: 'Você: Oi, tudo bem?', previewKind: 'text' });
  });

  it('2. a recording reads "Mensagem de voz · 0:42" with the voice kind, with the same prefix rule', () => {
    const voice = (own: boolean) =>
      directRow({ lastPreview: { kind: 'voice', durationSeconds: 42, own } });
    expect(conversationRowView(voice(false), ctx())).toMatchObject({
      preview: 'Mensagem de voz · 0:42',
      previewKind: 'voice',
    });
    expect(conversationRowView(voice(true), ctx())).toMatchObject({
      preview: 'Você: Mensagem de voz · 0:42',
      previewKind: 'voice',
    });
  });

  it('3. a retired recording says so with the deleted kind and never prints its length', () => {
    const view = conversationRowView(
      directRow({
        lastPreview: { kind: 'voice', durationSeconds: 42, own: false, deleted: true },
      }),
      ctx(),
    );
    expect(view).toMatchObject({ preview: 'Mensagem de voz apagada', previewKind: 'voiceDeleted' });
    expect(JSON.stringify(view)).not.toContain('0:42');
  });

  it('4. a removed member reads "Membro removido" with no avatar and no profile link', () => {
    const view = conversationRowView(
      directRow({
        other: { membershipId: null, displayName: null, avatarAssetId: null, removed: true },
      }),
      ctx(),
    );
    expect(view).toMatchObject({
      name: 'Membro removido',
      removed: true,
      avatar: null,
      profileHref: null,
      href: `/conversas/${ID}`,
    });
  });

  it('5. a live member keeps the name, the photo and the profile link', () => {
    const view = conversationRowView(directRow(), ctx());
    expect(view.name).toBe('Ana Lima');
    expect(view.removed).toBe(false);
    expect(view.avatar).toContain(AVATAR);
    expect(view.profileHref).toBe(`/membros/${MEMBER}`);
  });

  it.each([
    [0, null, 'Ana Lima. Oi'],
    [1, { count: 1, text: '1' }, 'Ana Lima, 1 mensagem nova. Oi'],
    [3, { count: 3, text: '3' }, 'Ana Lima, 3 mensagens novas. Oi'],
    [99, { count: 99, text: '99' }, 'Ana Lima, 99 mensagens novas. Oi'],
    [100, { count: 100, text: '99+' }, 'Ana Lima, 100 mensagens novas. Oi'],
    [120, { count: 120, text: '99+' }, 'Ana Lima, 120 mensagens novas. Oi'],
  ])('6. unread %i prints %j and names the row "%s"', (unreadCount, unread, label) => {
    const view = conversationRowView(
      directRow({ unreadCount, lastPreview: { kind: 'text', text: 'Oi', own: false } }),
      ctx(),
    );
    expect(view.unread).toEqual(unread);
    expect(view.label).toBe(label);
  });

  it('7. the time is the tenant-zone inbox time (today HH:mm, yesterday, dd/MM)', () => {
    expect(conversationRowView(directRow(), ctx()).time).toBe('14:30');
    expect(
      conversationRowView(directRow({ lastMessageAt: '2026-11-16T17:30:00.000000Z' }), ctx()).time,
    ).toBe('Ontem');
    expect(
      conversationRowView(directRow({ lastMessageAt: '2026-10-12T17:30:00.000000Z' }), ctx()).time,
    ).toBe('12/10');
  });

  it('8. a name of combining marks and emoji passes through whole, never split', () => {
    const name = `${'A\u0301\u0323'.repeat(20)} 👩🏽‍💻 ${'Ñandú '.repeat(6)}`.trim();
    const view = conversationRowView(
      directRow({ other: { ...directRow().other, displayName: name } }),
      ctx(),
    );
    expect(view.name).toBe(name);
    expect(view.label.startsWith(`${name}.`)).toBe(true);
  });

  it('9. a message of only line breaks previews as one blank-safe line', () => {
    const view = conversationRowView(
      directRow({ lastPreview: { kind: 'text', text: '\n\n \r\n', own: false } }),
      ctx(),
    );
    expect(view.preview).toBe('');
    expect(view.preview).not.toMatch(/[\r\n]/);
    const own = conversationRowView(
      directRow({ lastPreview: { kind: 'text', text: '\n\n', own: true } }),
      ctx(),
    );
    expect(own.preview).not.toMatch(/[\r\n]/);
  });

  it('10. a multi-line text previews as one line, cut on graphemes and never mid-emoji', () => {
    const view = conversationRowView(
      directRow({ lastPreview: { kind: 'text', text: 'primeira\nsegunda', own: false } }),
      ctx(),
    );
    expect(view.preview).toBe('primeira segunda');
    const long = conversationRowView(
      directRow({ lastPreview: { kind: 'text', text: '👩🏽‍💻'.repeat(150), own: false } }),
      ctx(),
    );
    const segments = [
      ...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(long.preview),
    ];
    expect(segments.length).toBeLessThanOrEqual(100);
    expect(long.preview.endsWith('…')).toBe(true);
    expect(long.preview.replace('…', '').replaceAll('👩🏽‍💻', '')).toBe('');
  });
});

describe('supportRowView (UI-D-862)', () => {
  const tenant = 'Rede Demo';
  const view = (summary: DirectSupportSummary) => supportRowView(summary, { tenant, t });

  it('1. a member who never wrote reads the idle line and the dot stays off', () => {
    expect(view({ lastPreview: null, unread: false })).toEqual({
      name: 'Equipe Rede Demo',
      href: '/suporte',
      preview: 'Fale com a equipe de Rede Demo',
      previewKind: 'text',
      idle: true,
      unread: false,
      label: 'Equipe Rede Demo. Fale com a equipe de Rede Demo',
    });
  });

  it('2. the prefix is "Você: " for the own message and "Equipe: " for the team message', () => {
    expect(
      view({ lastPreview: { kind: 'text', text: 'Preciso de ajuda', own: true }, unread: false }),
    ).toMatchObject({ preview: 'Você: Preciso de ajuda', idle: false });
    expect(
      view({ lastPreview: { kind: 'text', text: 'Já verificamos.', own: false }, unread: false }),
    ).toMatchObject({ preview: 'Equipe: Já verificamos.' });
  });

  it('3. a recording keeps the voice kind and the prefix', () => {
    expect(
      view({
        lastPreview: { kind: 'voice', durationSeconds: 42, own: false },
        unread: false,
      }),
    ).toMatchObject({ preview: 'Equipe: Mensagem de voz · 0:42', previewKind: 'voice' });
    expect(
      view({
        lastPreview: { kind: 'voice', durationSeconds: 7, own: true, deleted: true },
        unread: false,
      }),
    ).toMatchObject({ preview: 'Você: Mensagem de voz apagada', previewKind: 'voiceDeleted' });
  });

  it('4. unread is a flag (never a count) and adds ", mensagem nova" to the name', () => {
    const unread = view({
      lastPreview: { kind: 'text', text: 'Já verificamos.', own: false },
      unread: true,
    });
    expect(unread.unread).toBe(true);
    expect(unread.label).toBe('Equipe Rede Demo. Equipe: Já verificamos., mensagem nova');
  });
});

/**
 * Phase 11-18 (CHAT-07, D-722, D-723, UI-D-865) — the composer area is ONE enum, finished. The `closed`
 * strip is the blocked member's whole experience of a block: one sentence, no name, no reason, no block
 * word (T-11-03).
 */
describe('composerStateView (UI-D-865)', () => {
  const live = { removed: false, displayName: 'Ana Lima' };
  const gone = { removed: true, displayName: null };

  it('1. open draws no strip', () => {
    expect(composerStateView('open', live, t)).toEqual({ state: 'open', strip: null });
  });

  it('2. closed is the one sentence with the lock glyph and role "status"', () => {
    expect(composerStateView('closed', live, t)).toEqual({
      state: 'closed',
      strip: {
        kind: 'closed',
        glyph: 'Lock',
        role: 'status',
        text: 'Esta conversa não aceita novas mensagens.',
        label: 'Esta conversa não aceita novas mensagens.',
        unblock: null,
      },
    });
  });

  it('3. the closed strip carries no name, no reason and no block word anywhere in its output', () => {
    const names = ['Ana Lima', 'Marina Costa Bloqueadora'];
    for (const displayName of names) {
      const out = JSON.stringify(composerStateView('closed', { removed: false, displayName }, t));
      expect(out).not.toContain(displayName);
      expect(out).not.toMatch(/bloque|motivo|denunci|desde|porque/i);
    }
    // every other field of the strip is a plain constant, the same for every conversation
    expect(composerStateView('closed', live, t)).toEqual(
      composerStateView('closed', { removed: false, displayName: 'Outra Pessoa' }, t),
    );
    expect(Object.keys(composerStateView('closed', live, t).strip ?? {}).sort()).toEqual([
      'glyph',
      'kind',
      'label',
      'role',
      'text',
      'unblock',
    ]);
  });

  it('4. the blocker reads "Você bloqueou {nome}" with the unblock button, its pending label and its toast', () => {
    expect(composerStateView('blocker', live, t)).toEqual({
      state: 'blocker',
      strip: {
        kind: 'blocker',
        glyph: 'Ban',
        role: 'status',
        text: 'Você bloqueou Ana Lima',
        label: 'Você bloqueou Ana Lima',
        unblock: {
          label: 'Desbloquear',
          pendingLabel: 'Desbloqueando…',
          toast: 'Ana Lima foi desbloqueado.',
        },
      },
    });
  });

  it('5. a removed account reads the read-only sentence', () => {
    expect(composerStateView('removed', gone, t)).toEqual({
      state: 'removed',
      strip: {
        kind: 'removed',
        glyph: 'Lock',
        role: 'status',
        text: 'Este membro não está mais na comunidade. A conversa fica só para leitura.',
        label: 'Este membro não está mais na comunidade. A conversa fica só para leitura.',
        unblock: null,
      },
    });
  });

  it('6. the precedence is removed, then blocker, then closed', () => {
    // an account that left wins over whatever the word says
    expect(composerStateView('blocker', gone, t).state).toBe('removed');
    expect(composerStateView('closed', gone, t).state).toBe('removed');
    expect(composerStateView('open', gone, t).state).toBe('removed');
    // the server's own word `removed` is trusted even when the flag lags
    expect(composerStateView('removed', live, t).state).toBe('removed');
    expect(composerStateView('blocker', live, t).state).toBe('blocker');
    expect(composerStateView('closed', live, t).state).toBe('closed');
  });

  it('7. the blocker strip names a member with no profile through the neutral word', () => {
    const view = composerStateView('blocker', { removed: false, displayName: null }, t);
    expect(view.strip?.text).toBe('Você bloqueou Membro removido');
  });

  it('8. a name of combining marks and emoji is placed whole in the blocker sentence', () => {
    const name = `${'A\u0301'.repeat(40)} 👩🏽‍💻`;
    expect(composerStateView('blocker', { removed: false, displayName: name }, t).strip?.text).toBe(
      `Você bloqueou ${name}`,
    );
  });
});

describe('directDetailView and directWithView (UI-D-864, UI-D-865)', () => {
  const MEMBER = '0e000000-0000-4000-8000-000000000001';
  const detail = (overrides: Partial<DirectDetail> = {}): DirectDetail => ({
    conversationId: '0d000000-0000-4000-8000-000000000001',
    other: { membershipId: MEMBER, displayName: 'Ana Lima', avatarAssetId: null, removed: false },
    composer: 'open',
    canBlock: true,
    lastSeq: 9,
    lastReadSeq: 4,
    ...overrides,
  });

  it('1. the detail is the other member, the finished state and the viewer positions', () => {
    expect(directDetailView(detail(), t)).toEqual({
      conversationId: '0d000000-0000-4000-8000-000000000001',
      other: {
        membershipId: MEMBER,
        name: 'Ana Lima',
        avatar: null,
        removed: false,
        profileHref: `/membros/${MEMBER}`,
      },
      state: 'open',
      strip: null,
      canBlock: true,
      lastSeq: 9,
      lastReadSeq: 4,
    });
  });

  it('2. the blocked member reads the closed strip and no "blocked me" field exists in the view', () => {
    const view = directDetailView(detail({ composer: 'closed', canBlock: false }), t);
    expect(view.state).toBe('closed');
    expect(view.strip?.text).toBe('Esta conversa não aceita novas mensagens.');
    expect(Object.keys(view).sort()).toEqual([
      'canBlock',
      'conversationId',
      'lastReadSeq',
      'lastSeq',
      'other',
      'state',
      'strip',
    ]);
  });

  it('3. a removed account has the neutral name, no link and the read-only strip', () => {
    const view = directDetailView(
      detail({
        composer: 'removed',
        canBlock: false,
        other: { membershipId: null, displayName: null, avatarAssetId: null, removed: true },
      }),
      t,
    );
    expect(view.other).toEqual({
      membershipId: null,
      name: 'Membro removido',
      avatar: null,
      removed: true,
      profileHref: null,
    });
    expect(view.state).toBe('removed');
  });

  it('4. the "with" answer is the same finished state, with the conversation id or null', () => {
    const answer: DirectWithAnswer = {
      conversationId: null,
      other: { membershipId: MEMBER, displayName: 'Ana Lima', avatarAssetId: null, removed: false },
      composer: 'closed',
    };
    const view = directWithView(answer, t);
    expect(view.conversationId).toBeNull();
    expect(view.state).toBe('closed');
    expect(view.strip?.text).toBe('Esta conversa não aceita novas mensagens.');
    expect(view.other.name).toBe('Ana Lima');
  });
});
