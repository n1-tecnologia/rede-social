// @vitest-environment node

import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server.browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * Quick 261117-n9r (2026-11-17): the account e-mail under the name on `/perfil` is the tenant
 * administrator's alone. The page decides it on the server, so a member's or a support agent's HTML
 * must never carry the string (not hidden by CSS: not there). Rendered through the real streaming
 * renderer, with the REAL `ProfileHero` (the subject), the real catalog and the real pure libs; only
 * the API boundary (bootstrap, own profile) and the sections under the hero are stubbed, since this
 * test does not care about them. The assertions read the WHOLE html string.
 */

const mocks = vi.hoisted(() => ({
  requireBootstrap: vi.fn(),
  loadOwnProfile: vi.fn(),
}));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/api', () => ({ apiFetch: async () => new Response(null, { status: 404 }) }));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: () => mocks.requireBootstrap(),
}));
vi.mock('@/lib/profile', () => ({ loadOwnProfile: () => mocks.loadOwnProfile() }));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: 'tenant', host: 'comunidade.exemplo.com.br' }),
}));
vi.mock('@/lib/admin-icon-cookie', () => ({ readAdminIconChoice: async () => null }));
vi.mock('@/lib/profile-activity', () => ({ preloadProfileSections: () => {} }));
vi.mock('@/components/dashboard/OwnerPanelSection', () => ({ OwnerPanelSection: () => null }));
vi.mock('@/components/profile/activity/ActivitySkeleton', () => ({ ActivitySkeleton: () => null }));
vi.mock('@/components/profile/ProfileCompletenessCard', () => ({
  ProfileCompletenessCard: () => null,
}));
vi.mock('@/components/profile/ProfileSection', () => ({
  ProfileSection: () => null,
  ProfileRailSkeleton: () => null,
}));
vi.mock('@/components/profile-form/MyAnswersSection', () => ({
  MyAnswersSection: () => null,
  MyAnswersSkeleton: () => null,
}));
vi.mock('@/components/profile-form/NewQuestionsNotice', () => ({ NewQuestionsNotice: () => null }));
vi.mock('@/components/social/SocialProfileBlock', () => ({ SocialProfileBlock: () => null }));
vi.mock('@/components/media/MediaImage', () => ({ MediaImage: () => null }));
vi.mock('./ProfileActivity', () => ({ ProfileActivity: () => null }));
vi.mock('./ProfileCommunitiesRail', () => ({ ProfileCommunitiesRail: () => null }));
vi.mock('./ProfileEventsRail', () => ({ ProfileEventsRail: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
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

const { default: ProfilePage } = await import('./page');

const EMAIL = 'ana@example.com';

const bootstrapFor = (role: string) => ({
  membership: { role },
  modules: [],
  permissions: [],
  tenant: { displayName: 'Ana Mentoria', timezone: 'America/Sao_Paulo', branding: {} },
});

async function html(): Promise<string> {
  const ui = await ProfilePage({ searchParams: Promise.resolve({}) });
  const stream = await renderToReadableStream(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.loadOwnProfile.mockResolvedValue({
    membershipId: '00000000-0000-4000-8000-0000000000aa',
    displayName: 'Ana Souza',
    bio: 'Corro aos domingos.',
    avatarAssetId: null,
    avatarUrl: null,
    email: EMAIL,
    nudgeDismissedAt: null,
    needsNudge: false,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/perfil: the e-mail under the name is the administrator alone', () => {
  it('a member gets the name and the bio but never the e-mail anywhere in the html', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor('member'));
    const out = await html();
    expect(out).toContain('Ana Souza');
    expect(out).toContain('Corro aos domingos.');
    expect(out).not.toContain(EMAIL);
  });

  it('support_tenant is held back on purpose (lowest-risk reading): no e-mail either', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor('support_tenant'));
    const out = await html();
    expect(out).toContain('Ana Souza');
    expect(out).not.toContain(EMAIL);
  });

  it('admin_tenant sees the e-mail exactly once, after the name', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapFor('admin_tenant'));
    const out = await html();
    expect(out).toContain('Ana Souza');
    expect(out.split(EMAIL)).toHaveLength(2);
    expect(out.indexOf('Ana Souza')).toBeLessThan(out.indexOf(EMAIL));
  });
});
