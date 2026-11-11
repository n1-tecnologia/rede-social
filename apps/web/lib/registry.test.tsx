import type { Bootstrap } from '@rede-social/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RowCircleView } from '@/lib/story-view';

/**
 * 10-12, Pitfall 12 / SOCIAL-02: giving members `stories.story.publish` must not draw the admin's
 * "+ Seu story" in Início. Início is the ORGANIZATION's voice: its publish circle needs
 * `content.publish` as well, and a member's own circle lives in Explorar (`social.participate`).
 *
 * The Início stories slot is rendered for real, with the two reads it makes (`loadStories`,
 * `loadHighlights`) answering "nothing live", so the ONLY circle that can appear is the publish door,
 * and the permission sets are the ones the API composes (SOCIAL-02, D-707): a member holds the
 * composed `stories.story.publish` and `social.participate`, the administrator `content.publish`,
 * `stories.story.publish` and `stories.story.manage`.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/stories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stories')>()),
  loadStories: vi.fn(async () => ({ items: [], nextCursor: null })),
  loadHighlights: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/lib/tenant-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-host')>()),
  primaryHostOrigin: vi.fn(async () => null),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    getLocale: vi.fn(async () => 'pt-BR'),
    getTranslations: vi.fn(async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

const { WEB_MODULE_REGISTRY } = await import('@/lib/registry');

function bootstrapWith(permissions: string[]): Bootstrap {
  return {
    permissions,
    modules: [{ key: 'stories' }, { key: 'social' }],
    tenant: { displayName: 'Rede Demo', branding: { logoUrl: null } },
    membership: { profile: { avatarUrl: null } },
  } as unknown as Bootstrap;
}

/** The circles the Início stories slot renders, or `null` when the slot renders no node at all. */
async function inicioCircles(permissions: string[]): Promise<RowCircleView[] | null> {
  const slot = await WEB_MODULE_REGISTRY.stories?.home?.[0]?.({
    bootstrap: bootstrapWith(permissions),
  });
  if (slot === null || slot === undefined) return null;
  const band = slot as ReactElement<{ children: ReactElement<{ circles: RowCircleView[] }> }>;
  return band.props.children.props.circles;
}

describe('the Início stories slot — the publish circle is the organization’s voice (10-12, Pitfall 12)', () => {
  it('a member holding the composed permission set gets NO publish circle in Início (no node at all)', async () => {
    const member = ['social.participate', 'feed.post.create', 'stories.story.publish'];
    expect(await inicioCircles(member)).toBeNull();
  });

  it('the administrator keeps the "+ Seu story" circle exactly as before, with its dashed ring and the centred plus', async () => {
    const admin = [
      'content.publish',
      'stories.story.publish',
      'stories.story.manage',
      'moderation.manage',
    ];
    const circles = await inicioCircles(admin);
    expect(circles?.map((circle) => circle.key)).toContain('own');
    expect(circles?.find((circle) => circle.key === 'own')).toMatchObject({
      kind: 'link',
      href: '/stories/publicar',
      ring: 'dashed',
      disc: { kind: 'own' },
    });
  });
});
