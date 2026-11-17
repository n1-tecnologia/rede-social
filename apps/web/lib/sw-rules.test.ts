import { describe, expect, it } from 'vitest';
import { isNetworkOnlyRequest, NETWORK_ONLY_PREFIXES } from './sw-rules';

/**
 * 12.5-11 (D-871, VOICE-22, T-12.5-46): rule (a) of the service worker, as a pure predicate. A request to
 * `/v1/media/...` that comes from an `<audio>` or `<video>` element (Safari sends Range requests) must NOT
 * match, so the worker is not in its path and the browser's own networking answers; everything else rule
 * (a) used to keep off the cache still is `NetworkOnly`.
 */

const ID = '0b000000-0000-4000-8000-0000000000b1';

function ctx(
  path: string,
  over: {
    mode?: string;
    destination?: string;
    headers?: Record<string, string>;
    sameOrigin?: boolean;
  } = {},
) {
  const headers = new Headers(over.headers ?? {});
  return {
    request: { mode: over.mode ?? 'cors', destination: over.destination ?? '', headers },
    url: new URL(path, 'https://app.test'),
    sameOrigin: over.sameOrigin ?? true,
  };
}

describe('isNetworkOnlyRequest', () => {
  it('keeps the shipped prefixes in the list', () => {
    expect([...NETWORK_ONLY_PREFIXES]).toEqual(['/auth/', '/v1/', '/api/', '/m/', '/serwist/']);
  });

  it('a navigation and a document are network only', () => {
    expect(isNetworkOnlyRequest(ctx('/feed', { mode: 'navigate' }))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/feed', { destination: 'document' }))).toBe(true);
  });

  it('an RSC payload and a server action are network only wherever they go', () => {
    expect(isNetworkOnlyRequest(ctx('/feed', { headers: { RSC: '1' } }))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/feed', { headers: { 'Next-Action': 'abc' } }))).toBe(true);
  });

  it('a same-origin /v1/ fetch, an image and the other prefixes are network only', () => {
    expect(isNetworkOnlyRequest(ctx('/v1/feed'))).toBe(true);
    expect(isNetworkOnlyRequest(ctx(`/v1/media/${ID}/w640`, { destination: 'image' }))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/auth/login'))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/api/push/subscriptions'))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/m/rede/manifest.webmanifest'))).toBe(true);
    expect(isNetworkOnlyRequest(ctx('/serwist/sw.js'))).toBe(true);
  });

  it('an audio or video request to /v1/media is NOT matched, so the worker never touches it', () => {
    expect(isNetworkOnlyRequest(ctx(`/v1/media/${ID}/original`, { destination: 'audio' }))).toBe(
      false,
    );
    expect(isNetworkOnlyRequest(ctx(`/v1/media/${ID}/original`, { destination: 'video' }))).toBe(
      false,
    );
    // A Range header changes nothing: the decision is the destination.
    expect(
      isNetworkOnlyRequest(
        ctx(`/v1/media/${ID}/original`, { destination: 'audio', headers: { Range: 'bytes=0-' } }),
      ),
    ).toBe(false);
  });

  it('a cross-origin request is never matched by the prefix clause, whatever its destination', () => {
    for (const destination of ['', 'audio', 'video', 'image']) {
      expect(
        isNetworkOnlyRequest(ctx(`/v1/media/${ID}/original`, { destination, sameOrigin: false })),
      ).toBe(false);
    }
  });

  it('a same-origin request outside the prefixes is not matched', () => {
    expect(isNetworkOnlyRequest(ctx('/icons/icon-192.png', { destination: 'image' }))).toBe(false);
    expect(isNetworkOnlyRequest(ctx('/_next/static/chunk.js', { destination: 'script' }))).toBe(
      false,
    );
  });
});
