import { fileURLToPath } from 'node:url';
import { devices, expect, type Locator, type Page, test } from '@playwright/test';
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import {
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsByTitlePrefix,
  deleteEventsTenant,
  type EventsTenant,
  insertEvent,
  moveEventStart,
  readEventInstants,
  secretsFor,
  tenantIdBySlug,
  waitForReadyCover,
} from './events-admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

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
  /** In progress and multi-day: started a day ago, ends in two. The head of Próximos. */
  inProgress: 'Semana de integracao',
  /** Upcoming and cancelled, WITH a cover (so the grayscale branch is the photo's). */
  upcomingCancelled: 'Oficina de fotografia',
  /** Ended 5 days ago, and ended 10 days ago (cancelled): Passados, most recent first. */
  pastRecent: 'Mutirao de primavera',
  pastOlder: 'Cafe com a diretoria',
  /** `SEED_LONG_EVENT_TITLE` (120 characters) and `SEED_LONG_EVENT_VENUE` (60), no cover. */
  longTitle:
    'Encontro regional de voluntarios, lideres de grupo e parceiros para planejar juntos as acoes do proximo semestre inteiro',
  longVenue: 'Centro de Convencoes Professor Joaquim Nabuco, Auditorio 12B',
  tenantName: 'TRIA Demo',
} as const;

/** The tenant's zone, exactly what `bootstrap.tenant.timezone` carries for tria-demo. */
const TENANT_ZONE = 'America/Sao_Paulo';

/** `19:00` in `timeZone`, the formatter `lib/events-view.ts` uses. */
const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** `seg., 12 de out.` in `timeZone` (the year only when it is not the current one there). */
const day = (iso: string, timeZone: string) => {
  const year = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(value);
  const otherYear = year(new Date(iso)) !== year(new Date());
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(iso));
};

/**
 * The seeded answers (`scripts/seed.ts`, 06-03): on the upcoming in-person event member@ and two named
 * members answered Vou and one Não vou; at the recent past event member@ checked in and one member
 * walked in.
 */
const SEEDED_COUNTS = { upcomingConfirmed: 3, pastRecentPresent: 2 } as const;

/** The catalog's `{count, plural, …}` string for a count above one ("3 confirmados"). */
const count = (message: string, n: number) => {
  const other = /other \{([^}]*)\}/.exec(message)?.[1] ?? '';
  return other.replace('#', String(n));
};

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

/** Every poster link in the list region, in DOM (= server) order. */
const posters = (page: Page): Locator => page.locator('main').getByTestId('event-poster');

/** The poster whose accessible name starts with `title`. */
const posterFor = (page: Page, title: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(`^${literal(title)}, `) });

