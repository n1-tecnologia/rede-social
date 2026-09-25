import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { storyWriteIssue } from '@/lib/stories';

/**
 * `storyWriteIssue` is the ONE place the web reads a story-publish refusal out of the API envelope.
 * Since 05.2-08 a publish can name a highlight (`highlightId` or `newHighlight`), so the refusal is
 * no longer only the story module's own `details.story` vocabulary: a destination community archived
 * after the composer opened answers `400 { highlight: 'archived' }`, and a pending title the API
 * refuses answers `{ highlight: 'title_invalid' }` — the highlight writes' own closed vocabulary.
 * These cases pin that the web tells those refusals apart from a generic failure, reads nothing
 * else, and no longer reads the retired `details.pin`.
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

  it('3. a 400 carrying details.highlight archived / title_invalid / full is that code', () => {
    for (const code of ['archived', 'title_invalid', 'full'] as const) {
      expect(
        storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { highlight: code })),
      ).toBe(code);
    }
  });

  it('4. an unknown highlight code, the retired details.pin, a 400 with no details and a non-API error are all null', () => {
    expect(
      storyWriteIssue(
        new ApiClientError(400, 'VALIDATION_FAILED', { highlight: 'something-else' }),
      ),
    ).toBeNull();
    expect(
      storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { pin: 'archived' })),
    ).toBeNull();
    expect(storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED'))).toBeNull();
    expect(storyWriteIssue(new Error('boom'))).toBeNull();
    expect(storyWriteIssue('archived')).toBeNull();
  });
});
