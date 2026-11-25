import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11.1-16 (UI-D-891 a, c; A-UI-13) — `/stories/meus` decides on the server whether a member's row menu
 * offers "Destacar". The decision is `memberCanHighlight`: the member owns an active community, or the
 * catalogue the API answers for them lists a highlight the administrator opened. The page compares no
 * role: it reads the composed permissions and hands the finished fact to the list.
 *
 * The page is an async server component called directly with its collaborators mocked; the props it
 * hands to `StoryHistoryList` are captured.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  modules: [{ key: 'communities' }] as { key: string }[],
  canHighlight: false,
  memberCanHighlight: vi.fn(),
  listProps: null as Record<string, unknown> | null,
  hostMode: 'tenant',
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({ permissions: mocks.permissions, modules: mocks.modules }),
}));
vi.mock('@/lib/stories', () => ({
  loadOwnStories: async () => ({ items: [], nextCursor: null }),
  memberCanHighlight: (...args: unknown[]) => mocks.memberCanHighlight(...args),
}));
vi.mock('@/lib/tenant-host', () => ({ getHostTenant: async () => ({ mode: mocks.hostMode }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  PageHeader: () => null,
}));
vi.mock('./StoryHistoryList', () => ({
  StoryHistoryList: (props: Record<string, unknown>) => {
    mocks.listProps = props;
    return null;
  },
}));

const { default: StoryHistoryPage } = await import('./page');

const PUBLISH = 'stories.story.publish';
const MANAGE = 'stories.story.manage';

async function render() {
  mocks.listProps = null;
  const tree = (await StoryHistoryPage()) as ReactElement;
  renderToStaticMarkup(tree);
  return mocks.listProps as Record<string, unknown> | null;
}

beforeEach(() => {
  mocks.permissions = [PUBLISH, 'social.participate'];
  mocks.modules = [{ key: 'communities' }];
  mocks.hostMode = 'tenant';
  mocks.memberCanHighlight.mockReset();
  mocks.memberCanHighlight.mockImplementation(async () => mocks.canHighlight);
});

describe('/stories/meus — "Destacar" for a member comes from a finished fact (11.1-16)', () => {
  it('H1. a buyer with an open highlight is offered "Destacar" (member.canHighlight true)', async () => {
    mocks.canHighlight = true;
    const props = await render();
    expect(props?.member).toEqual({ canHighlight: true });
    expect(mocks.memberCanHighlight).toHaveBeenCalledWith(mocks.modules);
  });

  it('H2. with no open highlight and no community of their own the entry is absent (member.canHighlight false)', async () => {
    mocks.canHighlight = false;
    const props = await render();
    expect(props?.member).toEqual({ canHighlight: false });
  });

  it('H3. the administrator keeps the unchanged list: no member mode and the fact is never read', async () => {
    mocks.permissions = [PUBLISH, MANAGE];
    mocks.canHighlight = true;
    const props = await render();
    expect(props?.member).toBeUndefined();
    expect(mocks.memberCanHighlight).not.toHaveBeenCalled();
  });

  it('H4. without the publish permission the member goes back to /inicio', async () => {
    mocks.permissions = ['social.participate'];
    await expect(render()).rejects.toThrow('redirect:/inicio');
  });
});
