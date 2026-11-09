import { StoreBrowseSkeleton } from './StoreSkeletons';

/**
 * `/loja/loading.tsx` (UI-D-384, E02 loading). 2026-10-24 (the Loja area): Produtos' placeholder,
 * the header and the storefront's hero, tiles and shelf at the full width of the member area
 * (`data-shell-full`, 2026-10-27), so the column does not jump when the screen lands. The store's other screens and forms carry their own loading views.
 */
export default function StoreLoading() {
  return <StoreBrowseSkeleton front />;
}
