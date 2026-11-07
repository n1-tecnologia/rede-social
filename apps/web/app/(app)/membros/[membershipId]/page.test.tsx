// @vitest-environment node

import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server.browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12-14 Task 3 (D-593, D-45, UI-D-592, UI-D-593; PFORM-18, PFORM-19): another member's page with the
 * form's answers block. Rendered through the real streaming renderer so each `Suspense` really resolves.
 * The API boundary is stubbed (`apiFetch` for the answers, the profile loaders for the base profile), so
 * the strict contract, the real blocks and the real catalog run. The point: the base profile renders
 * whatever the answers read does.
 */

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  requireBootstrap: vi.fn(),
  loadOwnProfile: vi.fn(),
  loadMemberProfile: vi.fn(),
}));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: () => mocks.requireBootstrap(),
}));
vi.mock('@/lib/profile', () => ({
  loadOwnProfile: () => mocks.loadOwnProfile(),
  loadMemberProfile: (id: string) => mocks.loadMemberProfile(id),
}));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: 'tenant', host: 'comunidade.exemplo.com.br' }),
}));
vi.mock('@/lib/admin-members', () => ({ loadAdminMemberForProfile: async () => null }));
vi.mock('@/components/social/SocialProfileBlock', () => ({ SocialProfileBlock: () => null }));
vi.mock('@/components/admin/ProfileAdminTrigger', () => ({ ProfileAdminTrigger: () => null }));
vi.mock('@/components/media/MediaImage', () => ({ MediaImage: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: MemberProfilePage } = await import('./page');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bootstrapFor = (role: string) => ({
  membership: { role },
  permissions: [],
  tenant: { displayName: 'Ana Mentoria' },
});

const ID = '00000000-0000-4000-8000-0000000000aa';

async function html(): Promise<string> {
  const ui = await MemberProfilePage({ params: Promise.resolve({ membershipId: ID }) });
  const stream = await renderToReadableStream(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const publicPayload = {
  kind: 'member',
  answers: [
    {
      questionId: '00000000-0000-4000-8000-000000000001',
      title: 'Qual é o seu cargo?',
      type: 'short_text',
      options: [],
      value: 'Gerente de produto',
    },
  ],
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireBootstrap.mockResolvedValue(bootstrapFor('member'));
  mocks.loadOwnProfile.mockResolvedValue({ membershipId: 'outro' });
  mocks.loadMemberProfile.mockResolvedValue({
    status: 'ok',
    member: { displayName: 'Carla Menezes', avatarAssetId: null, bio: 'Gerente de produto.' },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/membros/[membershipId] with the form answers block', () => {
  it('renders the base profile and, after it, the public block for a member viewer', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, publicPayload));
    const out = await html();
    expect(out).toContain('Carla Menezes');
    expect(out).toContain('Gerente de produto.');
    expect(out).toContain('Sobre Carla Menezes');
    expect(out).toContain('Qual é o seu cargo?');
    expect(out.indexOf('Carla Menezes')).toBeLessThan(out.indexOf('Sobre Carla Menezes'));
    expect(mocks.apiFetch).toHaveBeenCalledWith(`/v1/members/${ID}/profile-answers`);
  });

  it('renders the staff block for admin and support', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor('admin_tenant'));
    mocks.apiFetch.mockResolvedValue(
      json(200, {
        kind: 'staff',
        answers: [
          {
            ...publicPayload.answers[0],
            value: null,
            showOnProfile: true,
            position: 1,
            archivedAt: null,
            answered: false,
            required: false,
            branchId: null,
          },
        ],
        branches: [],
      }),
    );
    const out = await html();
    expect(out).toContain('Carla Menezes');
    expect(out).toContain('Esta pessoa ainda não respondeu o formulário.');
  });

  it('leaves the base profile as it was when the API answers its bare 404 (no block, no heading)', async () => {
    mocks.apiFetch.mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    const out = await html();
    expect(out).toContain('Carla Menezes');
    expect(out).not.toContain('Sobre ');
    expect(out).not.toContain('Respostas do formulário');
    expect(out).not.toContain('Não foi possível carregar as respostas agora.');
  });

  it('keeps the base profile and shows only the small error row when the answers read fails', async () => {
    mocks.apiFetch.mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    const out = await html();
    expect(out).toContain('Carla Menezes');
    expect(out).toContain('Gerente de produto.');
    expect(out).toContain('Não foi possível carregar as respostas agora.');
    expect(out).toContain('Tentar novamente');
    expect(out).toContain(`href="/membros/${ID}"`);
    expect(out).not.toContain('Sobre Carla');
    expect(out).not.toContain('Algo deu errado');
  });

  it('keeps the base profile when the answers request itself throws', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    const out = await html();
    expect(out).toContain('Carla Menezes');
    expect(out).toContain('Não foi possível carregar as respostas agora.');
  });

  it('keeps the existing flow: own membership redirects to /perfil, a miss is the one notFound', async () => {
    mocks.loadOwnProfile.mockResolvedValue({ membershipId: ID });
    await expect(html()).rejects.toThrow('REDIRECT /perfil');
    expect(mocks.apiFetch).not.toHaveBeenCalled();

    mocks.loadOwnProfile.mockResolvedValue({ membershipId: 'outro' });
    mocks.loadMemberProfile.mockResolvedValue({ status: 'not-found' });
    await expect(html()).rejects.toThrow('NOT_FOUND');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});
