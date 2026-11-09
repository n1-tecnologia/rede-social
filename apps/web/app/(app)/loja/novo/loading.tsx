import { ProductFormSkeleton } from '../StoreSkeletons';

/**
 * `/loja/novo` while it loads (2026-10-24): the form's own 680px placeholder. Without it the nearest
 * boundary would be Produtos' wide one, and the column would shrink when the form lands.
 */
export default function NewProductLoading() {
  return <ProductFormSkeleton />;
}
