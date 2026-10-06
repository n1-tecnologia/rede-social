import { createRoute } from '@hono/zod-openapi';
import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  apiErrorEnvelopeSchema,
  type Bootstrap,
  bootstrapSchema,
  countersSchema,
  inviteContextSchema,
  resolveBranding,
  TENANT_ROLES,
} from '@rede-social/contracts';
import {
  ownProfileSchema,
  type ProfileIssue,
  updateProfileBodySchema,
} from '@rede-social/contracts/profiles';
import { memberships, tenants, users } from '@rede-social/core/db/schema';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  dismissNudge,
  getOwnProfile,
  profileForBootstrap,
  updateOwnProfile,
} from '@rede-social/core/server/profiles/index';
import { acceptInvite } from '@rede-social/core/server/tenancy/accept-invite';
import { identityHasPassword } from '@rede-social/core/server/tenancy/identity';
import { membershipOfRecord } from '@rede-social/core/server/tenancy/membership-scope';
import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';
import { createOpenApiApp } from '../http/openapi';
import { countersFor, enabledModulesForBootstrap, permissionsFor } from '../modules/registry';

const me = createOpenApiApp();
me.use('*', requireAuth);

const isTenantRole = (value: string): value is Bootstrap['membership']['role'] =>
  (TENANT_ROLES as readonly string[]).includes(value);
const isStatus = (value: string): value is Bootstrap['membership']['status'] =>
  value === 'active' || value === 'blocked' || value === 'invited';

/** `X-Client-IP` is set by the web server action from Vercel's `x-real-ip` (T-04-03: trusted hop only). */
const CLIENT_IP_HEADER = 'X-Client-IP';

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

/**
 * The profile form's refusal hook (PROF-01). The shared `platformDefaultHook` answers a failed body
 * validation with `details.issues[{ path, message }]`, which is right for shape violations but says
 * nothing a form field can switch on. This hook keeps those issues AND adds the closed
 * `PROFILE_ISSUES` code per field (`details.displayName`, `details.bio`, `details.avatarAssetId`),
 * so 03-04 maps one code to one pt-BR string instead of parsing messages.
 */
const PROFILE_FIELDS = ['displayName', 'bio', 'avatarAssetId'] as const;

const profileIssueFor = (code: string, message: string): ProfileIssue => {
  if (message === 'required' || code === 'too_small') return 'required';
  // `too_big` is Zod's code-POINT cap; the code-UNIT refinement next to it raises a `custom` issue
  // carrying the same `'too_long'` message (see `withinCodeUnits` in @rede-social/contracts/profiles).
  if (message === 'too_long' || code === 'too_big') return 'too_long';
  return 'invalid';
};

const profileValidationHook = (result: { success: boolean; error?: ZodError }): undefined => {
  if (result.success) return undefined;
  const issues = result.error?.issues ?? [];
  const details: Record<string, unknown> = {
    issues: issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if ((PROFILE_FIELDS as readonly string[]).includes(field) && !(field in details)) {
      details[field] = profileIssueFor(issue.code, issue.message);
    }
  }
  throw new ApiError(400, 'VALIDATION_FAILED', details);
};

const profileEnvelope = envelope(
  'Invalid profile edit: details.displayName = "required" | "too_long", details.bio = "too_long", ' +
    'details.avatarAssetId = "invalid" (plus details.issues[] for shape violations)',
);

/**
 * `POST /v1/me/accept-invite` (ROLE-03, D-29): the invited first admin accepts the tenant rules and
 * the platform's terms. The tenant and the user come ONLY from `ctx` — the verified Bearer and its membership
 * — never from the body; the body carries the two consent versions and nothing else. The password
 * was set through Supabase by the web action before this call and never reaches the API (D-10).
 * `requireAuth` lets an `invited` membership reach exactly this route and `/bootstrap`.
 */
