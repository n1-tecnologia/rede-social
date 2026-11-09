import { ProductFormSkeleton } from '../../StoreSkeletons';

/**
 * `/loja/{id}/editar` while it loads (2026-10-24): the form's own 680px placeholder. Without it the
 * nearest boundary would be the product page's wide one, and the column would shrink when the form
 * lands.
 */
export default function EditProductLoading() {
  return <ProductFormSkeleton />;
}
