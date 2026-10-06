import type { Bootstrap } from '@rede-social/contracts';
import type { NavItem } from '@rede-social/core/ui';
import { getTranslations } from 'next-intl/server';
import { loadNextEvent } from '@/lib/events';

/**
 * The shell's tab dots (product decision 2026-10-03): a red dot with no number on a module's tab,
 * the module's loader deciding it per request. Registered at the web composition point
 * (`lib/registry.tsx`, `WebModule.tabDot`), read by the `(app)` layout (`tabDotsFor`) and drawn by
 * the kernel's BottomNav and rail (`NavItem.dot`).
 *
 * A leaf module on purpose, as `notification-renderers.tsx` is: `lib/registry.tsx` imports the feed
 * and stories server actions, so a unit test could not import the loaders there without the whole
 * action graph and its env validation.
 */

/**
 * A tab's dot for this request: the description assistive tech reads after the tab's name while the
 * dot shows (the name itself never changes), and the instant after which the answer may change
 * (the shell refreshes just after it, within 24 h); or `null` for no dot.
 */
export type TabDot = { description: string; until: string | null };

/**
 * Answers a module's tab dot. It must never reject: a dot is never a reason for the shell to fail
 * (`collectTabDots` still contains one that does).
 */
export type TabDotLoader = (ctx: { bootstrap: Bootstrap }) => Promise<TabDot | null>;

/**
 * `events` → the red dot on the Eventos tab, in place of the Início "Próximo evento" card (06-08):
 * shown while the tenant has an event to come, read exactly as the card read it
 * (`GET /v1/events/next`: the next ACTIVE event that has not ended, cancelled excluded). So the dot
 * stays while that event runs and goes when the last one ends: `until` is its end, where the shell
 * refreshes to ask again. A failed read is `loadNextEvent`'s `null` (logged `events.next_failed`,
 * shape only): no dot, nothing else changes.
 */
export const eventsTabDot: TabDotLoader = async () => {
  const [next, t] = await Promise.all([loadNextEvent(), getTranslations('events')]);
  return next ? { description: t('tabDot'), until: next.endsAt } : null;
};

/**
 * The dots of a tab row, by tab key: every tab whose module registered a loader (`loaderFor`) asks
 * it, all at once. A tab exists only for an ENABLED module (`buildNav` over `bootstrap.modules`), so
 * a disabled module is never asked. A loader that rejects anyway is logged with its tab key (and the
 * reason, never a member's content: loaders hold none) and the tab simply has no dot.
 */
export async function collectTabDots(
  loaderFor: (key: string) => TabDotLoader | undefined,
  bootstrap: Bootstrap,
  tabs: ReadonlyArray<NavItem>,
): Promise<Record<string, TabDot>> {
  const jobs = tabs.flatMap((tab) => {
    const load = loaderFor(tab.key);
    return load ? [{ key: tab.key, run: () => load({ bootstrap }) }] : [];
  });
  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  const dots: Record<string, TabDot> = {};
  results.forEach((result, i) => {
    const { key } = jobs[i] as (typeof jobs)[number];
    if (result.status === 'rejected') {
      console.error('tab-dot.failed', { tab: key, reason: String(result.reason) });
    } else if (result.value) {
      dots[key] = result.value;
    }
  });
  return dots;
}
