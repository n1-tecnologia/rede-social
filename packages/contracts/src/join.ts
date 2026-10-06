import { z } from 'zod';
import { signupBodySchema, slugSchema } from './auth';

/**
 * 08.1 (V2-PLAT-07, D-305, D-306): joining a community with an identity that already exists. Subpath
 * `@rede-social/contracts/join` only — the index barrel is frozen.
 */

/**
 * `GET /v1/join/state` answers exactly ONE fact about the HOST's community for the caller (D-302,
 * D-309: never anything about another community):
 * - `joinable` — no membership here: `/participar` shows the form;
 * - `member` — an active membership here already;
 * - `invited` — an `invited` membership here: accept the invite instead (D-29);
 * - `blocked` — blocked here (D-304; a block elsewhere never shows);
 * - `removed` — a soft-deleted membership here: refused, never revived (V2-PROF-02 decides that);
 * - `platform_admin` — a platform account, which never joins a community (D-316);
 * - `suspended` — the community itself is suspended (D-32).
 */
export const JOIN_STATES = [
  'joinable',
  'member',
  'invited',
  'blocked',
  'removed',
  'platform_admin',
  'suspended',
] as const;
export type JoinState = (typeof JOIN_STATES)[number];

export const joinStateSchema = z.object({ state: z.enum(JOIN_STATES) }).strict();

/**
 * Body of `POST /v1/join`. The name is the one typed on `/participar` (D-311: the new membership's
 * profile starts from it and nothing else). `consents` carries the versions the browser displayed;
 * stale ones are refused. `slug` names the community ONLY on a host that is not a tenant host (the
 * sign-up precedent, D-22); on a tenant host the host decides and `slug` is ignored.
 */
export const joinBodySchema = z.object({
  name: signupBodySchema.shape.name,
  consents: z.object({
    tenantRulesVersion: z.number().int().positive(),
    platformTermsVersion: z.number().int().positive(),
  }),
  slug: slugSchema.optional(),
});
export type JoinBody = z.infer<typeof joinBodySchema>;

/**
 * What the `/participar` form must satisfy: the body without `slug` PLUS both consent boxes ticked.
 * `z.literal(true)` is the point (AUTH-04): an absent or `false` box is a validation failure.
 */
export const joinFormSchema = joinBodySchema.omit({ slug: true }).extend({
  acceptRules: z.literal(true),
  acceptTerms: z.literal(true),
});
export type JoinForm = z.infer<typeof joinFormSchema>;

/** `already_member`: an idempotent replay — nothing was written. */
export const joinResponseSchema = z.object({
  outcome: z.enum(['joined', 'already_member']),
  tenantSlug: slugSchema,
});
export type JoinResponse = z.infer<typeof joinResponseSchema>;

/**
 * One entry of the generic-host community picker (08.1-03, D-308): the slug the choice cookie carries
 * and the display name the button shows. Nothing else about the community is listed.
 */
export const communitySchema = z
  .object({ slug: slugSchema, displayName: z.string().min(1) })
  .strict();
export type Community = z.infer<typeof communitySchema>;

/**
 * `GET /v1/join/communities` (identity lane, GENERIC hosts only — a tenant or the platform host answers
 * 404, D-309 / D-21): the caller's own non-deleted, non-blocked memberships, ordered by display name
 * (pt-BR collation) and then by slug, so the order is total and stable across requests.
 */
export const communitiesSchema = z.object({ communities: z.array(communitySchema) }).strict();
export type Communities = z.infer<typeof communitiesSchema>;
