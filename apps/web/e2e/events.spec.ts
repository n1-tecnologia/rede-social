import { fileURLToPath } from 'node:url';
import { devices, expect, type Locator, type Page, test } from '@playwright/test';
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import {
  addEventsMember,
  attendanceFor,
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsByTitlePrefix,
  deleteEventsTenant,
  type EventsTenant,
  eventsApiAs,
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
    expect(await secretsFor(inPersonId)).toMatchObject({
      eventFormat: 'in_person',
      meetingUrl: null,
    });
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

/**
 * EVENT-04 in person, on a phone (06-05, UI-D-207 / UI-D-208, sketch 006 surface 3): the member at
 * the venue types the code the organiser reads aloud and becomes present, confirmed or not.
 *
 * One throwaway tenant (`e2e-events-checkin`), phone only, serial. Every event is written RELATIVE
 * to the database's `now()` (`insertEvent`), so the window is really open (Pitfall 7: the API and the
 * database use the real clock). The code is learned ONLY through `secretsFor`, the superuser read no
 * browser can make; the walk-in is proved through `attendanceFor` (the status is admin-only in the UI).
 *
 * The main event carries a 60-character venue: the UI E08 long-text backstop (the Local cell
 * truncates on one line at 320px without widening its column) and the Data-cell fix (the date prints
 * without its weekday, so it fits a third of the ticket at 390 and 320) are measured on it.
 */
test.describe('events check-in', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-checkin';
  /** 60 characters: the E08 backstop fixture. */
  const LONG_VENUE = 'Auditorio Principal do Centro de Convencoes Anhembi, Bloco B';
  let tenant: EventsTenant | null = null;
  let walkInEmail = '';
  const ids = { live: '', later: '', online: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    walkInEmail = await addEventsMember(tenant, 'sem.resposta', 'Membro Sem Resposta');
    ids.live = await insertEvent(tenant.tenantId, {
      title: 'Encontro presencial com check-in',
      venueName: LONG_VENUE,
      startsInMinutes: 30,
      endsInMinutes: 150,
    });
    ids.later = await insertEvent(tenant.tenantId, {
      title: 'Encontro mais tarde',
      startsInMinutes: 180,
      endsInMinutes: 300,
    });
    ids.online = await insertEvent(tenant.tenantId, {
      title: 'Live com check-in',
      format: 'online',
      startsInMinutes: 30,
      endsInMinutes: 150,
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  const cta = (page: Page) => page.getByRole('link', { name: E.checkin.cta });
  const codeField = (page: Page) => page.getByLabel(E.checkin.codeLabel);
  const confirm = (page: Page) => page.getByRole('button', { name: E.checkin.submit });
  /** The form's own `role="alert"` slot (the page has others, e.g. Next's route announcer). */
  const fieldAlert = (page: Page) => page.getByTestId('event-ticket').getByRole('alert');

  /** Fills the code once React owns the field: the submit only enables on the client's state. */
  async function typeCode(page: Page, code: string) {
    await expect(async () => {
      await codeField(page).fill(code);
      await expect(confirm(page)).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** `true` when an element's text is cut by its own box (the `truncate` ellipsis is showing). */
  const isCut = (locator: Locator) =>
    locator.evaluate((node) => node.scrollWidth > node.clientWidth + 1);

  test('1. after Vou, "Fazer check-in" opens the ticket; at 320px the long Local cell truncates and Data/Horário keep their width', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events check-in tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.live}`);

    // P1: the pair is still open; answer Vou, then the ONE brand CTA below it.
    const vou = page
      .getByRole('group', { name: E.rsvp.label })
      .getByRole('button', { name: E.rsvp.going, exact: true });
    await vou.dispatchEvent('click');
    await expect(vou).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.going);
    await expect(cta(page)).toHaveAttribute('href', `/eventos/${ids.live}/check-in`);
    await expect(page.getByTestId('event-actions').locator('.bg-brand')).toHaveCount(1);

    await cta(page).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${ids.live}/check-in$`));
    await expect(page.getByRole('heading', { level: 1, name: E.checkin.title })).toBeVisible();
    await expect(page.getByText(E.checkin.tip)).toBeVisible();
    await expect(codeField(page)).toHaveAttribute('maxlength', '4');
    await expect(confirm(page)).toBeDisabled();

    const ticket = page.getByTestId('event-ticket');
    const cells = ticket.getByTestId('event-info-cell');
    const values = ticket.getByTestId('event-info-value');
    await expect(cells).toHaveCount(3);
    await expect(values.nth(2)).toHaveText(LONG_VENUE);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      // The Data cell fits (the weekday-free date); the 60-character venue is cut on one line.
      expect(await isCut(values.nth(0)), `Data cut at ${width}px`).toBe(false);
      expect(await isCut(values.nth(1)), `Horário cut at ${width}px`).toBe(false);
      expect(await isCut(values.nth(2)), `Local not cut at ${width}px`).toBe(true);
      const boxes = await Promise.all([0, 1, 2].map((i) => cells.nth(i).boundingBox()));
      const widths = boxes.map((box) => Math.round(box?.width ?? 0));
      // Three equal columns: the long venue widens nothing.
      expect(Math.max(...widths) - Math.min(...widths), `widths ${widths}`).toBeLessThanOrEqual(1);
      const valueHeight = (await values.nth(2).boundingBox())?.height ?? 0;
      const dataHeight = (await values.nth(0).boundingBox())?.height ?? 0;
      expect(Math.abs(valueHeight - dataHeight), 'the Local value stays on one line').toBeLessThan(
        2,
      );
      // The ticket stays inside its 16px gutters.
      const ticketBox = await ticket.boundingBox();
      expect(ticketBox?.x ?? 0).toBeGreaterThanOrEqual(15);
      expect((ticketBox?.x ?? 0) + (ticketBox?.width ?? 0)).toBeLessThanOrEqual(width - 15);
    }
  });

  test('2. a wrong code: the inline error, the value kept; the right code: "Check-in confirmado!", and the detail shows the banner with no CTA', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events check-in tenant was not provisioned');
    const { checkinCode } = await secretsFor(ids.live);
    const wrong = checkinCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.live}/check-in`);

    await expect(fieldAlert(page)).toHaveCount(0);
    await typeCode(page, wrong.toLowerCase());
    await expect(codeField(page)).toHaveValue(wrong);
    await confirm(page).click();
    await expect(fieldAlert(page)).toHaveText(E.checkin.errors.wrongCode);
    await expect(codeField(page)).toHaveValue(wrong);
    await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');

    await typeCode(page, checkinCode);
    await confirm(page).click();
    const done = page.getByRole('heading', { name: E.checkin.doneTitle });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(page.getByTestId('checkin-done-at')).toHaveText(
      new RegExp(`^${literal(E.checkin.doneAt).replace(literal('{time}'), '\\d{2}:\\d{2}')}$`),
    );
    await expect(confirm(page)).toHaveCount(0);
    expect(await attendanceFor(ids.live, tenant.memberEmail)).toEqual({
      status: 'checked_in',
      checkinVia: 'code',
    });

    await page.getByRole('link', { name: E.checkin.back, exact: true }).last().click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${ids.live}$`));
    const banner = page.getByTestId('event-banner');
    await expect(banner).toHaveAttribute('data-kind', 'checkedIn');
    await expect(banner).toContainText(E.checkin.banner);
    await expect(page.getByTestId('event-header-pill')).toHaveText(E.state.present);
    await expect(page.getByTestId('event-actions-checkin')).toHaveCount(0);
    await expect(page.getByRole('group', { name: E.rsvp.label })).toHaveCount(0);

    // Back on the ticket, the state is read from the database: done, with no form.
    await page.goto(`${tenant.origin}/eventos/${ids.live}/check-in`);
    await expect(page.getByTestId('checkin-done')).toBeVisible();
    await expect(page.getByTestId('checkin-form')).toHaveCount(0);
  });

  test('3. a member who never answered checks in with the same code and is recorded as a walk-in', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events check-in tenant was not provisioned');
    const { checkinCode } = await secretsFor(ids.live);
    await login(page, walkInEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.live}`);
    await expect(cta(page)).toBeVisible();
    await page.goto(`${tenant.origin}/eventos/${ids.live}/check-in`);
    await typeCode(page, checkinCode);
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: E.checkin.doneTitle })).toBeVisible();
    expect(await attendanceFor(ids.live, walkInEmail)).toEqual({
      status: 'walk_in',
      checkinVia: 'code',
    });
    // The walk-in sees exactly the confirmed member's banner (the walk-in tag is admin-only, 06-07).
    await page.goto(`${tenant.origin}/eventos/${ids.live}`);
    await expect(page.getByTestId('event-banner')).toHaveAttribute('data-kind', 'checkedIn');
    await expect(page.getByTestId('event-banner')).toContainText(E.checkin.banner);
  });

  test('4. an event starting in 3 hours: the not-open-yet sentence and no form; an online event’s /check-in is the not-found screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events check-in tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    await page.goto(`${tenant.origin}/eventos/${ids.later}`);
    await expect(page.getByTestId('event-actions-checkin')).toHaveCount(0);
    await expect(page.getByText(E.rsvp.windowHint)).toBeVisible();

    await page.goto(`${tenant.origin}/eventos/${ids.later}/check-in`);
    const state = page.getByTestId('checkin-state');
    await expect(state).toHaveAttribute('data-kind', 'notOpenYet');
    const [prefix] = E.checkin.notOpenYet.split('{when}');
    await expect(state).toContainText(prefix ?? '');
    // `{when}` is "às 18:00" (the window opens today) or "em {date}, às 18:00" (another day).
    const at = literal(E.checkin.opensAt).replace(literal('{time}'), '\\d{2}:\\d{2}');
    await expect(state).toContainText(new RegExp(`${at}\\.$`));
    await expect(page.getByTestId('checkin-form')).toHaveCount(0);
    await expect(codeField(page)).toHaveCount(0);

    await page.goto(`${tenant.origin}/eventos/${ids.online}/check-in`);
    await expect(page.getByText(E.notFound.title, { exact: true })).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
  });
});

/**
 * EVENT-04 online (06-06, D-207, D-210, D-218, UI-D-209): `Entrar` and its refusal screens, on the
 * phone in a throwaway tenant (`e2e-events-entrar`), serial.
 *
 * Every event is ONLINE and written relative to the database's `now()` (`insertEvent`). The route
 * handler is exercised as the browser would follow it: `page.request.get(…, { maxRedirects: 0 })`
 * carries the member's session cookies and shows the 303 itself, so the `Location` header — the ONLY
 * place the meeting URL may reach the browser — is asserted directly. The meeting host
 * (`https://meet.example.test`) never resolves, and Playwright routes only the first url of a
 * redirect chain, so a browsing context that must land there is proved by its navigation REQUEST to
 * the stored URL, redirected from `/entrar`. Presence is read through `attendanceFor` (a superuser read no browser can
 * make). No detail, list or aviso page may ever contain the meeting host (D-207, T-06-35).
 */
test.describe('events entrar', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-entrar';
  const MEETING = 'https://meet.example.test';
  let tenant: EventsTenant | null = null;
  let walkInEmail = '';
  let calendarEmail = '';
  const ids = { early: '', live: '', ended: '', cancelled: '', prefetch: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    walkInEmail = await addEventsMember(tenant, 'sem.resposta', 'Membro Sem Resposta');
    calendarEmail = await addEventsMember(tenant, 'agenda', 'Membro da Agenda');
    const online = (title: string, startsInMinutes: number, endsInMinutes: number, room: string) =>
      insertEvent(tenant?.tenantId ?? '', {
        title,
        format: 'online',
        meetingUrl: `${MEETING}/${room}`,
        startsInMinutes,
        endsInMinutes,
      });
    ids.early = await online('Live mais tarde', 180, 300, 'cedo');
    ids.live = await online('Live agora', 30, 150, 'agora');
    ids.ended = await online('Live encerrada', -180, -1, 'fim');
    ids.prefetch = await online('Live pre-carregada', 30, 150, 'prefetch');
    ids.cancelled = await insertEvent(tenant.tenantId, {
      title: 'Live cancelada',
      format: 'online',
      meetingUrl: `${MEETING}/cancelada`,
      startsInMinutes: 30,
      endsInMinutes: 150,
      cancelled: true,
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  const enterPath = (id: string) => `/eventos/${id}/entrar`;
  const enterLink = (page: Page) => page.getByTestId('event-actions-enter');
  const onlineHint = (page: Page) => page.getByTestId('event-actions-online-hint');
  const vou = (page: Page) =>
    page
      .getByRole('group', { name: E.rsvp.label })
      .getByRole('button', { name: E.rsvp.going, exact: true });

  /** GET `/entrar` as the page's member, without following the redirect. */
  const follow = (page: Page, id: string, headers: Record<string, string> = {}) =>
    page.request.get(`${tenant?.origin ?? ''}${enterPath(id)}`, { maxRedirects: 0, headers });

  /** D-207: the rendered page never carries the meeting host, in any attribute or text. */
  async function expectNoMeetingHost(page: Page) {
    expect(await page.content()).not.toContain('meet.example.test');
  }

  test('1. P0: without Vou the Lock hint and no Entrar; after Vou the OUTLINE Entrar, and following it forwards to the meeting WITHOUT recording', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events entrar tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.early}`);

    await expect(onlineHint(page)).toHaveText(E.online.confirmToGetLink);
    await expect(enterLink(page)).toHaveCount(0);
    await expectNoMeetingHost(page);

    await vou(page).dispatchEvent('click');
    await expect(vou(page)).toHaveAttribute('aria-pressed', 'true');
    const link = enterLink(page);
    await expect(link).toHaveAttribute('href', enterPath(ids.early));
    await expect(link).toHaveAttribute('data-tone', 'outline');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('data-no-prefetch', '');
    const [before] = E.online.hintBefore.split('{time}');
    await expect(onlineHint(page)).toHaveText(
      new RegExp(`^${literal(before ?? '')}\\d{2}:\\d{2}\\.$`),
    );
    await expect(page.getByTestId('event-actions').locator('.bg-brand')).toHaveCount(0);
    await expectNoMeetingHost(page);

    const res = await follow(page, ids.early);
    expect(res.status()).toBe(303);
    expect(res.headers().location).toBe(`${MEETING}/cedo`);
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    // D-218: entering early works but counts nothing.
    expect(await attendanceFor(ids.early, tenant.memberEmail)).toEqual({
      status: 'going',
      checkinVia: null,
    });
  });

  test('2. P0 without Vou: the gate refuses with no URL, and the aviso page says "Confirme sua presença"', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events entrar tenant was not provisioned');
    await login(page, walkInEmail, tenant.password, tenant.origin);

    const res = await follow(page, ids.early);
    expect(res.status()).toBe(303);
    const location = res.headers().location ?? '';
    expect(location).toBe(`/eventos/${ids.early}/entrar/aviso?motivo=confirmar`);
    expect(location).not.toContain('meet.example.test');
    expect(await attendanceFor(ids.early, walkInEmail)).toBeNull();

    await page.goto(`${tenant.origin}${location}`);
    await expect(page.getByTestId('enter-notice')).toHaveAttribute('data-reason', 'confirmar');
    await expect(page.getByRole('heading', { name: E.enter.confirmFirst.title })).toBeVisible();
    await expect(page.getByText(E.enter.confirmFirst.body)).toBeVisible();
    await expect(page.getByTestId('enter-notice-cta')).toHaveText(E.enter.cta);
    await expect(page.getByTestId('enter-notice-cta')).toHaveAttribute(
      'href',
      `/eventos/${ids.early}`,
    );
    await expectNoMeetingHost(page);
  });

  test('3. in the window with no answer: a prefetch is 204 and records nothing; the tap is a 303 to the meeting and a walk_in via online; a repeat forwards again with one row', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events entrar tenant was not provisioned');
    await login(page, walkInEmail, tenant.password, tenant.origin);

    await page.goto(`${tenant.origin}/eventos/${ids.live}`);
    await expect(enterLink(page)).toHaveAttribute('data-tone', 'brand');
    await expect(enterLink(page)).toHaveAttribute('href', enterPath(ids.live));
    await expect(onlineHint(page)).toHaveText(E.online.hintLive);
    await expect(page.getByTestId('event-actions').locator('.bg-brand')).toHaveCount(1);
    await expectNoMeetingHost(page);
    // A render recorded nothing.
    expect(await attendanceFor(ids.live, walkInEmail)).toBeNull();

    // D-218: a request that announces itself as a prefetch learns nothing and records nothing.
    // (A framework data fetch, `RSC: 1`, gets the same 204 — `entrar/route.test.ts`; Next itself
    // answers a hand-made RSC request without its cache-busting parameter before the handler runs.)
    const prefetchHeaders: Record<string, string>[] = [
      { 'Sec-Purpose': 'prefetch' },
      { Purpose: 'prefetch' },
      { 'Next-Router-Prefetch': '1' },
    ];
    for (const headers of prefetchHeaders) {
      const prefetch = await follow(page, ids.prefetch, headers);
      expect(prefetch.status(), JSON.stringify(headers)).toBe(204);
      expect(prefetch.headers()['cache-control']).toContain('no-store');
      expect(prefetch.headers().location).toBeUndefined();
    }
    expect(await attendanceFor(ids.prefetch, walkInEmail)).toBeNull();

    const first = await follow(page, ids.live);
    expect(first.status()).toBe(303);
    expect(first.headers().location).toBe(`${MEETING}/agora`);
    expect(await attendanceFor(ids.live, walkInEmail)).toEqual({
      status: 'walk_in',
      checkinVia: 'online',
    });

    const again = await follow(page, ids.live);
    expect(again.status()).toBe(303);
    expect(again.headers().location).toBe(`${MEETING}/agora`);
    expect(await attendanceFor(ids.live, walkInEmail)).toEqual({
      status: 'walk_in',
      checkinVia: 'online',
    });

    // The detail now shows the banner, and Entrar stays to rejoin (no hint).
    await page.goto(`${tenant.origin}/eventos/${ids.live}`);
    await expect(page.getByTestId('event-banner')).toHaveAttribute('data-kind', 'checkedIn');
    await expect(enterLink(page)).toHaveAttribute('data-tone', 'brand');
    await expect(onlineHint(page)).toHaveCount(0);
    await expectNoMeetingHost(page);
  });

  test('4. ended and cancelled name their reason on the one aviso layout; an unknown or repeated motivo falls back to the detail', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events entrar tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    const cases = [
      { id: ids.ended, reason: 'encerrado', copy: E.enter.ended },
      { id: ids.cancelled, reason: 'cancelado', copy: E.enter.cancelled },
    ] as const;
    for (const { id, reason, copy } of cases) {
      const res = await follow(page, id);
      expect(res.status(), reason).toBe(303);
      expect(res.headers().location).toBe(`/eventos/${id}/entrar/aviso?motivo=${reason}`);
      expect(await attendanceFor(id, tenant.memberEmail)).toBeNull();
      await page.goto(`${tenant.origin}${res.headers().location}`);
      await expect(page.getByTestId('enter-notice')).toHaveAttribute('data-reason', reason);
      await expect(page.getByRole('heading', { name: copy.title })).toBeVisible();
      await expect(page.getByText(copy.body)).toBeVisible();
      await expectNoMeetingHost(page);
    }

    // The cancelled detail: the disabled Entrar, which is not a link.
    await page.goto(`${tenant.origin}/eventos/${ids.cancelled}`);
    await expect(enterLink(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(enterLink(page)).not.toHaveAttribute('href');
    await expectNoMeetingHost(page);

    // D-93: anything but one exact motivo is the detail, silently.
    for (const query of ['?motivo=xyz', '?motivo=encerrado&motivo=encerrado', '']) {
      await page.goto(`${tenant.origin}/eventos/${ids.ended}/entrar/aviso${query}`);
      await expect(page, query).toHaveURL(new RegExp(`/eventos/${ids.ended}$`));
    }

    // Not found: an unknown id and a malformed one land on the detail's not-found screen.
    const unknown = '0d000000-0000-4000-8000-00000000ffff';
    const miss = await follow(page, unknown);
    expect(miss.status()).toBe(303);
    expect(miss.headers().location).toBe(`/eventos/${unknown}`);
    const malformed = await follow(page, 'nao-e-um-id');
    expect(malformed.status()).toBe(303);
    expect(malformed.headers().location).toBe('/eventos/nao-e-um-id');

    // The list carries no meeting host either.
    await page.goto(`${tenant.origin}/eventos`);
    await expect(posters(page).first()).toBeVisible();
    await expectNoMeetingHost(page);
  });

  test('5. a logged-out calendar tap: /entrar bounces to login, and after signing in the member lands in the meeting, counted', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events entrar tenant was not provisioned');
    const context = await browser.newContext({
      ...devices['iPhone 14'],
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await page.goto(`${tenant.origin}${enterPath(ids.live)}`);
      await expect(page).toHaveURL(/\/entrar$/);
      expect(await attendanceFor(ids.live, calendarEmail)).toBeNull();

      // The meeting host never resolves, and Playwright routes only the FIRST url of a redirect
      // chain, so the proof is the browser's own navigation request to the stored URL (the 303's
      // Location), not a fulfilled page.
      const meeting = page.waitForRequest((request) => request.url() === `${MEETING}/agora`, {
        timeout: 20_000,
      });
      await page.locator('#email').fill(calendarEmail);
      await page.locator('#password').fill(tenant.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      const request = await meeting;
      expect(request.isNavigationRequest()).toBe(true);
      const hop = request.redirectedFrom();
      expect(hop ? new URL(hop.url()).pathname : '').toBe(enterPath(ids.live));

      expect(await attendanceFor(ids.live, calendarEmail)).toEqual({
        status: 'walk_in',
        checkinVia: 'online',
      });
    } finally {
      await context.close();
    }
  });
});

/**
 * EVENT-05 (06-07, D-215, UI-D-213): the organiser's `Participantes`, on the phone in a throwaway
 * tenant (`e2e-events-participantes`), serial.
 *
 * ONE in-person event inside its check-in window (`insertEvent`, relative to the database's `now()`).
 * Every answer goes through the MEMBER API (`eventsApiAs`: `PUT /rsvp`, `POST /check-in` with the real
 * code), so the guard trigger and `app.events_check_in` wrote them, exactly as a phone would:
 *  - Ana and Bruno answered Vou (Confirmados);
 *  - Carla answered Vou and checked in (Presentes, no tag);
 *  - Elisa never answered and checked in (Presentes, "Sem confirmação");
 *  - Davi answered Não vou (Não vão).
 * So the member-facing number is 3 confirmados (going + checked_in), the Confirmados chip is 2
 * (going only: Pitfall 11), and 2 are present. The tenant's own member answers nothing and is the
 * negative case.
 */
test.describe('events participantes', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-participantes';
  let tenant: EventsTenant | null = null;
  let eventId = '';

  /** "Confirmados · 2": the catalog string with its `{count, number}` filled. */
  const chipLabel = (message: string, n: number) => message.replace('{count, number}', String(n));

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    const people = {
      ana: await addEventsMember(tenant, 'ana', 'Ana Confirmada'),
      bruno: await addEventsMember(tenant, 'bruno', 'Bruno Confirmado'),
      carla: await addEventsMember(tenant, 'carla', 'Carla Presente'),
      davi: await addEventsMember(tenant, 'davi', 'Davi Recusou'),
      elisa: await addEventsMember(tenant, 'elisa', 'Elisa Sem Resposta'),
    };
    eventId = await insertEvent(tenant.tenantId, {
      title: 'Encontro com participantes',
      startsInMinutes: 30,
      endsInMinutes: 150,
    });
    const rsvp = (email: string, answer: 'going' | 'not_going') =>
      eventsApiAs(tenant as EventsTenant, email, `/v1/events/${eventId}/rsvp`, {
        method: 'PUT',
        body: { answer },
      });
    await rsvp(people.ana, 'going');
    await rsvp(people.bruno, 'going');
    await rsvp(people.carla, 'going');
    await rsvp(people.davi, 'not_going');
    const { checkinCode } = await secretsFor(eventId);
    for (const email of [people.carla, people.elisa]) {
      await eventsApiAs(tenant, email, `/v1/events/${eventId}/check-in`, {
        method: 'POST',
        body: { code: checkinCode },
      });
    }
    expect(await attendanceFor(eventId, people.elisa)).toEqual({
      status: 'walk_in',
      checkinVia: 'code',
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  test('1-4. the admin: the manage row, the code, the counted chips with the walk-in tag, and a new code', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events participantes tenant was not provisioned');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${eventId}`);

    // 1. The manage card's Participantes row, with the member-facing numbers from the detail read.
    const row = page.locator('[data-event-manage-participants]');
    await expect(row).toContainText(E.manage.participants);
    await expect(page.locator('[data-event-manage-participants-sub]')).toHaveText(
      `${count(E.count.confirmed, 3)} · ${count(E.count.present, 2)}`,
    );
    await row.dispatchEvent('click');
    await expect(page).toHaveURL(new RegExp(`/eventos/${eventId}/participantes$`));
    await expect(page.getByRole('heading', { level: 1, name: E.participants.title })).toBeVisible();

    // 2. The door code, first on the screen, is the stored one.
    const before = (await secretsFor(eventId)).checkinCode;
    await expect(page.getByTestId('checkin-code')).toHaveText(before);

    // 3. Three counted chips (Confirmados is `going` only), and one walk-in tag in Presentes.
    const chips = page
      .getByRole('navigation', { name: E.participants.filter.label })
      .getByRole('link');
    await expect(chips).toHaveText([
      chipLabel(E.participants.filter.confirmed, 2),
      chipLabel(E.participants.filter.present, 2),
      chipLabel(E.participants.filter.notGoing, 1),
    ]);
    await expect(page.getByTestId('attendee-row')).toHaveCount(2);
    await expect(page.getByTestId('walk-in-tag')).toHaveCount(0);
    await chips.nth(1).dispatchEvent('click');
    await expect(page).toHaveURL(
      new RegExp(`/eventos/${eventId}/participantes\\?lista=presentes$`),
    );
    await expect(chips.nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('attendee-row')).toHaveCount(2);
    const tags = page.getByTestId('walk-in-tag');
    await expect(tags).toHaveCount(1);
    await expect(tags).toHaveText(E.state.walkIn);
    await expect(
      page
        .getByTestId('attendee-row')
        .filter({ hasText: 'Elisa Sem Resposta' })
        .getByTestId('walk-in-tag'),
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId('attendee-row')
        .filter({ hasText: 'Carla Presente' })
        .getByTestId('walk-in-tag'),
    ).toHaveCount(0);
    await chips.nth(2).dispatchEvent('click');
    await expect(page).toHaveURL(new RegExp(`/eventos/${eventId}/participantes\\?lista=nao-vao$`));
    await expect(page.getByTestId('attendee-row')).toHaveCount(1);
    await expect(page.getByTestId('attendee-row')).toContainText('Davi Recusou');

    // 4. "Gerar novo código", confirmed: a different code is shown, and it is the stored one.
    // Tapped until React owns the button (a tap before hydration opens nothing).
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      await page.locator('[data-regenerate-code]').dispatchEvent('click');
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog).toContainText(E.confirm.regenerate.title);
    await dialog.getByRole('button', { name: E.confirm.regenerate.confirm }).click();
    await expect(page.getByText(E.toasts.codeRegenerated)).toBeVisible();
    await expect(page.getByTestId('checkin-code')).not.toHaveText(before);
    const after = (await secretsFor(eventId)).checkinCode;
    expect(after).not.toBe(before);
    await expect(page.getByTestId('checkin-code')).toHaveText(after);
  });

  test('5. a member has no manage section, and typing /participantes gives the not-found screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events participantes tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${eventId}`);
    await expect(page.getByRole('group', { name: E.rsvp.label })).toBeVisible();
    await expect(page.locator('[data-event-manage]')).toHaveCount(0);
    await expect(page.getByText(E.manage.title)).toHaveCount(0);

    await page.goto(`${tenant.origin}/eventos/${eventId}/participantes`);
    await expect(page.getByText(E.notFound.title, { exact: true })).toBeVisible();
    await expect(page.getByTestId('checkin-code')).toHaveCount(0);
    await expect(
      page.getByText((await secretsFor(eventId)).checkinCode, { exact: true }),
    ).toHaveCount(0);
  });
});

