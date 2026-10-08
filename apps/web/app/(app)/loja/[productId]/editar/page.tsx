import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { ProductForm } from '@/app/(app)/loja/ProductForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { getProduct } from '@/lib/store';
import { type ProductFormCommunity, productFormDefaults } from '@/lib/store-view';

/**
 * `/loja/[productId]/editar` (08.2-10, D-362, D-363, UI-D-377): the edit half of the SAME form.
 *
 * **Permission first, then the read.** Without `store.product.manage` (the composed permission,
 * never a role) this is a not-found and the product is never requested. Every miss is the store's
 * one not-found (an unknown, foreign or vanished product), and so is a read FAILURE: a form filled
 * with blanks is never offered over a product that is fine.
 *
 * An ARCHIVED product is still editable: its form offers "Reativar produto" instead of "Arquivar".
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!storeOn || !bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) notFound();

  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const [result, all] = await Promise.all([
    getProduct(productId),
    communitiesOn ? listAllCommunities() : Promise.resolve(null),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status !== 'ok') notFound();

  const communities: ProductFormCommunity[] | null =
    all === null
      ? null
      : all.map((community) => ({
          id: community.id,
          name: community.name,
          coverAssetId: community.coverAssetId,
          coverVariantWidths: community.coverVariantWidths,
        }));

  return (
    <ProductForm
      mode="edit"
      productId={result.product.id}
      initial={productFormDefaults(result.product)}
      tenantName={bootstrap.tenant.displayName}
      communities={communities}
    />
  );
}