test.describe('events lista', () => {
  test.afterAll(async () => {
    await closeEventsAdmin();
  });

  test('Próximos opens on the in-progress event, with "Agora" and the live overline', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    const chips = page.getByRole('navigation', { name: E.list.filter.label });
    await expect(chips.getByRole('link')).toHaveCount(2);
    await expect(chips.getByRole('link', { name: E.list.filter.upcoming })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('region', {
        name: E.list.regionUpcoming.replace('{tenant}', SEEDED.tenantName),
      }),
    ).toBeVisible();

    const { endsAt } = await readEventInstants('tria-demo', SEEDED.inProgress);
    const first = posters(page).first();
    await expect(first.getByTestId('event-poster-title')).toHaveText(SEEDED.inProgress);
    await expect(first.getByTestId('event-poster-pill')).toHaveText(E.when.now);
    await expect(first.getByTestId('event-poster-overline')).toHaveText(
      E.when.liveUntil.replace('{time}', clock(endsAt, TENANT_ZONE)),
    );
  });

  test('a cancelled event stays in Próximos with the Cancelado pill and a grayscale photo', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    const cancelled = posterFor(page, SEEDED.upcomingCancelled);
    await expect(cancelled.getByTestId('event-poster-pill')).toHaveText(E.state.cancelled);
    const media = cancelled.getByTestId('event-cover-media');
    await expect(media).toBeVisible();
    const filter = await media.evaluate((element) => getComputedStyle(element).filter);
    expect(filter).toContain('grayscale');

    // Positive control: an active event's photo is NOT desaturated.
    const active = posterFor(page, SEEDED.upcomingInPerson).getByTestId('event-cover-media');
    expect(await active.evaluate((element) => getComputedStyle(element).filter)).not.toContain(
      'grayscale',
    );
  });

  test('Passados lists the ended events, most recently ended first', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    await page
      .getByRole('navigation', { name: E.list.filter.label })
      .getByRole('link', { name: E.list.filter.past })
      .click();
    await expect(page).toHaveURL(/\/eventos\?periodo=passados$/);
    await expect(
      page.getByRole('region', { name: E.list.regionPast.replace('{tenant}', SEEDED.tenantName) }),
    ).toBeVisible();

    const titles = await posters(page).getByTestId('event-poster-title').allTextContents();
    expect(titles).toContain(SEEDED.pastRecent);
    expect(titles).toContain(SEEDED.pastOlder);
    expect(titles.indexOf(SEEDED.pastRecent)).toBeLessThan(titles.indexOf(SEEDED.pastOlder));
    // An event in progress has not ended, so it is never here.
    expect(titles).not.toContain(SEEDED.inProgress);
    // 06-03: member@ checked in at the seeded past event, so its pill is the viewer's "Presente"
    // (priority over "Encerrado") and its meta line counts who came.
    const recent = posterFor(page, SEEDED.pastRecent);
    await expect(recent.getByTestId('event-poster-pill')).toHaveText(E.state.present);
    await expect(recent.getByTestId('event-poster-meta')).toHaveText(
      count(E.count.present, SEEDED_COUNTS.pastRecentPresent),
    );
  });

  test('06-03: the seeded upcoming poster shows "Você vai" and its count line; a cancelled one has none', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    const upcoming = posterFor(page, SEEDED.upcomingInPerson);
    await expect(upcoming.getByTestId('event-poster-pill')).toHaveText(E.state.going);
    await expect(upcoming.getByTestId('event-poster-pill')).toHaveAttribute('data-kind', 'going');
    await expect(upcoming.getByTestId('event-poster-meta')).toHaveText(
      count(E.count.confirmed, SEEDED_COUNTS.upcomingConfirmed),
    );
    // UI-D-202: a cancelled poster carries no meta line (member@ answered Vou before the cancel).
    await expect(
      posterFor(page, SEEDED.upcomingCancelled).getByTestId('event-poster-meta'),
    ).toHaveCount(0);
  });

  test('an unknown ?periodo= lands on Próximos silently (D-93)', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const value of ['xyz', 'PASSADOS', 'passados&periodo=passados']) {
      await page.goto(`${hosts.demo}/eventos?periodo=${value}`);
      await expect(
        page
          .getByRole('navigation', { name: E.list.filter.label })
          .getByRole('link', { name: E.list.filter.upcoming }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(posterFor(page, SEEDED.inProgress)).toBeVisible();
    }
  });

  test('E03 long text: at 320px the title stops at two lines and the venue truncates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);

    const poster = posterFor(page, SEEDED.longTitle);
    await poster.scrollIntoViewIfNeeded();
    // The cover-less branch: the D-69 gradient carries the text.
    await expect(poster.getByTestId('event-cover-fallback')).toBeVisible();

    const title = poster.getByTestId('event-poster-title');
    await expect(title).toHaveText(SEEDED.longTitle);
    const titleBox = await title.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    // Clamped: the text overflows the box, and the box is two lines tall.
    expect(titleBox.scrollHeight).toBeGreaterThan(titleBox.clientHeight);
    expect(titleBox.clientHeight).toBeLessThanOrEqual(Math.ceil(titleBox.lineHeight * 2) + 1);

    const venue = poster.getByTestId('event-poster-place').locator('span');
    await expect(venue).toHaveText(SEEDED.longVenue);
    const venueBox = await venue.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(venueBox.scrollWidth).toBeGreaterThan(venueBox.clientWidth);

    // The overline stays whole, inside the 4/5 box.
    const box = await poster.boundingBox();
    const overline = await poster.getByTestId('event-poster-overline').boundingBox();
    expect(box && overline).toBeTruthy();
    if (box && overline) {
      expect(overline.y).toBeGreaterThanOrEqual(box.y);
      expect(overline.y + overline.height).toBeLessThanOrEqual(box.y + box.height);
      expect(box.height / box.width).toBeCloseTo(5 / 4, 1);
    }
  });

  test.describe('on a device in another timezone', () => {
    test.use({ timezoneId: 'America/Manaus' });

    test('the overline shows the TENANT wall clock, not the device one', async ({ page }) => {
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      await page.goto(`${hosts.demo}/eventos`);

      const { startsAt } = await readEventInstants('tria-demo', SEEDED.upcomingInPerson);
      const tenantTime = clock(startsAt, TENANT_ZONE);
      const deviceTime = clock(startsAt, 'America/Manaus');
      expect(tenantTime).not.toBe(deviceTime);
      // The device really is in Manaus (the control), and the poster still reads São Paulo.
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
        'America/Manaus',
      );
      const overline = posterFor(page, SEEDED.upcomingInPerson).getByTestId(
        'event-poster-overline',
      );
      await expect(overline).toContainText(tenantTime);
      await expect(overline).not.toContainText(deviceTime);
    });
  });
});

