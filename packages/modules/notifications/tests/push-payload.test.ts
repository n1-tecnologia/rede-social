import { cutOnWord } from '@rede-social/contracts/text';
import type { NotificationPushHint } from '@rede-social/core/server/notifications/source';
import { describe, expect, it } from 'vitest';
import {
  notificationPushHintSchema,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_TITLE_TEXT_MAX,
  pushPayloadSchema,
} from '../contracts/index';
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

  describe('a literal title (D-728, D-729)', () => {
    it('the path: the hint parses and the payload carries the writer name within the byte bound', () => {
      const raw = hint({ titleText: 'Marina Costa' });
      expect(notificationPushHintSchema.parse(raw).titleText).toBe('Marina Costa');
      const { payload, json } = build({ titleText: 'Marina Costa' });
      expect(payload.title).toBe('Marina Costa');
      expect(bytes(json)).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
      expect(pushPayloadSchema.parse(JSON.parse(json))).toEqual(payload);
    });

    it('a literal wins over the closed title, for tenant and for team', () => {
      expect(build({ title: 'team', titleText: 'Nova denúncia' }).payload.title).toBe(
        'Nova denúncia',
      );
    });

    it('a blank literal falls back to the tenant name, never an empty title', () => {
      expect(build({ titleText: '   ' }).payload.title).toBe('Rede Demo');
      expect(build({ titleText: '\n\t ' }).payload.title).toBe('Rede Demo');
      expect(build({ title: 'team', titleText: '  ' }).payload.title).toBe('Equipe Rede Demo');
    });

    it('a hint without titleText renders as before for tenant and team', () => {
      expect(build().payload.title).toBe('Rede Demo');
      expect(build({ title: 'team' }).payload.title).toBe('Equipe Rede Demo');
    });

    it('a 90-grapheme name is cut at 60 graphemes with an ellipsis', () => {
      const long = 'a'.repeat(90);
      expect(graphemes(long)).toHaveLength(90);
      const { payload } = build({ titleText: long });
      expect(payload.title.endsWith('…')).toBe(true);
      expect(graphemes(payload.title.slice(0, -1))).toHaveLength(PUSH_TITLE_TEXT_MAX);
      expect(payload.title).toBe(`${'a'.repeat(PUSH_TITLE_TEXT_MAX)}…`);
      // A name of exactly the maximum is not cut.
      expect(build({ titleText: 'a'.repeat(PUSH_TITLE_TEXT_MAX) }).payload.title).toBe(
        'a'.repeat(PUSH_TITLE_TEXT_MAX),
      );
    });

    it('ZWJ emoji sequences, combining marks and a right-to-left name are cut by graphemes', () => {
      const family = '👩‍👩‍👧‍👦';
      const combining = 'e\u0301\u0323'; // e + acute + dot below: one grapheme
      const rtl = 'مرحبا بالعالم';
      for (const unit of [family, combining, rtl]) {
        let source = '';
        while (graphemes(source).length < 90) source += unit;
        const { payload } = build({ titleText: source });
        expect(payload.title.endsWith('…')).toBe(true);
        const kept = graphemes(payload.title.slice(0, -1));
        expect(kept).toHaveLength(PUSH_TITLE_TEXT_MAX);
        expect(kept.every((g, i) => g === graphemes(source)[i])).toBe(true);
        // No lone surrogate and no leading combining mark survives the cut.
        expect(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
            payload.title,
          ),
        ).toBe(false);
      }
    });

    it('a 60-grapheme title of four-byte characters with a maximal url and tag stays inside the bound', () => {
      const url = `/eventos/${'a'.repeat(503)}`;
      const tag = `events-reminder-${'f'.repeat(32)}`;
      const { payload, json } = build({
        titleText: '😀'.repeat(100),
        url,
        tag,
        body: 'x '.repeat(900),
        renotify: true,
      });
      expect(bytes(json)).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
      expect(graphemes(payload.title.slice(0, -1))).toHaveLength(PUSH_TITLE_TEXT_MAX);
      expect(payload.url).toBe(url);
      expect(payload.tag).toBe(tag);
    });

    it('a maximal literal with fixed fields past the bound throws, as a producer bug does today', () => {
      expect(() =>
        buildPushPayload({
          tenantName: 'Rede Demo',
          iconUrl: `https://storage.test/${'x'.repeat(3000)}.png`,
          hint: hint({ titleText: 'Marina' }),
          badge: 1,
        }),
      ).toThrow();
    });
  });
});
