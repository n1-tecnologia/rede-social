import { isIP } from 'node:net';
import {
  PLATFORM_TERMS_VERSION,
  type SignupBody,
  type SignupResponse,
} from '@rede-social/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { consentRecords, memberProfiles, memberships, users } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';
import { supabaseAdmin } from '../supabase-admin';
import { getPublicTenant, getTenantIdBySlug } from './public-tenant';

/** Fallback when no request logger is passed (scripts, tests); routes pass `c.get('logger')`. */
const baseLog = moduleLogger('signup');

export type SignupInput = {
  slug: string;
  body: SignupBody;
  /** From `X-Client-IP`, set by the web server action only (T-04-03). Stored as `inet` when valid. */
  ip: string | null;
  userAgent: string | null;
  /** The request's child logger, so `signup.*` lines carry `requestId` (WR-12). */
  logger?: Logger;
};

type ConsentRow = {
  tenantId: string;
  userId: string;
  kind: 'tenant_rules' | 'platform_terms';
  textVersion: number;
  ip: string | null;
  userAgent: string | null;
};

/** Only a syntactically valid address reaches the `inet` column; anything else is stored as null. */
const asInet = (value: string | null): string | null =>
  value && isIP(value.trim()) !== 0 ? value.trim() : null;

/**
 * GoTrue's duplicate-e-mail shape: the identity already exists on the PLATFORM. `auth.users.email` is
 * globally unique (PITFALLS §3), so one e-mail is one identity however many communities it belongs to
 * (08.1, V2-PLAT-07). The 409 this becomes stays detail-less (D-04, D-302): it reveals that the e-mail
 * has an account, never in which community; the web turns it into the "já tem conta" join (D-301),
 * where the existing password is proven before anything about this community is said.
 * Matched defensively on code, status and message because the wording is not part of GoTrue's contract.
 */
function isDuplicateEmail(error: { message?: string; code?: string; status?: number }): boolean {
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    message.includes('already been registered') ||
    message.includes('already registered') ||
    (error.status === 422 && message.includes('user') && message.includes('exist'))
  );
}

/**
 * Test seam (plan 01-04): the integration suite replaces `consentInsert` to force step (d) to fail and
 * observe the compensation. Production code MUST call these through the object so the override applies.
 */
export const signupInternals = {
  async consentInsert(tx: Tx, rows: ConsentRow[]): Promise<void> {
    await tx.insert(consentRecords).values(rows);
  },

  /**
   * ONE transaction: membership + its profile name + both consents land together or not at all
   * (AUTH-01 ordering). D-311: the new membership's `member_profiles.display_name` is the name typed
   * in THIS form, written explicitly — never left to the trigger's copy of a global name, so a
   * community only ever sees the name the person gave it (D-310).
   */
  async insertMembershipAndConsents(args: {
    tenantId: string;
    userId: string;
    name: string;
    rulesVersion: number;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    const { tenantId, userId, name, rulesVersion, ip, userAgent } = args;
    await withAdminTx(async (tx) => {
      // The `on_auth_user_created` trigger mirrors auth.users -> public.users; assert it before the FK.
      const mirrored = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!mirrored[0]) throw new Error(`public.users row missing for ${userId} after createUser`);

      const [membership] = await tx
        .insert(memberships)
        .values({ tenantId, userId, role: 'member', status: 'active' })
        .returning({ id: memberships.id });
      if (!membership) throw new Error(`membership insert returned no row for ${userId}`);

      // The `member_profiles_from_membership` trigger created the row in this same statement; name
      // it with what was typed here (D-311). Scoped by membership AND tenant, like the join.
      const named = await tx
        .update(memberProfiles)
        .set({ displayName: name })
        .where(
          and(
            eq(memberProfiles.membershipId, membership.id),
            eq(memberProfiles.tenantId, tenantId),
          ),
        )
        .returning({ id: memberProfiles.membershipId });
      if (named.length !== 1) throw new Error(`member_profiles row missing for ${membership.id}`);

      await signupInternals.consentInsert(tx, [
        { tenantId, userId, kind: 'tenant_rules', textVersion: rulesVersion, ip, userAgent },
        {
          tenantId,
          userId,
          kind: 'platform_terms',
          textVersion: PLATFORM_TERMS_VERSION,
          ip,
          userAgent,
        },
      ]);
    });
  },
};

export type ExistingIdentity = { userId: string; alreadyMemberHere: boolean };

/**
 * Server-side lookup of the identity an e-mail already belongs to, answering about the ATTEMPTED tenant
 * only (D-302): `alreadyMemberHere` is whether a live (non-deleted) membership in `tenantId` exists — an
 * `exists` sub-select, never a pick-one join over the identity's memberships, so nothing about another
 * community is ever read here. Used for two things, both invisible to the caller: the
 * `signup.duplicate_email` log line, and reclassifying a racing `createUser` failure as the 409 it
 * really is (see `signupMember`).
 */
