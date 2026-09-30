import { assertProductionEnv } from '@rede-social/core/server/env';
import { describe, expect, it } from 'vitest';

/**
 * 07-06 (NOTIF-03, T-07-38): the kernel refuses to boot a real Web Push selection without its VAPID
 * key pair and subject, and refuses a subject the push services themselves reject (Apple answers
 * `BadJwtToken` for a `localhost` subject; `web-push` accepts only `mailto:` and `https:`). The fake
 * transport, the default, needs nothing. The MUX all-or-none precedent lives in
 * `packages/core/tests/media-video.test.ts`.
 */

const base = {
  DOMAIN_PROVIDER: 'fake',
  AUTH_ALLOW_LIST: 'local',
  MAIL_TRANSPORT: 'local',
  VIDEO_PROVIDER: 'fake',
} as const;

const VAPID = {
  VAPID_PUBLIC_KEY: 'BExamplePublicKey',
  VAPID_PRIVATE_KEY: 'examplePrivateKey',
  VAPID_SUBJECT: 'mailto:ops@rede-social.test',
} as const;

const KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

const check = (env: Record<string, string>) => () => assertProductionEnv(env as never);

describe('assertProductionEnv: PUSH_TRANSPORT=webpush needs the whole VAPID set (07-06)', () => {
  it('names every missing VAPID key', () => {
    let message = '';
    try {
      assertProductionEnv({ ...base, PUSH_TRANSPORT: 'webpush' } as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Invalid kernel environment');
    for (const key of KEYS) {
      expect(message).toContain(`${key} (required when PUSH_TRANSPORT=webpush)`);
    }
  });

  it('refuses a selection missing even ONE key, naming it', () => {
    for (const omitted of KEYS) {
      const env: Record<string, string> = { ...base, PUSH_TRANSPORT: 'webpush', ...VAPID };
      delete env[omitted];
      expect(check(env)).toThrow(
        new RegExp(`${omitted} \\(required when PUSH_TRANSPORT=webpush\\)`),
      );
    }
  });

  it.each([
    ['a mailto: subject on localhost', 'mailto:ops@localhost'],
    ['an https: subject on localhost', 'https://localhost:3000'],
    ['an http: subject', 'http://x'],
    ['a bare address', 'ops@rede-social.test'],
  ])('refuses %s', (_label, subject) => {
    expect(check({ ...base, PUSH_TRANSPORT: 'webpush', ...VAPID, VAPID_SUBJECT: subject })).toThrow(
      /VAPID_SUBJECT \(must start with mailto: or https: and must not name localhost/,
    );
  });

  it.each([
    ['mailto:', 'mailto:ops@rede-social.test'],
    ['https:', 'https://rede-social.test/contato'],
  ])('accepts the full set with a %s subject', (_label, subject) => {
    expect(
      check({ ...base, PUSH_TRANSPORT: 'webpush', ...VAPID, VAPID_SUBJECT: subject }),
    ).not.toThrow();
  });

  it('PUSH_TRANSPORT=fake with nothing set passes (the fail-safe default never trips)', () => {
    expect(check({ ...base, PUSH_TRANSPORT: 'fake' })).not.toThrow();
  });

  it('a VAPID subject is not checked while the transport is fake (no real push is ever sent)', () => {
    expect(
      check({ ...base, PUSH_TRANSPORT: 'fake', VAPID_SUBJECT: 'mailto:ops@localhost' }),
    ).not.toThrow();
  });
});
