import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound } from 'next/navigation';
import { ProductForm } from '@/app/(app)/loja/ProductForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import type { ProductFormCommunity } from '@/lib/store-view';

/**
 * `/loja/novo` (08.2-10, D-362, STORE-02, UI-D-377): the create half of the product form.
 *
 * **Authorisation is the composed PERMISSION, never a role** (T-08.2-45): `store.product.manage`
 * read off the bootstrap, the value the API's route guard evaluates. Without it (or with the store
 * off, which `layout.tsx` already gates) this is a not-found: a member hand-typing the URL learns
 * nothing about an editor. The API refuses a crafted write independently.
 *
 * The picker's rows are the tenant's ACTIVE communities, read only while the communities module is
 * on (`listAllCommunities` never throws: an unreadable list offers no rows and the product still
 * saves without links).
 */
export default async function NewProductPage() {
  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!storeOn || !bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) notFound();

  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const communities: ProductFormCommunity[] | null = communitiesOn
    ? (await listAllCommunities()).map((community) => ({
        id: community.id,
        name: community.name,
        coverAssetId: community.coverAssetId,
        coverVariantWidths: community.coverVariantWidths,
      }))
    : null;

  return (
    <ProductForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      communities={communities}
    />
  );
}
