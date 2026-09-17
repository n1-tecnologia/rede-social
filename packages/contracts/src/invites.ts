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
 * `details.reason` of a 409 `INVITE_STATE_INVALID` (D-30, the `DOMAIN_STATE_REASONS` pattern):
 * - `already_accepted` — resend refused: the admin already accepted (the panel hides the button);
 * - `no_verified_primary` — resend refused: the tenant has no verified primary host, so there is
 *   no branded origin for the link to open (the panel disables the button with a helper line);
 * - `not_invited` — accept refused: the caller's membership is not `invited` (blocked or missing).
 */
export const INVITE_STATE_REASONS = [
  'already_accepted',
  'no_verified_primary',
  'not_invited',
] as const;
export type InviteStateReason = (typeof INVITE_STATE_REASONS)[number];
