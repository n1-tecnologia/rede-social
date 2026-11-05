import { describe, expect, it } from 'vitest';
import {
  createReviewer,
  generateReviewerPassword,
  REVIEWER_DISPLAY_NAME,
  type ReviewerAuth,
  type ReviewerMembers,
  type ReviewerRecord,
  type ReviewerStore,
  type ReviewerWarning,
  reviewerAddress,
  rotateReviewer,
} from '../server/apps/reviewer';
import { ApiError } from '../server/http/api-error';
import { open } from '../server/secrets/sealed';
import { memoryCredentialStore } from './fixtures/apps-memory';

/**
 * 13-31 Task 1 (D-607, Apple 2.1(a), NATIVE-29, T-13-55): the reviewer account at unit level. The three seams are
 * in-memory stand-ins, so the rules run with no database; the real stack is proved by
 * `apps/api/tests/integration/platform-reviewer.test.ts`.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const HOST = 'comunidade.cliente.test';

/** A store that queues callers per tenant, like the advisory lock does. */
function memoryReviewerStore(tenants: Record<string, string | null>) {
  const records = new Map<string, ReviewerRecord>();
  const queues = new Map<string, Promise<unknown>>();
  const store: ReviewerStore = {
    async facts(tenantId) {
      return tenantId in tenants
        ? { displayName: 'Comunidade', primaryHost: tenants[tenantId] ?? null }
        : null;
    },
    async runLocked(tenantId, fn) {
      if (!(tenantId in tenants)) throw new ApiError(404, 'NOT_FOUND');
      const previous = queues.get(tenantId) ?? Promise.resolve();
      const run = previous.then(async () => {
        const state = records.get(tenantId) ?? { email: null, userId: null };
        return fn(state, async (email, userId) => {
          records.set(tenantId, { email, userId });
        });
      });
      queues.set(
        tenantId,
        run.catch(() => undefined),
      );
      return run;
    },
  };
  return { store, records };
}

function memoryReviewerAuth() {
  const users = new Map<string, { email: string; password: string }>();
  const calls = { create: 0, setPassword: 0, remove: 0 };
  let duplicates = 0;
  const auth: ReviewerAuth = {
    async create(_tenantId, { email, password }) {
      calls.create += 1;
      if (duplicates > 0) {
        duplicates -= 1;
        return { duplicate: true };
      }
      const userId = `user-${users.size + 1}`;
      users.set(userId, { email, password });
      return { userId };
    },
    async setPassword(_tenantId, userId, password) {
      calls.setPassword += 1;
      const user = users.get(userId);
      if (!user) throw new Error('no user');
      user.password = password;
    },
    async remove(_tenantId, userId) {
      calls.remove += 1;
      users.delete(userId);
    },
  };
  return { auth, users, calls, failNextCreatesAsDuplicate: (n: number) => (duplicates = n) };
}

function memoryMembers(warnings: ReviewerWarning[] = []) {
  const added: { userId: string; name: string }[] = [];
  let failAdd = false;
  const members: ReviewerMembers = {
    async add(_tenantId, userId, name) {
      if (failAdd) throw new Error('membership insert failed');
      added.push({ userId, name });
    },
    async warnings() {
      return warnings;
    },
  };
  return { members, added, failAdd: () => (failAdd = true) };
}

function setup(options: { host?: string | null; warnings?: ReviewerWarning[] } = {}) {
  const host = options.host === undefined ? HOST : options.host;
  const reviewerStore = memoryReviewerStore({ [TENANT]: host });
  const authKit = memoryReviewerAuth();
  const membersKit = memoryMembers(options.warnings);
  const creds = memoryCredentialStore();
  const deps = {
    store: reviewerStore.store,
    auth: authKit.auth,
    members: membersKit.members,
    credentials: creds.store,
  };
  return { deps, ...reviewerStore, ...authKit, ...membersKit, creds };
}

const sealedPassword = (kit: ReturnType<typeof setup>): string | null => {
  const row = kit.creds.rows.get(`${TENANT}:reviewer_password`);
  return row ? open(row.sealed, `${row.id}:reviewer_password`) : null;
};

