import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { storyWriteIssue } from '@/lib/stories';

/**
 * `storyWriteIssue` is the ONE place the web reads a story-publish refusal out of the API envelope.
 * Since 05.1-01 a publish can carry a `communityId`, so the refusal is no longer only the story
 * module's own `details.story` vocabulary: a community archived after the composer opened answers
 * `400 { pin: 'archived' }`, exactly what the post-hoc pin toggle answers (Pitfall 7). These cases pin
 * that the web tells that refusal apart from a generic failure — and reads nothing else.
 *
 * What is stubbed: `lib/env` only. What is real: the error class and the mapping.
 */

// The module graph reaches `lib/api` -> `lib/env`, which validates the process environment at
// import time (fail fast, by design). Stubbed here exactly as `comunidades/actions.test.ts` does.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'tria.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

describe('storyWriteIssue — the publish refusal the composer can switch on', () => {
  it('1. a bare 404 is not_found', () => {
    expect(storyWriteIssue(new ApiClientError(404, 'NOT_FOUND'))).toBe('not_found');
  });

  it('2. a 400 carrying details.story media_invalid is media_invalid', () => {
    expect(
      storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { story: 'media_invalid' })),
    ).toBe('media_invalid');
  });

  it('3. a 400 carrying details.pin archived is archived (the community was archived while composing)', () => {
    expect(storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { pin: 'archived' }))).toBe(
      'archived',
    );
  });

  it('4. an unknown pin code, a 400 with no details and a non-API error are all null', () => {
    expect(
      storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { pin: 'something-else' })),
    ).toBeNull();
    expect(storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED'))).toBeNull();
    expect(storyWriteIssue(new Error('boom'))).toBeNull();
    expect(storyWriteIssue('archived')).toBeNull();
  });
});
