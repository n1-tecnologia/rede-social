import { defineModule } from '@rede-social/core/server/modules/manifest';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **D-121: Reels is its OWN module, and it owns no server code.** It reads posts only through feed's
 * published HTTP contract, `GET /v1/feed?media=video`, whose ONE ready-video fragment lives in feed's
 * service. There are no `routes` for two reasons that outlive this phase:
 *  - `turbo boundaries` forbids a module importing another module's server, so a reels router could
 *    not call `listFeed`;
 *  - a copy of feed's `postProjection` here would be a second query path, and D-73's "one query, one
 *    ordering expression" exists precisely so Reels can never list a post Início would not show the
 *    same member (Phase 9's follower rule then lands in one place).
 * Requiring the `feed` key makes the dependency explicit: while the tenant's `feed` flag is off this
 * module contributes nothing — no bootstrap entry, no permission — even with its own flag on
 * (`effectiveKeys` in `apps/api/src/modules/registry.ts`).
 *
 * **D-123: the tab sits at `order: 30`**, between Comunidades (20) and Phase 6's Eventos (40), with
 * `icon: 'film'` (already in `ICONS`, `packages/core/ui/nav.ts`). The pt-BR label comes from the
 * web catalog's `reels.nav` key when present, which wins over the fallback string below (PWA-03).
 * Navigation follows the FLAG, never the data (D-40, D-77): a tenant with zero videos still gets the
 * tab and lands on the empty state.
 *
 * **UI-D-81: `chrome: 'media'`** asks the shell to hide the mobile TopBar and float the BottomNav in
 * dark media chrome while this tab is active. The shell reads the flag from the nav entry; it never
 * tests a pathname.
 *
 * **D-124, reversed on 2026-10-09 at the product owner's request.** It read "there is no path into
 * Reels from a feed card; the tab is the only door". Now one tap on a feed video opens Reels OVER
 * the feed, already on that video, and a return arrow brings the member back to the same post at
 * the same place in the feed (the web's `ReelsOverlay`, opened by `useReelsOverlay` from Início, a
 * community's page and the post page). It is still the web's composition, never this manifest's: the
 * overlay exists only while this module is enabled (its props are composed only when `reels` is in
 * the bootstrap), and without it the tap keeps pausing the video in place. The tab stays a door.
 *
 * `home`, `jobs`, `events` and `defaultRolePermissions` are OMITTED rather than set to empty values,
 * so "declares none" and "declares an empty one" stay two different statements.
 */
export const reelsModule = defineModule({
  key: 'reels',
  nav: {
    placement: 'tab',
    label: 'Reels',
    icon: 'film',
    href: '/reels',
    order: 30,
    chrome: 'media',
  },
  requires: ['feed'],
});
