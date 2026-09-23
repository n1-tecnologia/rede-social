import { createHash } from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector } from 'undici';

/**
 * MEDIA-04 — the SSRF policy for the ONE outbound-HTTP-to-an-untrusted-host surface in the product.
 *
 * PURE MODULE: no database, no `env`, no logger, no network at import — the
 * `packages/core/server/paging.ts` / `branding/upload.ts` posture, so every rule here is
 * unit-testable against local `node:http` fixtures with no stack behind it.
 *
 * The guard is pinned at the SOCKET layer, not at the URL layer. That is not a stylistic choice:
 * research falsified the obvious implementation this session. An Agent given only a resolver hook
 * (a `lookup` inside its connect options) blocks `http://localhost/` and walks straight through to
 * `http://127.0.0.1/` and to the cloud
 * metadata address, because `net.connect` only consults `lookup` for HOSTNAMES. A connector
 * FUNCTION sees `opts.hostname` for every target, literal or not, on EVERY redirect hop — so one
 * guard covers the IP literal, the hostname, the redirect into a private range, and DNS rebinding.
 *
 * The policy is injectable (`GuardPolicy`) for exactly one reason: every fixture a test can start
 * is on the loopback, and the loopback is precisely what production refuses. A case that needs its
 * fixture to be REACHABLE substitutes a block list naming different addresses while keeping the
 * production connector, the production lookup and the production Agent options. `DEFAULT_GUARD_POLICY`
 * carries the numbers that actually ship.
 */

/** A policy refusal, named so a caller can tell it apart from a transport failure. */
export class BlockedTargetError extends Error {}

export interface GuardPolicy {
  /** The ranges a tenant's worker must never be able to reach. */
  blockList: net.BlockList;
  /** PITFALL 2: the scraper reads the WHOLE body before it checks the content type. */
  maxResponseSize: number;
  connectTimeout: number;
  headersTimeout: number;
  bodyTimeout: number;
  /** Socket-establishment timeout handed to the base connector. */
  connectorTimeout: number;
}

/** Everything a tenant's worker must never be able to reach. `net.BlockList` does the range math. */
function denyList(): net.BlockList {
  const blockList = new net.BlockList();
  for (const [cidr, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // ← the GCP/AWS metadata endpoint lives here
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved
  ] as const) {
    blockList.addSubnet(cidr, prefix, 'ipv4');
  }
  for (const [cidr, prefix] of [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['fc00::', 7], // unique-local
    ['fe80::', 10], // link-local
    ['64:ff9b::', 96], // NAT64
    ['2001:db8::', 32], // documentation
  ] as const) {
    blockList.addSubnet(cidr, prefix, 'ipv6');
  }
  return blockList;
}

/**
 * The IPv4-mapped IPv6 range, kept OUT of the deny list above and handled by unwrapping instead.
 *
 * Adding `::ffff:0:0/96` as an ipv6 subnet looks like the obvious way to stop `::ffff:127.0.0.1`
 * from smuggling a blocked IPv4 address past the IPv4 ranges — and it does, but it also makes
 * `check('93.184.216.34', 'ipv4')` return TRUE. Node widens an IPv4 argument to its mapped form
 * before comparing it against IPv6 rules, so that one entry blocks the ENTIRE public IPv4 internet
 * and the unfurler would refuse every real link while still looking correct. Unwrapping the mapped
 * spelling to its IPv4 form and re-checking against the IPv4 ranges gives the intended behaviour
 * for both spellings, and only for the addresses that are actually private.
 */
const V4_MAPPED_RANGE = (() => {
  const blockList = new net.BlockList();
  blockList.addSubnet('::ffff:0:0', 96, 'ipv6');
  return blockList;
})();

/** `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same address; both unwrap to `127.0.0.1`. */
function unmapV4(address: string): string | null {
  if (!V4_MAPPED_RANGE.check(address, 'ipv6')) return null;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted?.[1]) return dotted[1];
  const hex = /:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex?.[1] || !hex[2]) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

