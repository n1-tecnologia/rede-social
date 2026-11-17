import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { GET as getHistory } from './conversations/[conversationId]/case/history/route';
import { GET as getInbox } from './inbox/route';
import { GET as getStaff } from './staff/route';
import { GET as getMyCases } from './support/cases/route';

/**
 * 12.4-20 — the four BFF read handlers of the support cases beside the extended inbox handler
 * (D-803, D-805, D-810, CASE-14, CASE-16; T-12.4-51, T-12.4-52, T-12.4-87).
 *
 * The claims worth a test, for every handler: a cross-site request and an anonymous one cost ZERO API
 * calls; a good request costs exactly ONE; the answer is `no-store`; the logs carry status and code only.
 * Then each handler's finished view.
 *
 * What is stubbed: `lib/env`, the Supabase server client, the transport (`apiFetch`, so a call count is
 * the count of API calls and the REAL strict contract parses every answer), `getBootstrap` (the tenant
 * zone) and the translator, which is the REAL pt-BR catalog. What is real: the handlers, the fetchers,
 * the contracts and the view functions.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

const getClaims = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims } })),
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(async () => ({
    tenant: { timezone: 'America/Sao_Paulo' },
    permissions: ['chat.support'],
  })),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const EARLIER = '0c000000-0000-4000-8000-0000000000c0';
const USER_A = '0a000000-0000-4000-8000-0000000000a1';
const USER_B = '0a000000-0000-4000-8000-0000000000a2';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function get(
  path: string,
  site: string | null = 'same-origin',
): [Request, { params: Promise<{ conversationId: string }> }] {
  const headers: Record<string, string> = { host: 'rede-demo.localhost:3000' };
  if (site !== null) headers['sec-fetch-site'] = site;
  return [
    new Request(`http://rede-demo.localhost:3000${path}`, { headers }),
    { params: Promise.resolve({ conversationId: CONVERSATION }) },
  ];
}

beforeEach(() => {
  // The day words ("Hoje", "Ontem") read the ONE clock of the request: pin it (Date only, timers stay real).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
  vi.mocked(createClient).mockClear();
  vi.mocked(apiFetch).mockReset();
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u' } }, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

const HANDLERS = [
  [
    'history',
    (site?: string | null) =>
      getHistory(...get(`/api/chat/conversations/${CONVERSATION}/case/history`, site)),
  ],
  ['staff', (site?: string | null) => getStaff(get('/api/chat/staff', site)[0])],
  ['my cases', (site?: string | null) => getMyCases(get('/api/chat/support/cases', site)[0])],
  ['inbox', (site?: string | null) => getInbox(get('/api/chat/inbox', site)[0])],
] as const;

describe.each(HANDLERS)('%s handler: the shared gates (T-12.4-51, T-12.4-52)', (_name, call) => {
  it.each([['cross-site'], ['same-site'], ['none']])(
    'Sec-Fetch-Site %s is 403 with zero session reads and zero API calls',
    async (site) => {
      const res = await call(site);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(createClient).not.toHaveBeenCalled();
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it('an anonymous request is 401 with zero API calls', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await call();
    expect(res.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('passes an API 403 through, empty and no-store, after exactly one API call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('answers 502 for a transport failure and logs the shape only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockRejectedValue(new Error(`boom ${CONVERSATION} Carla private subject`));
    const res = await call();
    expect(res.status).toBe(502);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('TRANSPORT');
    expect(logged).not.toContain(CONVERSATION);
    expect(logged).not.toContain('Carla');
    spy.mockRestore();
  });
});

describe('GET /api/chat/conversations/{id}/case/history', () => {
  const history = () => ({
    events: [
      { kind: 'opened', at: '2026-11-16T17:02:00.000Z', actorName: 'Ana Lima', toState: 'open' },
      {
        kind: 'taken',
        at: '2026-11-16T17:10:00.000Z',
        actorName: 'Carla Souza',
        toState: 'in_progress',
      },
      {
        kind: 'resolved',
        at: '2026-11-16T17:40:00.000Z',
        fromState: 'in_progress',
        toState: 'resolved',
      },
      {
        kind: 'reopened',
        at: '2026-11-16T18:00:00.000Z',
        actorName: 'Ana Lima',
        fromState: 'resolved',
        toState: 'open',
      },
      {
        kind: 'edited',
        at: '2026-11-16T18:05:00.000Z',
        actorName: 'Carla Souza',
        field: 'category',
        from: 'other',
        to: 'payment',
      },
      { kind: 'closed', at: '2026-11-17T09:00:00.000Z', fromState: 'resolved', toState: 'closed' },
    ],
    earlierCases: [
      {
        id: EARLIER,
        number: 38,
        state: 'closed',
        subjectLabel: 'Meu ingresso',
        openedAt: '2026-10-12T19:40:00.000Z',
      },
    ],
    hasMoreEarlier: true,
  });

  it('answers the finished sentences, oldest first, and the earlier cases, in ONE call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, history()));
    const res = await getHistory(...get(`/api/chat/conversations/${CONVERSATION}/case/history`));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(
      `/v1/chat/conversations/${CONVERSATION}/case/history`,
    );
    const body = (await res.json()) as {
      events: {
        kind: string;
        text: string;
        parts: { text: string; strong: boolean }[];
        time: string;
      }[];
      earlier: Record<string, unknown>[];
      hasMoreEarlier: boolean;
    };
    expect(body.events.map((event) => event.text)).toEqual([
      'Ana Lima abriu o chamado.',
      'Carla Souza assumiu o chamado.',
      // an actor who left reads through the catalog fallback
      'Alguém da equipe marcou como resolvido.',
      // the reopen came from the member who opened the case
      'Ana Lima respondeu e o chamado foi reaberto.',
      'Carla Souza mudou a categoria de Outro para Pagamento.',
      // a close with no actor that started from `resolved` is the automatic one
      'O chamado foi fechado automaticamente após 7 dias resolvido.',
    ]);
    expect(body.events[1]?.parts).toEqual([
      { text: 'Carla Souza', strong: true },
      { text: ' assumiu o chamado.', strong: false },
    ]);
    expect(body.events.map((event) => event.time)).toEqual([
      'Ontem · 14:02',
      'Ontem · 14:10',
      'Ontem · 14:40',
      'Ontem · 15:00',
      'Ontem · 15:05',
      'Hoje · 06:00',
    ]);
    expect(body.earlier).toEqual([
      {
        id: EARLIER,
        href: `/suporte/${EARLIER}`,
        subjectLine: '#38 · Meu ingresso',
        state: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
        date: '12/10',
      },
    ]);
    expect(body.hasMoreEarlier).toBe(true);
  });

  it('a team reopen reads as the team and a manual close by a departed actor says so', async () => {
    const rows = history();
    rows.events = [
      { kind: 'opened', at: '2026-11-16T17:02:00.000Z', actorName: 'Ana Lima', toState: 'open' },
      {
        kind: 'reopened',
        at: '2026-11-16T18:00:00.000Z',
        actorName: 'Carla Souza',
        fromState: 'resolved',
        toState: 'open',
      },
      { kind: 'closed', at: '2026-11-17T09:00:00.000Z', fromState: 'open', toState: 'closed' },
    ] as never;
    vi.mocked(apiFetch).mockResolvedValue(json(200, rows));
    const res = await getHistory(...get(`/api/chat/conversations/${CONVERSATION}/case/history`));
    const body = (await res.json()) as { events: { text: string }[] };
    expect(body.events.map((event) => event.text)).toEqual([
      'Ana Lima abriu o chamado.',
      'Carla Souza reabriu o chamado.',
      'Alguém da equipe fechou o chamado.',
    ]);
  });

  it('a path id that is not a uuid is 404 with zero API calls', async () => {
    const res = await getHistory(
      new Request('http://rede-demo.localhost:3000/x', {
        headers: { host: 'rede-demo.localhost:3000', 'sec-fetch-site': 'same-origin' },
      }),
      { params: Promise.resolve({ conversationId: 'nope' }) },
    );
    expect(res.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/chat/staff', () => {
  it('answers { items: [{ userId, name }] } only, in ONE call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, {
        items: [
          { userId: USER_A, name: 'Carla Souza' },
          { userId: USER_B, name: 'Bruno' },
        ],
      }),
    );
    const res = await getStaff(get('/api/chat/staff')[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      items: [
        { userId: USER_A, name: 'Carla Souza' },
        { userId: USER_B, name: 'Bruno' },
      ],
    });
  });

  it('T-12.4-87: an extra field in the roster is refused by the strict contract, nothing leaks', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [{ userId: USER_A, name: 'Carla', email: 'carla@example.test' }] }),
    );
    const res = await getStaff(get('/api/chat/staff')[0]);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('');
    spy.mockRestore();
  });
});

describe('GET /api/chat/support/cases (the whole finished page, checker W11)', () => {
  const card = (n: number, state: 'in_progress' | 'closed') => ({
    id: `0c000000-0000-4000-8000-00000000000${n}`,
    number: n,
    state,
    subject: n === 2 ? null : 'Cobrança duplicada',
    subjectLabel: n === 2 ? 'Oi, preciso de ajuda com' : 'Cobrança duplicada',
    category: 'payment',
    openedAt: '2026-11-16T17:02:00.000Z',
    lastMessage: { preview: 'Já verificamos.', side: 'staff' },
    lastMessageAt: '2026-11-16T17:30:00.000Z',
  });
  const page = () => ({
    current: card(3, 'in_progress'),
    items: [card(2, 'closed'), card(1, 'closed')],
    total: 3,
    nextCursor: 'c-next',
  });

  it('answers current, items, total and nextCursor with finished cards, in ONE call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, page()));
    const res = await getMyCases(get('/api/chat/support/cases')[0]);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/support/cases');
    const body = (await res.json()) as {
      current: Record<string, unknown> | null;
      items: Record<string, unknown>[];
      total: number;
      nextCursor: string | null;
    };
    expect(body.total).toBe(3);
    expect(body.nextCursor).toBe('c-next');
    expect(body.current).toMatchObject({
      number: 3,
      title: 'Chamado #3',
      subject: 'Cobrança duplicada',
      hasSubject: true,
      preview: 'Equipe: Já verificamos.',
      category: 'Pagamento',
      closed: false,
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ number: 2, hasSubject: false, closed: true });
  });

  it('a cursor is forwarded and the page keeps current and total', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { ...page(), items: [card(1, 'closed')], nextCursor: null }),
    );
    const res = await getMyCases(get('/api/chat/support/cases?cursor=abc')[0]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/support/cases?cursor=abc');
    const body = (await res.json()) as { current: unknown; total: number };
    expect(body.current).not.toBeNull();
    expect(body.total).toBe(3);
  });

  it('an over-long cursor is 400 with zero API calls', async () => {
    const res = await getMyCases(get(`/api/chat/support/cases?cursor=${'x'.repeat(513)}`)[0]);
    expect(res.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('T-12.4-87: a member card carrying a priority or an owner is refused, nothing leaks', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leaky = page();
    Object.assign(leaky.current, { priority: 'high', ownerName: 'Carla' });
    vi.mocked(apiFetch).mockResolvedValue(json(200, leaky));
    const res = await getMyCases(get('/api/chat/support/cases')[0]);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('');
    spy.mockRestore();
  });
});

describe('GET /api/chat/inbox with the case filters', () => {
  const row = () => ({
    conversationId: CONVERSATION,
    member: { membershipId: null, displayName: 'Ana Lima', avatarAssetId: null, state: 'active' },
    lastMessage: { seq: 3, preview: 'Oi', side: 'member', authorFirstName: null },
    lastMessageAt: '2026-11-16T17:30:00.000Z',
    awaiting: true,
    case: {
      number: 42,
      state: 'in_progress',
      subjectLabel: 'Cobrança duplicada',
      category: 'payment',
      priority: 'high',
      ownerName: 'Carla Souza',
      ownerIsViewer: false,
    },
  });

  it('forwards tab, owner, priority and awaiting=1 in the API vocabulary and formats the case facts', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [row()], nextCursor: null }));
    const res = await getInbox(
      get('/api/chat/inbox?tab=resolved&owner=me&priority=high&awaiting=1')[0],
    );

    expect(res.status).toBe(200);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const url = new URL(`http://x${vi.mocked(apiFetch).mock.calls[0]?.[0]}`);
    expect(url.pathname).toBe('/v1/chat/inbox');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tab: 'resolved',
      owner: 'me',
      priority: 'high',
      awaiting: '1',
    });
    const body = (await res.json()) as { items: { case: Record<string, unknown> }[] };
    expect(body.items[0]?.case).toMatchObject({
      number: 42,
      subjectLine: '#42 · Cobrança duplicada',
      state: { label: 'Em atendimento' },
      priority: { label: 'Alta', tone: 'danger' },
      meta: 'Pagamento · Com Carla',
    });
  });

  it('forwards an owner uuid, lower-cased', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await getInbox(get(`/api/chat/inbox?owner=${USER_A.toUpperCase()}`)[0]);
    const url = new URL(`http://x${vi.mocked(apiFetch).mock.calls[0]?.[0]}`);
    expect(url.searchParams.get('owner')).toBe(USER_A);
  });

  it('drops an unknown tab, owner and priority before the forward, and a falsy awaiting', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await getInbox(get('/api/chat/inbox?tab=trash&owner=everyone&priority=urgent&awaiting=0')[0]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/inbox');
  });

  it('a request with no filters is the shipped page-1 call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await getInbox(get('/api/chat/inbox')[0]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/inbox');
  });
});
