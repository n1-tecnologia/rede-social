import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every webhook a video provider ever delivered, keyed by the PROVIDER's own event id (MEDIA-03,
 * R-03, RESEARCH Pitfall 6).
 *
 * This table IS the replay defence. `POST /v1/webhooks/mux` inserts `event.id` with
 * `on conflict (id) do nothing returning id`; a zero-row return means "already seen", so the route
 * answers 200 and enqueues nothing. Mux retries for 24 h with increasing delays and warns that
 * duplicates happen even after a 2xx, so without this a replayed `video.asset.ready` would apply a
 * state change twice (T-03-38).
 *
 * It carries NO `tenant_id` by design: a provider's event id is global, and the tenant is resolved
 * from the asset the event names. That also keeps it out of the "every tenant table is indexed
 * tenant-first" convention, which would be meaningless here.
 *
 * RLS is enabled with **no policy at all**, deliberately — the same shape as `platform_admins`
 * (01-03) and `tenant_invites` (02-03). Webhook traffic is written and read by the admin lane only;
 * a tenant lane (`authenticated`) has no business seeing another community's transcode traffic, and
 * with the schema-wide SELECT grant from 20260912031029 a policy is the only thing that could expose
 * the table (T-03-45). Adding a policy for `authenticated` here is always a bug
 * (SCHEMA-CONVENTIONS (i)); `supabase/tests/010` lists the table and `040` pins the zero-policy
 * count at ZERO.
 */
export const mediaProviderEvents = pgTable(
  'media_provider_events',
  {
    /** The provider's own event id — the idempotency arbiter, not a generated uuid. */
    id: text().primaryKey(),
    provider: text().notNull(),
    /** The raw provider event type, e.g. `video.asset.ready`. Never a provider message. */
    type: text().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The only read pattern: "what arrived recently" during an incident, and the 03-08 sweeper.
    index('media_provider_events_received_idx').on(t.receivedAt),
  ],
).enableRLS();
