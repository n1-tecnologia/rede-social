import { COMMUNITY_MAX_PAGE_SIZE } from '@rede-social/module-communities/contracts';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { getCommunities } from '@/lib/communities';
import { getEventSections } from '@/lib/events';
import { getCommunityAccessList } from '@/lib/store';
import {
  preloadProfileSections,
  profileCommunityAccess,
  profileCommunityPage,
  profileEventSections,
} from './profile-activity';

/**
 * 2026-10-12 — the profile's reads. The claims:
 *
 *  1. **Each loader asks what its screen already asks**: both event periods (`getEventSections`),
 *     ONE page of the communities at the widest size, the store's access list.
 *  2. **None of them throws or navigates**: a refusal (a 401 included), a 5xx or a thrown error is
 *     `null`, logged with its SHAPE only (a status and a code, or the error's name), never a name or
 *     a title.
 *  3. **The preload asks only what the page will read**: nothing for a module that is off, and the
 *     access list only for a member with the communities and the store on.
 *
 * What is stubbed: the three `get*` helpers (their own tests cover the transport). React's `cache`
 * passes through outside a render, so every call below reaches its helper.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/events', () => ({ getEventSections: vi.fn() }));
vi.mock('@/lib/communities', () => ({ getCommunities: vi.fn() }));
vi.mock('@/lib/store', () => ({ getCommunityAccessList: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const SECRET = 'Comunidade Secreta de Ana';
const SECTIONS = { upcoming: [], past: [] };
const PAGE = { items: [], nextCursor: null };
const ACCESS = { items: [] };

/** One spy for the file, cleared before each case, so a case sees only its own log lines. */
const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(getEventSections).mockReset().mockResolvedValue(SECTIONS);
  vi.mocked(getCommunities).mockReset().mockResolvedValue(PAGE);
  vi.mocked(getCommunityAccessList).mockReset().mockResolvedValue(ACCESS);
  vi.mocked(redirect).mockClear();
  logged.mockClear();
});

describe('the loaders ask what their screens ask (1)', () => {
  it('the events: both periods, as the /eventos galleries read them', async () => {
    await expect(profileEventSections()).resolves.toBe(SECTIONS);
    expect(getEventSections).toHaveBeenCalledTimes(1);
  });

  it('the communities: ONE page at the widest size, the active list (no status)', async () => {
    await expect(profileCommunityPage()).resolves.toBe(PAGE);
    expect(getCommunities).toHaveBeenCalledWith({ limit: COMMUNITY_MAX_PAGE_SIZE });
  });

  it('the access list: the store’s own never-throwing read, answered as is', async () => {
    await expect(profileCommunityAccess()).resolves.toBe(ACCESS);
    vi.mocked(getCommunityAccessList).mockResolvedValueOnce(null);
    await expect(profileCommunityAccess()).resolves.toBeNull();
  });
});

describe('never a throw, never a navigation, a log line with the shape only (2)', () => {
  const loaders = [
    ['profile.events_failed', profileEventSections, getEventSections],
    ['profile.communities_failed', profileCommunityPage, getCommunities],
  ] as const;

  it('an API refusal (a 401 included) or a 5xx is null, logged with its status and code', async () => {
    for (const [line, load, helper] of loaders) {
      for (const error of [
        new ApiClientError(401, 'UNAUTHENTICATED'),
        new ApiClientError(503, 'UNAVAILABLE', { name: SECRET }),
      ]) {
        vi.mocked(helper).mockRejectedValueOnce(error);
        await expect(load(), line).resolves.toBeNull();
        expect(logged).toHaveBeenLastCalledWith(line, { status: error.status, code: error.code });
      }
    }
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('a thrown error is null, logged with its name only, never its message', async () => {
    for (const [line, load, helper] of loaders) {
      vi.mocked(helper).mockRejectedValueOnce(new TypeError(`fetch failed for ${SECRET}`));
      await expect(load(), line).resolves.toBeNull();
      expect(logged).toHaveBeenLastCalledWith(line, { name: 'TypeError' });
    }
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('preloadProfileSections — only what the page will read (3)', () => {
  const off = { events: false, communities: false, store: false };
  const calls = () => ({
    events: vi.mocked(getEventSections).mock.calls.length,
    communities: vi.mocked(getCommunities).mock.calls.length,
    access: vi.mocked(getCommunityAccessList).mock.calls.length,
  });

  it('every module off: no request at all', () => {
    preloadProfileSections(off, 'member');
    expect(calls()).toEqual({ events: 0, communities: 0, access: 0 });
  });

  it('each module starts its own read, once', () => {
    preloadProfileSections({ ...off, events: true }, 'member');
    expect(calls()).toEqual({ events: 1, communities: 0, access: 0 });

    preloadProfileSections({ ...off, communities: true }, 'member');
    // The store is off: nothing is locked, so no store request is made for the carousel.
    expect(calls()).toEqual({ events: 1, communities: 1, access: 0 });

    // The store alone: the profile reads nothing of it.
    preloadProfileSections({ ...off, store: true }, 'member');
    expect(calls()).toEqual({ events: 1, communities: 1, access: 0 });
  });

  it('the access list: a member with the communities and the store on, never the staff', () => {
    const all = { events: true, communities: true, store: true };
    preloadProfileSections(all, 'member');
    expect(calls()).toEqual({ events: 1, communities: 1, access: 1 });

    preloadProfileSections(all, 'admin_tenant');
    preloadProfileSections(all, 'support_tenant');
    expect(calls()).toEqual({ events: 3, communities: 3, access: 1 });
  });
});
