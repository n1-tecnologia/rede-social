import { z } from 'zod';

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
