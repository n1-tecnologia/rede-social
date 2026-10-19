import { describe, expect, it } from 'vitest';
import { ACCESS_REFUSALS, POST_ACCESS } from '../src/access';

describe('access (08.2, STORE-13, STORE-15, STORE-17): the community access vocabulary', () => {
  it('pins the 403 refusal list to community_locked then follow_required (09-05, D-469)', () => {
    expect([...ACCESS_REFUSALS]).toEqual(['community_locked', 'follow_required']);
  });

  it('keeps community_locked at index 0: the web reads ACCESS_REFUSALS[0] as the community code (UI-D-500)', () => {
    expect(ACCESS_REFUSALS[0]).toBe('community_locked');
    expect(ACCESS_REFUSALS[ACCESS_REFUSALS.length - 1]).toBe('follow_required');
  });

  it('pins the post access marker list to exactly sample (absent means full access)', () => {
    expect([...POST_ACCESS]).toEqual(['sample']);
  });
});
