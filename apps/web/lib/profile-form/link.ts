/**
 * The link helper of the member's completion screen (12-13, D-590, UI-D-585).
 *
 * `normalizeLink` only adds what the member left out, the `https://` in front of `exemplo.com.br`. It
 * never repairs a scheme: `ftp:`, `javascript:` and `data:` are left exactly as typed so the contract's
 * `parseAnswer` (the same rule as the server, which accepts `http:` and `https:` only) refuses them
 * (T-12-31).
 */

/** A scheme: letters, digits, `+`, `-`, `.` then a colon. `exemplo.com:8080` also looks like one. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** What follows the colon of a host and a port: digits, then the path or nothing. */
const PORT_AFTER_HOST = /^:\d+(?:[/?#]|$)/;

export function normalizeLink(raw: string): string {
  const text = raw.trim();
  if (text === '') return '';
  if (SCHEME.test(text)) {
    const colon = text.indexOf(':');
    // `localhost:3000/x` and `exemplo.com:8080` are hosts with a port, not schemes.
    if (!PORT_AFTER_HOST.test(text.slice(colon))) return text;
  }
  // A protocol-relative `//exemplo.com` only lacks its scheme.
  return `https://${text.replace(/^\/\//, '')}`;
}
