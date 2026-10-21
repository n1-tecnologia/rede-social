import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { PAYMENTS_PERMISSIONS } from '@rede-social/module-payments/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProductForm } from '@/app/(app)/loja/ProductForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import { listProductFormCourses, listProductFormLives } from '@/lib/courses';
import { loadProductFormPayment } from '@/lib/product-payment';
import {
  type ProductFormCommunity,
  type ProductFormCourse,
  type ProductFormLinkList,
  type ProductFormLive,
  productFormCourseView,
  productFormLiveView,
} from '@/lib/store-view';

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
 *
 * **The product form is the only place a course or a live is linked** (08.4, D-418, UI-D-413): the
 * course and live lists are read only while the courses module is on AND the viewer holds
 * `courses.manage` (one gate for both blocks); otherwise the form gets `null`, the blocks are absent
 * and no `courseIds` / `liveIds` key is ever sent (SC 5). A failed list read still renders the form:
 * the sheet says the list could not load (UI-D-419). Every meta line is finished here, on the server.
 *
 * **The "Pagamento" block** (09.1-17, UI-D-524, D-502) follows the same rule: its data is read only while
 * the `payments` module is on AND the viewer holds `payments.manage`; otherwise (or when a read fails)
 * the form gets `null` and the block is absent from the DOM.
 */
export default async function NewProductPage() {
  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!storeOn || !bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) notFound();

  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const coursesOn =
    bootstrap.modules.some((module) => module.key === 'courses') &&
    bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  // 09.1-17: the "Pagamento" block exists only with the module on AND `payments.manage` (the courses rule).
  const paymentsOn =
    bootstrap.modules.some((module) => module.key === 'payments') &&
    bootstrap.permissions.includes(PAYMENTS_PERMISSIONS.manage);

  const [all, courseLoad, liveLoad, payment, t] = await Promise.all([
    communitiesOn ? listAllCommunities() : Promise.resolve(null),
    coursesOn ? listProductFormCourses() : Promise.resolve(null),
    coursesOn ? listProductFormLives() : Promise.resolve(null),
    paymentsOn ? loadProductFormPayment(null) : Promise.resolve(null),
    getTranslations(),
  ]);

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
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      communities={communities}
      courses={courses}
      lives={lives}
      payment={payment}
    />
  );
}
