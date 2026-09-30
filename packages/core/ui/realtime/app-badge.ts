/**
 * D-239: the installed app's icon badge mirrors the shell's counters (07-03 wires the bell half;
 * 07-09 adds the chat half through the same `unreadConversations`).
 *
 * `navigator.setAppBadge(n)` above zero, `navigator.clearAppBadge()` at zero, only where the Badging
 * API exists. Where it does not (most desktop browsers, iOS outside an installed PWA) this silently
 * does nothing, and a rejected promise (permission, a non-installed context) is swallowed: the badge
 * is a nicety, never a failure the member sees.
 */

interface BadgingNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

export interface BadgeCounters {
  unreadNotifications: number;
  unreadConversations: number;
}

/** The number the icon shows: every unseen notification plus every unread conversation. */
export function appBadgeCount(counters: BadgeCounters): number {
  const sum = counters.unreadNotifications + counters.unreadConversations;
  return Number.isFinite(sum) && sum > 0 ? Math.floor(sum) : 0;
}

export function applyAppBadge(
  counters: BadgeCounters,
  nav: BadgingNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as BadgingNavigator),
): void {
  if (!nav || !('setAppBadge' in nav) || typeof nav.setAppBadge !== 'function') return;
  const count = appBadgeCount(counters);
  try {
    const pending =
      count > 0
        ? nav.setAppBadge(count)
        : typeof nav.clearAppBadge === 'function'
          ? nav.clearAppBadge()
          : nav.setAppBadge(0);
    void Promise.resolve(pending).catch(() => {});
  } catch {
    // A synchronous throw from an exotic implementation is swallowed too.
  }
}
