import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import ogs from 'open-graph-scraper';
// undici's OWN fetch, not the global: the Agent under test is an npm-undici dispatcher and this is
// the exact call `open-graph-scraper` makes internally, so the test drives the production path.
import { fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertAllowedUrl,
  BlockedTargetError,
  DEFAULT_GUARD_POLICY,
  type GuardPolicy,
  guardedAgent,
  isBlockedAddress,
  normaliseUrl,
  urlHash,
} from '../server/unfurl/guard';

/**
 * MEDIA-04 / T-04-29, T-04-30 — the SSRF guard, proven against LOCAL `node:http` fixtures only.
 *
 * Not one assertion here reaches the public internet: a guard test that depends on a third party's
 * uptime is not a guard test, it is a network test that happens to import a guard. Every fixture
 * binds to the loopback on an ephemeral port (`listen(0)`, port read back from the server) and is
 * closed in `afterAll`.
 *
 * **The policy is injectable, which is what makes the allowed half testable at all.** Every fixture
 * this suite can start is on the loopback, and the loopback is exactly what production refuses — so
 * a test that needs a fixture to be REACHABLE (the body cap, the timeout, the scraper's happy path,
 * the first hop of the redirect) passes a policy whose block list names different addresses. The
 * connector, the guarded lookup and the Agent options are the production ones in every case; only
 * the ranges move. `DEFAULT_GUARD_POLICY`'s own numbers are pinned in their own test so the
 * substitution can never quietly become the thing under test.
 */

/** Everything the production policy blocks, so a fixture is unreachable exactly as a real one is. */
const productionPolicy = (): GuardPolicy => DEFAULT_GUARD_POLICY;

/** Nothing blocked: the fixture stands in for an ordinary public host. */
const permissive = (over: Partial<GuardPolicy> = {}): GuardPolicy => ({
  ...DEFAULT_GUARD_POLICY,
  blockList: new net.BlockList(),
  ...over,
});

/**
 * Only the IPv4 loopback blocked. The `::1` fixture then stands in for a PUBLIC host that answers a
 * 302 into a private range — which is how "every redirect hop re-enters the connector" becomes an
 * assertion without needing a public host to redirect for us.
 */
const ipv4LoopbackOnly = (): GuardPolicy => {
  const blockList = new net.BlockList();
  blockList.addSubnet('127.0.0.0', 8, 'ipv4');
  return { ...DEFAULT_GUARD_POLICY, blockList };
};

interface Fixture {
  server: http.Server;
  port: number;
  /** How many requests the fixture has actually served — the cache-hit evidence in later plans. */
  requests: number;
}

const fixtures: Fixture[] = [];

async function listen(handler: http.RequestListener, host = '127.0.0.1'): Promise<Fixture> {
  const fixture: Fixture = { server: null as unknown as http.Server, port: 0, requests: 0 };
  fixture.server = http.createServer((req, res) => {
    fixture.requests += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => fixture.server.listen(0, host, resolve));
  const address = fixture.server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture has no port');
  fixture.port = address.port;
  fixtures.push(fixture);
  return fixture;
}

const html = (body: string) => (_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
};

/** The cause undici attaches to a `TypeError: fetch failed`, as an Error we can assert on. */
function causeOf(error: unknown): Error {
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: unknown }).cause;
  expect(cause).toBeInstanceOf(Error);
  return cause as Error;
}

/** A fixture serving ordinary Open Graph metadata. */
let metadata: Fixture;
/** A fixture streaming far more than the cap, with a `text/html` content type (Pitfall 2). */
let oversized: Fixture;
/** A fixture that accepts the connection and never answers. */
let silent: Fixture;
/** Bound to `::1` so a policy that blocks only IPv4 sees it as public; answers a 302 to `metadata`. */
let redirector: Fixture;