/** The numbers that ship. Pinned by their own test so a policy substitution cannot move them. */
export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  blockList: denyList(),
  maxResponseSize: 512 * 1024,
  connectTimeout: 3_000,
  headersTimeout: 5_000,
  bodyTimeout: 5_000,
  connectorTimeout: 3_000,
};

function checkBlocked(blockList: net.BlockList, address: string, family: number): boolean {
  if (family === 6) {
    const unmapped = unmapV4(address);
    if (unmapped !== null) return blockList.check(unmapped, 'ipv4');
    return blockList.check(address, 'ipv6');
  }
  return blockList.check(address, 'ipv4');
}

/** The range math, against the shipping deny list. */
export function isBlockedAddress(address: string, family: number): boolean {
  return checkBlocked(DEFAULT_GUARD_POLICY.blockList, address, family);
}

/**
 * DNS names: resolve ALL addresses and refuse if ANY is blocked. Happy Eyeballs will try them all,
 * so refusing only on the first answer leaves the rebinding case wide open.
 */
function guardedLookup(blockList: net.BlockList): net.LookupFunction {
  return (hostname, options, cb) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err, [], 0);
      for (const { address, family } of addrs) {
        if (checkBlocked(blockList, address, family)) {
          return cb(new BlockedTargetError(`blocked ${address}`), [], 0);
        }
      }
      const first = addrs[0];
      if (!first) return cb(new BlockedTargetError(`blocked ${hostname}`), [], 0);
      if (options.all) return cb(null, addrs as never, 0);
      return cb(null, first.address as never, first.family);
    });
  };
}

/** `[::1]` arrives bracketed from a URL authority; `net.isIP` wants the bare form. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * PITFALL 1: a resolver hook alone is NOT enough — `net.connect` never calls `lookup` for an
 * IP-literal host, so a resolver-only guard protects nothing against `http://127.0.0.1/` or
 * `http://169.254.169.254/`. The connector below sees every hostname, literal or not, on every
 * redirect hop, and checks `net.isIP` FIRST before delegating to the DNS-resolving base.
 */
export function guardedAgent(policy: GuardPolicy = DEFAULT_GUARD_POLICY): Agent {
  const base = buildConnector({
    lookup: guardedLookup(policy.blockList),
    timeout: policy.connectorTimeout,
  });
  const connector: buildConnector.connector = (opts, cb) => {
    const hostname = bareHost(opts.hostname);
    const version = net.isIP(hostname); // 0 when it is a DNS name
    if (version && checkBlocked(policy.blockList, hostname, version)) {
      return cb(new BlockedTargetError(`blocked literal ${hostname}`), null);
    }
    return base(opts, cb);
  };
  return new Agent({
    connect: connector,
    maxResponseSize: policy.maxResponseSize,
    connectTimeout: policy.connectTimeout,
    headersTimeout: policy.headersTimeout,
    bodyTimeout: policy.bodyTimeout,
  });
}

/**
 * The cheap synchronous policy, applied at create time before anything is enqueued.
 *
 * It is deliberately NOT a host deny-list: nothing here inspects addresses, because only the
 * socket-layer guard above survives a redirect. This rejects the two classes a connector cannot
 * see — a scheme that is not HTTP at all, and credentials smuggled into the authority.
 */
export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedTargetError(`blocked scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedTargetError('blocked credentials');
  }
  return url;
}

/**
 * The canonical string the per-tenant cache key is hashed from. `URL` already lower-cases the host
 * and strips a default port; dropping the fragment is what makes two spellings of one link share a
 * cache row, and therefore cost one outbound fetch rather than two.
 */
export function normaliseUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  return url.toString();
}

/** The hex sha256 of the NORMALISED form — the `feed_link_previews.url_hash` value. */
export function urlHash(raw: string): string {
  return createHash('sha256').update(normaliseUrl(raw)).digest('hex');
}
