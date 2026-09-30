import { FAKE_PUSH_HOST, PUSH_SERVICE_HOST_SUFFIXES } from '../../contracts/index';

/** Which transport is active: the fake one accepts its own test host, the real one never does. */
export type PushTransportName = 'fake' | 'webpush';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * T-07-33 (SSRF): a subscription endpoint is attacker-controlled input the WORKER later POSTs to, so
 * it must name a real push service and nothing else. Accepted only when ALL hold:
 *
 * - it parses as a URL with the `https:` scheme;
 * - it carries no userinfo (`https://user:pass@…`);
 * - its port is the default (443): any explicit other port is refused;
 * - its hostname is not an IP literal (IPv4 dotted quad or a bracketed IPv6 address);
 * - its hostname ends with one of `PUSH_SERVICE_HOST_SUFFIXES` (the leading dot is load-bearing, so
 *   `evilgoogleapis.com` does not pass), or is exactly `push.fake.test` while the transport is `fake`.
 *
 * `localhost`, internal names and metadata hosts fail the suffix rule. A legitimate but unlisted push
 * service is a visible 400 (`endpoint_invalid`), never a silent loss.
 */
export function isAllowedPushEndpoint(url: string, transport: PushTransportName): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.port !== '' && parsed.port !== '443') return false;

  const host = parsed.hostname.toLowerCase();
  if (host === '' || host.startsWith('[') || host.includes(':') || IPV4.test(host)) return false;

  if (host === FAKE_PUSH_HOST) return transport === 'fake';
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
