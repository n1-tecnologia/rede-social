import { MemberSkin } from '@rede-social/ui';
import { ShoppingBag } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { STORE_PATH } from '@/lib/store-area';
import { OUTLINE_LINK } from '../cursos/admin-styles';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from '../cursos/MemberEmptyCard';

/**
 * "Produto indisponível" (UI-D-384, E04 error): the ONE screen every product miss under `/loja`
 * lands on. Three causes reach it and must stay indistinguishable (an existence oracle over an
 * enumerable uuid space otherwise): an unknown id, another tenant's product, and an archived product
 * for someone who neither holds nor manages it. The API answers one bare 404 for all three.
 *
 * It takes no props and reads no param, so it cannot echo the id. The store being OFF never lands
 * here: `layout.tsx` throws that `notFound()` from the layout, which the parent's (generic) boundary
 * catches (UI-D-387).
 *
 * 2026-10-24 (the Loja redesign on the "área de membros"): the area's `MemberEmptyCard` on a wide
 * page at the member area's full width (`data-shell-full`, 2026-10-27), like the store's screens.
 */
export default async function StoreNotFound() {
  const t = await getTranslations('store');
  return (
    <MemberSkin>
      <div data-shell-full className="mx-auto flex w-full flex-col px-4 pt-4">
        <MemberEmptyCard
          icon={ShoppingBag}
          data-testid="store-not-found"
          className={MEMBER_EMPTY_WIDE}
          title={t('notFound.title')}
          body={t('notFound.body')}
          action={
            <a href={STORE_PATH} className={OUTLINE_LINK}>
              {t('notFound.cta')}
            </a>
          }
        />
      </div>
    </MemberSkin>
  );
}
