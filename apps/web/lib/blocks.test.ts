import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 11-20 (CHAT-07, UI-D-635): the blocked-list loader over the strict contract, and the finished row. */

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => api.apiFetch(...args) }));

const { blockedMemberView, fetchBlocks } = await import('./blocks');

const USER = '00000000-0000-4000-8000-000000000001';
const ASSET = '00000000-0000-4000-8000-0000000000aa';
const row = {
  userId: USER,
  displayName: 'Carla Nunes',
  avatarAssetId: null,
  blockedAt: '2026-11-19',
};

beforeEach(() => api.apiFetch.mockReset());

describe('fetchBlocks', () => {
  it('reads page 1 with no cursor and parses the strict list', async () => {
    api.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [row], nextCursor: null })),
    );
    const page = await fetchBlocks();
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/blocks');
    expect(page.items).toHaveLength(1);
  });

  it('forwards the opaque cursor encoded', async () => {
    api.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], nextCursor: null })),
    );
    await fetchBlocks({ cursor: 'a b+c' });
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/blocks?cursor=a+b%2Bc');
  });

  it('refuses a key the contract does not name', async () => {
    api.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ ...row, blockedBy: 'x' }], nextCursor: null })),
    );
    await expect(fetchBlocks()).rejects.toThrow();
  });

  it('throws on a non-2xx, naming the status', async () => {
    api.apiFetch.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(fetchBlocks()).rejects.toMatchObject({ status: 403 });
  });
});

describe('blockedMemberView', () => {
  it('keeps the id the caller own list returned, the name and the avatar URL', () => {
    expect(blockedMemberView({ ...row, avatarAssetId: ASSET })).toMatchObject({
      userId: USER,
      name: 'Carla Nunes',
    });
    expect(blockedMemberView({ ...row, avatarAssetId: ASSET }).avatarUrl).toContain(ASSET);
  });

  it('a departed member has a null name and no avatar', () => {
    expect(blockedMemberView({ ...row, displayName: null })).toEqual({
      userId: USER,
      name: null,
      avatarUrl: null,
    });
  });
});