describe('generateReviewerPassword (T-13-55)', () => {
  it('is 24 characters, from an alphabet with no ambiguous character, with all three classes', () => {
    for (let index = 0; index < 200; index += 1) {
      const password = generateReviewerPassword();
      expect(password).toHaveLength(24);
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
    }
  });

  it('draws every character through the injected source (crypto.randomInt by default)', () => {
    let draws = 0;
    const password = generateReviewerPassword((max) => {
      draws += 1;
      return draws % max;
    });
    expect(password).toHaveLength(24);
    expect(draws).toBeGreaterThanOrEqual(24);
  });

  it('two passwords differ', () => {
    expect(generateReviewerPassword()).not.toBe(generateReviewerPassword());
  });
});

describe('createReviewer: the tracer (D-607)', () => {
  it('creates one confirmed member on the tenant host, seals the password and records the address', async () => {
    const kit = setup();
    const result = await createReviewer(TENANT, kit.deps);

    expect(result.created).toBe(true);
    expect(result.email).toMatch(
      new RegExp(`^app-review\\+[0-9a-f]{8}@${HOST.replace('.', '\\.')}$`),
    );
    expect(kit.users.size).toBe(1);
    const [user] = [...kit.users.values()];
    expect(user?.email).toBe(result.email);
    expect(user?.password).toHaveLength(24);

    expect(kit.added).toEqual([{ userId: 'user-1', name: REVIEWER_DISPLAY_NAME }]);
    expect(REVIEWER_DISPLAY_NAME).toBe('Revisor do app');
    expect(kit.records.get(TENANT)).toEqual({ email: result.email, userId: 'user-1' });

    // The sealed row opens (AAD <rowId>:reviewer_password) to the very password Auth was given.
    expect(sealedPassword(kit)).toBe(user?.password);
    const row = kit.creds.rows.get(`${TENANT}:reviewer_password`);
    expect(row?.sealed).not.toContain(user?.password ?? 'x');
  });

  it('never returns the password: the result is the address and the warnings only', async () => {
    const kit = setup();
    const result = await createReviewer(TENANT, kit.deps);
    const password = [...kit.users.values()][0]?.password ?? '';
    expect(JSON.stringify(result)).not.toContain(password);
    expect(Object.keys(result).sort()).toEqual(['created', 'email', 'warnings']);
  });

  it('is idempotent: a second call creates nothing and returns the same address', async () => {
    const kit = setup();
    const first = await createReviewer(TENANT, kit.deps);
    const second = await createReviewer(TENANT, kit.deps);
    expect(second.email).toBe(first.email);
    expect(second.created).toBe(false);
    expect(kit.calls.create).toBe(1);
    expect(kit.users.size).toBe(1);
    expect(kit.creds.calls.upsert).toBe(1);
  });

  it('two simultaneous calls create exactly one user and one sealed row; the loser returns the winner address', async () => {
    const kit = setup();
    const [a, b] = await Promise.all([
      createReviewer(TENANT, kit.deps),
      createReviewer(TENANT, kit.deps),
    ]);
    expect(a.email).toBe(b.email);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(kit.users.size).toBe(1);
    expect(kit.creds.rows.size).toBe(1);
  });

  it('answers the closed reason no_primary_host and creates nothing for a tenant without a verified host', async () => {
    const kit = setup({ host: null });
    const error = await createReviewer(TENANT, kit.deps).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('CONFLICT');
    expect((error as ApiError).details).toEqual({ reason: 'no_primary_host' });
    expect(kit.calls.create).toBe(0);
    expect(kit.creds.rows.size).toBe(0);
  });

  it('is 404 for a tenant the control plane does not know', async () => {
    const kit = setup();
    const error = await createReviewer('99999999-9999-4999-8999-999999999999', kit.deps).catch(
      (caught) => caught,
    );
    expect((error as ApiError).status).toBe(404);
    expect(kit.calls.create).toBe(0);
  });

  it('retries with a new address when the first one already exists in the project', async () => {
    const kit = setup();
    kit.failNextCreatesAsDuplicate(1);
    const result = await createReviewer(TENANT, kit.deps);
    expect(kit.calls.create).toBe(2);
    expect(kit.users.size).toBe(1);
    expect(result.email).toMatch(/^app-review\+[0-9a-f]{8}@/);
  });

  it('removes the Auth user again when a later step fails, and records nothing', async () => {
    const kit = setup();
    kit.failAdd();
    await expect(createReviewer(TENANT, kit.deps)).rejects.toThrow('membership insert failed');
    expect(kit.users.size).toBe(0);
    expect(kit.calls.remove).toBe(1);
    expect(kit.records.has(TENANT)).toBe(false);
    // And a later attempt starts clean.
    const retry = setup();
    expect((await createReviewer(TENANT, retry.deps)).created).toBe(true);
  });

  it('reports the two gate warnings without bypassing either gate (A-13-09)', async () => {
    const kit = setup({ warnings: ['profile_form_required', 'access_grant_required'] });
    const result = await createReviewer(TENANT, kit.deps);
    expect(result.warnings).toEqual(['profile_form_required', 'access_grant_required']);
    const again = await createReviewer(TENANT, kit.deps);
    expect(again.warnings).toEqual(['profile_form_required', 'access_grant_required']);
  });

  it('builds the address from the host and 8 hex characters', () => {
    expect(reviewerAddress('a.b.test', 'deadbeef')).toBe('app-review+deadbeef@a.b.test');
  });
});

