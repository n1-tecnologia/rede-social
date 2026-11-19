import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { fetchReports } from './reports';

/**
 * 11-18 (MODER-05, D-730, D-731) — the admin queue loader against a stubbed transport: the `estado`
 * and the cursor ride the query in the API's vocabulary, a refusal is the typed client error, and the
 * STRICT list schema (with the optional `community`, `voice` and `ref` keys) parses the answer.
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

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ID = '0b000000-0000-4000-8000-000000000001';
const item = () => ({
  id: ID,
  createdAt: '2026-11-17T17:00:00.000000Z',
  subjectType: 'direct_message',
  subjectId: ID,
  reason: 'spam',
  note: null,
  excerpt: 'Oi',
  status: 'open',
  resolvedAt: null,
  contentAvailable: true,
  reporter: { displayName: 'Ana', avatarAssetId: null },
  author: { displayName: 'Bia', avatarAssetId: null, isMember: true },
});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('fetchReports', () => {
  it('forwards estado and the cursor in the API vocabulary', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [item()], nextCursor: null }));
    const page = await fetchReports({ estado: 'resolvidas', cursor: 'c1' });
    expect(page.items).toHaveLength(1);
    const url = new URL(`http://x${vi.mocked(apiFetch).mock.calls[0]?.[0]}`);
    expect(url.pathname).toBe('/v1/admin/reports');
    expect(Object.fromEntries(url.searchParams)).toEqual({ estado: 'resolvidas', cursor: 'c1' });
  });

  it('the default is the open queue with no cursor', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await fetchReports({});
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/admin/reports?estado=abertas');
  });

  it('a 403 throws the typed client error', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => json(403, { error: { code: 'FORBIDDEN' } }));
    await expect(fetchReports({})).rejects.toBeInstanceOf(ApiClientError);
    await expect(fetchReports({})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('refuses an item with an unknown key', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [{ ...item(), conversationId: ID }], nextCursor: null }),
    );
    await expect(fetchReports({})).rejects.toThrow();
  });
});
