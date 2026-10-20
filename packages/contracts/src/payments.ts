/**
 * The neutral vocabulary of the payment gate (Phase 09.1, D-485, D-486). Nothing here names a
 * gateway: a provider is a FORMAT on the database side, never an enum, so a second gateway needs no
 * migration.
 */

/** Who wrote an `access_grants` row: an admin by hand, or a gateway event (D-485). */
export const ACCESS_SOURCES = ['manual', 'gateway'] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

/**
 * `access_grants.status`. A `manual` row is `active` (a release) or `blocked`; a `gateway` row is
 * `active` or `inactive` (the CHECK pins the pairing).
 */
export const ACCESS_ROW_STATUSES = ['active', 'inactive', 'blocked'] as const;
export type AccessRowStatus = (typeof ACCESS_ROW_STATUSES)[number];

/** What `app.access_effective(tenant, email)` answers: the precedence of D-489 collapsed to one word. */
export const ACCESS_EFFECTIVE_STATES = ['active', 'inactive', 'blocked', 'none'] as const;
export type AccessEffectiveState = (typeof ACCESS_EFFECTIVE_STATES)[number];

/**
 * What `app.access_state(tenant, user)` answers `requireAuth` on every request (D-496): `open` (the
 * gate is off, or the caller is staff, D-492), `granted`, `blocked` (a manual block, answered as
 * `MEMBERSHIP_BLOCKED` while the gate is on) or `cut` (answered as `SUBSCRIPTION_PENDING`).
 */
export const ACCESS_STATES = ['open', 'granted', 'cut', 'blocked'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

/**
 * `membership.access_cut` — emitted by the kernel AFTER a gateway event takes a member's access away
 * (D-496). Ids only: no e-mail, no amount. The notifications module subscribes to nudge the open
 * app; the membership itself is never written by a cut.
 *
 * Declared against `@rede-social/contracts` by name, exactly like `membership.blocked`
 * (`moderation.ts`): a relative `declare module` does not merge across the workspace.
 */
export type MembershipAccessCut = { tenantId: string; userId: string; membershipId: string };

/**
 * `payments.purchase_confirmed` — emitted AFTER a gateway-confirmed purchase of a mapped store
 * product commits. Names the product, never the money.
 */
export type PaymentsPurchaseConfirmed = {
  tenantId: string;
  userId: string;
  productId: string;
  productName: string;
};

declare module '@rede-social/contracts' {
  interface EventMap {
    'membership.access_cut': MembershipAccessCut;
    'payments.purchase_confirmed': PaymentsPurchaseConfirmed;
  }
}
