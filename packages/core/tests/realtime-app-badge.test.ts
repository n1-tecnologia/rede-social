import { describe, expect, it, vi } from 'vitest';
import { appBadgeCount, applyAppBadge } from '../ui/realtime/app-badge';

/**
 * D-239 (07-03, bell half): the installed app's icon badge is the sum of the shell's counters, set
 * with `setAppBadge` above zero and cleared with `clearAppBadge` at zero, only where the Badging API
 * exists, and a rejection is swallowed.
 */
describe('applyAppBadge', () => {
  it('sets the sum: { 3, 1 } -> setAppBadge(4)', () => {
    const nav = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    applyAppBadge({ unreadNotifications: 3, unreadConversations: 1 }, nav);
    expect(nav.setAppBadge).toHaveBeenCalledWith(4);
    expect(nav.clearAppBadge).not.toHaveBeenCalled();
  });

  it('clears at zero', () => {
    const nav = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    applyAppBadge({ unreadNotifications: 0, unreadConversations: 0 }, nav);
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });

  it('does nothing and never throws where the API is absent', () => {
    expect(() =>
      applyAppBadge({ unreadNotifications: 2, unreadConversations: 0 }, {}),
    ).not.toThrow();
    expect(() =>
      applyAppBadge({ unreadNotifications: 2, unreadConversations: 0 }, undefined),
    ).not.toThrow();
  });

  it('swallows a rejected promise', async () => {
    const rejection = vi.fn();
    process.on('unhandledRejection', rejection);
    try {
      const nav = {
        setAppBadge: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
        clearAppBadge: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
      };
      applyAppBadge({ unreadNotifications: 1, unreadConversations: 0 }, nav);
      applyAppBadge({ unreadNotifications: 0, unreadConversations: 0 }, nav);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', rejection);
    }
  });

  it('never shows a negative or fractional count', () => {
    expect(appBadgeCount({ unreadNotifications: -2, unreadConversations: 0 })).toBe(0);
    expect(appBadgeCount({ unreadNotifications: 2.7, unreadConversations: 0 })).toBe(2);
  });
});
