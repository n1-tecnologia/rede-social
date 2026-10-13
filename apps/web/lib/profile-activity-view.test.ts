import { TENANT_ROLES } from '@rede-social/contracts';
import type { CommunityAccessList } from '@rede-social/module-store/contracts';
import { describe, expect, it } from 'vitest';
import {
  accessibleCommunities,
  moduleFlags,
  PROFILE_RAIL_SIZE,
  profileCompleteness,
  readsCommunityAccess,
} from './profile-activity-view';

/**
 * 2026-10-12 — what the profile shows under its hero, pure. The claims: the module flags are the
 * bootstrap's keys; the access list is read only for a member with both modules on; "Complete seu
 * perfil" counts the photo, the bio text and the Instagram; and the communities carousel drops only
 * the exclusives still locked.
 */

describe('moduleFlags and readsCommunityAccess', () => {
  it('the three flags are the bootstrap’s enabled keys; any other key is ignored', () => {
    expect(moduleFlags([])).toEqual({ events: false, communities: false, store: false });
    expect(moduleFlags([{ key: 'feed' }, { key: 'events' }, { key: 'store' }])).toEqual({
      events: true,
      communities: false,
      store: true,
    });
    expect(moduleFlags([{ key: 'communities' }, { key: 'chat' }])).toEqual({
      events: false,
      communities: true,
      store: false,
    });
  });

  it('the access list is read for a member with both modules on, and never otherwise', () => {
    const both = { events: false, communities: true, store: true };
    expect(readsCommunityAccess(both, 'member')).toBe(true);
    // Store off: nothing is locked and the endpoint is off. Communities off: nothing to show.
    expect(readsCommunityAccess({ ...both, store: false }, 'member')).toBe(false);
    expect(readsCommunityAccess({ ...both, communities: false }, 'member')).toBe(false);
    // Staff are never locked: the list would drop nothing.
    for (const role of TENANT_ROLES.filter((role) => role !== 'member')) {
      expect(readsCommunityAccess(both, role)).toBe(false);
    }
  });
});

describe('profileCompleteness — Foto, Bio and Instagram', () => {
  const profile = (avatarAssetId: string | null, bioText: string, instagram: string | null) =>
    profileCompleteness({ avatarAssetId, bioText, instagram });
  const PHOTO = '11111111-1111-4111-8111-111111111111';

  it('lists the three items in order and rounds the percentage', () => {
    expect(profile(null, '', null)).toEqual({
      items: [
        { key: 'photo', done: false },
        { key: 'bio', done: false },
        { key: 'instagram', done: false },
      ],
      done: 0,
      total: 3,
      percent: 0,
    });
    expect(profile(PHOTO, '', null).percent).toBe(33);
    expect(profile(PHOTO, 'Professora.', null).percent).toBe(67);
    expect(profile(PHOTO, 'Professora.', 'ana.souza')).toMatchObject({ done: 3, percent: 100 });
    expect(profile(null, '', 'ana.souza').items.map((item) => item.done)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('a bio of only whitespace is missing', () => {
    expect(profile(PHOTO, '  \n\t ', 'ana').items[1]).toEqual({ key: 'bio', done: false });
    expect(profile(PHOTO, '  \n\t ', 'ana').percent).toBe(67);
  });
});

describe('accessibleCommunities', () => {
  const community = (id: string, status: 'active' | 'archived' = 'active') => ({ id, status });
  const access = (rows: Array<[string, { gated?: boolean; locked: boolean }]>) =>
    ({
      items: rows.map(([communityId, row]) => ({
        communityId,
        gated: row.gated ?? true,
        locked: row.locked,
        archivedTag: false,
      })),
    }) satisfies CommunityAccessList;

  it('drops the locked exclusives and the archived, keeps the API order and the limit', () => {
    const items = [
      community('open-1'),
      community('locked'),
      community('unlocked'),
      community('archived', 'archived'),
      community('open-2'),
    ];
    const rows = access([
      ['locked', { locked: true }],
      ['unlocked', { locked: false }],
      // A row that is not gated never drops its community.
      ['open-2', { gated: false, locked: true }],
    ]);

    expect(accessibleCommunities(items, rows).map((item) => item.id)).toEqual([
      'open-1',
      'unlocked',
      'open-2',
    ]);
    expect(accessibleCommunities(items, rows, 2).map((item) => item.id)).toEqual([
      'open-1',
      'unlocked',
    ]);
  });

  it('without an access list nothing is dropped but the archived, at most a rail by default', () => {
    expect(PROFILE_RAIL_SIZE).toBe(10);
    const many = Array.from({ length: 12 }, (_, index) => community(`c${index + 1}`));
    expect(accessibleCommunities(many, null)).toHaveLength(PROFILE_RAIL_SIZE);
    expect(
      accessibleCommunities([community('a'), community('b', 'archived')], null).map(
        (item) => item.id,
      ),
    ).toEqual(['a']);
  });
});
