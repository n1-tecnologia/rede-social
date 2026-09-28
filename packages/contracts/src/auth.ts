import { z } from 'zod';

/**
 * Shared auth contracts (AUTH-01/AUTH-02/AUTH-04). One schema language for the API validators, the
 * web server actions and the forms, so a rule can never drift between the two tiers.
 */

/**
 * Tenant slug: lowercase letters, digits and hyphens only, 3-40 chars. Deliberately NO normalisation
 * anywhere (D-01/V5): `Rede-Demo` is not a slug, it is a miss — two spellings must never alias one
 * tenant. Mirrors the `tenants_slug_chk` CHECK on the table.
 */
export const slugSchema = z.string().regex(/^[a-z0-9-]{3,40}$/);

/** D-10: minimum 8 characters, no symbol/case rules. Same rule at sign-up, login and reset. */
export const passwordSchema = z.string().min(8);

export const loginSchema = z.object({ email: z.email(), password: passwordSchema });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({ email: z.email() });
export type ForgotInput = z.infer<typeof forgotSchema>;

export const resetSchema = z.object({ password: passwordSchema });
export type ResetInput = z.infer<typeof resetSchema>;

/**
 * Body of `POST /v1/public/signup/{slug}` (D-02: name, e-mail, password — no username, no confirm
 * field). `consents` carries the versions the browser actually displayed; the API rejects stale ones
 * so a recorded consent always points at the text the person read (D-03, LGPD evidence).
 */
export const signupBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password: passwordSchema,
  consents: z.object({
    tenantRulesVersion: z.number().int().positive(),
    platformTermsVersion: z.number().int().positive(),
  }),
});
export type SignupBody = z.infer<typeof signupBodySchema>;

/**
 * What the browser form must satisfy: the body PLUS both consent checkboxes explicitly ticked.
 * `z.literal(true)` is the point — an absent or `false` checkbox is a validation failure, never a
 * default (AUTH-04 prohibition: no pre-checked, no merged, no implicit acceptance).
 */
export const signupFormSchema = signupBodySchema.extend({
  acceptRules: z.literal(true),
  acceptTerms: z.literal(true),
});
export type SignupForm = z.infer<typeof signupFormSchema>;

/** Body of `GET /v1/public/tenants/{slug}` — everything the public sign-up page needs, nothing more. */
export const publicTenantSchema = z.object({
  slug: slugSchema,
  displayName: z.string(),
  rulesText: z.string(),
  rulesVersion: z.number().int(),
  termsVersion: z.number().int(),
});
export type PublicTenant = z.infer<typeof publicTenantSchema>;

/** The API never returns tokens: the web tier signs the new member in with the same credentials. */
export const signupResponseSchema = z.object({ userId: z.uuid(), tenantSlug: slugSchema });
export type SignupResponse = z.infer<typeof signupResponseSchema>;