/** A fixture's title prefix, swept before and after the detail describe. */
const DETAIL_FIXTURE_PREFIX = 'Evento e2e detalhe';

/** 2,000 characters of plain text, no HTML (T-06-17). */
const LONG_DESCRIPTION = Array.from(
  { length: 40 },
  (_, index) => `Paragrafo ${String(index + 1).padStart(2, '0')} da descricao longa do evento.`,
)
  .join(' ')
  .padEnd(2000, ' x')
  .slice(0, 2000);
const FOUR_LINE_ADDRESS = 'Rua das Flores, 100\nBloco B, sala 12\nCentro\nSao Paulo - SP';

test.describe('events detalhe', () => {
  let demoTenantId = '';
  let longEventId = '';

  test.beforeAll(async () => {
    demoTenantId = await tenantIdBySlug('tria-demo');
    await deleteEventsByTitlePrefix(demoTenantId, DETAIL_FIXTURE_PREFIX);
    longEventId = await insertEvent(demoTenantId, {
      title: `${DETAIL_FIXTURE_PREFIX} texto longo`,
      description: LONG_DESCRIPTION,
      venueName: 'Auditorio da sede',
      address: FOUR_LINE_ADDRESS,
      startsInMinutes: 5 * 24 * 60,
      endsInMinutes: 5 * 24 * 60 + 120,
    });
  });

  test.afterAll(async () => {
    await deleteEventsByTitlePrefix(demoTenantId, DETAIL_FIXTURE_PREFIX);
    await closeEventsAdmin();
  });

  test('the seeded upcoming event: "Você vai", the info grid and the Abrir no Maps link', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos`);
    // Reached from its poster, the link 06-01 already renders.
    await posterFor(page, SEEDED.upcomingInPerson).click();
    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/);

    await expect(
      page.getByRole('heading', { level: 1, name: SEEDED.upcomingInPerson }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: E.detail.back })).toHaveAttribute(
      'href',
      '/eventos',
    );
    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.going);

    const { startsAt, endsAt } = await readEventInstants('tria-demo', SEEDED.upcomingInPerson);
    const values = page.getByTestId('event-info-value');
    await expect(values).toHaveText([
      day(startsAt, TENANT_ZONE),
      E.info.timeRange
        .replace('{start}', clock(startsAt, TENANT_ZONE))
        .replace('{end}', clock(endsAt, TENANT_ZONE)),
      'Auditorio da sede',
      count(E.count.confirmed, SEEDED_COUNTS.upcomingConfirmed),
    ]);
    await expect(page.getByTestId('event-info-grid')).toContainText(E.info.confirmed);

    const maps = page.getByTestId('event-maps-link');
    await expect(maps).toHaveText(E.location.openMaps);
    await expect(maps).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/,
    );
    await expect(maps).toHaveAttribute('target', '_blank');
    await expect(maps).toHaveAttribute('rel', 'noopener noreferrer');
    // D-203: no embed anywhere on the page.
    await expect(page.locator('iframe')).toHaveCount(0);
    // A short description shows no toggle at all.
    await expect(page.getByRole('button', { name: E.detail.more })).toHaveCount(0);
  });

  test('the seeded past event where the member checked in: "Presente", the banner, "Presentes"', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const { id } = await readEventInstants('tria-demo', SEEDED.pastRecent);
    await page.goto(`${hosts.demo}/eventos/${id}`);

    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.present);
    const banner = page.getByTestId('event-banner');
    await expect(banner).toHaveAttribute('data-kind', 'checkedIn');
    await expect(banner).toContainText(E.checkin.banner);
    await expect(page.getByTestId('event-info-grid')).toContainText(E.info.present);
    await expect(page.getByTestId('event-info-value').nth(3)).toHaveText(
      count(E.count.present, SEEDED_COUNTS.pastRecentPresent),
    );
  });

  test('the cancelled event: the danger banner and the Cancelado pill', async ({ page }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const { id } = await readEventInstants('tria-demo', SEEDED.upcomingCancelled);
    await page.goto(`${hosts.demo}/eventos/${id}`);

    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.cancelled);
    const banner = page.getByTestId('event-banner');
    await expect(banner).toHaveAttribute('data-kind', 'cancelled');
    await expect(banner).toContainText(E.cancelled.title);
    await expect(banner).toContainText(E.cancelled.body);
  });

  test('an unknown id, another tenant’s event and a malformed id are ONE not-found screen', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const lab = await readEventInstants('tria-lab', SEEDED.upcomingInPerson);
    for (const id of ['0d000000-0000-4000-8000-00000000ffff', lab.id, 'not-a-uuid']) {
      await page.goto(`${hosts.demo}/eventos/${id}`);
      await expect(page.getByText(E.notFound.title, { exact: true })).toBeVisible();
      await expect(
        page.getByText(E.notFound.body.replace('{tenant}', SEEDED.tenantName)),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: E.notFound.cta })).toHaveAttribute(
        'href',
        '/eventos',
      );
      // Nothing of the lab's event leaks onto the screen.
      await expect(page.getByTestId('event-info-grid')).toHaveCount(0);
    }
  });

  test('E04 long text: the description clamps at six lines behind "Ver mais", and "Ver menos" restores it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 390×844 backstop is a phone check');
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/eventos/${longEventId}`);

    const description = page.getByTestId('event-description');
    await expect(description).toBeVisible();
    const measure = () =>
      description.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      }));
    const clamped = await measure();
    expect(clamped.scrollHeight).toBeGreaterThan(clamped.clientHeight);
    expect(clamped.clientHeight).toBeLessThanOrEqual(Math.ceil(clamped.lineHeight * 6) + 1);

    // The info grid stays within one viewport of the clamped description (the zone is reachable).
    const grid = await page.getByTestId('event-info-grid').boundingBox();
    const text = await description.boundingBox();
    expect(grid && text).toBeTruthy();
    if (grid && text) expect(grid.y - text.y).toBeLessThan(844);

    // The four-line address wraps and keeps its line breaks.
    const address = page.getByTestId('event-location').locator('p').nth(1);
    await expect(address).toHaveCSS('white-space', 'pre-line');
    expect(await address.evaluate((element) => element.getClientRects().length)).toBeGreaterThan(0);
    const addressBox = await address.boundingBox();
    const lineHeight = await address.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(addressBox?.height ?? 0).toBeGreaterThanOrEqual(lineHeight * 4 - 1);

    const more = page.getByRole('button', { name: E.detail.more });
    await more.scrollIntoViewIfNeeded();
    // Dispatched AT the element: the dev overlay pill can sit over a phone's bottom edge.
    await more.dispatchEvent('click');
    await expect(page.getByRole('button', { name: E.detail.less })).toBeVisible();
    const expanded = await measure();
    expect(expanded.scrollHeight).toBeLessThanOrEqual(expanded.clientHeight + 1);

    await page.getByRole('button', { name: E.detail.less }).dispatchEvent('click');
    await expect(page.getByRole('button', { name: E.detail.more })).toBeVisible();
    const again = await measure();
    expect(again.scrollHeight).toBeGreaterThan(again.clientHeight);
  });

  test.describe('on a device in another timezone', () => {
    test.use({ timezoneId: 'America/Manaus' });

    test('the info grid shows the TENANT wall clock, not the device one', async ({ page }) => {
      await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
      const { id, startsAt, endsAt } = await readEventInstants(
        'tria-demo',
        SEEDED.upcomingInPerson,
      );
      await page.goto(`${hosts.demo}/eventos/${id}`);
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
        'America/Manaus',
      );
      const time = page.getByTestId('event-info-value').nth(1);
      await expect(time).toHaveText(
        E.info.timeRange
          .replace('{start}', clock(startsAt, TENANT_ZONE))
          .replace('{end}', clock(endsAt, TENANT_ZONE)),
      );
      await expect(time).not.toContainText(clock(startsAt, 'America/Manaus'));
    });
  });
});

