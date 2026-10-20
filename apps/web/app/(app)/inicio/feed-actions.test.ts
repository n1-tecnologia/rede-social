import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import {
  createComment,
  getComments,
  getReplies,
  likeComment,
  likePost,
  unlikeComment,
  unlikePost,
} from '@/lib/feed';
import {
  createCommentAction,
  likeCommentAction,
  likePostAction,
  loadCommentsAction,
  loadRepliesAction,
  unlikeCommentAction,
  unlikePostAction,
} from './feed-actions';

/**
 * 09-11 (UI-D-500, D-469, R-P6): the like and comment actions name the API's two closed refusals.
 * A 403 whose `details.access` is `community_locked` answers `{ ok: false, code: 'community_locked' }`
 * (08.2, unchanged); one whose access is `follow_required` answers `code: 'follow_required'`; every
 * other failure stays `generic`. The actions return a CODE, never copy, and the access value is read
 * from the error's own `details`, so a 500 or a 403 with another word can never read as either.
 *
 * Stubbed: the `@/lib/feed` clients (they throw the `ApiClientError` the API's envelope becomes) and
 * `redirect`. Real: `ApiClientError`, the refusal map and the id schemas.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(async () => ({ tenant: { timezone: 'America/Sao_Paulo' } })),
}));

vi.mock('@/lib/feed', () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  getComments: vi.fn(),
  getFeed: vi.fn(),
  getReplies: vi.fn(),
  likeComment: vi.fn(),
  likePost: vi.fn(),
  softDeletePost: vi.fn(),
  unlikeComment: vi.fn(),
  unlikePost: vi.fn(),
  updatePost: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('@/lib/tenant-host', () => ({ primaryHostOrigin: vi.fn(async () => 'https://x.example') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));

const ID = '11111111-1111-4111-8111-111111111111';
const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

function refusal(status: number, details?: Record<string, unknown>) {
  return new ApiClientError(status, 'FORBIDDEN', details);
}
const FOLLOW = refusal(403, { access: 'follow_required' });
const COMMUNITY = refusal(403, { access: 'community_locked', communityId: ID });

beforeEach(() => {
  vi.clearAllMocks();
  logged.mockClear();
});

type Case = [name: string, mock: () => ReturnType<typeof vi.fn>, call: () => Promise<unknown>];

const CASES: Case[] = [
  ['likePostAction', () => vi.mocked(likePost), () => likePostAction(ID)],
  ['unlikePostAction', () => vi.mocked(unlikePost), () => unlikePostAction(ID)],
  ['likeCommentAction', () => vi.mocked(likeComment), () => likeCommentAction(ID)],
  ['unlikeCommentAction', () => vi.mocked(unlikeComment), () => unlikeCommentAction(ID)],
  ['createCommentAction', () => vi.mocked(createComment), () => createCommentAction(ID, 'oi')],
  ['loadCommentsAction', () => vi.mocked(getComments), () => loadCommentsAction(ID)],
  ['loadRepliesAction', () => vi.mocked(getReplies), () => loadRepliesAction(ID)],
];

describe.each(CASES)('%s', (_name, mock, call) => {
  it('answers code follow_required to a 403 whose access is follow_required', async () => {
    mock().mockRejectedValue(FOLLOW);
    await expect(call()).resolves.toEqual({ ok: false, code: 'follow_required' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('keeps answering code community_locked to the 08.2 refusal', async () => {
    mock().mockRejectedValue(COMMUNITY);
    await expect(call()).resolves.toEqual({ ok: false, code: 'community_locked' });
  });

  it('answers generic to a 403 with any other word, a 403 without details and a 500', async () => {
    for (const error of [
      refusal(403, { access: 'something_else' }),
      refusal(403),
      refusal(500, { access: 'follow_required' }),
    ]) {
      mock().mockRejectedValueOnce(error);
      await expect(call()).resolves.toMatchObject({ ok: false, code: 'generic' });
    }
  });
});
