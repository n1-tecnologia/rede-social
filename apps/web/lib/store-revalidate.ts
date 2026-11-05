import { revalidatePath } from 'next/cache';
import { STORE_MANAGE_PATH, STORE_OWNED_PATH, STORE_PATH } from '@/lib/store-area';

/**
 * 2026-10-24 (the Loja area) — revalidates every store screen a product write can change: Produtos
 * (`/loja`), Comprados (`/loja/comprados`), Gerenciar (`/loja/gerenciar`, both lists: the query is not
 * part of the path) and, given its id, the product's page. Explicit paths rather than
 * `revalidatePath('/loja', 'layout')`, so each screen is named where the writes are. Not a
 * `'use server'` module, so the actions may import it.
 */
export function revalidateStoreScreens(productId?: string): void {
  for (const path of [STORE_PATH, STORE_OWNED_PATH, STORE_MANAGE_PATH]) revalidatePath(path);
  if (productId) revalidatePath(`${STORE_PATH}/${productId}`);
}
