import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-14 Task 2 (UI-D-710, UI-D-716, UI-D-717) — `/comunidades/[communityId]/editar` opens for whoever the
 * API's `viewer.canEdit` says may edit: an admin on an organization community, the creator of a member
 * community (while `social` is on), and a moderator on a member community. Everyone else, and the creator
 * with `social` off, is sent back to the community page; a miss is the shipped not-found screen.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  modules: [{ key: 'communities' }] as { key: string }[],
  result: null as unknown,
  hostMode: 'tenant',
}));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: { displayName: 'Rede Lab' },
    modules: mocks.modules,
  }),
}));
vi.mock('@/lib/communities', async (orig) => ({
  ...(await orig<typeof import('@/lib/communities')>()),
  loadCommunity: async () => mocks.result,
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/store', () => ({ getCommunityAccess: async () => null }));
vi.mock('@/lib/store-view', () => ({ communityAccessProductsView: () => [] }));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: mocks.hostMode }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/app/(app)/comunidades/CommunityForm', () => ({ CommunityForm: () => null }));

const { default: EditCommunityPage } = await import('./page');

const ID = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';

function community(kind: 'organization' | 'member', canEdit: boolean, isOwner = false) {
  return {
    id: ID,
    name: 'Clube de Leitura',
    slug: 'clube',
    description: 'Livros',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: 'active' as const,
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    kind,
    createdBy: null,
    viewer: {
      isOwner,
      canPublish: canEdit && isOwner,
      canEdit,
      canCurate: canEdit && isOwner,
      actions: {
        like: true,
        comment: true,
        share: true,
        post: canEdit && isOwner,
        story: canEdit && isOwner,
      },
    },
  };
}

async function render() {
  return (await EditCommunityPage({
    params: Promise.resolve({ communityId: ID }),
  })) as ReactElement<Record<string, unknown>>;
}

beforeEach(() => {
  mocks.permissions = [];
  mocks.hostMode = 'tenant';
});

describe('/comunidades/[communityId]/editar — the guard is viewer.canEdit (UI-D-710, UI-D-716)', () => {
  it('E1. the creator of a member community opens the form', async () => {
    mocks.result = { status: 'ok', community: community('member', true, true) };

    const element = await render();

    expect(element.props.mode).toBe('edit');
    expect(element.props.communityId).toBe(ID);
    // UI-D-712: the owner's copy variant and the member form (no store block, the audience line).
    expect(element.props.relation).toBe('owner');
    expect(element.props.memberMode).toBe(true);
  });

  it('E2. an admin on an organization community and a moderator on a member one open it too', async () => {
    mocks.result = { status: 'ok', community: community('organization', true) };
    const organization = await render();
    expect(organization.props.communityId).toBe(ID);
    expect(organization.props.relation).toBe('organization');
    expect(organization.props.memberMode).toBe(false);

    mocks.result = { status: 'ok', community: community('member', true) };
    const moderator = await render();
    expect(moderator.props.communityId).toBe(ID);
    // UI-D-714: the moderator's copy variant; the member form, but no audience line (the form decides).
    expect(moderator.props.relation).toBe('moderator');
    expect(moderator.props.memberMode).toBe(true);
  });

  it('E3. a viewer who may not edit (another member, support, the creator with social off) goes back to the community page', async () => {
    mocks.result = { status: 'ok', community: community('member', false) };
    await expect(render()).rejects.toThrow(`REDIRECT:/comunidades/${ID}`);

    mocks.result = { status: 'ok', community: community('member', false, true) };
    await expect(render()).rejects.toThrow(`REDIRECT:/comunidades/${ID}`);
  });

  it('E4. the guard is the flag, not a permission: a manage permission with canEdit false still redirects', async () => {
    mocks.permissions = ['communities.community.manage'];
    mocks.result = { status: 'ok', community: community('member', false) };

    await expect(render()).rejects.toThrow(`REDIRECT:/comunidades/${ID}`);
  });

  it('E5. a miss or a failed read is the shipped not-found screen, with no hint of the editor', async () => {
    mocks.result = { status: 'not-found' };
    await expect(render()).rejects.toThrow('NOT_FOUND');

    mocks.result = { status: 'error' };
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});
