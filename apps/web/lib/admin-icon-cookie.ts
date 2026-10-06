import { cookies } from 'next/headers';
import { ADMIN_ICON_COOKIE, type AdminIconChoice, parseAdminIconChoice } from './admin-icon';

/** The viewer's own icon pick on THIS device (`lib/admin-icon.ts`), or `null`. Server only. */
export async function readAdminIconChoice(): Promise<AdminIconChoice | null> {
  return parseAdminIconChoice((await cookies()).get(ADMIN_ICON_COOKIE)?.value);
}
