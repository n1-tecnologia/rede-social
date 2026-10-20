// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommentItem, PostHeader } from '@rede-social/module-feed/ui';
import { ReelRail } from '@rede-social/module-reels/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-10 (D-470, UI-D-498, EP-42 FOLLOW-05 adjacency): the Seguir control renders in FOUR places - the
 * member profile (beside the counts), the "Siga para ver" screen (plan 11), each `/membros` row of a
 * member viewer and each row of the two private lists - and NOWHERE else. In particular it never sits
 * next to a name in a post header, a comment row, the Reels rail or the overlay, so a member is never
 * invited to follow from a place where they are reading, liking or commenting.
 *
 * Two layers, because "does not render" alone could pass by accident: the three components are
 * RENDERED with a member author and must offer no follow control (no button named Seguir or Seguindo,
 * no word of it), and the SOURCE of every author-bearing surface must not import the social module's
 * UI or the host's `FollowControl` at all, so the control cannot appear without this test going red.
 */

afterEach(cleanup);

const FOLLOW_WORDS = /segu(ir|indo|idor)|follow/i;

function expectNoFollowControl(container: HTMLElement) {
  for (const button of screen.queryAllByRole('button')) {
    expect(button.getAttribute('aria-label') ?? button.textContent ?? '').not.toMatch(FOLLOW_WORDS);
  }
  expect(container.textContent ?? '').not.toMatch(FOLLOW_WORDS);
  expect(container.querySelector('[aria-label*="eguir"]')).toBeNull();
}

describe('EP-42: no follow control next to a member author', () => {
  it('N1: PostHeader with a member author', () => {
    const { container } = render(
      <PostHeader
        displayName="Helena Autora"
        profileHref="/membros/00000000-0000-4000-8000-000000000001"
        avatarUrl={null}
        createdAtIso="2026-10-19T12:00:00.000Z"
        createdAtRelative="agora"
        createdAtAbsolute="19 de outubro"
        onMore={vi.fn()}
        moreLabel="Mais opções"
      />,
    );
    expect(screen.getByRole('link', { name: /Helena Autora/ })).toBeTruthy();
    expectNoFollowControl(container);
  });

  it('N2: CommentItem with a member author', () => {
    const { container } = render(
      <CommentItem
        comment={{
          id: 'c1',
          body: 'Um comentário de outra pessoa.',
          author: {
            displayName: 'Helena Autora',
            profileHref: '/membros/00000000-0000-4000-8000-000000000001',
            avatarUrl: null,
          },
          authorRemoved: false,
          createdAtIso: '2026-10-19T12:00:00.000Z',
          createdAtRelative: 'agora',
          createdAtAbsolute: '19 de outubro',
          likeCount: 0,
          viewerLiked: false,
          replyCount: 0,
          isReply: false,
          canDelete: false,
          removal: null,
        }}
        locale="pt-BR"
        labels={{
          removedAuthor: 'Membro removido',
          like: 'Curtir',
          unlike: 'Descurtir',
          likes: { one: '1 curtida', other: '{count} curtidas' },
          reply: 'Responder',
          delete: 'Excluir',
        }}
        onReply={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );
    expect(screen.getByText('Um comentário de outra pessoa.')).toBeTruthy();
    expectNoFollowControl(container);
  });

  it('N3: the Reels rail with a member author', () => {
    const { container } = render(
      <ReelRail
        author={{
          href: '/membros/00000000-0000-4000-8000-000000000001',
          avatarUrl: null,
          name: 'Helena Autora',
          label: 'Ver o perfil de Helena Autora',
        }}
        like={
          <button type="button" aria-label="Curtir">
            coracao
          </button>
        }
        likeCount={null}
        commentLabel="Comentar"
        commentCount={null}
        onComment={vi.fn()}
        shareLabel="Compartilhar"
        onShare={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ver o perfil de Helena Autora' })).toBeTruthy();
    expectNoFollowControl(container);
  });
});

describe('D-470: the author-bearing surfaces do not import the follow control', () => {
  const ROOT = join(process.cwd(), '..', '..');
  const SURFACES = [
    'packages/modules/feed/ui/PostHeader.tsx',
    'packages/modules/feed/ui/CommentItem.tsx',
    'packages/modules/feed/ui/PostCard.tsx',
    'packages/modules/reels/ui/ReelRail.tsx',
    'apps/web/components/reels/ReelOverlay.tsx',
    'apps/web/components/reels/ReelsOverlay.tsx',
  ];

  it.each(SURFACES)('N4: %s imports neither the social UI nor a follow control', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toContain('module-social');
    expect(source).not.toMatch(/FollowControl|FollowButton|FollowCounts|FollowListRow/);
  });
});
