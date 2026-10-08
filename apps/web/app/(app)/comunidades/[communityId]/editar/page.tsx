import { COMMUNITY_PERMISSIONS } from '@rede-social/module-communities/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { CommunityForm } from '@/app/(app)/comunidades/CommunityForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCommunity } from '@/lib/communities';
import { getCommunityAccess } from '@/lib/store';
import { communityAccessProductsView } from '@/lib/store-view';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/comunidades/[communityId]/editar` (COMM-01, UI-D-38) — the edit half of the SAME form.
 *
 * The form is `create` bound to values (UI-SPEC E13/partial): this route resolves the community on
 * the server so the fields are filled on first paint, with no client fetch and no flash of an empty
 * form, and hands the SAME component the same props plus `communityId`.
 *
 * **Every miss is the community page's own one screen.** An unknown id, another tenant's and a
 * soft-deleted one all arrive as `loadCommunity`'s single `not-found` and render the shared
 * `not-found.tsx` one level up — the same words a member gets, with no hint that the editor exists.
 * A read FAILURE is different and also lands there rather than on a half-filled form: an editor
 * pre-filled with blanks would save blanks over a community that is perfectly fine.
 *
 * **An ARCHIVED community is still editable.** Archiving gates new POSTS and hides the container
 * from the list; it does not freeze its name and description, and "Reativar" has to be reachable
 * from somewhere (UI-D-37).
 *
 * **The read-only "Acesso" block (08.2-10, D-363, UI-D-379).** With the store on and the viewer
 * holding `store.product.manage`, the community's store access is read here and its `products`
 * (every linked product, archived included) handed to the form. `getCommunityAccess` answers `null`
 * on any failure; the form then renders WITHOUT the block (never a wrong list) and still saves.
 */
export default async function EditCommunityPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { communityId } = await params;
  const [bootstrap, result] = await Promise.all([requireBootstrap(), loadCommunity(communityId)]);

  if (!bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manage)) {
    redirect(`/comunidades/${communityId}`);
  }
  if (result.status !== 'ok') notFound();

  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const access = storeOn && canManageStore ? await getCommunityAccess(result.community.id) : null;
  const accessProducts = access?.products
    ? communityAccessProductsView(access.products)
    : undefined;

  return (
    <CommunityForm
      mode="edit"
      communityId={result.community.id}
      initial={{
        name: result.community.name,
        description: result.community.description,
        coverAssetId: result.community.coverAssetId,
        coverVariantWidths: result.community.coverVariantWidths,
        status: result.community.status,
      }}
      tenantName={bootstrap.tenant.displayName}
      accessProducts={accessProducts}
    />
  );
}
