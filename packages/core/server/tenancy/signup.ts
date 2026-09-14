import { isIP } from 'node:net';
import { type SignupBody, type SignupResponse, TRIA_TERMS_VERSION } from '@tria/contracts';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { withAdminTx } from '../../db/admin-tx';
import { consentRecords, memberships, users } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import { supabaseAdmin } from '../supabase-admin';
import { getPublicTenant, getTenantIdBySlug } from './public-tenant';

const log = pino({
  name: 'signup',
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type SignupInput = {
  slug: string;
  body: SignupBody;
  /** From `X-Client-IP`, set by the web server action only (T-04-03). Stored as `inet` when valid. */
  ip: string | null;
  userAgent: string | null;
};

type ConsentRow = {
  tenantId: string;
  userId: string;
  kind: 'tenant_rules' | 'tria_terms';
  textVersion: number;
  ip: string | null;
  userAgent: string | null;
};

/** Only a syntactically valid address reaches the `inet` column; anything else is stored as null. */
const asInet = (value: string | null): string | null =>
  value && isIP(value.trim()) !== 0 ? value.trim() : null;

/**
 * GoTrue's duplicate-e-mail shape. `auth.users.email` is globally unique across every tenant
 * (PITFALLS §3), so this is the ROLE-02 "one membership per user" rule surfacing at the identity layer.
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

  /** ONE transaction: membership + both consents land together or not at all (AUTH-01 ordering). */
  async insertMembershipAndConsents(args: {
    tenantId: string;
    userId: string;
    rulesVersion: number;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    const { tenantId, userId, rulesVersion, ip, userAgent } = args;
    await withAdminTx(async (tx) => {
      // The `on_auth_user_created` trigger mirrors auth.users -> public.users; assert it before the FK.
      const mirrored = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!mirrored[0]) throw new Error(`public.users row missing for ${userId} after createUser`);

      await tx.insert(memberships).values({ tenantId, userId, role: 'member', status: 'active' });
      await signupInternals.consentInsert(tx, [
        { tenantId, userId, kind: 'tenant_rules', textVersion: rulesVersion, ip, userAgent },
        { tenantId, userId, kind: 'tria_terms', textVersion: TRIA_TERMS_VERSION, ip, userAgent },
      ]);
    });
  },
};

type ExistingIdentity = { userId: string; tenantId: string | null };

/**
 * Server-side lookup of the identity (and the tenant) an e-mail already belongs to. Used for two
 * things, both invisible to the caller: the `signup.duplicate_email` log line, and reclassifying a
 * racing `createUser` failure as the 409 it really is (see `signupMember`).
 */
async function existingIdentityForEmail(email: string): Promise<ExistingIdentity | null> {
  try {
    return await withAdminTx(async (tx) => {
      const rows = await tx
        .select({ userId: users.id, tenantId: memberships.tenantId })
        .from(users)
        .leftJoin(memberships, eq(memberships.userId, users.id))
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      const row = rows[0];
      return row ? { userId: row.userId, tenantId: row.tenantId ?? null } : null;
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
 *   (c) `createUser` (autoconfirmed, D-04); a duplicate e-mail is a 409 that never names a tenant
 *   (d) membership + both consent rows in ONE admin-lane transaction
 *   (e) any failure after (c) deletes the identity again, so no orphan can log in with no tenant
 *
 * The API never returns tokens: the web tier signs the person in with the same credentials.
 */
export async function signupMember(input: SignupInput): Promise<SignupResponse> {
  const { slug, body, userAgent } = input;
  const ip = asInet(input.ip);

  const tenant = await getPublicTenant(slug);
  const tenantId = await getTenantIdBySlug(slug);

  if (
    body.consents.tenantRulesVersion !== tenant.rulesVersion ||
    body.consents.triaTermsVersion !== TRIA_TERMS_VERSION
  ) {
    throw new ApiError(400, 'VALIDATION_FAILED', { consents: 'stale' });
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { name: body.name },
  });

  if (created.error) {
    const duplicate = isDuplicateEmail(created.error);
    // Concurrency (AUTH-01): when two sign-ups race, GoTrue's own unique index fires and the loser
    // gets an opaque `Database error creating new user` (500), not the tidy 422. Reclassify it as the
    // duplicate it is — but ONLY after confirming the e-mail really exists, so a genuine outage still
    // answers 500. The winner's row is committed by the time the loser's insert conflicts.
    const existing = await existingIdentityForEmail(body.email);
    if (duplicate || existing) {
      // `ip`/`userAgent` make probing visible (WR-05): the 409-vs-201 answer is an e-mail existence
      // oracle by design (D-04), so at minimum every hit is attributable in the logs. Rate limiting
      // and/or a CAPTCHA in front of this route are a pending product decision.
      log.warn(
        {
          event: 'signup.duplicate_email',
          existingTenantId: existing?.tenantId ?? null,
          attemptedTenantId: tenantId,
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
