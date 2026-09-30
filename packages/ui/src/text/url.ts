/**
 * THE URL matcher for member- and staff-authored text, shared by every surface that turns text into
 * links and by the feed's unfurl path (MEDIA-04, T-04-43).
 *
 * It lives here, in a React-free file with its own package entry point (`@rede-social/ui/text/url`),
 * because two consumers sit on opposite sides of the client/server line: the one `linkify` renderer
 * (a client-safe component helper) and the feed's contracts, which the API imports to pick the URL it
 * unfurls. The feed re-exports these under its historical names (`FEED_URL_PATTERN`,
 * `FEED_URL_TRAILING_PUNCTUATION`, `trimMatchedUrl`), so there is still exactly ONE rule for what
 * counts as a link: a caption can never render a link the unfurler never saw, and a chat bubble can
 * never be more permissive than a caption.
 *
 * Deliberately conservative: a run of non-space characters after `http://` or `https://`, with
 * trailing sentence punctuation pushed back into the text so "veja https://exemplo.com." matches the
 * URL and not the full stop. The scheme restriction is load-bearing: a `javascript:` or `data:` URL
 * simply is not a match, so it can never become an `href` and can never be enqueued.
 */
export const LINK_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
export const LINK_URL_TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** One match, trimmed of trailing punctuation. `matchAll` clones the regex, so `lastIndex` is safe. */
export function trimMatchedUrl(raw: string): string {
  const trailing = LINK_URL_TRAILING_PUNCTUATION.exec(raw);
  return trailing ? raw.slice(0, raw.length - trailing[0].length) : raw;
}
