import type { TenantRole } from '@rede-social/contracts';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { CommunityAccessList } from '@rede-social/module-store/contracts';

/**
 * 2026-10-12 — what the profile (`/perfil`) shows under its hero, computed from reads other screens
 * already make: no endpoint of its own, nothing in the backend. Pure (no React, no catalog, no
 * clock): the page passes the bootstrap's modules, the profile and its reads, and translates what
 * comes back. Since 2026-10-13 that is the "Complete seu perfil" warning and the Eventos and
 * Comunidades rails (the "Atividades" dashboard was removed at the owner's request).
 */

/**
 * How many items each profile rail shows at most: the Eventos posters and the Comunidades tiles. The
 * screens behind "Ver todos" / "Ver todas" (`/eventos/meus`, `/comunidades`) have the rest.
 */
export const PROFILE_RAIL_SIZE = 10;

/** Which of the modules the profile's sections depend on are on for this tenant. */
export type ModuleFlags = { events: boolean; communities: boolean; store: boolean };

/**
 * The bootstrap's enabled modules → the profile's flags. A module that is off has no section and
 * no skeleton on the profile, and costs no request.
 */
export function moduleFlags(modules: readonly { key: string }[]): ModuleFlags {
  const on = new Set(modules.map((module) => module.key));
  return { events: on.has('events'), communities: on.has('communities'), store: on.has('store') };
}

/**
 * Whether the Comunidades rail reads the store's community access list
 * (`GET /v1/store/community-access`) to drop the exclusives still locked for the viewer. Only for a
 * `member` with BOTH modules on:
 * - with the store off nothing is locked (`app.community_locked_ids()` reads the store's module
 *   flag) and the endpoint answers 404, so no store request is made at all (the `/comunidades` P81
 *   rule);
 * - staff are never locked (the API answers `locked: false` for every row), so for them the list
 *   would drop nothing.
 * When it is false the page passes `null` to `accessibleCommunities` (nothing dropped, the right
 * answer in both cases).
 */
export function readsCommunityAccess(flags: ModuleFlags, role: TenantRole): boolean {
  return flags.communities && flags.store && role === 'member';
}

/** One item of "Complete seu perfil". */
export type ProfileCompletenessItem = { key: 'photo' | 'bio' | 'instagram'; done: boolean };

export type ProfileCompleteness = {
  items: ProfileCompletenessItem[];
  done: number;
  total: number;
  /** 0 to 100, rounded: 0, 33, 67 or 100 for the three items. */
  percent: number;
};

/**
 * How complete the member's own profile is: the photo, the bio TEXT (a bio of only whitespace is
 * missing) and the Instagram handle, the last two as `splitProfileBio` splits the stored bio.
 */
export function profileCompleteness(profile: {
  avatarAssetId: string | null;
  bioText: string;
  instagram: string | null;
}): ProfileCompleteness {
  const items: ProfileCompletenessItem[] = [
    { key: 'photo', done: profile.avatarAssetId !== null },
    { key: 'bio', done: profile.bioText.trim() !== '' },
    { key: 'instagram', done: profile.instagram !== null },
  ];
  const done = items.filter((item) => item.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100) };
}

/**
 * The communities the viewer can open, for the profile's carousel: the ACTIVE ones, minus the
 * exclusive communities still locked for them (an access row that is `gated` and `locked`), in the
 * API's order (an admin's order, then the most recent activity), at most `limit`. Without an access
 * list (not read, see `readsCommunityAccess`, or a failed hint read) nothing is dropped, as on
 * `/comunidades`: the gate itself is server-side, so a locked community opened from here still shows
 * only its sample.
 */
export function accessibleCommunities<T extends Pick<CommunitySummary, 'id' | 'status'>>(
  items: readonly T[],
  access: CommunityAccessList | null,
  limit = PROFILE_RAIL_SIZE,
): T[] {
  const locked = new Set(
    (access?.items ?? []).filter((row) => row.gated && row.locked).map((row) => row.communityId),
  );
  return items
    .filter((community) => community.status === 'active' && !locked.has(community.id))
    .slice(0, limit);
}