/** The catalog's `=0` branch of a `{count, plural, …}` string ("Ninguém confirmou ainda"). */
const zero = (message: string) => /=0 \{([^}]*)\}/.exec(message)?.[1] ?? '';
/** The catalog's `one` branch, with `#` = 1 ("1 confirmado"). */
const one = (message: string) => (/one \{([^}]*)\}/.exec(message)?.[1] ?? '').replace('#', '1');

/**
 * EVENT-03 (06-03 Task 3, sketch 006 surface 2): the member answers `Vou` / `Não vou` on the detail
 * page and watches the count move, then meets the database's refusal once the event has started.
 *
 * Runs in a THROWAWAY events tenant (`createEventsTenant`) so the seeded counts other describes read
 * never move, with an event written relative to the database's `now()` (Pitfall 7: `page.clock` moves
 * only the browser). Phone only: the pair is the phone's primary action, and one tenant per run keeps
 * the serial flow simple. Taps are dispatched AT the element (the dev overlay pill can sit over a
 * phone's bottom edge, the 06-01 workaround).
 */
test.describe('events rsvp', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-rsvp';
  let tenant: EventsTenant | null = null;
  let eventId = '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    eventId = await insertEvent(tenant.tenantId, {
      title: 'Encontro RSVP e2e',
      startsInMinutes: 3 * 24 * 60,
      endsInMinutes: 3 * 24 * 60 + 120,
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  const pair = (page: Page) => page.getByRole('group', { name: E.rsvp.label });
  const vou = (page: Page) => pair(page).getByRole('button', { name: E.rsvp.going, exact: true });
  const naoVou = (page: Page) => pair(page).getByRole('button', { name: E.rsvp.notGoing });
  const countCell = (page: Page) => page.getByTestId('event-info-value').nth(3);

  test('Vou moves the count to "1 confirmado", Não vou moves it back, and a reload keeps the answer', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events rsvp tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${eventId}`);

    // Unanswered: both segments idle, the count reads its zero form, the P0 in-person hint shows.
    await expect(pair(page)).toBeVisible();
    await expect(vou(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(naoVou(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(countCell(page)).toHaveText(zero(E.count.confirmed));
    await expect(page.getByText(E.rsvp.windowHint)).toBeVisible();
    // The pair spends no brand fill (the zone's one fill is the check-in CTA, 06-05).
    await expect(pair(page).locator('.bg-brand')).toHaveCount(0);

    await vou(page).dispatchEvent('click');
    await expect(vou(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(countCell(page)).toHaveText(one(E.count.confirmed));
    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.going);
    await expect(pair(page)).not.toHaveAttribute('aria-busy', 'true');

    await naoVou(page).dispatchEvent('click');
    await expect(naoVou(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(vou(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(countCell(page)).toHaveText(zero(E.count.confirmed));
    await expect(page.getByTestId('event-header-pill')).toHaveCount(0);
    // No success toast: the pressed state and the count are the feedback.
    await expect(page.getByText(E.rsvp.errors.failed)).toHaveCount(0);

    await page.reload();
    await expect(naoVou(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(vou(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(countCell(page)).toHaveText(zero(E.count.confirmed));
  });

  test('a tap after the start is refused by the database: the "encerraram" toast, then the read-only line', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events rsvp tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${eventId}`);
    await expect(naoVou(page)).toHaveAttribute('aria-pressed', 'true');

    // The page still draws P0; the database now says the event started five minutes ago.
    await moveEventStart(eventId, -5);
    await vou(page).dispatchEvent('click');

    await expect(page.getByText(E.rsvp.errors.closed)).toBeVisible();
    // The refresh swaps in the P2 zone: no pair, the stored answer as a read-only line (Não vou
    // survived: the late Vou was never written).
    await expect(pair(page)).toHaveCount(0);
    await expect(page.getByTestId('event-actions-answer')).toHaveText(E.rsvp.answeredNotGoing);
    await expect(countCell(page)).toHaveText(zero(E.count.confirmed));
  });
});

