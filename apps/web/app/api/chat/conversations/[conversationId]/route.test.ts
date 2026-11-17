import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { fetchCaseHeader } from '@/lib/chat';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

/**
 * 12.4-20 tracer, `GET /api/chat/conversations/{id}` (D-805, UI-D-830, T-12.4-87): the case header
 * for either side of the thread, finished on the server in ONE API call.
 *
 * What is stubbed: `lib/env`, the Supabase server client, the fetcher at the module boundary
 * (`fetchCaseHeader`, so a call count is the count of API calls) and the translator, which is the REAL
 * pt-BR catalog. What is real: the route, the gates and `caseHeaderView`.
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

vi.mock('@/lib/chat', () => ({ fetchCaseHeader: vi.fn() }));

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
const MEMBER_USER = '0a000000-0000-4000-8000-0000000000a1';

function request(
  site: string | null = 'same-origin',
  id = CONVERSATION,
): [Request, { params: Promise<{ conversationId: string }> }] {
  const headers: Record<string, string> = { host: 'rede-demo.localhost:3000' };
  if (site !== null) headers['sec-fetch-site'] = site;
  return [
    new Request(`http://rede-demo.localhost:3000/api/chat/conversations/${id}`, { headers }),
    { params: Promise.resolve({ conversationId: id }) },
  ];
}

const staffDetail = () => ({
  viewer: 'staff' as const,
  id: CONVERSATION,
  member: { membershipId: null, displayName: 'Ana Lima', avatarAssetId: null, state: 'active' },
  lastSeq: 5,
  staffLastReadSeq: 4,
  case: {
    id: CONVERSATION,
    number: 42,
    state: 'in_progress' as const,
    subject: 'Cobrança duplicada',
    subjectLabel: 'Cobrança duplicada',
    category: 'payment' as const,
    openedAt: '2026-11-16T14:02:00.000Z',
    priority: 'normal' as const,
    ownerUserId: MEMBER_USER,
    ownerName: 'Carla Souza',
    ownerIsViewer: false,
    resolvedAt: null,
    closedAt: null,
    actions: ['take', 'resolve', 'close', 'edit'] as const,
  },
});

const memberDetail = () => ({
  viewer: 'member' as const,
  id: CONVERSATION,
  lastSeq: 5,
  lastReadSeq: 3,
  lastStaffSeq: 4,
  case: {
    id: CONVERSATION,
    number: 42,
    state: 'in_progress' as const,
    subject: 'Cobrança duplicada',
    subjectLabel: 'Cobrança duplicada',
    category: 'payment' as const,
    openedAt: '2026-11-16T14:02:00.000Z',
  },
});

beforeEach(() => {
  vi.mocked(createClient).mockClear();
  vi.mocked(fetchCaseHeader).mockReset();
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u' } }, error: null });
});

describe('GET /api/chat/conversations/{id} (the case header)', () => {
  it('a staff answer for an in_progress case is the finished staff header, no-store, in ONE API call', async () => {
    vi.mocked(fetchCaseHeader).mockResolvedValue(staffDetail() as never);
    const [req, ctx] = request();
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fetchCaseHeader).toHaveBeenCalledTimes(1);
    expect(fetchCaseHeader).toHaveBeenCalledWith(CONVERSATION);
    const body = (await res.json()) as { viewer: string; header: Record<string, unknown> };
    expect(body.viewer).toBe('staff');
    expect(body.header).toMatchObject({
      viewer: 'staff',
      number: 42,
      title: 'Chamado #42',
      subject: 'Cobrança duplicada',
      subjectLine: '#42 · Cobrança duplicada',
      state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
      meta: 'Pagamento · Normal · Com Carla',
      actions: ['take', 'resolve', 'close', 'edit'],
    });
  });

  it('a member answer is title, state and subject only', async () => {
    vi.mocked(fetchCaseHeader).mockResolvedValue(memberDetail() as never);
    const [req, ctx] = request();
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(fetchCaseHeader).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { viewer: string; header: Record<string, unknown> };
    expect(body.viewer).toBe('member');
    expect(body.header).toEqual({
      viewer: 'member',
      id: CONVERSATION,
      number: 42,
      title: 'Chamado #42',
      state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
      subject: 'Cobrança duplicada',
      subjectLine: '#42 · Cobrança duplicada',
    });
  });

  it('T-12.4-87: a priority, owner or action list the (mocked) API wrongly sends a member never reaches the answer', async () => {
    const detail = memberDetail();
    Object.assign(detail.case, {
      priority: 'high',
      ownerName: 'Carla Souza',
      ownerUserId: MEMBER_USER,
      ownerIsViewer: false,
      actions: ['take'],
    });
    vi.mocked(fetchCaseHeader).mockResolvedValue(detail as never);
    const [req, ctx] = request();
    const res = await GET(req, ctx);

    const text = await res.text();
    for (const leaked of [
      'priority',
      'ownerName',
      'ownerUserId',
      'ownerIsViewer',
      'actions',
      'Carla',
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).not.toContain(MEMBER_USER);
  });

  it('a conversation with no case answers a null header', async () => {
    const { case: _case, ...withoutCase } = memberDetail();
    vi.mocked(fetchCaseHeader).mockResolvedValue(withoutCase as never);
    const [req, ctx] = request();
    const res = await GET(req, ctx);
    expect(await res.json()).toEqual({ viewer: 'member', header: null });
  });

  it.each([401, 403, 404])(
    'passes a %s from the API through, empty and no-store',
    async (status) => {
      vi.mocked(fetchCaseHeader).mockRejectedValue(new ApiClientError(status, 'X'));
      const [req, ctx] = request();
      const res = await GET(req, ctx);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('');
      expect(fetchCaseHeader).toHaveBeenCalledTimes(1);
    },
  );

  it('answers 502 for a transport failure and logs the shape only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchCaseHeader).mockRejectedValue(new Error(`boom ${CONVERSATION} secret subject`));
    const [req, ctx] = request();
    const res = await GET(req, ctx);
    expect(res.status).toBe(502);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(CONVERSATION);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    spy.mockRestore();
  });

  it.each([['cross-site'], ['same-site'], ['none']])(
    'T-12.4-51: Sec-Fetch-Site %s is 403 before any session read or API call',
    async (site) => {
      const [req, ctx] = request(site);
      const res = await GET(req, ctx);
      expect(res.status).toBe(403);
      expect(createClient).not.toHaveBeenCalled();
      expect(fetchCaseHeader).not.toHaveBeenCalled();
    },
  );

  it('an anonymous request is 401 with zero API calls', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const [req, ctx] = request();
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(fetchCaseHeader).not.toHaveBeenCalled();
  });

  it('a path id that is not a uuid is 404 with zero API calls', async () => {
    const [req, ctx] = request('same-origin', 'not-a-uuid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(fetchCaseHeader).not.toHaveBeenCalled();
  });
});
