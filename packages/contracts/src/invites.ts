import { z } from 'zod';
import { passwordSchema } from './auth';

/**
 * First-admin invite contracts (ROLE-03, D-29/D-30). The invite row lives in `tenant_invites`
 * (admin-lane only); the accept flow runs in the tenant lane with an `invited` membership.
 */
export const inviteStatusSchema = z.enum(['pending', 'sent', 'accepted', 'expired']);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/** One `tenant_invites` row as the platform panel sees it (inside `platformTenantDetailSchema`). */
export const tenantInviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['admin_tenant']),
  status: inviteStatusSchema,
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TenantInvite = z.infer<typeof tenantInviteSchema>;

/**
 * Body of `POST /v1/me/accept-invite`: the two consent versions the browser displayed (D-03, the
 * same fields sign-up records). The password is set through Supabase Auth in the web action and is
 * NEVER sent to the API; any extra key is ignored, not refused.
 */
export const acceptInviteBodySchema = z.object({
  rulesVersion: z.number().int().positive(),
  termsVersion: z.number().int().positive(),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;

/** The API answers where the new admin lands: always the tenant home. */
export const acceptInviteResponseSchema = z.object({
  tenantSlug: z.string(),
  landing: z.literal('/inicio'),
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

/**
 * What the `/aceitar-convite` form must satisfy (D-29, D-10, D-03): the accept body PLUS the new
 * password (min 8, the same `passwordSchema` sign-up and reset use) PLUS both consent boxes ticked.
 * `z.literal(true)` is the AUTH-04 rule — no default, no merge, no pre-check: an absent or unticked
 * box fails validation in the web action and nothing reaches the API. The password field exists
 * here ONLY for the form; the action strips it before calling `POST /v1/me/accept-invite`.
 */
export const acceptInviteFormSchema = acceptInviteBodySchema.extend({
  password: passwordSchema,
  acceptRules: z.literal(true),
  acceptTerms: z.literal(true),
});
export type AcceptInviteForm = z.infer<typeof acceptInviteFormSchema>;

/**
 * `GET /v1/me/invite` (D-314): the one question the accept screen asks before rendering. An identity
 * that already has a password (a member of another community, invited with the tokenless mail)
 * answers `passwordRequired: false` and accepts without a password step; a fresh invitee answers
 * `true` and sets one. Read from `auth.users` at request time (never stored with the invite, so a
 * password set elsewhere before accepting is seen). The web action re-reads it server-side, so a form
 * edit can neither skip the password for an identity without one nor force `updateUser` for one
 * that has one (T-08.1-30).
 */
export const inviteContextSchema = z.object({ passwordRequired: z.boolean() }).strict();
export type InviteContext = z.infer<typeof inviteContextSchema>;

/**
 * The `/aceitar-convite` form for an identity that already has a password (D-314, UI-D-323): the
 * accept body plus both consent boxes ticked, and NO password — `z.literal(true)` is the same
 * AUTH-04 rule as `acceptInviteFormSchema`. Chosen by the web action from `GET /v1/me/invite`,
 * never from the submitted form.
 */
export const acceptInviteExistingFormSchema = acceptInviteBodySchema.extend({
  acceptRules: z.literal(true),
  acceptTerms: z.literal(true),
});
export type AcceptInviteExistingForm = z.infer<typeof acceptInviteExistingFormSchema>;

/**
 * `details.reason` of a 409 `INVITE_STATE_INVALID` (D-30, the `DOMAIN_STATE_REASONS` pattern):
 * - `already_accepted` — send/resend refused: the admin already accepted, or the existing identity is
 *   already active in this tenant (D-314) (the panel hides the button);
 * - `no_verified_primary` — resend refused: the tenant has no verified primary host, so there is
 *   no branded origin for the link to open (the panel disables the button with a helper line);
 * - `not_invited` — accept refused: the caller's membership is not `invited` (blocked or missing);
 *   send/resend refused: the existing identity's membership in this tenant is blocked or removed;
 * - `email_in_use` — send/resend refused: the e-mail is a platform account (`super_admin`), which is
 *   never a tenant member (D-316); the row is left `expired` with `sentAt` null (02-19 D-A,
 *   "Convite recusado"). A member of ANOTHER community is not refused: the invite adds a membership
 *   for that identity and mails the tokenless "use a senha que você já tem" invite (D-314);
 * - `invite_pending` — `POST /v1/join` refused (08.1, D-29): the caller's membership in that tenant
 *   is still `invited`, so the person accepts the invite instead of joining; the web routes to
 *   `/aceitar-convite`.
 *
 * `email_in_use` is answered ONLY on the platform lane (behind `requireSuperAdmin()`) and never
 * names another tenant.
 */
export const INVITE_STATE_REASONS = [
  'already_accepted',
  'no_verified_primary',
  'not_invited',
  'email_in_use',
  'invite_pending',
] as const;
export type InviteStateReason = (typeof INVITE_STATE_REASONS)[number];

/** Path params of `POST /v1/platform/tenants/{id}/invites/{inviteId}/resend`. */
export const inviteParamsSchema = z.object({ id: z.uuid(), inviteId: z.uuid() });
export type InviteParams = z.infer<typeof inviteParamsSchema>;

/** `GET /v1/platform/tenants/{id}/invites` — every invite row of the tenant, oldest first. */
export const tenantInvitesListSchema = z.object({ invites: z.array(tenantInviteSchema) });
export type TenantInvitesList = z.infer<typeof tenantInvitesListSchema>;
