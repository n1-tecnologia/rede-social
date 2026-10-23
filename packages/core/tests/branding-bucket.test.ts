import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-07 (D-539, T-09.2-34): a tenant's brand files live in the Storage of the project that holds the tenant.
 * `brandingBucketFor(tenantId)` asks the registry which project that is and takes THAT project's admin client.
 * The registry and the admin clients are replaced by recorders, one Storage double per project, so the test can
 * say which project a call reached; nothing opens a socket.
 */
const h = vi.hoisted(() => ({
  stores: {
    p0: { id: 'p0', from: vi.fn((bucket: string) => ({ project: 'p0', bucket })) },
    pb: { id: 'pb', from: vi.fn((bucket: string) => ({ project: 'pb', bucket })) },
  } as Record<string, { id: string; from: ReturnType<typeof vi.fn> }>,
  resolveProject: vi.fn(),
}));

vi.mock('../server/supabase-admin', () => ({
  supabaseAdminFor: (project: { id: string }) => ({ storage: h.stores[project.id] }),
}));

vi.mock('../server/tenancy/project-registry', () => ({
  resolveProject: h.resolveProject,
  resolveProjectById: vi.fn(),
  invalidateProject: vi.fn(),
}));

const { brandingBucketFor } = await import('../server/platform/branding');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  h.stores.p0?.from.mockClear();
  h.stores.pb?.from.mockClear();
  h.resolveProject.mockReset();
});

describe('brandingBucketFor routes by the tenant that owns the key prefix', () => {
  it('a tenant on project B gets the branding bucket of B and project 0 is never touched', async () => {
    h.resolveProject.mockResolvedValue({ id: 'pb' });
    const bucket = await brandingBucketFor(TENANT_B);
    expect(bucket).toEqual({ project: 'pb', bucket: 'branding' });
    expect(h.resolveProject).toHaveBeenCalledWith(TENANT_B);
    expect(h.stores.pb?.from).toHaveBeenCalledTimes(1);
    expect(h.stores.p0?.from).not.toHaveBeenCalled();
  });

  it('a tenant of the central project gets the central client', async () => {
    h.resolveProject.mockResolvedValue({ id: 'p0' });
    expect(await brandingBucketFor(TENANT_A)).toEqual({ project: 'p0', bucket: 'branding' });
    expect(h.stores.pb?.from).not.toHaveBeenCalled();
  });

  it('two tenants of two projects resolve independently', async () => {
    h.resolveProject.mockImplementation(async (id: string) => ({
      id: id === TENANT_B ? 'pb' : 'p0',
    }));
    const [a, b] = await Promise.all([brandingBucketFor(TENANT_A), brandingBucketFor(TENANT_B)]);
    expect(a).toEqual({ project: 'p0', bucket: 'branding' });
    expect(b).toEqual({ project: 'pb', bucket: 'branding' });
  });

  it('an unbound tenant fails closed: the resolver error surfaces and no client is built', async () => {
    h.resolveProject.mockRejectedValue(new Error('tenant project unbound'));
    await expect(brandingBucketFor(TENANT_A)).rejects.toThrow('tenant project unbound');
    expect(h.stores.p0?.from).not.toHaveBeenCalled();
    expect(h.stores.pb?.from).not.toHaveBeenCalled();
  });
});
