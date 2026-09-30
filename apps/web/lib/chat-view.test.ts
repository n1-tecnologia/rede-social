import { fileURLToPath } from 'node:url';
import type { MessageRow } from '@rede-social/module-chat/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  type ChatMessageView,
  chatDayLabel,
  chatMessageView,
  chatRuns,
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