describe('rotateReviewer (D-607, T-13-55)', () => {
  it('replaces the password in Auth and in the sealed row, keeping the user and the row id', async () => {
    const kit = setup();
    await createReviewer(TENANT, kit.deps);
    const rowBefore = kit.creds.rows.get(`${TENANT}:reviewer_password`);
    const before = sealedPassword(kit);

    await rotateReviewer(TENANT, kit.deps);

    const rowAfter = kit.creds.rows.get(`${TENANT}:reviewer_password`);
    const after = sealedPassword(kit);
    expect(rowAfter?.id).toBe(rowBefore?.id);
    expect(after).not.toBe(before);
    expect([...kit.users.values()][0]?.password).toBe(after);
    expect(kit.users.size).toBe(1);
    expect(kit.records.get(TENANT)?.userId).toBe('user-1');
  });

  it('rotating twice leaves one sealed row with the same id and a new value each time', async () => {
    const kit = setup();
    await createReviewer(TENANT, kit.deps);
    const id = kit.creds.rows.get(`${TENANT}:reviewer_password`)?.id;
    const seen = new Set<string | null>([sealedPassword(kit)]);
    await rotateReviewer(TENANT, kit.deps);
    seen.add(sealedPassword(kit));
    await rotateReviewer(TENANT, kit.deps);
    seen.add(sealedPassword(kit));
    expect(seen.size).toBe(3);
    expect(kit.creds.rows.size).toBe(1);
    expect(kit.creds.rows.get(`${TENANT}:reviewer_password`)?.id).toBe(id);
  });

  it('is the closed reason reviewer_missing when there is no account yet', async () => {
    const kit = setup();
    const error = await rotateReviewer(TENANT, kit.deps).catch((caught) => caught);
    expect((error as ApiError).code).toBe('CONFLICT');
    expect((error as ApiError).details).toEqual({ reason: 'reviewer_missing' });
    expect(kit.calls.setPassword).toBe(0);
  });

  it('puts the old password back in Auth when sealing the new one fails, so the two never disagree', async () => {
    const kit = setup();
    await createReviewer(TENANT, kit.deps);
    const before = sealedPassword(kit);
    const failing = {
      ...kit.deps,
      credentials: {
        ...kit.creds.store,
        async upsertSealed() {
          throw new Error('database down');
        },
      },
    };
    await expect(rotateReviewer(TENANT, failing)).rejects.toThrow('database down');
    expect([...kit.users.values()][0]?.password).toBe(before);
    expect(sealedPassword(kit)).toBe(before);
  });
});
