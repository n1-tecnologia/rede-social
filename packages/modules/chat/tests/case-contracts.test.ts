import { describe, expect, it } from 'vitest';
import {
  CHAT_CASE_ACTIONS,
  CHAT_CASE_CATEGORIES,
  CHAT_CASE_PRIORITIES,
  CHAT_CASE_STATES,
  CHAT_INBOX_PAGE_SIZE,
  CHAT_MAX_INBOX_PAGE_SIZE,
  CHAT_MY_CASES_PAGE_SIZE,
  CHAT_NOTIFICATION_KINDS,
  CHAT_PERMISSIONS,
  CHAT_SUBJECT_MAX,
  type ChatCaseAssigned,
  type ChatCaseResolved,
  caseActionInputSchema,
  caseAssignInputSchema,
  caseCardSchema,
  caseEditInputSchema,
  caseHistorySchema,
  caseResultSchema,
  codePointLength,
  conversationDetailSchema,
  inboxQuerySchema,
  inboxRowSchema,
  memberCaseSchema,
  myCasesPageSchema,
  myCasesQuerySchema,
  sendResultSchema,
  staffCaseSchema,
  staffRosterSchema,
  subjectInputSchema,
  supportSendInputSchema,
  supportThreadSchema,
} from '../contracts/index';

/**
 * The case contract surface of Phase 12.4, pinned without a server (CASE-24). The tracer block proves the
 * first path through the plan: the member's first message may carry a category and a subject and never a
 * priority, a state or an owner (D-811, D-812, T-12.4-21).
 */

const issuesOf = (schema: { safeParse: (v: unknown) => unknown }, value: unknown): string[] => {
  const parsed = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  return parsed.success ? [] : (parsed.error?.issues.map((issue) => issue.message) ?? []);
};