export async function existingIdentityForEmail(
  email: string,
  tenantId: string,
): Promise<ExistingIdentity | null> {
  try {
    return await withAdminTx(async (tx) => {
      const rows = await tx
        .select({
          userId: users.id,
          // Spelled out with an alias: drizzle renders the columns of a single-table select
          // unqualified, and an unqualified `"id"` inside the sub-select would bind to the
          // membership's own id.
          alreadyMemberHere: sql<boolean>`exists (
            select 1 from public.memberships m
             where m.user_id = "users"."id"
               and m.tenant_id = ${tenantId}::uuid
               and m.deleted_at is null)`,
        })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      const row = rows[0];
      return row ? { userId: row.userId, alreadyMemberHere: row.alreadyMemberHere === true } : null;
    });
  } catch {
    return null; // The duplicate answer must not depend on this diagnostic lookup.
  }
}

/**
 * Creates a `member` of `slug` from the public sign-up form (AUTH-01, AUTH-04, D-04).
 *
 * Order is load-bearing:
 *   (a) resolve the tenant (404 for unknown / suspended / malformed slug)
 *   (b) reject stale consent versions — a recorded consent must point at the text that was displayed
 *   (c) `createUser` UNCONFIRMED (supersedes the autoconfirm of D-04): GoTrue sends no mail on an
 *       admin create, so the web tier triggers the signup mail through GoTrue's resend, which passes
 *       the Send Email Hook; a duplicate e-mail is a 409 that never names a tenant (D-04 kept)
 *   (d) membership + both consent rows in ONE admin-lane transaction. Still at sign-up, not at
 *       confirmation: the hook brands the mail from the identity's membership (decision row 6a)
 *       and the consent evidence belongs to the moment the person accepted
 *   (e) any failure after (c) deletes the identity again, so no orphan can log in with no tenant
 *
 * The API never returns tokens: the person signs in only after confirming the e-mail. Until then the
 * membership row is inert (an unconfirmed identity has no session).
 */
export async function signupMember(input: SignupInput): Promise<SignupResponse> {
  const { slug, body, userAgent } = input;
  const ip = asInet(input.ip);
  const log = input.logger ? input.logger.child({ name: 'signup' }) : baseLog;

  const tenant = await getPublicTenant(slug);
  const tenantId = await getTenantIdBySlug(slug);

  if (
    body.consents.tenantRulesVersion !== tenant.rulesVersion ||
    body.consents.platformTermsVersion !== PLATFORM_TERMS_VERSION
  ) {
    throw new ApiError(400, 'VALIDATION_FAILED', { consents: 'stale' });
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: false,
    user_metadata: { name: body.name },
  });

  if (created.error) {
    const duplicate = isDuplicateEmail(created.error);
    // Concurrency (AUTH-01): when two sign-ups race, GoTrue's own unique index fires and the loser
    // gets an opaque `Database error creating new user` (500), not the tidy 422. Reclassify it as the
    // duplicate it is — but ONLY after confirming the e-mail really exists, so a genuine outage still
    // answers 500. The winner's row is committed by the time the loser's insert conflicts.
    const existing = await existingIdentityForEmail(body.email, tenantId);
    if (duplicate || existing) {
      // `ip`/`userAgent` make probing visible (WR-05): the 409-vs-201 answer is an e-mail existence
      // oracle by design (D-04), so at minimum every hit is attributable in the logs. Rate limiting
      // and/or a CAPTCHA in front of this route are a pending product decision.
      // D-302: the line speaks about the attempted tenant only — never another tenant's id.
      log.warn(
        {
          event: 'signup.duplicate_email',
          attemptedTenantId: tenantId,
          alreadyMemberHere: existing?.alreadyMemberHere ?? false,
          raced: !duplicate,
          ip,
          userAgent,
        },
        'e-mail already registered',
      );
      // No `details`: the response must never tell the browser which tenant owns the e-mail (T-04-01).
      throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED');
    }
    log.error({ event: 'signup.create_user_failed', err: created.error }, 'createUser failed');
    throw new ApiError(500, 'INTERNAL');
  }

  const userId = created.data.user?.id;
  if (!userId) throw new ApiError(500, 'INTERNAL');

  try {
    await signupInternals.insertMembershipAndConsents({
      tenantId,
      userId,
      name: body.name,
      rulesVersion: tenant.rulesVersion,
      ip,
      userAgent,
    });
  } catch (error) {
    // Compensation (Pitfall 7): an identity without a membership could log in and reach NO_MEMBERSHIP.
    const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
    log.error(
      {
        event: 'signup.compensated',
        userId,
        tenantId,
        deleteError: deleted.error?.message ?? null,
        err: error instanceof Error ? error.message : String(error),
      },
      'sign-up transaction failed; auth user deleted',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  return { userId, tenantSlug: tenant.slug };
}
