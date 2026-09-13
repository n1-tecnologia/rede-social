import { eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { platformAdmins } from '../../db/schema';

/**
 * ROLE-01: is this identity TRIA platform staff? `platform_admins` has RLS enabled and **no policy**,
 * so the tenant lane can never see a row — the admin lane is the only reader, and this file is one of
 * the few places Biome's `noRestrictedImports` allows to open it.
 *
 * Never cached: a revoked super admin must lose the platform lane on the very next request, exactly
 * like a blocked membership (D-09). One indexed primary-key lookup per `/v1/platform/*` request.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return withAdminTx(async (tx) => {
    const rows = await tx
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, userId))
      .limit(1);
    return rows.length > 0;
  });
}
