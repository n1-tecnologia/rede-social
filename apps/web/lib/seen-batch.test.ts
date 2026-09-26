import { STORY_SEEN_BATCH_MAX } from '@tria/module-stories/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSeenBatch, SEEN_BEACON_PATH, sendSeenBeacon } from './seen-batch';

/**
 * quick 260926-d8f — the ONE dedupe-then-cap rule for the seen write (review WR-04, T-05.2-48) and
 * the page-hide transport (review WR-07).
 *
 *  - B1: `parseSeenBatch` dedupes (first-seen order) BEFORE it applies the contract cap, and refuses
 *    anything the contract would refuse — so neither public door (the server action, the beacon
 *    route) can amplify one call into many API calls.
 *  - B2: `sendSeenBeacon` prefers `navigator.sendBeacon` with a CORS-safelisted text/plain Blob.
 *  - B3: when the beacon is absent, refused or throws, ONE `fetch` with `keepalive` carries the same
 *    body; a transport failure answers false and never throws.
 */

function uuid(n: number): string {
  return `0d000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const A = uuid(1);
const B = uuid(2);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseSeenBatch — dedupe, then the contract cap (B1)', () => {
  it('B1. dedupes in first-seen order, accepts the cap, refuses cap + 1, and refuses malformed input', () => {
    expect(parseSeenBatch([B, A, B, A])).toEqual([B, A]);

    const cap = Array.from({ length: STORY_SEEN_BATCH_MAX }, (_, n) => uuid(n + 1));
    expect(parseSeenBatch(cap)).toEqual(cap);

    const over = Array.from({ length: STORY_SEEN_BATCH_MAX + 1 }, (_, n) => uuid(n + 1));
    expect(parseSeenBatch(over)).toBeNull();

    // 60 entries that collapse to 50 unique ids: the dedupe runs BEFORE the cap.
    const repeated = [...cap, ...cap.slice(0, 10)];
    expect(repeated).toHaveLength(STORY_SEEN_BATCH_MAX + 10);
    expect(parseSeenBatch(repeated)).toEqual(cap);

    expect(parseSeenBatch('not-a-list')).toBeNull();
    expect(parseSeenBatch({ storyIds: [A] })).toBeNull();
    expect(parseSeenBatch(null)).toBeNull();
    expect(parseSeenBatch([])).toBeNull();
    expect(parseSeenBatch([A, 'nao-e-um-uuid'])).toBeNull();
  });
});

describe('sendSeenBeacon — the page-hide transport (B2, B3)', () => {
  it('B2. sendBeacon accepting the Blob is ONE beacon to SEEN_BEACON_PATH, text/plain, and no fetch', async () => {
    const beacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(sendSeenBeacon([A, B])).resolves.toBe(true);

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, data] = beacon.mock.calls[0] ?? [];
    expect(url).toBe(SEEN_BEACON_PATH);
    expect(data).toBeInstanceOf(Blob);
    const blob = data as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe(JSON.stringify({ storyIds: [A, B] }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('B3. no beacon, a refused beacon or a throwing beacon falls back to ONE keepalive fetch; a rejected fetch is false', async () => {
    const body = JSON.stringify({ storyIds: [A] });
    const expectFetch = (fetchSpy: ReturnType<typeof vi.fn>) => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe(SEEN_BEACON_PATH);
      expect(init).toMatchObject({
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
        body,
      });
      expect(new Headers(init?.headers).get('content-type')).toBe('text/plain;charset=UTF-8');
    };

    for (const nav of [
      {},
      { sendBeacon: vi.fn(() => false) },
      {
        sendBeacon: vi.fn(() => {
          throw new TypeError('Illegal invocation');
        }),
      },
    ]) {
      const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('navigator', nav);
      vi.stubGlobal('fetch', fetchSpy);
      await expect(sendSeenBeacon([A])).resolves.toBe(true);
      expectFetch(fetchSpy);
      vi.unstubAllGlobals();
    }

    // A non-ok answer is false; a rejected fetch is false — never a throw.
    const refused = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', refused);
    await expect(sendSeenBeacon([A])).resolves.toBe(false);
    expectFetch(refused);

    const rejected = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', rejected);
    await expect(sendSeenBeacon([A])).resolves.toBe(false);
    expectFetch(rejected);
  });
});
