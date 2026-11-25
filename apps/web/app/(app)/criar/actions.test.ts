import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11.1-17 Task 2 (UI-D-893, D-888, T-11.1-62, T-11.1-63) - the composer's create action maps a refused
 * publish to the ONE word 'refused', from the status alone.
 *
 *  - the answer carries no reason, no code of the server and no text: a missing flag, a revoked
 *    purchase and a switched-off module are the same bytes;
 *  - it is tried AFTER the bootstrap redirects (a 403 that carries one still redirects);
 *  - a refused post into a community revalidates THAT community page (where the compose entries live)
 *    and never `/criar` itself, so the composer stays pinned to the community it opened with;
 *  - nothing is re-sent: the action calls the API exactly once and never with another destination.
 */

const mocks = vi.hoisted(() => ({
  createPost: vi.fn(),
  getBootstrap: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/feed', () => ({ createPost: (...args: unknown[]) => mocks.createPost(...args) }));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: (...args: unknown[]) => mocks.getBootstrap(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidatePath(path) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => mocks.redirect(path) }));

const { ApiClientError } = await import('@/lib/bootstrap');
const { createPostAction } = await import('./actions');

const COMMUNITY = '6e1d2d3f-8b52-4d63-8e4b-1f7a2c3d4e51';
const BODY = { caption: 'Preparei um resumo da aula de hoje.', communityId: COMMUNITY };
const BODY_NO_COMMUNITY = { caption: 'Preparei um resumo da aula de hoje.' };

/** The buyer's composed permissions: they speak as a member (no `content.publish`). */
const MEMBER_LANE = { permissions: ['feed.post.create', 'social.participate'] };
/** The organization's composer: `content.publish` on top, so never the member lane. */
const STAFF_LANE = {
  permissions: ['feed.post.create', 'content.publish', 'social.participate'],
};

beforeEach(() => {
  mocks.createPost.mockReset();
  mocks.getBootstrap.mockReset();
  mocks.getBootstrap.mockResolvedValue(MEMBER_LANE);
  mocks.revalidatePath.mockClear();
  mocks.redirect.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('createPostAction - a refused publish (11.1-17, UI-D-893)', () => {
  it('R1. a bare 403 into a community is { ok: false, code: refused } and nothing else', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN'));

    const result = await createPostAction(BODY);

    expect(result).toEqual({ ok: false, code: 'refused' });
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('R2. the answer is the same bytes whatever the 403 carried (a code, details, a reason)', async () => {
    const answers: string[] = [];
    for (const error of [
      new ApiClientError(403, 'FORBIDDEN'),
      new ApiClientError(403, 'SOMETHING_ELSE', { reason: 'refund', product: 'Mentoria' }),
      new ApiClientError(403, 'FORBIDDEN', { flag: 'post' }, 'req-1'),
    ]) {
      mocks.createPost.mockRejectedValue(error);
      answers.push(JSON.stringify(await createPostAction(BODY)));
    }

    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).not.toMatch(/refund|Mentoria|post"|flag|FORBIDDEN/i);
  });

  it('R3. a refusal revalidates the community page (where the entries live) and not /criar', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN'));

    await createPostAction(BODY);

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY}`);
  });

  it('R4. a refusal logs no line (the caption is member content and the reason is not ours to record)', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN'));

    await createPostAction(BODY);

    expect(console.error).not.toHaveBeenCalled();
  });

  it('R5. a 403 that carries a bootstrap redirect still redirects, never refused', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(403, 'TENANT_HOST_MISMATCH'));

    await expect(createPostAction(BODY)).rejects.toThrow('REDIRECT:/participar');
  });

  it('R6. any other failure keeps its own answer: a 500 is generic and logged, a 404 is not_found', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(500, 'INTERNAL'));
    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'generic' });
    expect(console.error).toHaveBeenCalledTimes(1);

    mocks.createPost.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'not_found' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('R7. positive control: an accepted post is ok and revalidates Início, the post and the community', async () => {
    mocks.createPost.mockResolvedValue({ id: 'POST_NEW' });

    expect(await createPostAction(BODY)).toEqual({ ok: true, postId: 'POST_NEW' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/inicio');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/post/POST_NEW');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY}`);
  });
});

/**
 * 11.1-20 (WR-02, D-888, UI-D-893, T-11.1-72, T-11.1-73): the word 'refused' is the MEMBER lane's only
 * (a publish into a community by a viewer whose composed permissions make the member composer). A 403
 * anywhere else is the generic answer with its log line, exactly as before Phase 11.1. The lane is read
 * on the server, lazily, only when a 403 has to be classified.
 */
describe('createPostAction - the refused word is the member lane only (11.1-20, WR-02)', () => {
  const bare403 = () => new ApiClientError(403, 'FORBIDDEN');

  it("W1. a staff composer's bare 403 into a community is generic, logged once, and revalidates nothing", async () => {
    mocks.getBootstrap.mockResolvedValue(STAFF_LANE);
    mocks.createPost.mockRejectedValue(bare403());

    const result = await createPostAction(BODY);

    expect(result).toEqual({ ok: false, code: 'generic' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toBe('feed.post.write_failed');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();

    // positive control: the same 403 from the member lane flips back to the word.
    mocks.getBootstrap.mockResolvedValue(MEMBER_LANE);
    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'refused' });
  });

  it('W2. the member lane stays refused: no log line, the community page revalidated', async () => {
    mocks.createPost.mockRejectedValue(bare403());

    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'refused' });
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY}`);
  });

  it('W3. a member with no community (the Explorar composer) is generic and logged, as before 11.1', async () => {
    mocks.createPost.mockRejectedValue(bare403());

    expect(await createPostAction(BODY_NO_COMMUNITY)).toEqual({ ok: false, code: 'generic' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    // positive control: the same member with a community in the body is refused.
    vi.mocked(console.error).mockClear();
    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'refused' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('W4. fails safe: a lane read that rejects is generic and logged once', async () => {
    mocks.getBootstrap.mockRejectedValue(new ApiClientError(500, 'INTERNAL'));
    mocks.createPost.mockRejectedValue(bare403());

    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'generic' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('W5. the lane is read lazily: an accepted post, a 500 and a 404 never read it; a 403 reads it once', async () => {
    mocks.createPost.mockResolvedValue({ id: 'POST_NEW' });
    await createPostAction(BODY);
    mocks.createPost.mockRejectedValue(new ApiClientError(500, 'INTERNAL'));
    await createPostAction(BODY);
    mocks.createPost.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    await createPostAction(BODY);
    expect(mocks.getBootstrap).not.toHaveBeenCalled();

    mocks.createPost.mockRejectedValue(bare403());
    await createPostAction(BODY);
    expect(mocks.getBootstrap).toHaveBeenCalledTimes(1);
  });

  it('W6. a 403 that carries a bootstrap redirect still redirects and reads no lane', async () => {
    mocks.createPost.mockRejectedValue(new ApiClientError(403, 'TENANT_HOST_MISMATCH'));

    await expect(createPostAction(BODY)).rejects.toThrow('REDIRECT:/participar');
    expect(mocks.getBootstrap).not.toHaveBeenCalled();
  });

  it("W7. a buyer's refusal stays neutral when `social` was turned off while the composer was open", async () => {
    // The live bootstrap after the 403 has lost every `social` key (feed.post.create, social.participate).
    mocks.getBootstrap.mockResolvedValue({ permissions: [] });
    mocks.createPost.mockRejectedValue(bare403());

    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'refused' });
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY}`);

    // positive control: a staff composer in the same state (content.publish, no social key) is generic and logged.
    vi.mocked(console.error).mockClear();
    mocks.revalidatePath.mockClear();
    mocks.getBootstrap.mockResolvedValue({ permissions: ['content.publish'] });
    expect(await createPostAction(BODY)).toEqual({ ok: false, code: 'generic' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
