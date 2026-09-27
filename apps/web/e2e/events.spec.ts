import { expect, test } from '@playwright/test';
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const E = eventMessages.events;

/**
 * EVENT-02 / D-55 (plan 06-01): the `Eventos` tab and the `/eventos` list, on the phone
 * (`mobile-chromium`, an iPhone 14 preset) and on the desktop.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering the navigation from its own cache
 * would have these assertions reading what a previous run left behind.
 */
test.use({ serviceWorkers: 'block' });

/**
 * What `scripts/seed.ts` writes for the demo tenant (`SEED_EVENTS`), mirrored here because the seed
 * is a top-level-await script that opens a database connection at import time.
 */
const SEEDED = {
  /** Upcoming, in person, with a cover, in 3 days. */
  upcomingInPerson: 'Encontro de boas-vindas',
} as const;

/** Escapes a literal for a `RegExp`. */
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('events tracer', () => {
  test('a member taps the Eventos tab, lands on /eventos and sees a seeded event poster', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // D-55: the tab exists because the MODULE'S MANIFEST declares it; reached by its catalog label.
    const tab = page.locator('nav').getByRole('link', { name: E.nav, exact: true }).first();
    await expect(tab).toBeVisible();
    // Dispatched AT the element: under `next dev` the issues pill (a dev-only `<nextjs-portal>`,
    // recorded in the stories/reels specs) sits over the phone's BottomNav and intercepts a
    // coordinate click. The tab is visible and enabled; its navigation is what this asserts.
    await tab.dispatchEvent('click');
    await expect(page).toHaveURL(/\/eventos$/);

    await expect(page.getByRole('heading', { name: E.list.title, level: 1 })).toBeVisible();
    await expect(page.getByText(E.list.subtitle)).toBeVisible();

    // The poster is ONE link whose accessible name is "{title}, {when}".
    const poster = page
      .locator('main')
      .getByRole('link', { name: new RegExp(`^${literal(SEEDED.upcomingInPerson)}, `) });
    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute('href', /^\/eventos\/[0-9a-f-]{36}$/);
  });
});
