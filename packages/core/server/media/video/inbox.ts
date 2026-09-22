import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../../db/admin-tx';
import { enqueueInTx } from '../../jobs/boss';
import { videoProvider } from './index';
import { MEDIA_PROVIDER_EVENT_QUEUE, type VideoProviderEvent } from './types';

/**
 * The kernel half of `POST /v1/webhooks/mux`: record the provider's own event id EXACTLY once and
 * enqueue the state change in the SAME admin transaction (MEDIA-03, R-03, T-03-38).
 *
 * It lives here rather than in the route because the admin transaction lane is kernel-only — Biome
 * refuses `@tria/core/db/admin-tx` outside `server/{tenancy,platform,media}` — and because it is the
 * whole replay defence, which deserves one implementation a test can point at. The route stays what
 * it should be: read the raw body, verify the signature, call this, answer 2xx.
 *
 * `on conflict (id) do nothing returning id` returns zero rows for a delivery we have already seen,
 * and then NOTHING is enqueued: the caller answers 200 and Mux stops retrying. Mux warns that
 * duplicates happen even after a 2xx, so this is not a rare path. The enqueue additionally carries
 * `singletonKey = event.id` under the `short` queue policy, so two simultaneous FIRST deliveries —
 * which both pass the insert in different transactions only if the unique index lets them, and it
 * does not — still converge on one job.
 *
 * Returns whether this call was the one that enqueued.
 */
export async function recordProviderEvent(event: VideoProviderEvent): Promise<boolean> {
  return withAdminTx(async (tx) => {
    const rows = (await tx.execute(sql`
      insert into public.media_provider_events (id, provider, type)
      values (${event.id}, ${videoProvider.name}, ${event.rawType})
      on conflict (id) do nothing
      returning id`)) as unknown as { id: string }[];
    if (rows.length === 0) return false;
    await enqueueInTx(tx, MEDIA_PROVIDER_EVENT_QUEUE, event, { singletonKey: event.id });
    return true;
  });
}
