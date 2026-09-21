import { createRoute } from '@hono/zod-openapi';
import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  apiErrorEnvelopeSchema,
  type Bootstrap,
  bootstrapSchema,
  resolveBranding,
  TENANT_ROLES,
} from '@tria/contracts';
import {
  ownProfileSchema,
  type ProfileIssue,
  updateProfileBodySchema,
} from '@tria/contracts/profiles';
import { memberships, tenants, users } from '@tria/core/db/schema';
import { withTenantTx } from '@tria/core/db/tenant-tx';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import {
  dismissNudge,
  getOwnProfile,
  profileForBootstrap,
  updateOwnProfile,
} from '@tria/core/server/profiles/index';
import { acceptInvite } from '@tria/core/server/tenancy/accept-invite';
import { membershipOfRecord } from '@tria/core/server/tenancy/membership-scope';
import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';
import { createOpenApiApp } from '../http/openapi';
import { enabledModulesForBootstrap, permissionsFor } from '../modules/registry';

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
  // carrying the same `'too_long'` message (see `withinCodeUnits` in @tria/contracts/profiles).
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
 * TRIA's terms. The tenant and the user come ONLY from `ctx` — the verified Bearer and its membership
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
          })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1);
        const [user] = await tx
          .select({ id: users.id, email: users.email, name: users.name })
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
        return { tenant, user, membership, profile };
      });

      const { tenant, user, membership, profile } = data;
      if (!tenant || !user || !membership) throw new ApiError(500, 'INTERNAL');
      if (!isTenantRole(membership.role) || !isStatus(membership.status)) {
        throw new ApiError(500, 'INTERNAL');
      }

      const body: Bootstrap = {
        user: { id: user.id, email: user.email, name: user.name },
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
        },
        // Enabled keys from `tenant_modules`, decorated by the registry and sorted by nav order.
        modules: enabledModulesForBootstrap(flags.keys, flags.settings),
        permissions: permissionsFor(membership.role, flags.keys),
        counters: { unreadNotifications: 0, unreadConversations: 0 },
      };
      return c.json(body, 200);
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
