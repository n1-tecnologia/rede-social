import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProductForm } from '@/app/(app)/loja/ProductForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { listProductFormCourses, listProductFormLives } from '@/lib/courses';
import { getProduct } from '@/lib/store';
import {
  type ProductFormCommunity,
  type ProductFormCourse,
  type ProductFormLinkList,
  type ProductFormLive,
  productFormCourseView,
  productFormDefaults,
  productFormLiveView,
} from '@/lib/store-view';

/**
 * `/loja/[productId]/editar` (08.2-10, D-362, D-363, UI-D-377): the edit half of the SAME form.
 *
 * **Permission first, then the read.** Without `store.product.manage` (the composed permission,
 * never a role) this is a not-found and the product is never requested. Every miss is the store's
 * one not-found (an unknown, foreign or vanished product), and so is a read FAILURE: a form filled
 * with blanks is never offered over a product that is fine.
 *
 * An ARCHIVED product is still editable: its form offers "Reativar produto" instead of "Arquivar".
 *
 * **The product form is the only place a course or a live is linked** (08.4, D-418, UI-D-413): the
 * course and live lists are read only while the courses module is on AND the viewer holds
 * `courses.manage`; otherwise the form gets `null` and the blocks are absent (SC 5). The saved rows
 * come from the product detail (manager-only `courses` / `lives`), so a linked course outside the
 * walked picker pages, or a failed list read, still shows as a selected row (UI-D-415, UI-D-419).
 * Every meta line is finished here, on the server, in the tenant's timezone (UI-D-288).
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
  const coursesOn =
    bootstrap.modules.some((module) => module.key === 'courses') &&
    bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);
  const [result, all, courseLoad, liveLoad, t] = await Promise.all([
    getProduct(productId),
    communitiesOn ? listAllCommunities() : Promise.resolve(null),
    coursesOn ? listProductFormCourses() : Promise.resolve(null),
    coursesOn ? listProductFormLives() : Promise.resolve(null),
    getTranslations(),
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

  const courses: ProductFormLinkList<ProductFormCourse> | null =
    courseLoad === null
      ? null
      : {
          items: courseLoad.items.map((row) => productFormCourseView(row, t)),
          failed: courseLoad.failed,
          capped: courseLoad.capped,
        };

  const timeZone = bootstrap.tenant.timezone;
  const lives: ProductFormLinkList<ProductFormLive> | null =
    liveLoad === null
      ? null
      : {
          items: liveLoad.items.map((row) => productFormLiveView(row, t, timeZone)),
          failed: liveLoad.failed,
          capped: liveLoad.capped,
        };

  return (
    <ProductForm
      mode="edit"
      productId={result.product.id}
      initial={productFormDefaults(result.product, t, timeZone)}
      tenantName={bootstrap.tenant.displayName}
      communities={communities}
      courses={courses}
      lives={lives}
    />
  );
}
