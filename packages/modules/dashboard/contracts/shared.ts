import { z } from 'zod';

/**
 * The dashboard's shared contract pieces (08.7-01, D-455, D-462, D-464). Every API answer of the two
 * panels is built from these, and they REPLACE the fixtures' `ReportValue` / `ExampleValue` for API
 * answers: an API schema has no example branch at all, so no fictional value can ever be served as
 * a measured one (D-455). The fixtures keep their own types for tests and previews.
 *
 * Snapshots hold ids and numbers only (PR-1): no member name, caption, comment body or support text
 * ever travels in a snapshot row, a job payload or a log line; labels are joined live at read time.
 */

/** The dashboard's pg-boss queues (08.7-01). Registered by the app registry: the dashboard has no manifest. */
export const DASHBOARD_QUEUES = {
  snapshotBuild: 'dashboard.snapshot-build',
} as const;

/**
 * The zero user: never a real user. The builder (`app.dashboard_build_snapshot`) refuses every lane
 * whose `sub` claim is not this id, so a request lane can never trigger a build (T-08.7-03). The
 * dashboard cannot import another module's system context (MOD-02), so it owns its own.
 */
export const DASHBOARD_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * What the app must start collecting before a metric can be measured: the shipped
 * `NotMeasuredReason` list of `fixtures/shared.ts`, plus `needs_member_exit` and `needs_offers`.
 */
export const NOT_MEASURED_REASONS = [
  'needs_billing_per_client',
  'needs_post_views',
  'needs_saves',
  'needs_shares',
  'needs_video_playback',
  'needs_product_page_views',
  'needs_usage_sessions',
  'needs_story_view_time',
  'needs_waitlist',
  'needs_access_expiry',
  'needs_support_subject',
  'needs_event_tickets',
  'needs_gallery_swipes',
  'needs_link_clicks',
  'needs_story_taps',
  'needs_member_exit',
  'needs_offers',
] as const;
export type NotMeasuredReason = (typeof NOT_MEASURED_REASONS)[number];

/** A metric the app does not collect yet: there is deliberately no value field (it reads "Em breve"). */
export const notMeasuredSchema = z
  .object({ measured: z.literal(false), reason: z.enum(NOT_MEASURED_REASONS) })
  .strict();
export type NotMeasured = z.infer<typeof notMeasuredSchema>;

/**
 * A metric that is either measured (`{ measured: true, value }`) or not measured yet (no value). No
 * example branch (D-455): an object carrying `example` fails both branches, which are strict.
 */
export const measured = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('measured', [
    z.object({ measured: z.literal(true), value }).strict(),
    notMeasuredSchema,
  ]);

/**
 * A group total under the privacy floor (D-462): `{ belowFloor: true }` carries NO value key at all,
 * so the number is not in the JSON (a flag beside a value would still leak it).
 */
export const flooredCountSchema = z.discriminatedUnion('belowFloor', [
  z.object({ belowFloor: z.literal(true) }).strict(),
  z.object({ belowFloor: z.literal(false), value: z.number().int().nonnegative() }).strict(),
]);
export type FlooredCount = z.infer<typeof flooredCountSchema>;

/**
 * One row of a floored band split (08.7-06, D-462, UI-D-470): one or more adjacent engagement bands
 * merged by `mergeBandsBelowFloor` so no group under the floor is recoverable by subtraction, and
 * the group's count through the floor. The band literals are the six of `ENGAGEMENT_BANDS`
 * (`members.ts` imports this file, so they are spelled here). Lives beside `flooredCountSchema`, not
 * in the zod-free `floor.ts` the client `ui` entry re-exports.
 */
export const flooredBandGroupSchema = z
  .object({
    bands: z
      .array(z.enum(['new', 'superfan', 'engaged', 'occasional', 'at_risk', 'inactive']))
      .min(1),
    count: flooredCountSchema,
  })
  .strict();
export type FlooredBandGroup = z.infer<typeof flooredBandGroupSchema>;

/** An instant as the builder writes it: UTC, second precision, `Z` suffix. */
const instant = z.iso.datetime();

/**
 * The windows one snapshot was built over (D-464): every window ends at the end of `day` (D, the
 * tenant-local yesterday at build time), so today never counts. `day`, `from30` (D-29), `prev30From`
 * (D-59), `from7` (D-6) and `prev7From` (D-13) are tenant-local ISO dates; `from30At`, `prev30At`
 * and `untilAt` are the same local midnights as instants (`untilAt` = local midnight of D+1), the
 * bounds the live lists behind a number reuse so they agree with it.
 */
export const snapshotWindowsSchema = z
  .object({
    day: z.iso.date(),
    from30: z.iso.date(),
    prev30From: z.iso.date(),
    from7: z.iso.date(),
    prev7From: z.iso.date(),
    from30At: instant,
    prev30At: instant,
    untilAt: instant,
  })
  .strict();
export type SnapshotWindows = z.infer<typeof snapshotWindowsSchema>;

/** Which snapshot an answer comes from: its day, when it was built ("atualizados às"), its windows. */
export const snapshotMetaSchema = z
  .object({ day: z.iso.date(), builtAt: instant, windows: snapshotWindowsSchema })
  .strict();
export type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

/**
 * No snapshot yet (a new tenant, a first deploy before the worker ran) or this area's payload key is
 * missing or stale (UI-D-469): never a sample, a zero or a 404.
 */
export const preparingSchema = z.object({ state: z.literal('preparing') }).strict();
export type Preparing = z.infer<typeof preparingSchema>;

/**
 * The `dashboard.snapshot-build` job payload (D-464): one tenant, one tenant-local day. `tenantId` is
 * DATA, not authority (T-08.7-04): the builder pins the lane's own tenant and refuses a day that is
 * not complete. Strict, so a payload carrying anything else is dropped.
 */
export const snapshotBuildPayloadSchema = z
  .object({ tenantId: z.uuid(), day: z.iso.date() })
  .strict();
export type SnapshotBuildJob = z.infer<typeof snapshotBuildPayloadSchema>;
