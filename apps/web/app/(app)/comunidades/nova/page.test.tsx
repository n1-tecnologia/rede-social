import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-13 (UI-D-707, UI-D-716) — `/comunidades/nova` decides WHICH screen a caller gets, from the composed
 * permissions the bootstrap carries and the quota the list read carries (never a role comparison):
 *
 *  - an admin (`communities.community.manage`) gets the shipped form, untouched;
 *  - a member holding `communities.community.create` gets the form in member mode while under the limit
 *    and the limit screen (`limitReached`) AT the limit;
 *  - limit 0, or neither permission (which is what `social` off looks like to a member), goes back to
 *    `/comunidades`.
 *
 * The page is an async server component: it is called directly with its collaborators mocked and the
 * element it returns is inspected. The post-hoc coverage of behavior written in the same task's commit.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  quota: null as { ownedActive: number; limit: number } | null,
  loadCommunities: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: 'tenant' }) }));
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: { displayName: 'Rede Demo' },
  }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/communities', async (orig) => ({
  ...(await orig<typeof import('@/lib/communities')>()),
  loadCommunities: (...args: unknown[]) => mocks.loadCommunities(...args),
}));
vi.mock('@/app/(app)/comunidades/CommunityForm', () => ({ CommunityForm: () => null }));

const { default: NewCommunityPage } = await import('./page');

const MANAGE = 'communities.community.manage';
const CREATE = 'communities.community.create';

const props = async () =>
  ((await NewCommunityPage()) as ReactElement<Record<string, unknown>>).props;

beforeEach(() => {
  mocks.permissions = [];
  mocks.quota = null;
  mocks.redirect.mockClear();
  mocks.loadCommunities.mockReset();
  mocks.loadCommunities.mockImplementation(async () => ({
    items: [],
    nextCursor: null,
    memberQuota: mocks.quota,
  }));
});

describe('/comunidades/nova — who gets which screen (UI-D-707)', () => {
  it('1. an admin gets the shipped form and no quota read at all', async () => {
    mocks.permissions = [MANAGE];

    const p = await props();

    expect(p.mode).toBe('create');
    expect(p.memberMode).toBeUndefined();
    expect(p.limitReached).toBeUndefined();
    expect(mocks.loadCommunities).not.toHaveBeenCalled();
  });

  it('2. a member under the limit gets the member form', async () => {
    mocks.permissions = [CREATE];
    mocks.quota = { ownedActive: 1, limit: 3 };

    const p = await props();

    expect(p.memberMode).toBe(true);
    expect(p.limitReached).toBeUndefined();
    expect(p.tenantName).toBe('Rede Demo');
  });

  it('3. a member AT the limit gets the limit screen, naming the limit', async () => {
    mocks.permissions = [CREATE];
    mocks.quota = { ownedActive: 3, limit: 3 };

    expect((await props()).limitReached).toEqual({ limit: 3 });
  });

  it('4. limit 0 sends the member back to the list', async () => {
    mocks.permissions = [CREATE];
    mocks.quota = { ownedActive: 0, limit: 0 };

    await expect(props()).rejects.toThrow('REDIRECT:/comunidades');
  });

  it('5. neither permission (social off for a member) goes back to the list', async () => {
    mocks.permissions = [];

    await expect(props()).rejects.toThrow('REDIRECT:/comunidades');
    expect(mocks.loadCommunities).not.toHaveBeenCalled();
  });
});
