import { LINK_URL_PATTERN, linkify as sharedLinkify, trimMatchedUrl } from '@rede-social/ui';
import { describe, expect, it } from 'vitest';
import { FEED_URL_PATTERN, trimMatchedUrl as feedTrim, firstUrlIn } from '../contracts/index';
import { linkify } from '../ui/index';

/**
 * 07-09 re-homed the auto-linker into `@rede-social/ui` (MOD-02). The feed must keep exposing the SAME
 * function and the SAME matcher, not copies: the create path unfurls with `firstUrlIn`, the caption
 * links with `linkify`, and the two may never disagree about what a link is (MEDIA-04, T-04-43).
 */
describe('feed linkify and matcher are the shared ones', () => {
  it('re-exports the one linkify', () => {
    expect(linkify).toBe(sharedLinkify);
  });

  it('re-exports the one matcher and trimmer', () => {
    expect(FEED_URL_PATTERN).toBe(LINK_URL_PATTERN);
    expect(feedTrim).toBe(trimMatchedUrl);
    expect(firstUrlIn('veja https://exemplo.com. e javascript:alert(1)')).toBe(
      'https://exemplo.com',
    );
  });
});