describe('case tracer', () => {
  it('names the assign permission beside the two shipped ones', () => {
    expect(CHAT_PERMISSIONS.assign).toBe('chat.support.assign');
    expect(CHAT_CASE_CATEGORIES).toEqual(['check_in', 'events', 'payment', 'account', 'other']);
    expect(CHAT_CASE_PRIORITIES).toEqual(['low', 'normal', 'high']);
    expect(CHAT_SUBJECT_MAX).toBe(80);
  });

  it('accepts a first message with a category and a subject, and a body alone', () => {
    const full = supportSendInputSchema.parse({
      body: 'Preciso de ajuda',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(full).toEqual({
      body: 'Preciso de ajuda',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(supportSendInputSchema.parse({ body: 'oi' })).toEqual({ body: 'oi' });
  });

  it('an all-whitespace subject becomes an absent subject', () => {
    const parsed = supportSendInputSchema.parse({ body: 'oi', subject: '   \n ' });
    expect(parsed.subject).toBeUndefined();
    expect(subjectInputSchema.parse('')).toBeUndefined();
  });

  it('refuses a forged priority, state or owner as a plain failure, never an issue code', () => {
    expect(supportSendInputSchema.safeParse({ body: 'oi', priority: 'high' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', state: 'closed' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', ownerUserId: 'x' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', category: 'nope' }).success).toBe(false);
    expect(issuesOf(supportSendInputSchema, { body: 'oi', priority: 'high' })).not.toContain(
      'subject_too_long',
    );
  });

  it('counts the subject in code points: 80 emoji pass, 81 are subject_too_long', () => {
    const emoji = '😀'.repeat(CHAT_SUBJECT_MAX);
    expect(codePointLength(emoji)).toBe(80);
    expect(supportSendInputSchema.safeParse({ body: 'oi', subject: emoji }).success).toBe(true);
    expect(issuesOf(supportSendInputSchema, { body: 'oi', subject: `${emoji}😀` })).toEqual([
      'subject_too_long',
    ]);
  });
});

const ID = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const ID2 = '0c4d8f7e-3d1a-4b6b-9a63-1f6f1d2f5a10';
const AT = '2026-11-17T09:00:00.000000Z';

const memberCase = {
  id: ID,
  number: 42,
  state: 'open',
  subject: 'Cobrança duplicada',
  subjectLabel: 'Cobrança duplicada',
  category: 'payment',
  openedAt: AT,
};
const staffCase = {
  ...memberCase,
  priority: 'normal',
  ownerUserId: ID2,
  ownerName: 'Carla',
  ownerIsViewer: false,
  resolvedAt: null,
  closedAt: null,
  actions: ['take', 'assign', 'resolve', 'close', 'edit'],
};
const message = {
  id: ID,
  seq: 1,
  side: 'member',
  body: 'oi',
  createdAt: AT,
  author: null,
  authorIsViewer: true,
};
const card = {
  ...memberCase,
  lastMessage: { preview: 'oi', side: 'member' },
  lastMessageAt: AT,
};

describe('closed lists', () => {
  it('EP-081: states, categories, priorities and actions are closed ORDERED tuples', () => {
    expect(CHAT_CASE_STATES).toEqual(['open', 'in_progress', 'resolved', 'closed']);
    expect(CHAT_CASE_CATEGORIES).toEqual(['check_in', 'events', 'payment', 'account', 'other']);
    expect(CHAT_CASE_PRIORITIES).toEqual(['low', 'normal', 'high']);
    expect(CHAT_CASE_ACTIONS).toEqual(['take', 'assign', 'resolve', 'close', 'reopen', 'edit']);
    expect(CHAT_MY_CASES_PAGE_SIZE).toBe(20);
  });

  it('D-808 and D-809: the four case notice kinds', () => {
    expect(CHAT_NOTIFICATION_KINDS).toMatchObject({
      caseResolved: 'chat.case_resolved',
      caseAssigned: 'chat.case_assigned',
      caseNew: 'chat.case_new',
      caseReopened: 'chat.case_reopened',
    });
  });

  it('D-808 and D-809: the two events carry ids and an instant, never text', () => {
    const resolved: ChatCaseResolved = { tenantId: ID, conversationId: ID, resolvedAt: AT };
    const assigned: ChatCaseAssigned = {
      tenantId: ID,
      conversationId: ID,
      assigneeUserId: ID2,
      actorUserId: ID,
    };
    expect(Object.keys(resolved).sort()).toEqual(['conversationId', 'resolvedAt', 'tenantId']);
    expect(Object.keys(assigned).sort()).toEqual([
      'actorUserId',
      'assigneeUserId',
      'conversationId',
      'tenantId',
    ]);
  });
});

describe('subjectInputSchema', () => {
  it('EP-080 empty: an empty subject is absent, trimmed text stays, 80 pass and 81 do not', () => {
    expect(subjectInputSchema.parse('')).toBeUndefined();
    expect(subjectInputSchema.parse('  Oi  ')).toBe('Oi');
    expect(subjectInputSchema.safeParse('a'.repeat(80)).success).toBe(true);
    expect(subjectInputSchema.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

describe('supportSendInputSchema', () => {
  it('EP-079 adjacency: an unknown key beside known keys is refused', () => {
    expect(
      supportSendInputSchema.safeParse({ body: 'oi', category: 'other', state: 'closed' }).success,
    ).toBe(false);
    expect(
      supportSendInputSchema.safeParse({ body: 'oi', category: 'other', priority: 'high' }).success,
    ).toBe(false);
  });

  it('EP-080 empty: an empty category is invalid, an empty subject is absent', () => {
    expect(supportSendInputSchema.safeParse({ body: 'oi', category: '' }).success).toBe(false);
    expect(supportSendInputSchema.parse({ body: 'oi', subject: '' }).subject).toBeUndefined();
  });

  it('keeps the body rule: an empty body is body_required', () => {
    const parsed = supportSendInputSchema.safeParse({ body: '   ' });
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.message)).toEqual([
      'body_required',
    ]);
  });
});

describe('memberCaseSchema', () => {
  it('parses a full member case and refuses every staff fact (UI-D-835)', () => {
    expect(memberCaseSchema.parse(memberCase)).toEqual(memberCase);
    expect(memberCaseSchema.safeParse({ ...memberCase, unknown: 1 }).success).toBe(false);
    expect(memberCaseSchema.safeParse({ ...memberCase, priority: 'high' }).success).toBe(false);
    expect(memberCaseSchema.safeParse({ ...memberCase, ownerName: 'Carla' }).success).toBe(false);
    expect(memberCaseSchema.safeParse({ ...memberCase, ownerUserId: ID2 }).success).toBe(false);
    expect(memberCaseSchema.safeParse({ ...memberCase, actions: [] }).success).toBe(false);
    expect(memberCaseSchema.safeParse(staffCase).success).toBe(false);
  });

  it('accepts a case with no typed subject', () => {
    expect(memberCaseSchema.safeParse({ ...memberCase, subject: null }).success).toBe(true);
  });
});

describe('staffCaseSchema', () => {
  it('parses a full staff case, an unowned one and refuses an unknown key or action', () => {
    expect(staffCaseSchema.parse(staffCase)).toEqual(staffCase);
    expect(
      staffCaseSchema.safeParse({ ...staffCase, ownerUserId: null, ownerName: null }).success,
    ).toBe(true);
    expect(staffCaseSchema.safeParse({ ...staffCase, unknown: 1 }).success).toBe(false);
    expect(staffCaseSchema.safeParse({ ...staffCase, actions: ['delete'] }).success).toBe(false);
    expect(staffCaseSchema.safeParse({ ...staffCase, actions: [] }).success).toBe(true);
    expect(staffCaseSchema.safeParse(memberCase).success).toBe(false);
  });
});

describe('caseCardSchema', () => {
  it('parses a card, refuses staff facts and takes a case with no message', () => {
    expect(caseCardSchema.parse(card)).toEqual(card);
    expect(
      caseCardSchema.safeParse({ ...card, lastMessage: null, lastMessageAt: null }).success,
    ).toBe(true);
    expect(caseCardSchema.safeParse({ ...card, priority: 'high' }).success).toBe(false);
    expect(caseCardSchema.safeParse({ ...card, ownerName: 'Carla' }).success).toBe(false);
    expect(caseCardSchema.safeParse({ ...card, unknown: 1 }).success).toBe(false);
  });
});

describe('myCasesQuerySchema and myCasesPageSchema', () => {
  it('clamps the limit, drops an over-long cursor and refuses an unknown key', () => {
    expect(myCasesQuerySchema.parse({})).toEqual({ limit: CHAT_MY_CASES_PAGE_SIZE });
    expect(myCasesQuerySchema.parse({ limit: '9999' }).limit).toBe(CHAT_MAX_INBOX_PAGE_SIZE);
    expect(myCasesQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(myCasesQuerySchema.parse({ limit: 'abc' }).limit).toBe(CHAT_MY_CASES_PAGE_SIZE);
    expect(myCasesQuerySchema.parse({ cursor: 'x'.repeat(513) }).cursor).toBeUndefined();
    expect(myCasesQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc');
    expect(myCasesQuerySchema.safeParse({ owner: 'me' }).success).toBe(false);
  });

  it('EP-080 empty: a page with no current case and no items parses', () => {
    const empty = { current: null, items: [], total: 0, nextCursor: null };
    expect(myCasesPageSchema.parse(empty)).toEqual(empty);
    expect(
      myCasesPageSchema.parse({ current: card, items: [card], total: 2, nextCursor: 'c' }).total,
    ).toBe(2);
    expect(myCasesPageSchema.safeParse({ ...empty, unknown: 1 }).success).toBe(false);
  });
});

describe('caseActionInputSchema and caseAssignInputSchema', () => {
  it('requires the expected state, takes an optional owner and refuses other keys', () => {
    expect(caseActionInputSchema.parse({ expectedState: 'open' })).toEqual({
      expectedState: 'open',
    });
    expect(
      caseActionInputSchema.safeParse({ expectedState: 'open', expectedOwnerId: ID }).success,
    ).toBe(true);
    expect(caseActionInputSchema.safeParse({}).success).toBe(false);
    expect(caseActionInputSchema.safeParse({ expectedState: 'nope' }).success).toBe(false);
    expect(
      caseActionInputSchema.safeParse({ expectedState: 'open', state: 'closed' }).success,
    ).toBe(false);
    expect(
      caseActionInputSchema.safeParse({ expectedState: 'open', expectedOwnerId: 'x' }).success,
    ).toBe(false);
  });

  it('the assign body adds the assignee and refuses a missing or foreign-shaped one', () => {
    expect(
      caseAssignInputSchema.safeParse({ expectedState: 'open', assigneeUserId: ID2 }).success,
    ).toBe(true);
    expect(caseAssignInputSchema.safeParse({ expectedState: 'open' }).success).toBe(false);
    expect(
      caseAssignInputSchema.safeParse({ expectedState: 'open', assigneeUserId: 'x' }).success,
    ).toBe(false);
    expect(
      caseAssignInputSchema.safeParse({
        expectedState: 'open',
        assigneeUserId: ID2,
        ownerUserId: ID,
      }).success,
    ).toBe(false);
  });
});

describe('caseEditInputSchema', () => {
  const issues = (value: unknown): string[] => {
    const parsed = caseEditInputSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  };

  it('EP-080 empty: an edit with no field is case_nothing_to_edit', () => {
    expect(issues({ expectedState: 'open' })).toEqual(['case_nothing_to_edit']);
    expect(issues({ expectedState: 'open', category: 'other' })).toEqual([]);
    expect(issues({ expectedState: 'open', priority: 'high' })).toEqual([]);
  });

  it('a null subject blanks it, an empty one blanks it too, 81 code points is subject_too_long', () => {
    expect(caseEditInputSchema.parse({ expectedState: 'open', subject: null }).subject).toBeNull();
    expect(caseEditInputSchema.parse({ expectedState: 'open', subject: '  ' }).subject).toBeNull();
    expect(caseEditInputSchema.parse({ expectedState: 'open', subject: ' Oi ' }).subject).toBe(
      'Oi',
    );
    expect(issues({ expectedState: 'open', subject: 'a'.repeat(CHAT_SUBJECT_MAX + 1) })).toEqual([
      'subject_too_long',
    ]);
  });

  it('EP-079 adjacency: an owner or a state key is refused beside a valid field', () => {
    expect(
      caseEditInputSchema.safeParse({ expectedState: 'open', category: 'other', ownerUserId: ID })
        .success,
    ).toBe(false);
    expect(
      caseEditInputSchema.safeParse({ expectedState: 'open', category: 'other', state: 'closed' })
        .success,
    ).toBe(false);
    expect(caseEditInputSchema.safeParse({ category: 'other' }).success).toBe(false);
    expect(caseEditInputSchema.safeParse({ expectedState: 'open', category: '' }).success).toBe(
      false,
    );
  });
});

describe('caseResultSchema', () => {
  it('wraps a staff case and refuses a member-shaped one', () => {
    expect(caseResultSchema.parse({ case: staffCase })).toEqual({ case: staffCase });
    expect(caseResultSchema.safeParse({ case: memberCase }).success).toBe(false);
    expect(caseResultSchema.safeParse({ case: staffCase, extra: 1 }).success).toBe(false);
  });
});

describe('caseHistorySchema', () => {
  it('EP-080 empty: no events and no earlier cases parse', () => {
    const empty = { events: [], earlierCases: [], hasMoreEarlier: false };
    expect(caseHistorySchema.parse(empty)).toEqual(empty);
  });

  it('parses events with and without an actor and from-to values, and caps earlier cases at five', () => {
    const earlier = { id: ID2, number: 3, state: 'closed', subjectLabel: 'Antes', openedAt: AT };
    const history = {
      events: [
        { kind: 'opened', at: AT, actorName: 'Ana', toState: 'open' },
        {
          kind: 'assigned',
          at: AT,
          actorName: 'Admin',
          targetName: 'Carla',
          toState: 'in_progress',
        },
        { kind: 'edited', at: AT, actorName: 'Carla', field: 'subject', from: null, to: 'Novo' },
        { kind: 'closed', at: AT, fromState: 'resolved', toState: 'closed' },
      ],
      earlierCases: Array.from({ length: 5 }, () => earlier),
      hasMoreEarlier: true,
    };
    expect(caseHistorySchema.parse(history)).toEqual(history);
    expect(
      caseHistorySchema.safeParse({ ...history, earlierCases: [...history.earlierCases, earlier] })
        .success,
    ).toBe(false);
    expect(
      caseHistorySchema.safeParse({ ...history, events: [{ kind: 'deleted', at: AT }] }).success,
    ).toBe(false);
    expect(
      caseHistorySchema.safeParse({
        ...history,
        events: [{ kind: 'opened', at: AT, actorUserId: ID }],
      }).success,
    ).toBe(false);
  });
});

describe('staffRosterSchema', () => {
  it('EP-080 empty: an empty roster parses; a row carries only id and name', () => {
    expect(staffRosterSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(staffRosterSchema.safeParse({ items: [{ userId: ID, name: 'Carla' }] }).success).toBe(
      true,
    );
    expect(
      staffRosterSchema.safeParse({ items: [{ userId: ID, name: 'Carla', email: 'x@y.z' }] })
        .success,
    ).toBe(false);
  });
});

describe('the existing responses only gained optional keys (CASE-24)', () => {
  it('supportThreadSchema: the previous API payload still parses, the new one carries the case', () => {
    const old = { conversation: null, messages: [], hasOlder: false };
    expect(supportThreadSchema.parse(old)).toEqual(old);
    const next = { ...old, case: memberCase, hasAnyCase: true };
    expect(supportThreadSchema.parse(next)).toEqual(next);
    expect(supportThreadSchema.safeParse({ ...old, case: null }).success).toBe(true);
    expect(supportThreadSchema.safeParse({ ...old, case: staffCase }).success).toBe(false);
  });

  it('sendResultSchema: the previous payload parses, the new one names the case', () => {
    const old = { conversationId: ID, message };
    expect(sendResultSchema.parse(old)).toEqual(old);
    const next = {
      ...old,
      case: { id: ID, number: 42, state: 'open', opened: true, reopened: false },
    };
    expect(sendResultSchema.parse(next)).toEqual(next);
    expect(
      sendResultSchema.safeParse({ ...old, case: { ...next.case, priority: 'high' } }).success,
    ).toBe(false);
  });

  it('conversationDetailSchema: both variants parse with and without the case, each with its own shape', () => {
    const staff = {
      viewer: 'staff',
      id: ID,
      member: { membershipId: ID2, displayName: 'Ana', avatarAssetId: null, state: 'active' },
      lastSeq: 2,
      staffLastReadSeq: 1,
    };
    const member = { viewer: 'member', id: ID, lastSeq: 2, lastReadSeq: 1, lastStaffSeq: 0 };
    expect(conversationDetailSchema.parse(staff)).toEqual(staff);
    expect(conversationDetailSchema.parse(member)).toEqual(member);
    expect(conversationDetailSchema.safeParse({ ...staff, case: staffCase }).success).toBe(true);
    expect(conversationDetailSchema.safeParse({ ...member, case: memberCase }).success).toBe(true);
    // A member never receives a staff-shaped case, and staff never a member-shaped one.
    expect(conversationDetailSchema.safeParse({ ...member, case: staffCase }).success).toBe(false);
    expect(conversationDetailSchema.safeParse({ ...staff, case: memberCase }).success).toBe(false);
  });

  it('inboxRowSchema: the previous row parses, the new one carries the case facts', () => {
    const old = {
      conversationId: ID,
      member: { membershipId: ID2, displayName: 'Ana', avatarAssetId: null, state: 'active' },
      lastMessage: { seq: 1, preview: 'oi', side: 'member', authorFirstName: null },
      lastMessageAt: AT,
      awaiting: true,
    };
    expect(inboxRowSchema.parse(old)).toEqual(old);
    const next = {
      ...old,
      case: {
        number: 42,
        state: 'open',
        subjectLabel: 'Cobrança',
        category: 'payment',
        priority: 'normal',
        ownerName: null,
        ownerIsViewer: false,
      },
    };
    expect(inboxRowSchema.parse(next)).toEqual(next);
    expect(
      inboxRowSchema.safeParse({ ...old, case: { ...next.case, ownerUserId: ID } }).success,
    ).toBe(false);
  });
});

describe('inboxQuerySchema (12.4 filters)', () => {
  it('defaults: the open tab, no owner, no priority, not awaiting-only', () => {
    expect(inboxQuerySchema.parse({})).toEqual({
      limit: CHAT_INBOX_PAGE_SIZE,
      tab: 'open',
      awaiting: false,
    });
  });

  it('reads each filter and coerces awaiting from 1 or true', () => {
    expect(
      inboxQuerySchema.parse({ tab: 'resolved', owner: 'me', priority: 'high', awaiting: '1' }),
    ).toMatchObject({ tab: 'resolved', owner: 'me', priority: 'high', awaiting: true });
    expect(inboxQuerySchema.parse({ awaiting: 'true' }).awaiting).toBe(true);
    expect(inboxQuerySchema.parse({ owner: 'none' }).owner).toBe('none');
    expect(inboxQuerySchema.parse({ owner: ID }).owner).toBe(ID);
    expect(inboxQuerySchema.parse({ tab: 'closed' }).tab).toBe('closed');
  });

  it('a bad value degrades to its default, never a failure', () => {
    const parsed = inboxQuerySchema.safeParse({
      tab: 'nope',
      owner: 'someone',
      priority: 'urgent',
      awaiting: 'maybe',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ tab: 'open', awaiting: false });
    expect(parsed.success && parsed.data.owner).toBeUndefined();
    expect(parsed.success && parsed.data.priority).toBeUndefined();
    expect(inboxQuerySchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});