const acceptInviteRoute = createRoute({
  method: 'post',
  path: '/accept-invite',
  request: {
    body: { content: { 'application/json': { schema: acceptInviteBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Membership active, both consents recorded, invite accepted; where to land',
      content: { 'application/json': { schema: acceptInviteResponseSchema } },
    },
    400: envelope('Stale consent versions ({ consents: "stale" }) or invalid payload'),
    403: envelope("Not the caller's own invited membership / host mismatch"),
    409: envelope('Membership is not invited (INVITE_STATE_INVALID { reason: "not_invited" })'),
  },
});

/**
 * `GET /v1/me/invite` (D-314, UI-D-323): the accept screen's question — must this identity set a
 * password before accepting? `false` for an identity that already has one (a member of another
 * community, invited with the tokenless mail), `true` for a fresh invitee. Read from `auth.users`
 * through `app.identity_has_password` for `ctx.userId` only, at request time, never cached. Reachable
 * by an `invited` membership (`INVITED_ALLOWED_PATHS`); the web accept action asks it again
 * server-side before choosing its form schema (T-08.1-30).
 */
const inviteContextRoute = createRoute({
  method: 'get',
  path: '/invite',
  responses: {
    200: {
      description: 'Whether the accept screen must ask this identity for a new password',
      content: { 'application/json': { schema: inviteContextSchema } },
    },
    403: envelope("No membership in the host's tenant / blocked / suspended"),
  },
});

/** `GET /v1/me/bootstrap` — everything is read inside the tenant lane, scoped by the membership's tenant. */
export const meRoutes = me
  .openapi(
    createRoute({
      method: 'get',
      path: '/bootstrap',
      responses: {
        200: {
          description: 'Current user, membership, tenant and enabled modules',
          content: { 'application/json': { schema: bootstrapSchema } },
        },
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');

      // The flags come from the same tenant lane, through the 30 s cache (ROLE-06 concurrency).
      const flags = await moduleFlags.flags(ctx);

      const data = await withTenantTx(ctx, async (tx) => {
        const [tenant] = await tx
          .select({
            id: tenants.id,
            slug: tenants.slug,
            displayName: tenants.displayName,
            branding: tenants.branding,
            // Phase 6 (locked): every events string is formatted in the TENANT's timezone, never the
            // device's, so the bootstrap carries the column the web pins `Intl.DateTimeFormat` to.
            timezone: tenants.timezone,
          })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1);
        // D-310: the identity row carries only the id and the e-mail here. The name a community
        // sees is its own membership's profile, read below (`user.name` is filled from it).
        const [user] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.id, ctx.userId))
          .limit(1);
        // layer 2 of the tenant scoping (CLAUDE.md): tenant_id + user_id + deleted_at is null — never user_id alone (WR-05)
        const [membership] = await tx
          .select({ role: memberships.role, status: memberships.status })
          .from(memberships)
          .where(membershipOfRecord(ctx))
          .limit(1);
        // PROF-01: the REAL profile row, read inside the SAME transaction (no second round trip).
        // `bootstrapSchema` is untouched — the sub-shape is exactly `{ displayName, avatarUrl, bio }`
        // and new profile facts (the nudge, `avatarAssetId`) live on `GET /v1/me/profile` instead.
        const profile = await profileForBootstrap(tx, ctx);
        // D-40: the badge counters, composed from the EFFECTIVE modules' manifests in this same
        // transaction (07-01), so the bell and the rest of the bootstrap are one snapshot.
        const counters = await countersFor(tx, ctx, flags);
        return { tenant, user, membership, profile, counters };
      });

      const { tenant, user, membership, profile, counters } = data;
      if (!tenant || !user || !membership) throw new ApiError(500, 'INTERNAL');
      if (!isTenantRole(membership.role) || !isStatus(membership.status)) {
        throw new ApiError(500, 'INTERNAL');
      }

      const body: Bootstrap = {
        // D-310: `user.name` is the HOST membership's profile name, so a person in two communities
        // is called what each community knows them as. The key stays for contract compatibility:
        // dropping it would force a web-before-API deploy order (`bootstrapSchema` is frozen).
        user: { id: user.id, email: user.email, name: profile.displayName },
        membership: {
          tenantId: tenant.id,
          role: membership.role,
          status: membership.status,
          profile,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          displayName: tenant.displayName,
          // D-25: the whole jsonb, resolved — every color key present, `{}` becomes the neutral brand.
          branding: resolveBranding(tenant.branding),
          timezone: tenant.timezone,
        },
        // Enabled keys from `tenant_modules`, decorated by the registry and sorted by nav order.
        modules: enabledModulesForBootstrap(flags.keys, flags.settings),
        permissions: permissionsFor(membership.role, flags.keys, flags.settings),
        counters,
      };
      return c.json(body, 200);
    },
  )
  /**
   * `GET /v1/me/counters` (07-03, NOTIF-02, D-240): the bootstrap's badge counters and nothing else,
   * for the live refetch the shell runs on every Realtime signal, re-join and refocus. It reads the
   * SAME flags through the same cache and runs the SAME `countersFor` in ONE tenant-lane transaction,
   * so this answer and the bootstrap's `counters` cannot disagree for the same member. A signal only
   * says "refetch"; the number always comes from here.
   */
  .openapi(
    createRoute({
      method: 'get',
      path: '/counters',
      responses: {
        200: {
          description: "The caller's badge counters (the bootstrap's `counters`)",
          content: { 'application/json': { schema: countersSchema } },
        },
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const flags = await moduleFlags.flags(ctx);
      const counters = await withTenantTx(ctx, (tx) => countersFor(tx, ctx, flags));
      c.header('Cache-Control', 'no-store');
      return c.json(countersSchema.parse(counters), 200);
    },
  )
  /**
   * `GET /v1/me/profile` (PROF-01): the caller's own profile — the SAME `member_profiles` row
   * 03-03's `GET /v1/members/{membershipId}` will serve to other members, plus the facts only its
   * owner may see (`email`, the nudge state). There is deliberately no second storage path for
   * "my profile".
   */
  .openapi(
    createRoute({
      method: 'get',
      path: '/profile',
      responses: {
        200: {
          description: "The caller's own member profile, with the first-access nudge state",
          content: { 'application/json': { schema: ownProfileSchema } },
        },
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const profile = await getOwnProfile(ctx);
      c.get('logger').info(
        {
          event: 'me.profile.read',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          requestId: ctx.requestId,
        },
        'own profile read',
      );
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    },
  )
  /**
   * `PATCH /v1/me/profile` (PROF-01, D-46): a free rename with no history, a 150-character plain
   * text bio and the avatar's `media_assets` id. The row this touches is decided by the
   * `member_profiles_self_update` policy, never by the body.
   */
  .openapi(
    createRoute({
      method: 'patch',
      path: '/profile',
      request: {
        body: {
          content: { 'application/json': { schema: updateProfileBodySchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: 'The updated profile',
          content: { 'application/json': { schema: ownProfileSchema } },
        },
        400: profileEnvelope,
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const profile = await updateOwnProfile(ctx, c.req.valid('json'));
      c.get('logger').info(
        {
          event: 'me.profile.update',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          requestId: ctx.requestId,
        },
        'own profile updated',
      );
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    },
    profileValidationHook,
  )
  /**
   * `POST /v1/me/profile/dismiss-nudge` (D-02/R-13): "Agora não". Server state, so the card does not
   * come back on another device or after the OS evicts an installed PWA's storage. Idempotent.
   */
  .openapi(
    createRoute({
      method: 'post',
      path: '/profile/dismiss-nudge',
      responses: {
        200: {
          description: 'The refreshed profile, with needsNudge now false',
          content: { 'application/json': { schema: ownProfileSchema } },
        },
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const profile = await dismissNudge(ctx);
      c.get('logger').info(
        {
          event: 'me.profile.dismiss_nudge',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          requestId: ctx.requestId,
        },
        'first-access nudge dismissed',
      );
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    },
  )
  .openapi(inviteContextRoute, async (c) => {
    const ctx = c.get('ctx');
    const passwordRequired = !(await identityHasPassword(ctx.userId));
    c.header('Cache-Control', 'no-store');
    return c.json({ passwordRequired }, 200);
  })
  .openapi(acceptInviteRoute, async (c) => {
    const ctx = c.get('ctx');
    const body = c.req.valid('json');

    const result = await acceptInvite({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      rulesVersion: body.rulesVersion,
      termsVersion: body.termsVersion,
      ip: c.req.header(CLIENT_IP_HEADER) ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      logger: c.get('logger'),
    });

    c.header('Cache-Control', 'no-store');
    return c.json({ tenantSlug: result.tenantSlug, landing: '/inicio' as const }, 200);
  });
