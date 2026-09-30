import { cutOnWord } from '@rede-social/contracts/text';
import type { NotificationPushHint } from '@rede-social/core/server/notifications/source';
import { describe, expect, it } from 'vitest';
import { PUSH_PAYLOAD_MAX_BYTES, pushPayloadSchema } from '../contracts/index';
import { buildPushPayload, NEUTRAL_PUSH_ICON } from '../server/push/payload';

/**
 * NOTIF-03 encoding (07-06 edge accounting, explicit): bodies are cut in grapheme clusters, never
 * splitting an emoji or a surrogate pair, ending in `…` only when cut, and the SERIALISED payload is
 * bounded at `PUSH_PAYLOAD_MAX_BYTES` (3,072) UTF-8 bytes by shortening the body, never the URL or tag.
 */

const graphemes = (value: string) =>
  Array.from(
    new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(value),
    (s) => s.segment,
  );
const bytes = (value: string) => new TextEncoder().encode(value).length;

const hint = (over: Partial<NotificationPushHint> = {}): NotificationPushHint => ({
  title: 'tenant',
  body: 'Novo post: Olá',
  url: '/post/0f000000-0000-4000-8000-0000000000f1',
  tag: 'feed-post',
  topic: 'feed-post',
  ttlSeconds: 86_400,
  urgency: 'normal',
  renotify: false,
  ...over,
});

const build = (over: Partial<NotificationPushHint> = {}, tenantName = 'Rede Demo', badge = 3) =>
  buildPushPayload({ tenantName, iconUrl: NEUTRAL_PUSH_ICON, hint: hint(over), badge });

/** Every grapheme of `cut` (minus a trailing `…`) is a whole grapheme of `source`, in order. */
function isGraphemePrefix(cut: string, source: string): boolean {
  const kept = graphemes(cut.endsWith('…') ? cut.slice(0, -1) : cut);
  const original = graphemes(source.replace(/\s*[\r\n]+\s*/g, ' '));
  return kept.every((g, i) => g === original[i]);
}

describe('buildPushPayload', () => {
  it('is the versioned shape: v 1, the tenant title, icon, url, tag, renotify and badge', () => {
    const { payload, json } = build();
    expect(payload).toEqual({
      v: 1,
      title: 'Rede Demo',
      body: 'Novo post: Olá',
      icon: NEUTRAL_PUSH_ICON,
      url: '/post/0f000000-0000-4000-8000-0000000000f1',
      tag: 'feed-post',
      renotify: false,
      badge: 3,
    });
    expect(payload.v).toBe(1);
    expect(JSON.parse(json)).toEqual(payload);
    expect(pushPayloadSchema.parse(JSON.parse(json))).toEqual(payload);
  });

  it("title 'team' is Equipe {tenant} (a support reply, D-235)", () => {
    expect(build({ title: 'team' }).payload.title).toBe('Equipe Rede Demo');
  });

  it('a 2,000-character chat body with emoji and ZWJ sequences is cut to ~100 graphemes with …, never mid-grapheme', () => {
    const unit = 'Oi 👩‍👩‍👧‍👦 tudo bem? 🇧🇷 família 👍🏽 ';
    let long = '';
    while (long.length < 2000) long += unit;
    const body = cutOnWord(long, 100);
    const { payload } = build({ body, tag: 'fedcba9876543210fedcba9876543210', renotify: true });
    expect(graphemes(payload.body).length).toBeLessThanOrEqual(100);
    expect(graphemes(payload.body).length).toBeGreaterThan(80);
    expect(payload.body.endsWith('…')).toBe(true);
    expect(isGraphemePrefix(payload.body, long)).toBe(true);
    // No lone surrogate survives the cut.
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(payload.body),
    ).toBe(false);
  });

  it('an 80-grapheme excerpt passes unchanged (no …)', () => {
    const excerpt = 'á'.repeat(40) + '😀'.repeat(40);
    expect(graphemes(excerpt)).toHaveLength(80);
    const body = `Novo post: ${cutOnWord(excerpt, 80)}`;
    expect(build({ body }).payload.body).toBe(`Novo post: ${excerpt}`);
    expect(build({ body }).payload.body.endsWith('…')).toBe(false);
  });

  it(`the worst case stays at or under ${PUSH_PAYLOAD_MAX_BYTES} bytes, shortening only the body`, () => {
    const title = 'Á'.repeat(120);
    const url = `/eventos/${'a'.repeat(503)}`;
    const tag = `events-reminder-${'f'.repeat(32)}`;
    const body = '😀 '.repeat(1000);
    const { payload, json } = buildPushPayload({
      tenantName: title,
      iconUrl: `https://storage.test/branding/${'x'.repeat(200)}/icon-192.png`,
      hint: hint({ body, url, tag, renotify: true }),
      badge: 999,
    });
    expect(bytes(json)).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    expect(payload.url).toBe(url);
    expect(payload.tag).toBe(tag);
    expect(payload.title).toBe(title);
    expect(payload.body.endsWith('…')).toBe(true);
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('a url without a leading / (or protocol-relative) throws', () => {
    expect(() => build({ url: 'post/1' })).toThrow();
    expect(() => build({ url: 'https://evil.test/post/1' })).toThrow();
    expect(() => build({ url: '//evil.test/post/1' })).toThrow();
    expect(() => build({ url: '/\\evil.test' })).toThrow();
    expect(() => build({ url: '/post/1' })).not.toThrow();
  });

  it('a negative or fractional badge is clamped to a non-negative integer', () => {
    expect(build({}, 'Rede Demo', -2).payload.badge).toBe(0);
    expect(build({}, 'Rede Demo', 2.7).payload.badge).toBe(2);
  });
});
