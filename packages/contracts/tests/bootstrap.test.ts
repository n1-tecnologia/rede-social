import { describe, expect, it } from 'vitest';
import { bootstrapSchema, countersSchema } from '../src/bootstrap';
import { resolveBranding } from '../src/branding';

/**
 * 07 review A-WR-07: an additive bootstrap field is tolerant on the reader side, so a web build that
 * goes live before the API revision that sends it (or an API rollback) never fails the parse.
 */
describe('bootstrap counters contract', () => {
  it('reads an absent conversationsBadge as the kernel default count', () => {
    expect(countersSchema.parse({ unreadNotifications: 2, unreadConversations: 1 })).toEqual({
      unreadNotifications: 2,
      unreadConversations: 1,
      conversationsBadge: 'count',
    });
  });

  it('keeps the value the API sends, and still refuses a value outside the enum', () => {
    expect(
      countersSchema.parse({
        unreadNotifications: 0,
        unreadConversations: 1,
        conversationsBadge: 'dot',
      }).conversationsBadge,
    ).toBe('dot');
    expect(
      countersSchema.safeParse({
        unreadNotifications: 0,
        unreadConversations: 1,
        conversationsBadge: 'badge',
      }).success,
    ).toBe(false);
  });
});

/**
 * 12.3-15 (D-697): the bootstrap's tenant brand reuses `tenantBrandingSchema`, which STRIPS undeclared
 * keys, so declaring `phoneMenu` there is what carries the menu to the shell; absent, the key is not
 * invented.
 */
describe('bootstrap tenant brand and the phone menu', () => {
  const MENU = { bar: ['home', 'courses'], top: ['chat'], hidden: ['events'] };
  const brandShape = bootstrapSchema.shape.tenant.shape.branding;

  it('keeps tenant.branding.phoneMenu when present', () => {
    expect(brandShape.parse(resolveBranding({ phoneMenu: MENU })).phoneMenu).toEqual(MENU);
  });

  it('carries no phoneMenu key when none was saved, and reads a corrupt one as none', () => {
    expect('phoneMenu' in brandShape.parse(resolveBranding({}))).toBe(false);
    expect(brandShape.parse({ phoneMenu: { bar: 'x' } }).phoneMenu).toBeUndefined();
  });
});
