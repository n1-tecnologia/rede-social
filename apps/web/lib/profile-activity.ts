import type { TenantRole } from '@rede-social/contracts';
import {
  COMMUNITY_MAX_PAGE_SIZE,
  type CommunityPage,
} from '@rede-social/module-communities/contracts';
import type { CommunityAccessList } from '@rede-social/module-store/contracts';
import { cache } from 'react';
import { ApiClientError } from '@/lib/bootstrap';
import { getCommunities } from '@/lib/communities';
import { getMemberActivity } from '@/lib/dashboard';
import { type EventSectionsData, getEventSections } from '@/lib/events';
import { type ModuleFlags, readsCommunityAccess } from '@/lib/profile-activity-view';
import { getCommunityAccessList } from '@/lib/store';

/**
 * 2026-10-12 — the reads behind the profile's "Eventos" and "Comunidades" rails (`/perfil`): the
 * SAME `get*` calls the events, communities and store screens make, read so that none of them can be
 * the reason the profile fails. Each one:
 * - is React `cache`d, so the preload that started it and the section that reads it cost ONE
 *   request per render;
 * - NEVER throws and NEVER redirects: a refusal, a 5xx, a transport error or a body that fails the
 *   contract is `null` (the section then shows its own error card, never `app/error.tsx`). The
 *   wrapped `get*` helpers never call `redirect()` themselves (they throw `ApiClientError`), so
 *   swallowing here hides no navigation: a session problem is the page's own `requireBootstrap` to
 *   handle, the `loadNextEvent` posture;
 * - logs its failure SHAPE only (a status and a code, or the error's name), never a title or a
 *   name.
 */

/** A failure's shape for a log line: the API's status and code, or the thrown value's name. */
function failureShape(error: unknown): Record<string, unknown> {
  if (error instanceof ApiClientError) return { status: error.status, code: error.code };
  return { name: error instanceof Error ? error.name : typeof error };
}

/** Both periods of the events, the `/eventos` galleries' read (`getEventSections`), or `null`. */
export const profileEventSections = cache(async (): Promise<EventSectionsData | null> => {
  try {
    return await getEventSections();
  } catch (error) {
    console.error('profile.events_failed', failureShape(error));
    return null;
  }
});

/** ONE page of the active communities, the largest the API serves, in the list's order, or `null`. */
export const profileCommunityPage = cache(async (): Promise<CommunityPage | null> => {
  try {
    return await getCommunities({ limit: COMMUNITY_MAX_PAGE_SIZE });
  } catch (error) {
    console.error('profile.communities_failed', failureShape(error));
    return null;
  }
});

/**
 * The store's community access list, or `null`. `getCommunityAccessList` already never throws and
 * logs its own failures (the store being off is not one); this only adds the per-render `cache`.
 */
export const profileCommunityAccess = cache(
  (): Promise<CommunityAccessList | null> => getCommunityAccessList(),
);

/**
 * Starts, without waiting, every read the profile's sections will make, so they run beside the
 * page's own reads instead of after them (the sections then await the same `cache`d promises inside
 * their `Suspense`): the events with the events module, the community page with the communities
 * module, the access list when `readsCommunityAccess` says the page reads it (a member, with
 * both modules on), and (08.7-03) the member's own "Sua atividade" for the `member` role only. A
 * module that is off costs no request.
 */
export function preloadProfileSections(flags: ModuleFlags, role: TenantRole): void {
  if (role === 'member') void getMemberActivity();
  if (flags.events) void profileEventSections();
  if (flags.communities) void profileCommunityPage();
  if (readsCommunityAccess(flags, role)) void profileCommunityAccess();
}