beforeAll(async () => {
  metadata = await listen(
    html(
      '<html><head>' +
        '<meta property="og:title" content="Fixture Title">' +
        '<meta property="og:description" content="Fixture description">' +
        '<meta property="og:site_name" content="Fixture Site">' +
        '</head><body></body></html>',
    ),
  );
  oversized = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const chunk = 'x'.repeat(64 * 1024);
    let written = 0;
    const timer = setInterval(() => {
      if (written >= 40) {
        clearInterval(timer);
        res.end();
        return;
      }
      written += 1;
      res.write(chunk);
    }, 1);
  });
  silent = await listen(() => {
    /* accepts the socket, answers nothing — the hung-server case */
  });
  redirector = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${metadata.port}/` });
    res.end();
  }, '::1');
});

afterAll(async () => {
  await Promise.all(
    fixtures.map(
      (fixture) => new Promise<void>((resolve) => fixture.server.close(() => resolve())),
    ),
  );
});

describe('assertAllowedUrl — the cheap synchronous policy', () => {
  it('accepts an ordinary https URL and returns it parsed', () => {
    const url = assertAllowedUrl('https://example.org/artigo?x=1');
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('example.org');
  });

  it('accepts an ordinary http URL', () => {
    expect(assertAllowedUrl('http://example.org/').protocol).toBe('http:');
  });

  it.each(['file:///etc/passwd', 'ftp://example.org/x', 'javascript:alert(1)', 'data:text/html,x'])(
    'refuses the scheme in %s',
    (raw) => {
      expect(() => assertAllowedUrl(raw)).toThrow(BlockedTargetError);
    },
  );

  it('refuses a URL carrying embedded credentials', () => {
    expect(() => assertAllowedUrl('https://user:secret@example.org/')).toThrow(BlockedTargetError);
    expect(() => assertAllowedUrl('https://user@example.org/')).toThrow(BlockedTargetError);
  });

  it('refuses a string that is not a URL at all', () => {
    expect(() => assertAllowedUrl('not a url')).toThrow();
  });
});

describe('isBlockedAddress — the range math net.BlockList owns', () => {
  it.each([
    ['0.0.0.0', 4],
    ['10.1.2.3', 4],
    ['100.64.0.1', 4],
    ['127.0.0.1', 4],
    ['169.254.169.254', 4], // the cloud metadata address
    ['172.16.5.5', 4],
    ['192.0.0.1', 4],
    ['192.0.2.7', 4],
    ['192.168.1.1', 4],
    ['198.18.0.1', 4],
    ['224.0.0.1', 4],
    ['240.0.0.1', 4],
  ])('blocks the IPv4 address %s', (address, family) => {
    expect(isBlockedAddress(address, family)).toBe(true);
  });

  it.each([
    ['::', 6],
    ['::1', 6],
    ['fc00::1', 6],
    ['fe80::1', 6],
    ['64:ff9b::1', 6],
    ['2001:db8::1', 6],
  ])('blocks the IPv6 address %s', (address, family) => {
    expect(isBlockedAddress(address, family)).toBe(true);
  });

  it('blocks the IPv4-mapped IPv6 spelling of a blocked IPv4 address', () => {
    expect(isBlockedAddress('::ffff:169.254.169.254', 6)).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1', 6)).toBe(true);
  });

  it('allows an ordinary public address', () => {
    expect(isBlockedAddress('93.184.216.34', 4)).toBe(false);
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false);
  });
});

describe('normaliseUrl / urlHash — the per-tenant cache key', () => {
  it('drops the fragment, lower-cases the host and strips a default port', () => {
    expect(normaliseUrl('HTTPS://Example.ORG:443/Artigo?b=2#secao')).toBe(
      'https://example.org/Artigo?b=2',
    );
    expect(normaliseUrl('http://example.org:80/')).toBe('http://example.org/');
  });

  it('preserves a bare trailing slash', () => {
    expect(normaliseUrl('https://example.org')).toBe('https://example.org/');
  });

  it('hashes the NORMALISED form, so two spellings of one link share a cache row', () => {
    expect(urlHash('https://Example.org/a#x')).toBe(urlHash('https://example.org/a'));
    expect(urlHash('https://example.org/a')).toBe(
      createHash('sha256').update('https://example.org/a').digest('hex'),
    );
    expect(urlHash('https://example.org/a')).not.toBe(urlHash('https://example.org/b'));
  });
});

describe('the guarded Agent', () => {
  it('pins the production policy numbers', () => {
    expect(DEFAULT_GUARD_POLICY.maxResponseSize).toBe(512 * 1024);
    expect(DEFAULT_GUARD_POLICY.connectTimeout).toBe(3_000);
    expect(DEFAULT_GUARD_POLICY.headersTimeout).toBe(5_000);
    expect(DEFAULT_GUARD_POLICY.bodyTimeout).toBe(5_000);
  });

  it('refuses an IP-LITERAL target — the case a lookup-only guard walks straight through', async () => {
    const agent = guardedAgent(productionPolicy());
    const error = await fetch(`http://127.0.0.1:${metadata.port}/`, { dispatcher: agent }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    const cause = causeOf(error);
    // The connector — not the resolver — is the thing that saw it: net.connect never calls `lookup`
    // for a literal host, so this message can only come from the `net.isIP` branch.
    expect(cause).toBeInstanceOf(BlockedTargetError);
    expect(cause.message).toBe('blocked literal 127.0.0.1');
    await agent.close();
  });

  it('refuses a hostname that RESOLVES into a blocked range, via the guarded lookup', async () => {
    const agent = guardedAgent(productionPolicy());
    const error = await fetch(`http://localhost:${metadata.port}/`, { dispatcher: agent }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    const cause = causeOf(error);
    expect(cause).toBeInstanceOf(BlockedTargetError);
    // `localhost` is not an IP literal, so the literal branch cannot have fired: the message names
    // the RESOLVED address and carries no "literal" marker.
    expect(cause.message).not.toContain('literal');
    expect(cause.message).toMatch(/^blocked (::1|127\.0\.0\.1)$/);
    await agent.close();
  });

  it('refuses the SECOND hop of a 302 into a blocked range — the connector is re-entered per hop', async () => {
    const agent = guardedAgent(ipv4LoopbackOnly());
    const error = await fetch(`http://[::1]:${redirector.port}/`, {
      dispatcher: agent,
      redirect: 'follow',
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    const cause = causeOf(error);
    expect(cause).toBeInstanceOf(BlockedTargetError);
    expect(cause.message).toBe(`blocked literal 127.0.0.1`);
    await agent.close();
  });

  it('POSITIVE CONTROL: the same first hop succeeds when the policy does not name its target', async () => {
    // Without this the refusal above could be a broken fixture rather than a working guard.
    const agent = guardedAgent(permissive());
    const response = await fetch(`http://[::1]:${redirector.port}/`, {
      dispatcher: agent,
      redirect: 'follow',
    });
    expect(response.status).toBe(200);
    await response.text();
    await agent.close();
  });

  it('aborts an oversized body at the Agent rather than buffering it', async () => {
    const agent = guardedAgent(permissive());
    const error = await fetch(`http://127.0.0.1:${oversized.port}/`, { dispatcher: agent })
      .then((r) => r.text())
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    // `maxResponseSize` is what raises this: the scraper reads the whole body into memory and only
    // THEN checks the content type, so a cap anywhere above the Agent is too late (Pitfall 2).
    expect(causeOf(error).message).toContain('exceeded max size');
    await agent.close();
  });

  it('aborts a server that never answers within the configured header timeout', async () => {
    const agent = guardedAgent(permissive({ headersTimeout: 600, bodyTimeout: 600 }));
    const started = Date.now();
    const error = await fetch(`http://127.0.0.1:${silent.port}/`, { dispatcher: agent }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(causeOf(error).message).toMatch(/Timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
    await agent.close();
  });
});

describe('open-graph-scraper driven through the guarded Agent', () => {
  /**
   * The assertion that turns "one undici instance in the store, not two copies" from an assumption
   * into a test: if the scraper resolved a DIFFERENT undici, our Agent would not be recognised as a
   * dispatcher, the fetch would go out unguarded, and this would resolve with the fixture's title.
   */
  it('refuses a blocked target, and the guard MESSAGE reaches the scraper', async () => {
    const agent = guardedAgent(productionPolicy());
    const rejection = await ogs({
      url: `http://127.0.0.1:${metadata.port}/`,
      timeout: 5,
      fetchOptions: { dispatcher: agent, redirect: 'follow' },
    }).then(
      (ok) => ({ kind: 'resolved' as const, ok }),
      (err: { error?: boolean; result?: { error?: string } }) => ({
        kind: 'rejected' as const,
        err,
      }),
    );
    expect(rejection.kind).toBe('rejected');
    if (rejection.kind !== 'rejected') return;
    expect(rejection.err.error).toBe(true);
    expect(rejection.err.result?.error).toBe('blocked literal 127.0.0.1');
    await agent.close();
  });

  it('returns metadata for an allowed target through the same Agent', async () => {
    const agent = guardedAgent(permissive());
    const { error, result } = await ogs({
      url: `http://127.0.0.1:${metadata.port}/`,
      timeout: 5,
      fetchOptions: { dispatcher: agent, redirect: 'follow' },
    });
    expect(error).toBe(false);
    expect(result.ogTitle).toBe('Fixture Title');
    expect(result.ogDescription).toBe('Fixture description');
    expect(result.ogSiteName).toBe('Fixture Site');
    await agent.close();
  });
});
