import { fileURLToPath } from 'node:url';
import type {
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
  caseHeaderView,
  caseStateView,
  caseTitle,
  chatDayLabel,
  chatMessageView,
  chatRuns,
  inboxRowView,
  inboxTime,
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
