import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { STORE_PATH } from '@/lib/store-area';
import { StoreManageScreen } from '../StoreManageScreen';

/**
 * `/loja/gerenciar` (2026-10-24, the Loja area): "Gerenciar", a manager's last row of the "· Loja"
 * menu and the Configurações "Loja" row's target: the products as management rows, the active ones or
 * `?filtro=arquivados`, and "Novo produto". `StoreManageScreen` draws it.
 *
 * The role split (D-362, as `/cursos/gerenciar`): a caller without `store.product.manage` is sent to
 * Produtos (the row is invisible to them, and a shared link should land on the store). The module
 * check repeats `layout.tsx`'s, because Next renders the layout and the page concurrently. A static
 * segment, so it wins over `[productId]`.
 */
export default async function StoreManagePage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string | string[] }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  if (!bootstrap.modules.some((module) => module.key === 'store')) notFound();
  if (!bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) redirect(STORE_PATH);

  return <StoreManageScreen filtro={params.filtro} />;
}
