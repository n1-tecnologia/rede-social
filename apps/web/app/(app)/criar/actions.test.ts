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
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/feed', () => ({ createPost: (...args: unknown[]) => mocks.createPost(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidatePath(path) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => mocks.redirect(path) }));

const { ApiClientError } = await import('@/lib/bootstrap');
const { createPostAction } = await import('./actions');

const COMMUNITY = '6e1d2d3f-8b52-4d63-8e4b-1f7a2c3d4e51';
const BODY = { caption: 'Preparei um resumo da aula de hoje.', communityId: COMMUNITY };

beforeEach(() => {
  mocks.createPost.mockReset();
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
