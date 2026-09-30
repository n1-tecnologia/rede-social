import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { NotificationRetraction } from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';

/** What a producer's retraction names: the rows whose subject (or object) is this target. */
export type RetractionMatch = ReturnType<NotificationRetraction['match']>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keep-and-mark retraction (07-04, planning decision 1): every row of the CALLER's tenant whose
 * subject (or object) is `match` keeps its place in the list but loses its payload, which becomes
 * exactly `{"removed": true}`. The excerpt, the names and every other fact are dropped, so the bell
 * never becomes a way to read what an author or a moderator took down (the plan's prohibition).
 *
 * The write is the SECURITY DEFINER `app.notifications_retract` (the table has no member-lane write
 * path for another user's rows), scoped to `app.tenant_id()` inside the function. Returns how many
 * rows changed; a second call for the same target changes none (idempotent).
 *
 * A match whose id is not a uuid (a producer bug) is skipped rather than raised: pg-boss would retry
 * the cast failure forever against a payload that can never become valid.
 */
export async function retractNotifications(tx: Tx, match: RetractionMatch): Promise<number> {
  if (!UUID.test(match.id)) return 0;
  const rows = await tx.execute<{ n: number }>(sql`
    select app.notifications_retract(${match.on}::text, ${match.type}::text, ${match.id}::uuid) as n`);
  return Number(rows[0]?.n ?? 0);
}
