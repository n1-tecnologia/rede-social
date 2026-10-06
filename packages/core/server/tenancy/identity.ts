import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

/**
 * D-314: does this identity already have a password? Read through the SECURITY DEFINER
 * `app.identity_has_password` (migration `20261006215630_identity_has_password.sql`) on the bare
 * `api_user` connection, like the membership lookups in `membership.ts`: `auth.users` is not
 * readable by the API's role, and the function answers a boolean only, never the hash.
 *
 * `GET /v1/me/invite` asks it for the accept screen (`passwordRequired = !identityHasPassword`), so
 * an identity that already has a password accepts an invite without setting a new one, and one
 * that has none (a fresh GoTrue invite) still sets it. The invite sender asks the same function
 * inside its admin transaction (`identityKind` in `platform/invites.ts`). Never cached: a password
 * set on another tab must be seen on the next request.
 */
export async function identityHasPassword(userId: string): Promise<boolean> {
  const rows = await db.execute<{ has_password: boolean }>(
    sql`select app.identity_has_password(${userId}::uuid) as has_password`,
  );
  return rows[0]?.has_password === true;
}
