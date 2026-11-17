import { describe, expect, it } from 'vitest';
import {
  anyInboxFilter,
  INBOX_DEFAULTS,
  type InboxQueryState,
  inboxApiFilters,
  inboxApiQuery,
  inboxHref,
  parseInboxQuery,
  serializeInboxQuery,
  withInboxTab,
} from './inbox-query';

/**
 * 12.4-14 Task 1 (UI-D-823, D-805; T-12.4-64; checker W12): the inbox's URL state. The URL vocabulary
 * (`aba`, `resp`, `prio`, `aguardando`) is the user's; the API's (`tab`, `owner`, `priority`, `awaiting`)
 * is the server's, and the map between them is asserted value by value so a wrong mapping cannot be
 * swallowed as "no filter".
 */

const UUID = '3f2b8c1e-9a4d-4c7b-8e11-0d5a6b7c8d9e';
const parse = (query: string) => parseInboxQuery(new URLSearchParams(query));

describe('parseInboxQuery', () => {
  it('an empty query is the default view: Em aberto, Todos, Todas, toggle off', () => {
    expect(parse('')).toEqual(INBOX_DEFAULTS);
    expect(INBOX_DEFAULTS).toEqual({
      tab: 'em-aberto',
      owner: null,
      priority: null,
      awaiting: false,
    });
  });

  it.each([
    ['aba=em-aberto', 'em-aberto'],
    ['aba=resolvidos', 'resolvidos'],
    ['aba=fechados', 'fechados'],
  ])('reads the tab %s', (query, tab) => {
    expect(parse(query).tab).toBe(tab);
  });

  it.each([
    ['resp=eu', 'eu'],
    ['resp=sem', 'sem'],
    [`resp=${UUID}`, UUID],
    [`resp=${UUID.toUpperCase()}`, UUID],
  ])('reads the owner %s', (query, owner) => {
    expect(parse(query).owner).toBe(owner);
  });

  it.each(['alta', 'normal', 'baixa'])('reads the priority %s', (priority) => {
    expect(parse(`prio=${priority}`).priority).toBe(priority);
  });

  it('reads the awaiting toggle on the open tab', () => {
    expect(parse('aguardando=1').awaiting).toBe(true);
    expect(parse('aba=em-aberto&aguardando=1').awaiting).toBe(true);
  });

  it('an unknown value of each key falls back to its default (T-12.4-64)', () => {
    expect(parse('aba=tudo&resp=ninguem&prio=urgente&aguardando=sim')).toEqual(INBOX_DEFAULTS);
    expect(parse('aba=&resp=&prio=&aguardando=')).toEqual(INBOX_DEFAULTS);
    expect(parse('aguardando=0').awaiting).toBe(false);
  });

  it('a malformed uuid falls back to Todos and never reaches the API', () => {
    expect(parse(`resp=${UUID}x`).owner).toBeNull();
    expect(parse(`resp=${UUID.slice(0, 20)}`).owner).toBeNull();
    expect(parse("resp=1' or '1'='1").owner).toBeNull();
    expect(parse('resp=../../etc').owner).toBeNull();
  });

  it('the toggle is dropped on the two other tabs, even when the URL carries it', () => {
    expect(parse('aba=resolvidos&aguardando=1').awaiting).toBe(false);
    expect(parse('aba=fechados&aguardando=1').awaiting).toBe(false);
  });

  it('reads from a plain object with get() as well (a Next ReadonlyURLSearchParams)', () => {
    const map = new Map([['aba', 'resolvidos']]);
    expect(parseInboxQuery({ get: (key: string) => map.get(key) ?? null }).tab).toBe('resolvidos');
  });
});

describe('serializeInboxQuery', () => {
  it('the default view serialises to an empty query', () => {
    expect(serializeInboxQuery(INBOX_DEFAULTS)).toBe('');
  });

  it('writes every key in a fixed order and round-trips', () => {
    const state: InboxQueryState = {
      tab: 'em-aberto',
      owner: UUID,
      priority: 'alta',
      awaiting: true,
    };
    const query = serializeInboxQuery(state);
    expect(query).toBe(`resp=${UUID}&prio=alta&aguardando=1`);
    expect(parse(query)).toEqual(state);
  });

  it('writes the tab only when it is not the default', () => {
    expect(serializeInboxQuery({ ...INBOX_DEFAULTS, tab: 'resolvidos' })).toBe('aba=resolvidos');
    expect(serializeInboxQuery({ ...INBOX_DEFAULTS, tab: 'fechados', owner: 'eu' })).toBe(
      'aba=fechados&resp=eu',
    );
  });

  it('never writes the toggle for another tab than Em aberto', () => {
    expect(serializeInboxQuery({ ...INBOX_DEFAULTS, tab: 'resolvidos', awaiting: true })).toBe(
      'aba=resolvidos',
    );
  });

  it('round-trips every combination of tab, owner and priority', () => {
    for (const tab of ['em-aberto', 'resolvidos', 'fechados'] as const) {
      for (const owner of [null, 'eu', 'sem', UUID]) {
        for (const priority of [null, 'alta', 'normal', 'baixa'] as const) {
          const state: InboxQueryState = { tab, owner, priority, awaiting: tab === 'em-aberto' };
          expect(parse(serializeInboxQuery(state))).toEqual(state);
        }
      }
    }
  });
});

