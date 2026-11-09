import { cookies } from 'next/headers';
import { HOME_PROMO_COOKIE, parseHomePromoChoice } from './home-promo';

/** The administrator's promotion pick on THIS device (`lib/home-promo.ts`), or `null`. Server only. */
export async function readHomePromoChoice(): Promise<string | null> {
  return parseHomePromoChoice((await cookies()).get(HOME_PROMO_COOKIE)?.value);
}
