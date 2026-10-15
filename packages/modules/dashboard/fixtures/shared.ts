/**
 * Shapes shared by every panel fixture. A fixture is RAW DATA, shaped like the API answer it will
 * become: counts, percents as numbers (0–100), enum ids, ISO dates and entity names. Never a
 * sentence, a unit or a label — those are catalog copy the web tier picks.
 */

export type DeltaDirection = 'up' | 'down' | 'flat';

/** How `amount` reads: a plain count, a relative %, percentage points, or minutes. */
export type DeltaKind = 'count' | 'percent' | 'points' | 'minutes';

/** What the amount is compared with; `none` prints the amount alone. */
export type DeltaBasis =
  | 'previous_month'
  | 'previous_30_days'
  | 'previous_24h'
  | 'yesterday'
  | 'last_7_days'
  | 'previous_7_days'
  | 'average_30_days'
  | 'none';

/**
 * A change against a previous period. `direction` is the arrow (what the number did); `good` is the
 * colour and the screen-reader sentiment (whether that is good news): storage going up is `up` and
 * `good: false`. `null` means neither.
 */
export interface Delta {
  amount: number;
  kind: DeltaKind;
  direction: DeltaDirection;
  good: boolean | null;
  basis: DeltaBasis;
}

/** A KPI with no comparison yet, or one whose healthy value is zero. */
export type KpiHint = 'no_comparison_yet' | 'should_stay_zero';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** An alert's weight: `danger` rings the bell, `warning` does not. */
export type Severity = 'danger' | 'warning';

/** The four feed formats (a gallery of 1 photo is a photo, of 2+ a carousel, in the web tier). */
export type PostType = 'video' | 'gallery' | 'text' | 'link';

/** Days ago + the São Paulo clock time ("hoje 09:12", "ontem 18h", "há 14 dias"). */
export interface RelativeMoment {
  daysAgo: number;
  time?: string;
}

/**
 * The engagement segmentation of one tenant's members (role `member`, status `active`).
 *
 * Counted actions: like, comment, post, RSVP "vou", check-in or walk-in, paid order. Support
 * messages and moderated (removed) comments do not count. An active day is a São Paulo calendar day
 * with at least one counted action; the window is the last 30 rolling days.
 *
 * The bands are exclusive, evaluated in this order (the first that matches wins):
 * 1. `new`: joined less than 30 days ago.
 * 2. `superfan`: 12+ active days in 30 AND 3+ strong actions (comment, post, check-in, order) in 30.
 * 3. `engaged`: 4+ active days in 30.
 * 4. `occasional`: 1–3 active days in 30.
 * 5. `at_risk`: no active day in the last 30, at least one in days 31–60.
 * 6. `inactive`: no active day in 60.
 *
 * "Interagiu" = superfãs + engajados + ocasionais + novos ativados, so it always matches the bands.
 */
export type EngagementBand = 'new' | 'superfan' | 'engaged' | 'occasional' | 'at_risk' | 'inactive';

export interface EngagementBands {
  /** Members (role member, status active) per exclusive band, evaluated in ENGAGEMENT_BAND_ORDER. */
  counts: Record<EngagementBand, number>;
  /** Novos (joined < 30 days) with at least one counted action. */
  newActivated: number;
}

/** What the app must start collecting before the metric can be measured. */
export type NotMeasuredReason =
  | 'needs_billing_per_client'
  | 'needs_post_views'
  | 'needs_saves'
  | 'needs_shares'
  | 'needs_video_playback'
  | 'needs_product_page_views'
  | 'needs_usage_sessions'
  | 'needs_story_view_time'
  | 'needs_waitlist'
  | 'needs_access_expiry'
  | 'needs_support_subject'
  | 'needs_event_tickets'
  | 'needs_gallery_swipes'
  | 'needs_link_clicks'
  | 'needs_story_taps';

/**
 * A metric the app does not collect yet: there is deliberately no value field, so no number can be
 * shown for it (it reads "Ainda não medido" with its reason).
 */
export interface NotMeasured {
  measured: false;
  reason: NotMeasuredReason;
}

/** A value the app collects today. */
export interface MeasuredValue<T> {
  example: false;
  value: T;
}

/**
 * A FICTIONAL value for a metric the app does not collect yet. This is the bounded exception to
 * "NotMeasured has no value", for the member's "Sua atividade" report (261012-h5t D-03) and the
 * client owner's panel (261012-o00 D-03) only: it always renders with the "exemplo" pill, and
 * `reason` is never shown on screen (the module README lists it).
 */
export interface ExampleValue<T> {
  example: true;
  value: T;
  reason: NotMeasuredReason;
}

/** A member-report or owner-panel metric: measured, or an example the UI must mark as such. */
export type ReportValue<T> = MeasuredValue<T> | ExampleValue<T>;