/**
 * EVENT-01, the admin's half from a phone (06-04): create in person with a cover, create online,
 * edit, a format switch that stores only the visible side, a cancel the member can still see
 * (D-201), and a reactivation, on `mobile-chromium` (iPhone 14) in a throwaway tenant.
 *
 * Every step goes through the real form and the real API; the ONLY direct read is `secretsFor`, the
 * admin-only `event_secrets` row no browser can observe (that is the point of D-217). The cover is a
 * real upload through the file chooser, derived by a real worker (`ensureWorker`), and the form is
 * submitted only once the database says the cover is `ready` (the 05-09 tuple rule the API applies).
 *
 * Hydration proof before typing (the `media-fixtures.ts` lesson): a `filechooser` event or a
 * segmented toggle flipping `aria-pressed` can only happen once React's handlers are attached, so
 * no keystroke lands on server-rendered HTML. Controls that can sit under Next's dev pill or the
 * BottomNav at the bottom of a phone are dispatched (`dispatchEvent('click')`, the 06-01 note).
 */
test.describe('events admin', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-admin';
  const ZONE = 'America/Sao_Paulo';
  const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;
  const MEETING_HOST = 'meet.example.test';
  const MEETING_URL = `https://${MEETING_HOST}/e2e-sala`;
  const TITLE = 'Encontro admin e2e';
  const RENAMED = 'Encontro admin e2e renomeado';
  const ONLINE_TITLE = 'Live admin e2e';

  let tenant: EventsTenant | null = null;
  let stopWorker: (() => Promise<void>) | null = null;
  let inPersonId = '';

  /** `YYYY-MM-DD` of the tenant-local day `days` from now (the `en-CA` trick). */
  const tenantDate = (days: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + days * 86_400_000));

  const submit = (page: Page) => page.locator('[data-event-submit]');
  const toast = (page: Page, message: string) =>
    page.getByRole('status').filter({ hasText: message });
  const segment = (page: Page, label: string) =>
    page.getByRole('group', { name: E.form.format.label }).getByRole('button', { name: label });
  const eventIdFrom = (page: Page) => page.url().split('/eventos/')[1]?.split(/[/?#]/)[0] ?? '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    stopWorker = await ensureWorker();
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await stopWorker?.();
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  test('1. from the empty list, the admin creates an in-person event with a cover and an online one', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events admin tenant was not provisioned');
    test.setTimeout(240_000);
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos`);

    // D-212: the icon-only control below `sm`, named by the catalog string, and the manager empty.
    const create = page.locator('[data-events-create]');
    await expect(create).toBeVisible();
    await expect(create).toHaveAccessibleName(E.actions.create);
    const box = await create.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(44);
    expect(Math.round(box?.height ?? 0)).toBe(44);
    await expect(page.getByTestId('events-empty-upcoming')).toContainText(
      E.empty.upcoming.bodyManager,
    );
    await expect(page.locator('[data-events-empty-create]')).toHaveText(E.actions.create);
    await create.click();
    await expect(page).toHaveURL(/\/eventos\/novo$/);

    // E10/empty: submit disabled, the gradient preview, the tenant zone helper.
    await expect(submit(page)).toBeDisabled();
    await expect(
      page.locator('[data-event-cover-preview] [data-testid="event-cover-fallback"]'),
    ).toBeVisible();
    await expect(page.locator('[data-event-zone]')).toHaveText(
      E.form.when.zone.replace('{zone}', 'Horário Padrão de Brasília'),
    );

    // The cover through the real file chooser (also the hydration proof).
    const since = new Date(Date.now() - 1_000);
    const choosing = page.waitForEvent('filechooser');
    // The sr-only file input carries the same name, so the visible BUTTON is picked by tag.
    await page.locator('[data-event-form] button', { hasText: E.form.cover.add }).click();
    await (await choosing).setFiles(PHOTO);
    await expect(
      page.locator('[data-event-cover-preview] [data-testid="event-cover-image"]'),
    ).toBeVisible({ timeout: 60_000 });
    await waitForReadyCover(tenant.tenantId, since);

    const date = tenantDate(3);
    await page.locator('#event-title').fill(TITLE);
    await page.locator('#event-start-date').fill(date);
    await page.locator('#event-start-time').fill('19:00');
    // D-213: the untouched end followed the start, +2 h.
    await expect(page.locator('#event-end-date')).toHaveValue(date);
    await expect(page.locator('#event-end-time')).toHaveValue('21:00');
    await page.locator('#event-venue').fill('Auditorio da sede');
    await page.locator('#event-address').fill('Rua das Flores, 100');
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();

    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(toast(page, E.toasts.created)).toBeVisible();
    inPersonId = eventIdFrom(page);
    await expect(page.getByTestId('event-hero-title')).toHaveText(TITLE);
    await expect(page.getByTestId('event-maps-link')).toHaveText(E.location.openMaps);
    await expect(page.locator('[data-event-manage-edit]')).toHaveText(E.manage.edit);

    // The online one: Online selected first (the hydration proof), then the link.
    await page.goto(`${tenant.origin}/eventos/novo`);
    await segment(page, E.form.format.online).click();
    await expect(segment(page, E.form.format.online)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#event-title').fill(ONLINE_TITLE);
    await page.locator('#event-start-date').fill(tenantDate(4));
    await page.locator('#event-start-time').fill('20:00');
    await page.locator('#event-url').fill(MEETING_URL);
    await submit(page).click();
    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(toast(page, E.toasts.created)).toBeVisible();
    await expect(page.getByTestId('event-hero-place')).toHaveText(E.place.online);
    // T-06-20: the link is stored, and no byte of it reaches the page.
    expect((await secretsFor(eventIdFrom(page))).meetingUrl).toBe(MEETING_URL);
    expect(await page.content()).not.toContain('meet.example.test');
  });

  test('2. edit arrives in wall clock; a rename saves, and a format switch stores only the visible side', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant || !inPersonId) throw new Error('test 1 did not create the in-person event');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${inPersonId}`);

    await page.locator('[data-event-manage-edit]').click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${inPersonId}/editar$`));
    await expect(page.locator('#event-start-time')).toHaveValue('19:00');
    await expect(page.locator('#event-end-time')).toHaveValue('21:00');
    await expect(page.locator('#event-title')).toHaveValue(TITLE);
    await expect(page.getByText(E.form.editNote)).toBeVisible();
    // Hydration proof, harmless: the hidden side is never submitted.
    await segment(page, E.form.format.online).click();
    await segment(page, E.form.format.inPerson).click();
    await expect(segment(page, E.form.format.inPerson)).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#event-title').fill(RENAMED);
    await submit(page).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${inPersonId}$`), { timeout: 30_000 });
    await expect(toast(page, E.toasts.saved)).toBeVisible();
    await expect(page.getByTestId('event-hero-title')).toHaveText(RENAMED);

    // Online, a link typed, back to Presencial, save: still in person, and NO link stored.
    await page.goto(`${tenant.origin}/eventos/${inPersonId}/editar`);
    await segment(page, E.form.format.online).click();
    await expect(segment(page, E.form.format.online)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#event-url').fill(MEETING_URL);
    await segment(page, E.form.format.inPerson).click();
    await expect(page.locator('#event-venue')).toHaveValue('Auditorio da sede');
    await submit(page).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${inPersonId}$`), { timeout: 30_000 });
    await expect(page.getByTestId('event-maps-link')).toBeVisible();
    expect(await secretsFor(inPersonId)).toEqual({ eventFormat: 'in_person', meetingUrl: null });
  });

  test('3. cancel from the form, the member still sees it cancelled, and Reativar brings it back', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant || !inPersonId) throw new Error('test 1 did not create the in-person event');
    test.setTimeout(180_000);
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${inPersonId}/editar`);
    await expect(segment(page, E.form.format.inPerson)).toHaveAttribute('aria-pressed', 'true');

    // The bottom row, confirmed first (UI-D-211).
    await page.locator('[data-event-cancel]').dispatchEvent('click');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(E.confirm.cancel.title);
    await dialog.getByRole('button', { name: E.confirm.cancel.confirm }).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${inPersonId}$`), { timeout: 30_000 });
    await expect(toast(page, E.toasts.cancelled)).toBeVisible();
    const banner = page.getByTestId('event-banner');
    await expect(banner).toHaveAttribute('data-kind', 'cancelled');
    await expect(banner.locator('[data-event-reactivate]')).toHaveText(E.reactivate.action);

    // D-201, on the member's own session: still listed, with the pill; the detail disabled.
    const memberContext = await browser.newContext({
      ...devices['iPhone 14'],
      serviceWorkers: 'block',
    });
    const member = await memberContext.newPage();
    try {
      await login(member, tenant.memberEmail, tenant.password, tenant.origin);
      await member.goto(`${tenant.origin}/eventos`);
      const poster = posterFor(member, RENAMED);
      await expect(poster.getByTestId('event-poster-pill')).toHaveText(E.state.cancelled);
      // A member has no create control at all.
      await expect(member.locator('[data-events-create]')).toHaveCount(0);
      await poster.click();
      await expect(member.getByTestId('event-banner')).toHaveAttribute('data-kind', 'cancelled');
      await expect(member.getByRole('group', { name: E.rsvp.label })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await expect(member.locator('[data-event-reactivate]')).toHaveCount(0);
      await expect(member.locator('[data-event-manage]')).toHaveCount(0);

      // Back as the admin: Reativar from the banner, confirmed.
      await banner.locator('[data-event-reactivate]').dispatchEvent('click');
      await expect(dialog).toContainText(E.confirm.reactivate.title);
      await dialog.getByRole('button', { name: E.confirm.reactivate.confirm }).click();
      await expect(toast(page, E.toasts.reactivated)).toBeVisible();
      await expect(page.getByTestId('event-banner')).toHaveCount(0);

      // A member typing the form's URL gets the one not-found screen.
      await member.goto(`${tenant.origin}/eventos/novo`);
      await expect(member.getByText(E.notFound.title)).toBeVisible();
      await expect(member.locator('[data-event-form]')).toHaveCount(0);
      await member.goto(`${tenant.origin}/eventos/${inPersonId}/editar`);
      await expect(member.getByText(E.notFound.title)).toBeVisible();
    } finally {
      await memberContext.close();
    }
  });
});
