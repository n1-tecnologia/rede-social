import type { PhoneLayout } from '@rede-social/core/ui';
import { cookies } from 'next/headers';
import {
  LEGACY_NAV_ORDER_COOKIE,
  PHONE_NAV_LAYOUT_COOKIE,
  parseLegacyNavOrder,
  parsePhoneNavLayout,
} from '@/lib/phone-nav-layout';

/** The phone's menu on THIS device (`lib/phone-nav-layout.ts`), read on the server. */
export async function readPhoneNavLayout(): Promise<PhoneLayout | null> {
  const jar = await cookies();
  return (
    parsePhoneNavLayout(jar.get(PHONE_NAV_LAYOUT_COOKIE)?.value) ??
    parseLegacyNavOrder(jar.get(LEGACY_NAV_ORDER_COOKIE)?.value)
  );
}
