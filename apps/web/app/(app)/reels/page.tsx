import { notFound } from 'next/navigation';
import { ReelsHost } from '@/components/reels/ReelsHost';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadReelsPage, loadVideoCommunities } from '@/lib/reels';
import { reelsHostProps } from '@/lib/registry';

/**
 * `/reels` (REELS-02, D-121, D-123, UI-D-92) — the tenant's ready videos, full screen, reached from
 * the "Reels" tab the module's manifest declares (label from the catalog's `reels.nav`).
 *
 * **Gated by the module list, not by a role.** The bootstrap already applied `effectiveKeys`
 * (05.3-01), so `reels` is absent from `bootstrap.modules` both when the tenant turned Reels off
 * and when it turned the FEED off (Reels requires the feed). Either way this is the not-found
 * screen. `notFound()` throws in Next 16, so it sits outside any try/catch; the feed routes behind
 * the data reads answer 404 on their own when the feed is off (T-05.3-18).
 *
 * **First paint is server-rendered** (UI-D-92): the first "Todos" keyset page and the lanes are read
 * in parallel, so the tab opens on a video rather than on a spinner. `loadReelsPage` answers `null`
 * on a failed read (the host renders the stage error with a retry), and `loadVideoCommunities`
 * degrades to `[]` (the lane row hides, D-120).
 *
 * **No playback credential here** (D-44, T-05-34, T-05.3-19). A page carries asset ids and
 * dimensions only; the host mints the ±1 window through its batched server action, into a map that
 * lives in the client for the visit. Nothing token-related is imported by this file.
 *
 * **Every string, action and permission is composed by `reelsHostProps`** (`lib/registry.tsx`,
 * PWA-03), the one block the overlay a feed video opens reads too (2026-10-09), so the tab and the
 * overlay can never word or wire a Reel differently.
 */
export default async function ReelsPage() {
  const bootstrap = await requireBootstrap();

  if (!bootstrap.modules.some((module) => module.key === 'reels')) notFound();

  const [initial, lanes, host] = await Promise.all([
    loadReelsPage({}),
    loadVideoCommunities(),
    reelsHostProps(bootstrap),
  ]);

  return <ReelsHost {...host} initial={initial} lanes={lanes} />;
}
