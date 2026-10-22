import { PLATFORM_TERMS_VERSION, type SignupBody } from '@rede-social/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D-539 / T-09.2-24 (09.2-05): `signupMember` creates the Auth user, and on a later failure deletes it, through
 * `supabaseAdminFor` of the PROJECT THE TENANT LIVES IN, so a membership written in project B never pairs
 * with an Auth user created in project A. Every collaborator is replaced by a recorder: an injected admin
 * registry (`createSupabaseAdminRegistry`) hands out one fake client per project, a fake lane runs the
 * transactions, and what is asserted is WHICH client each Auth call went to.
 */

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // lives in project 0
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // lives in project B
const USER_ID = '99999999-9999-4999-8999-999999999999';

type Calls = { createUser: ReturnType<typeof vi.fn>; deleteUser: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  clients: new Map<string, unknown>(),
  lanes: [] as unknown[],
  projectOf: {} as Record<string, unknown>,
}));

vi.mock('../db/admin-tx', () => ({
  withAdminTx: vi.fn(async (target: unknown, fn: (tx: unknown) => unknown) => {
    h.lanes.push(target);
    return fn({});
  }),
}));

vi.mock('../server/tenancy/access', () => ({
  hasTenantAccess: vi.fn(async () => 'active'),
  isAccessGateOn: vi.fn(async () => false),
}));

vi.mock('../server/tenancy/public-tenant', () => ({
  getPublicTenant: vi.fn(async (slug: string) => ({ slug, rulesVersion: 3 })),
  getTenantIdBySlug: vi.fn(async (slug: string) => (slug === 'tenant-b' ? TENANT_B : TENANT_A)),
}));

vi.mock('../server/tenancy/project-registry', () => ({
  resolveProject: vi.fn(async (tenantId: string) => h.projectOf[tenantId]),
}));

vi.mock('../server/supabase-admin', async () => {
  const actual = await vi.importActual<typeof import('../server/supabase-admin')>(
    '../server/supabase-admin',
  );
  return {
    ...actual,
    // The REAL registry, with injected seams: project 0 resolves to `central`, any other project to a client
    // built from its own url, so the test can tell which project a call used.
    supabaseAdminFor: (project: Parameters<typeof actual.supabaseAdminFor>[0]) =>
      registry().forProject(project),
  };
});

function fakeClient(name: string): { client: SupabaseClient; calls: Calls } {
  const calls: Calls = {
    createUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    deleteUser: vi.fn(async () => ({ data: null, error: null })),
  };
  const client = { name, auth: { admin: calls } } as unknown as SupabaseClient;
  h.clients.set(name, calls);
  return { client, calls };
}

let central: ReturnType<typeof fakeClient>;
let registryInstance: ReturnType<
  typeof import('../server/supabase-admin').createSupabaseAdminRegistry
>;
const registry = () => registryInstance;

const { createSupabaseAdminRegistry } = await import('../server/supabase-admin');
const { signupInternals, signupMember } = await import('../server/tenancy/signup');

const projectZero = {
  id: 'p0',
  credentialSource: 'env',
  credentialVersion: 1,
  apiUrl: 'http://zero.test',
  serviceKeySealed: null,
};
const projectB = {
  id: 'pb',
  credentialSource: 'sealed',
  credentialVersion: 1,
  apiUrl: 'https://project-b.test',
  serviceKeySealed: 'sealed-key-of-b',
};

const body: SignupBody = {
  email: 'pessoa@example.com',
  password: 'Segredo-Forte-123',
  name: 'Pessoa Teste',
  consents: { tenantRulesVersion: 3, platformTermsVersion: PLATFORM_TERMS_VERSION },
} as SignupBody;

let projectBClient: ReturnType<typeof fakeClient>;

beforeEach(() => {
  h.clients.clear();
  h.lanes.length = 0;
  central = fakeClient('central');
  projectBClient = fakeClient('project-b');
  registryInstance = createSupabaseAdminRegistry({
    create: (url) => (url === projectB.apiUrl ? projectBClient.client : central.client),
    central: () => central.client,
    open: (sealed) => sealed,
  });
  h.projectOf = { [TENANT_A]: projectZero, [TENANT_B]: projectB };
  vi.spyOn(signupInternals, 'insertMembershipAndConsents').mockResolvedValue(undefined);
});

const input = (slug: string) => ({ slug, body, ip: null, userAgent: null });

describe('signupMember resolves the Auth admin client from the tenant project (D-539)', () => {
  it('a tenant on project B creates through B client and never touches project 0', async () => {
    await expect(signupMember(input('tenant-b'))).resolves.toEqual({
      userId: USER_ID,
      tenantSlug: 'tenant-b',
    });
    expect(projectBClient.calls.createUser).toHaveBeenCalledTimes(1);
    expect(central.calls.createUser).not.toHaveBeenCalled();
    expect(central.calls.deleteUser).not.toHaveBeenCalled();
  });

  it('a project-0 tenant uses the environment client (supabaseAdminFor of project 0)', async () => {
    await signupMember(input('tenant-a'));
    expect(central.calls.createUser).toHaveBeenCalledTimes(1);
    expect(projectBClient.calls.createUser).not.toHaveBeenCalled();
  });

  it('the membership transaction is opened for the same tenant the Auth user was created for', async () => {
    await signupMember(input('tenant-b'));
    expect(h.lanes).toEqual([{ tenantId: TENANT_B }]);
    expect(signupInternals.insertMembershipAndConsents).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B, userId: USER_ID }),
    );
  });

  it('a failure after createUser deletes the user through the SAME client with the same id', async () => {
    vi.mocked(signupInternals.insertMembershipAndConsents).mockRejectedValueOnce(new Error('boom'));
    await expect(signupMember(input('tenant-b'))).rejects.toMatchObject({ status: 500 });
    expect(projectBClient.calls.createUser).toHaveBeenCalledTimes(1);
    expect(projectBClient.calls.deleteUser).toHaveBeenCalledTimes(1);
    expect(projectBClient.calls.deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(central.calls.deleteUser).not.toHaveBeenCalled();
  });

  it('the compensation of a project-0 tenant goes to project 0 and not to B', async () => {
    vi.mocked(signupInternals.insertMembershipAndConsents).mockRejectedValueOnce(new Error('boom'));
    await expect(signupMember(input('tenant-a'))).rejects.toMatchObject({ status: 500 });
    expect(central.calls.deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(projectBClient.calls.deleteUser).not.toHaveBeenCalled();
  });

  it('an unbound tenant stops before any Auth call (never falls back to project 0)', async () => {
    h.projectOf = {};
    const { resolveProject } = await import('../server/tenancy/project-registry');
    vi.mocked(resolveProject).mockRejectedValueOnce(new Error('unbound'));
    await expect(signupMember(input('tenant-b'))).rejects.toThrow('unbound');
    expect(central.calls.createUser).not.toHaveBeenCalled();
    expect(projectBClient.calls.createUser).not.toHaveBeenCalled();
  });
});