describe('withInboxTab', () => {
  it('a tab change keeps the owner and the priority', () => {
    const state: InboxQueryState = {
      tab: 'em-aberto',
      owner: 'eu',
      priority: 'baixa',
      awaiting: false,
    };
    expect(withInboxTab(state, 'resolvidos')).toEqual({ ...state, tab: 'resolvidos' });
  });

  it('a tab change away from Em aberto drops the toggle', () => {
    const state: InboxQueryState = {
      tab: 'em-aberto',
      owner: null,
      priority: null,
      awaiting: true,
    };
    expect(withInboxTab(state, 'fechados').awaiting).toBe(false);
    expect(withInboxTab(state, 'em-aberto').awaiting).toBe(true);
  });
});

describe('inboxApiQuery (checker W12): the URL vocabulary to the API vocabulary, exactly', () => {
  it.each([
    ['em-aberto', 'tab=open'],
    ['resolvidos', 'tab=resolved'],
    ['fechados', 'tab=closed'],
  ] as const)('aba=%s is %s', (tab, expected) => {
    expect(inboxApiQuery({ ...INBOX_DEFAULTS, tab })).toBe(expected);
  });

  it.each([
    ['eu', 'tab=open&owner=me'],
    ['sem', 'tab=open&owner=none'],
    [UUID, `tab=open&owner=${UUID}`],
  ])('resp=%s is %s', (owner, expected) => {
    expect(inboxApiQuery({ ...INBOX_DEFAULTS, owner })).toBe(expected);
  });

  it.each([
    ['alta', 'tab=open&priority=high'],
    ['normal', 'tab=open&priority=normal'],
    ['baixa', 'tab=open&priority=low'],
  ] as const)('prio=%s is %s', (priority, expected) => {
    expect(inboxApiQuery({ ...INBOX_DEFAULTS, priority })).toBe(expected);
  });

  it('aguardando=1 is awaiting=1 on the open tab only', () => {
    expect(inboxApiQuery({ ...INBOX_DEFAULTS, awaiting: true })).toBe('tab=open&awaiting=1');
    expect(inboxApiQuery({ ...INBOX_DEFAULTS, tab: 'resolvidos', awaiting: true })).toBe(
      'tab=resolved',
    );
  });

  it('all four keys, in the API order', () => {
    expect(
      inboxApiQuery({ tab: 'resolvidos', owner: 'eu', priority: 'alta', awaiting: false }),
    ).toBe('tab=resolved&owner=me&priority=high');
    expect(inboxApiQuery({ tab: 'em-aberto', owner: 'eu', priority: 'alta', awaiting: true })).toBe(
      'tab=open&owner=me&priority=high&awaiting=1',
    );
  });

  it('the filters object (what the load-more action takes) carries only what is set', () => {
    expect(inboxApiFilters(INBOX_DEFAULTS)).toEqual({ tab: 'open' });
    expect(
      inboxApiFilters({ tab: 'em-aberto', owner: 'sem', priority: 'baixa', awaiting: true }),
    ).toEqual({ tab: 'open', owner: 'none', priority: 'low', awaiting: true });
  });
});

describe('anyInboxFilter and inboxHref', () => {
  it('a tab alone is not a filter; owner, priority and the toggle are', () => {
    expect(anyInboxFilter({ ...INBOX_DEFAULTS, tab: 'fechados' })).toBe(false);
    expect(anyInboxFilter({ ...INBOX_DEFAULTS, owner: 'eu' })).toBe(true);
    expect(anyInboxFilter({ ...INBOX_DEFAULTS, priority: 'alta' })).toBe(true);
    expect(anyInboxFilter({ ...INBOX_DEFAULTS, awaiting: true })).toBe(true);
  });

  it('builds a path with the current query, and the bare path for the default view', () => {
    expect(inboxHref('/suporte/abc', INBOX_DEFAULTS)).toBe('/suporte/abc');
    expect(inboxHref('/suporte/abc', { ...INBOX_DEFAULTS, tab: 'resolvidos', owner: 'eu' })).toBe(
      '/suporte/abc?aba=resolvidos&resp=eu',
    );
  });
});
