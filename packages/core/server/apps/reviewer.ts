import { randomBytes, randomInt } from 'node:crypto';
import type { ReviewerWarning } from '@rede-social/contracts/native';
import { and, eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantApps } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { memberProfiles, memberships, tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { open, seal } from '../secrets/sealed';
import { supabaseAdminFor } from '../supabase-admin';
import { resolveProject } from '../tenancy/project-registry';
import { type CredentialStore, pgCredentialStore } from './credentials';
import { pgAppStore, type TenantFacts } from './tenant-app';

/**
 * The reviewer account (13-31, D-607, D-604, Apple 2.1(a), NATIVE-29, T-13-55): the demo account App Review signs
 * in with. It is an ordinary `member` of the tenant, in the tenant's OWN project, with a random password that is
 * sealed as the generated credential `reviewer_password` (AAD `<rowId>:<kind>`) and never returned, logged or shown;
 * the only readers of that password are the release script (the demo-account field of the review detail) and the
 * tests. It can be rotated at any time and the account is least privilege by construction: nothing in this file
 * writes any role other than `member`.
 *
 * The three seams (`ReviewerStore`, `ReviewerAuth`, `ReviewerMembers`) are the module's only doors to the
 * database and to Auth, so the rules run in unit tests on in-memory stand-ins and in the integration test on the
 * real stack. No function here logs the password or the address; a log line carries the tenant id and an event.
 */

export const REVIEWER_DISPLAY_NAME = 'Revisor do app';
export const REVIEWER_PASSWORD_LENGTH = 24;
const REVIEWER_KIND = 'reviewer_password' as const;
/** No 0/O, 1/l/I: the password is typed by a person at the store's review desk. */
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = `${LOWER}${UPPER}${DIGITS}`;
const ADDRESS_ATTEMPTS = 3;

export type { ReviewerWarning };
export type ReviewerRecord = { email: string | null; userId: string | null };

export type ReviewerStore = {
  /** The control plane's facts about the tenant (the verified primary host). `null` when it is unknown. */
  facts(tenantId: string): Promise<TenantFacts | null>;
  /**
   * Runs `fn` under a per-tenant lock, INSIDE one platform transaction: the tenant must exist (404 `NOT_FOUND`),
   * the `tenant_apps` row is created when missing and locked, `fn` receives what is recorded and a writer for the
   * address and the user id. Two callers for one tenant run one after the other.
   */
  runLocked<T>(
    tenantId: string,
    fn: (
      state: ReviewerRecord,
      record: (email: string, userId: string) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
};

export type ReviewerAuth = {
  /** Creates a confirmed user in the tenant's own project. `duplicate` when the address already exists there. */
  create(
    tenantId: string,
    input: { email: string; password: string; name: string },
  ): Promise<{ userId: string } | { duplicate: true }>;
  setPassword(tenantId: string, userId: string, password: string): Promise<void>;
  remove(tenantId: string, userId: string): Promise<void>;
};

export type ReviewerMembers = {
  /** The plain `member` membership and the profile named `name`. Never any other role. */
  add(tenantId: string, userId: string, name: string): Promise<void>;
  /** What would stop the reviewer at the two gates (A-13-09). Read only: nothing is bypassed or granted. */
  warnings(tenantId: string, userId: string, email: string): Promise<ReviewerWarning[]>;
};

export type ReviewerDeps = {
  store?: ReviewerStore | undefined;
  auth?: ReviewerAuth | undefined;
  members?: ReviewerMembers | undefined;
  credentials?: CredentialStore | undefined;
  /** `[0, max)`, like `crypto.randomInt`. Injected so a test can make the draw predictable. */
  randomInt?: ((max: number) => number) | undefined;
  /** 4 random bytes for the address. */
  randomBytes?: ((size: number) => Uint8Array) | undefined;
};

/** A 24-character password with at least one lower-case letter, one upper-case letter and one digit. */
export function generateReviewerPassword(draw: (max: number) => number = randomInt): string {
  for (;;) {
    let value = '';
    for (let index = 0; index < REVIEWER_PASSWORD_LENGTH; index += 1) {
      value += ALPHABET[draw(ALPHABET.length)];
    }
    if (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[2-9]/.test(value)) return value;
  }
}

/** `app-review+<8 hex>@<primary host>`: on the tenant's own host, so it cannot collide with a real member. */
export const reviewerAddress = (host: string, hex: string): string => `app-review+${hex}@${host}`;

// --- The real seams ----------------------------------------------------------------------------------------

export const pgReviewerStore: ReviewerStore = {
  facts: (tenantId) => pgAppStore.facts(tenantId),
  async runLocked(tenantId, fn) {
    return withPlatformTx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`app-reviewer:${tenantId}`}))`);
      const [tenant] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant) throw new ApiError(404, 'NOT_FOUND');
      await tx.insert(tenantApps).values({ tenantId }).onConflictDoNothing();
      const [row] = await tx
        .select({ email: tenantApps.reviewerEmail, userId: tenantApps.reviewerUserId })
        .from(tenantApps)
        .where(eq(tenantApps.tenantId, tenantId))
        .for('update');
      if (!row) throw new ApiError(404, 'NOT_FOUND');
      return fn(row, async (email, userId) => {
        await tx
          .update(tenantApps)
          .set({ reviewerEmail: email, reviewerUserId: userId, updatedAt: sql`now()` })
          .where(eq(tenantApps.tenantId, tenantId));
      });
    });
  },
};

/** The tenant's OWN project's Auth admin, from the registry, for this tenant only (D-539). */
async function authAdminOf(tenantId: string) {
  return supabaseAdminFor(await resolveProject(tenantId)).auth.admin;
}

const isDuplicateAddress = (error: { message?: string; code?: string; status?: number }) => {
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    message.includes('already been registered') ||
    message.includes('already registered')
  );
};

export const pgReviewerAuth: ReviewerAuth = {
  async create(tenantId, { email, password, name }) {
    const admin = await authAdminOf(tenantId);
    const created = await admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (created.error) {
      if (isDuplicateAddress(created.error)) return { duplicate: true };
      throw new ApiError(500, 'INTERNAL');
    }
    const userId = created.data.user?.id;
    if (!userId) throw new ApiError(500, 'INTERNAL');
    return { userId };
  },
  async setPassword(tenantId, userId, password) {
    const updated = await (await authAdminOf(tenantId)).updateUserById(userId, { password });
    if (updated.error) throw new ApiError(500, 'INTERNAL');
  },
  async remove(tenantId, userId) {
    await (await authAdminOf(tenantId)).deleteUser(userId);
  },
};

export const pgReviewerMembers: ReviewerMembers = {
  async add(tenantId, userId, name) {
    await addReviewerMember(tenantId, userId, name);
  },
  async warnings(tenantId, userId, email) {
    return reviewerGateWarnings(tenantId, userId, email);
  },
};

/**
 * ONE admin-lane transaction in the tenant's project: the `member` membership (the only role this module ever
 * writes) and its profile name, the same two steps as a public sign-up. No consent row is written: the reviewer
 * is not a person accepting the community's rules, and nothing reads a consent as a gate.
 */
async function addReviewerMember(tenantId: string, userId: string, name: string): Promise<void> {
  await withAdminTx({ tenantId }, async (tx) => {
    const mirrored = await tx.execute<{ id: string }>(
      sql`select id from public.users where id = ${userId}::uuid`,
    );
    if (mirrored.length === 0) throw new Error('reviewer identity mirror row missing');
    const [membership] = await tx
      .insert(memberships)
      .values({ tenantId, userId, role: 'member', status: 'active' })
      .returning({ id: memberships.id });
    if (!membership) throw new Error('reviewer membership insert returned no row');
    const named = await tx
      .update(memberProfiles)
      .set({ displayName: name })
      .where(
        and(eq(memberProfiles.membershipId, membership.id), eq(memberProfiles.tenantId, tenantId)),
      )
      .returning({ id: memberProfiles.membershipId });
    if (named.length !== 1) throw new Error('reviewer profile row missing');
  });
}

/**
 * The two gates a plain member meets (A-13-09), read in SQL where each rule lives: a REQUIRED profile-form
 * question the reviewer has not answered (`app.profile_form_missing`), and the payment gate being on while the
 * address has no active access (`app.access_gate_on`, `app.access_effective`). Nothing is granted or bypassed.
 */
async function reviewerGateWarnings(
  tenantId: string,
  userId: string,
  email: string,
): Promise<ReviewerWarning[]> {
  return withAdminTx({ tenantId }, async (tx) => {
    const warnings: ReviewerWarning[] = [];
    const missing = await tx.execute<{ missing: number | string }>(sql`
      select app.profile_form_missing(m.tenant_id, m.id) as missing
        from public.memberships m
       where m.tenant_id = ${tenantId}::uuid and m.user_id = ${userId}::uuid
         and m.deleted_at is null`);
    if (Number(missing[0]?.missing ?? 0) > 0) warnings.push('profile_form_required');
    const gate = await tx.execute<{ on: boolean; state: string }>(sql`
      select app.access_gate_on(${tenantId}::uuid) as on,
             app.access_effective(${tenantId}::uuid, ${email}) as state`);
    if (gate[0]?.on === true && gate[0].state !== 'active') warnings.push('access_grant_required');
    return warnings;
  });
}

// --- The two operations ------------------------------------------------------------------------------------

const resolved = (deps: ReviewerDeps) => ({
  store: deps.store ?? pgReviewerStore,
  auth: deps.auth ?? pgReviewerAuth,
  members: deps.members ?? pgReviewerMembers,
  credentials: deps.credentials ?? pgCredentialStore,
  draw: deps.randomInt ?? randomInt,
  bytes: deps.randomBytes ?? randomBytes,
});

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

export type CreateReviewerResult = { email: string; warnings: ReviewerWarning[]; created: boolean };

/**
 * Creates the tenant's reviewer account, or returns the existing one (idempotent). Under the per-tenant lock:
 * the verified primary host (409 `CONFLICT` with the closed reason `no_primary_host` when there is none), a
 * confirmed Auth user with a random password, the `member` membership, the sealed `reviewer_password`, and the
 * address and user id recorded on `tenant_apps`. A failure after the user exists removes the user again, so no
 * orphan identity is left. The answer carries the address and the gate warnings, never the password.
 */
export async function createReviewer(
  tenantId: string,
  deps: ReviewerDeps = {},
): Promise<CreateReviewerResult> {
  const { store, auth, members, credentials, draw, bytes } = resolved(deps);
  const log = moduleLogger('platform.apps.reviewer');

  return store.runLocked(tenantId, async (state, record) => {
    if (state.userId !== null && state.email !== null) {
      const warnings = await members.warnings(tenantId, state.userId, state.email);
      return { email: state.email, warnings, created: false };
    }

    const facts = await store.facts(tenantId);
    if (!facts) throw new ApiError(404, 'NOT_FOUND');
    if (facts.primaryHost === null) {
      throw new ApiError(409, 'CONFLICT', { reason: 'no_primary_host' });
    }

    const password = generateReviewerPassword(draw);
    let userId: string | null = null;
    let email = '';
    for (let attempt = 0; attempt < ADDRESS_ATTEMPTS && userId === null; attempt += 1) {
      email = reviewerAddress(facts.primaryHost, hexOf(bytes(4)));
      const created = await auth.create(tenantId, {
        email,
        password,
        name: REVIEWER_DISPLAY_NAME,
      });
      if ('userId' in created) userId = created.userId;
    }
    if (userId === null) throw new ApiError(500, 'INTERNAL');

    try {
      await members.add(tenantId, userId, REVIEWER_DISPLAY_NAME);
      await credentials.upsertSealed(tenantId, REVIEWER_KIND, (rowId) =>
        seal(password, `${rowId}:${REVIEWER_KIND}`),
      );
      await record(email, userId);
    } catch (error) {
      await auth.remove(tenantId, userId).catch(() => undefined);
      throw error;
    }

    const warnings = await members.warnings(tenantId, userId, email);
    log.info({ event: 'platform.apps.reviewer.created', tenantId }, 'platform write');
    return { email, warnings, created: true };
  });
}

/**
 * Replaces the reviewer's password in Auth and in the sealed row (same row id, new value), keeping the same user.
 * 409 `CONFLICT` with the closed reason `reviewer_missing` when there is no account yet. Auth changes first and
 * the old password is put back if sealing the new one fails, so the two never disagree.
 */
export async function rotateReviewer(tenantId: string, deps: ReviewerDeps = {}): Promise<void> {
  const { store, auth, credentials, draw } = resolved(deps);
  const log = moduleLogger('platform.apps.reviewer');

  await store.runLocked(tenantId, async (state) => {
    if (state.userId === null) throw new ApiError(409, 'CONFLICT', { reason: 'reviewer_missing' });
    const userId = state.userId;
    const previousRow = await credentials.readSealed(tenantId, REVIEWER_KIND);
    const previous = previousRow
      ? open(previousRow.sealed, `${previousRow.id}:${REVIEWER_KIND}`)
      : null;

    const password = generateReviewerPassword(draw);
    await auth.setPassword(tenantId, userId, password);
    try {
      await credentials.upsertSealed(tenantId, REVIEWER_KIND, (rowId) =>
        seal(password, `${rowId}:${REVIEWER_KIND}`),
      );
    } catch (error) {
      if (previous !== null)
        await auth.setPassword(tenantId, userId, previous).catch(() => undefined);
      throw error;
    }
    log.info({ event: 'platform.apps.reviewer.rotated', tenantId }, 'platform write');
  });
}
