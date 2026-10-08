import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';

/**
 * The store's module gate for every `/loja*` route (UI-D-387, 08.2-07).
 *
 * With `store` absent from `bootstrap.modules` (the tenant has it off, the default), `notFound()` is
 * thrown HERE, in the segment's layout, on purpose: a layout's `notFound()` is caught by the PARENT
 * segment's boundary, not by `loja/not-found.tsx`. So a store that is off renders the app's generic
 * not-found, never the store's own "Produto indisponível" card, which is reserved for a product that
 * is unknown, another tenant's, or archived for a non-holder.
 *
 * `requireBootstrap` is React-cached, so the page below reads the same bootstrap with no second call.
 */
export default async function StoreLayout({ children }: { children: ReactNode }) {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.modules.some((module) => module.key === 'store')) notFound();
  return children;
}
