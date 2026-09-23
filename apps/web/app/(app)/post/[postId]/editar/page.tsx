import { FEED_PERMISSIONS } from '@tria/module-feed/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ComposerForm } from '@/app/(app)/criar/ComposerForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadPost } from '@/lib/feed';
import { composerDraft } from '@/lib/feed-view';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/post/[postId]/editar` (FEED-03, D-57) — the SAME `ComposerForm` the create route renders, in
 * `edit` mode and pre-filled. One form component, two routes: a "detail variant" of the composer
 * would drift from the create screen on the first change to either.
 *
 * **Every miss is ONE screen** (UI-D-16), and there are four of them: an unknown id, another
 * tenant's post, a soft-deleted post — all three arrive as `loadPost`'s single `not-found` because
 * the API answers one indistinguishable bare 404 (D-23/T-04-01) — and a caller who is not the
 * author. The fourth collapses into the same `notFound()` deliberately: telling a second admin
 * "this exists but is not yours" is the existence oracle the author predicate exists to close
 * (T-04-54), and the API would refuse their `PATCH` with the identical bare 404 anyway.
 *
 * `canManage` is the API's OWN answer to "is this yours", read off the post it just returned rather
 * than recomputed here by comparing ids. The permission is checked beside it, not instead of it:
 * holding `feed.post.manage` is not the same as owning the post, and V1 requires both.
 *
 * A transport or 5xx failure is NOT dressed up as a miss: it goes back to the post's own page,
 * which owns that error state. `redirect()` and `notFound()` both throw (Next 16), so both sit
 * outside any try/catch — and reading the session and the host headers at request time is what
 * keeps this route out of the static list (`scripts/check-static-routes.sh`).
 */
export default async function EditPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { postId } = await params;
  const [tf, bootstrap, result] = await Promise.all([
    getTranslations('feed'),
    requireBootstrap(),
    loadPost(postId),
  ]);

  if (result.status === 'not-found') notFound();
  if (result.status === 'error') redirect(`/post/${encodeURIComponent(postId)}`);
  if (!result.post.canManage || !bootstrap.permissions.includes(FEED_PERMISSIONS.manage)) {
    notFound();
  }

  return (
    <ComposerForm
      mode="edit"
      postId={result.post.id}
      initial={composerDraft(result.post, tf)}
      tenantName={bootstrap.tenant.displayName}
    />
  );
}
