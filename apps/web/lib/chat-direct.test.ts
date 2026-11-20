import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { fetchDirectDetail, fetchDirectList, fetchDirectWith, postDirectMessage } from './chat';

/**
 * 11-18 (CHAT-06, CHAT-07, D-719, D-720, D-722) — the three direct-chat loaders against a stubbed
 * transport: the path and the cursor are forwarded as the API documents, a non-2xx answer throws the
 * typed client error the screens map (a 404 is the single not-found), and the STRICT contracts refuse a
 * non-conforming answer (an extra "blocked me" key included).
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const MEMBER = '0e000000-0000-4000-8000-0000000000e1';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('fetchDirectList', () => {
  it('forwards page 1 with no query and parses the strict answer', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { rows: [], nextCursor: null }));
    await expect(fetchDirectList({ cursor: null })).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/direct');
  });

  it('forwards the opaque cursor, encoded', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { rows: [], nextCursor: null }));
    await fetchDirectList({ cursor: 'a b/c' });
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/direct?cursor=a+b%2Fc');
  });

  it('a 404 throws the typed client error with the envelope code', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(fetchDirectList({ cursor: null })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(fetchDirectList({ cursor: null })).rejects.toBeInstanceOf(ApiClientError);
  });

  it('refuses a non-conforming answer (an extra key is never tolerated)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { rows: [], nextCursor: null, blockedMe: true }),
    );
    await expect(fetchDirectList({ cursor: null })).rejects.toThrow();
  });
});

describe('fetchDirectDetail', () => {
  const detail = () => ({
    conversationId: CONVERSATION,
    other: { membershipId: MEMBER, displayName: 'Ana Lima', avatarAssetId: null, removed: false },
    composer: 'open',
    canBlock: true,
    lastSeq: 4,
    lastReadSeq: 2,
  });

  it('reads one conversation by id and parses the strict detail', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, detail()));
    await expect(fetchDirectDetail(CONVERSATION)).resolves.toMatchObject({ composer: 'open' });
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(`/v1/chat/direct/${CONVERSATION}`);
  });

  it('a 404 throws the typed client error (the screens render the single not-found)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(fetchDirectDetail(CONVERSATION)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an unknown composer word and an extra key', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { ...detail(), composer: 'blocked' }));
    await expect(fetchDirectDetail(CONVERSATION)).rejects.toThrow();
    vi.mocked(apiFetch).mockResolvedValue(json(200, { ...detail(), blockedMe: true }));
    await expect(fetchDirectDetail(CONVERSATION)).rejects.toThrow();
  });
});

describe('fetchDirectWith', () => {
  it('reads the existing conversation (or null) with a member by membership id', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, {
        conversationId: null,
        other: {
          membershipId: MEMBER,
          displayName: 'Ana Lima',
          avatarAssetId: null,
          removed: false,
        },
        composer: 'open',
      }),
    );
    await expect(fetchDirectWith(MEMBER)).resolves.toMatchObject({ conversationId: null });
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(`/v1/chat/direct/with/${MEMBER}`);
  });

  it('a 404 throws the typed client error', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(fetchDirectWith(MEMBER)).rejects.toMatchObject({ status: 404 });
  });
});

describe('postDirectMessage (11-22, D-720)', () => {
  const stored = {
    conversationId: CONVERSATION,
    created: true,
    message: {
      id: '0d000000-0000-4000-8000-0000000000d1',
      seq: 1,
      side: 'member',
      body: 'Oi',
      createdAt: '2026-11-19T17:12:00.000000Z',
      author: null,
      authorIsViewer: true,
    },
  };

  it('posts exactly { toMembershipId, body } and parses the strict answer', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, stored));
    await expect(postDirectMessage(MEMBER, 'Oi')).resolves.toMatchObject({
      conversationId: CONVERSATION,
      created: true,
    });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/chat/direct/messages');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      toMembershipId: MEMBER,
      body: 'Oi',
    });
  });

  it('throws the typed client error with the API word (409 direct_closed) and refuses an extra key', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(409, { error: { code: 'CONFLICT', details: { chat: 'direct_closed' } } }),
    );
    await expect(postDirectMessage(MEMBER, 'Oi')).rejects.toMatchObject({
      status: 409,
      details: { chat: 'direct_closed' },
    });
    vi.mocked(apiFetch).mockResolvedValueOnce(json(201, { ...stored, blockedMe: true }));
    await expect(postDirectMessage(MEMBER, 'Oi')).rejects.toThrow();
  });
});