/**
 * 06-08 (EVENT-06, D-211, UI-D-210): the calendar pair on the detail page, and the `.ics` it downloads.
 * A throwaway events tenant, on the phone. The file is read from disk after the browser's own
 * download, so what is asserted is exactly what a calendar app would import.
 */
test.describe('events agenda', () => {
  test.describe.configure({ mode: 'serial' });

  const SLUG = 'e2e-events-agenda';
  const MEETING = 'https://meet.example.test/agenda-secreta';
  let tenant: EventsTenant | null = null;
  const ids = { inPerson: '', online: '', onlineLive: '', cancelled: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    ids.inPerson = await insertEvent(tenant.tenantId, {
      title: 'Encontro para a agenda',
      description: 'Traga um amigo.',
      venueName: 'Auditorio da sede',
      address: 'Rua das Flores, 100',
      startsInMinutes: 180,
      endsInMinutes: 300,
    });
    ids.online = await insertEvent(tenant.tenantId, {
      title: 'Live para a agenda',
      format: 'online',
      meetingUrl: MEETING,
      startsInMinutes: 180,
      endsInMinutes: 300,
    });
    // In its window: here following /entrar WOULD record a walk-in, so an export must not.
    ids.onlineLive = await insertEvent(tenant.tenantId, {
      title: 'Live na janela',
      format: 'online',
      meetingUrl: MEETING,
      startsInMinutes: 30,
      endsInMinutes: 150,
    });
    ids.cancelled = await insertEvent(tenant.tenantId, {
      title: 'Encontro cancelado',
      startsInMinutes: 180,
      endsInMinutes: 300,
      cancelled: true,
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chromium') return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  const pair = (page: Page) => page.getByTestId('event-calendar');
  const googleLink = (page: Page) => page.getByTestId('event-calendar-google');
  const icsLink = (page: Page) => page.getByTestId('event-calendar-ics');

  /** Taps "Arquivo .ics" and returns the downloaded file's text. */
  async function downloadIcs(page: Page): Promise<{ name: string; text: string }> {
    const [download] = await Promise.all([page.waitForEvent('download'), icsLink(page).click()]);
    const { readFile } = await import('node:fs/promises');
    const file = await download.path();
    return { name: download.suggestedFilename(), text: await readFile(file, 'utf8') };
  }

  /** RFC 5545 unfolding, then the logical lines. */
  const icsLines = (text: string) => text.replace(/\r\n /g, '').split('\r\n');

  /** Each anchor of the pair: its box, whether its label sits on ONE line, and any overflow. */
  async function measurePair(page: Page) {
    return pair(page)
      .locator('a')
      .evaluateAll((anchors) =>
        anchors.map((a) => {
          // The LABEL's lines only: the text nodes, never the icon's box.
          const tops = new Set<number>();
          for (const node of Array.from(a.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of Array.from(range.getClientRects())) {
              if (r.width > 0) tops.add(Math.round(r.top));
            }
          }
          const box = a.getBoundingClientRect();
          return {
            top: Math.round(box.top),
            width: Math.round(box.width),
            lines: tops.size,
            overflowX: a.scrollWidth > a.clientWidth,
            overflowY: a.scrollHeight > a.clientHeight,
          };
        }),
      );
  }

  test('1. in person: the pair reads "Adicionar à agenda", and the .ics has UTC times, the venue and CRLF lines', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events agenda tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.inPerson}`);

    await expect(pair(page).getByText(E.calendar.label, { exact: true })).toBeVisible();
    await expect(googleLink(page)).toHaveText(E.calendar.google);
    await expect(googleLink(page)).toHaveAttribute('target', '_blank');
    await expect(googleLink(page)).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(icsLink(page)).toHaveText(E.calendar.ics);
    await expect(icsLink(page)).toHaveAttribute('href', `/eventos/${ids.inPerson}/agenda.ics`);
    await expect(icsLink(page)).toHaveAttribute('download', '');

    // UI E06/long-text (06-08 deviation): at half width the labels wrapped at 390 and 320, so below
    // `sm` the pair stacks; each label then sits on ONE line with no overflow. From `sm` it is the
    // side-by-side row UI-D-210 draws.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const [google, ics] = await measurePair(page);
      expect(google, `google @${width}`).toMatchObject({
        lines: 1,
        overflowX: false,
        overflowY: false,
      });
      expect(ics, `ics @${width}`).toMatchObject({ lines: 1, overflowX: false, overflowY: false });
      expect(ics?.top ?? 0, `stacked @${width}`).toBeGreaterThan(google?.top ?? 0);
    }
    await page.setViewportSize({ width: 700, height: 844 });
    const [wideGoogle, wideIcs] = await measurePair(page);
    expect(wideGoogle).toMatchObject({ lines: 1, overflowX: false });
    expect(wideIcs).toMatchObject({ lines: 1, overflowX: false });
    expect(wideIcs?.top).toBe(wideGoogle?.top);
    await page.setViewportSize({ width: 390, height: 844 });

    const { name, text } = await downloadIcs(page);
    expect(name).toBe('evento.ics');
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = icsLines(text);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.find((line) => line.startsWith('DTSTART:'))).toMatch(/^DTSTART:\d{8}T\d{6}Z$/);
    expect(lines.find((line) => line.startsWith('DTEND:'))).toMatch(/^DTEND:\d{8}T\d{6}Z$/);
    expect(lines).toContain('SUMMARY:Encontro para a agenda');
    expect(lines).toContain('LOCATION:Auditorio da sede\\, Rua das Flores\\, 100');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines.find((line) => line.startsWith('UID:'))).toMatch(
      new RegExp(`^UID:${ids.inPerson}@`),
    );
  });

  test('2. online: the .ics and the Google link point at /entrar, never at the meeting host, and Google gets no ctz', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events agenda tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.online}`);

    const href = (await googleLink(page).getAttribute('href')) ?? '';
    const google = new URL(href);
    expect(google.host).toBe('calendar.google.com');
    expect(google.searchParams.get('action')).toBe('TEMPLATE');
    expect(google.searchParams.has('ctz')).toBe(false);
    expect(google.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
    expect(google.searchParams.get('location')).toMatch(
      new RegExp(`/eventos/${ids.online}/entrar$`),
    );
    expect(href).not.toContain('meet.example.test');
    expect(await page.content()).not.toContain('meet.example.test');

    const { text } = await downloadIcs(page);
    const location = icsLines(text).find((line) => line.startsWith('LOCATION:')) ?? '';
    expect(location).toMatch(new RegExp(`/eventos/${ids.online}/entrar$`));
    expect(text).not.toContain('meet.example.test');
  });

  test('3. EVENT-06 concurrency: three parallel downloads are three well-formed files and record nothing', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events agenda tenant was not provisioned');
    await eventsApiAs(tenant, tenant.memberEmail, `/v1/events/${ids.inPerson}/rsvp`, {
      method: 'PUT',
      body: { answer: 'going' },
    });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    const before = {
      inPerson: await attendanceFor(ids.inPerson, tenant.memberEmail),
      onlineLive: await attendanceFor(ids.onlineLive, tenant.memberEmail),
    };
    expect(before).toEqual({ inPerson: { status: 'going', checkinVia: null }, onlineLive: null });

    for (const id of [ids.inPerson, ids.onlineLive]) {
      const url = `${tenant.origin}/eventos/${id}/agenda.ics`;
      const answers = await Promise.all([1, 2, 3].map(() => page.request.get(url)));
      for (const res of answers) {
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toBe('text/calendar; charset=utf-8');
        expect(res.headers()['content-disposition']).toBe('attachment; filename="evento.ics"');
        expect(res.headers()['cache-control']).toContain('no-store');
        const text = await res.text();
        expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(text).not.toContain('meet.example.test');
      }
    }

    expect({
      inPerson: await attendanceFor(ids.inPerson, tenant.memberEmail),
      onlineLive: await attendanceFor(ids.onlineLive, tenant.memberEmail),
    }).toEqual(before);
  });

  test('4. a cancelled event has no calendar pair, and a malformed id is a 404', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'one throwaway tenant, on the phone');
    if (!tenant) throw new Error('the events agenda tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${ids.cancelled}`);
    await expect(page.getByTestId('event-banner')).toHaveAttribute('data-kind', 'cancelled');
    await expect(pair(page)).toHaveCount(0);
    await expect(page.getByText(E.calendar.label)).toHaveCount(0);

    const malformed = await page.request.get(`${tenant.origin}/eventos/nao-e-um-id/agenda.ics`);
    expect(malformed.status()).toBe(404);
  });
});
