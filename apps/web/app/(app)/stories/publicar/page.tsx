import { STORY_PERMISSIONS } from '@tria/module-stories/contracts';
import { redirect } from 'next/navigation';
import { StoryComposer } from '@/app/(app)/stories/publicar/StoryComposer';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/stories/publicar` (STORY-01, D-81, UI-D-39) — the full-screen publish route, and surface 3 of
 * the five the design prototype does not have.
 *
 * **Authorisation is the composed PERMISSION, never a role comparison** (T-05-25). The page reads
 * `stories.story.publish` off the bootstrap — the identical value `requirePermission` evaluates on
 * the API — so V2's member stories are a `tenant_modules['stories'].settings` flip with no web
 * change. A caller without it goes back to `/inicio` rather than being shown a form they could fill
 * in and then be refused on; the API refuses the write independently regardless, which is what makes
 * this a UX decision rather than the security boundary.
 *
 * **There is no public render path.** The route lives inside the `(app)` group, so `proxy.ts`
 * bounces a session-less visitor to `/entrar` before this file runs, and it reads the session and
 * the host headers at request time — which is what keeps it OUT of the static route list
 * (`scripts/check-static-routes.sh`). `redirect()` throws in Next 16, so it sits outside any catch.
 *
 * The header's trailing "Seus stories" action points at `/stories/meus`, which **05-08 creates**.
 * Until then it is the one deliberately inert link on this screen — recorded as a known stub rather
 * than hidden, because a text action that appeared only once its destination existed would be a
 * second thing for 05-08 to remember.
 */
export default async function PublishStoryPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(STORY_PERMISSIONS.publish)) redirect('/inicio');

  return <StoryComposer historyHref="/stories/meus" />;
}
