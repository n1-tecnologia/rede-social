import { devices, expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import { closeAdmin } from './admin';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import {
  addEventsMember,
  attendanceFor,
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsTenant,
  type EventsTenant,
  eventsApiAs,
  insertEvent,
  moveEventWindow,
  readEventInstants,
  secretsFor,
  setTenantTimezone,
} from './events-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/**
 * Phase 6 smoke (plan 06-09): the phase's witness, in the shape 02-16 established and 03-08, 04-10
 * and 05-08 repeated. One spec, real fixtures, the module flag witnessed in both directions, each
 * ROADMAP success criterion asserted once, and an explicit note wherever the walk deliberately
 * proves nothing.
 *
 *   ENABLED  on the seeded `rede-demo`: a member sees the `Eventos` tab, the Próximos list headed by
 *            the seeded in-progress event, that event's Início card in check-in mode, and an event
 *            detail whose date and times are the tenant's clock.
 *   DISABLED on a throwaway tenant with `events` off: the same member-shaped session sees no tab and
 *            no Início card, gets no error card on `/inicio`, and every events route answers
 *            404 `MODULE_DISABLED` (never 403: a member must not learn what the tenant did not buy).
 *   FLIP     the flag back on: the tab and the card return within the flags-cache window, with the
 *            event row untouched (a flag hides a product; it deletes nothing).
 *
 * Then the four ROADMAP Phase 6 criteria, one test each, on a second throwaway tenant: (1) an admin
 * creates, edits and cancels from the phone and a member sees it upcoming, cancelled and then past,
 * in the tenant zone; (2) an RSVP moves the count, an in-window code check-in lands, and a no-RSVP
 * check-in is a walk-in; (3) the admin's chips split confirmed from present; (4) the `.ics` and the
 * Google `TEMPLATE` link. And the timezone claim 06-09 closes: the seeded tenant switched to
 * `America/Manaus` reads a feed post's absolute time one hour earlier, restored in `finally`.
 *
 * PER-RUN hosts for the throwaway tenants (03-05's finding): the web tier and the API cache the
 * host → tenant mapping for about a minute, so a reused host can point a fresh session at a tenant
 * that was just deleted. `serviceWorkers: 'block'` (the 03-05 lesson): a Serwist worker answering a
 * navigation from its cache would have these assertions reading what a previous run left behind.
 * Every throwaway tenant, its events and its GoTrue users go in `afterAll`.
 *
 * **What this spec deliberately does not prove**, carried to the phase UAT (`06-VALIDATION.md`
 * §Manual-Only Verifications) rather than counted as passing: anything on a real phone (the RSVP
 * pair, the form, the ticket at 320px on hardware), the `.ics` imported by iOS Calendar, the Google
 * link opened on a real Google account, the installed PWA's cookie jar on the online `Entrar`
 * hand-off, and whether `support_tenant` needs the door code. All of it waits on the deferred cloud
 * phase 01.1. The production-build prefetch proof (`/entrar` records nothing on a prefetch) is
 * `events-prefetch.spec.ts`, run by `e2e:pwa`, not here.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded rede-demo, throwaway tenants, direct DB fixtures)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const E = eventMessages.events;
const APP = appMessages.app;

/** Per-run slugs AND hosts; `tenant-fixtures` bounds a slug at 40 characters. */
const RUN = Date.now().toString(36);
const OFF_SLUG = `p6off-${RUN}`;
const CRIT_SLUG = `p6crit-${RUN}`;
const PHONE = 'mobile-chromium';

/** What `scripts/seed.ts` writes for rede-demo (`SEED_EVENTS`), mirrored as `events.spec.ts` does. */
const SEEDED = {
  inProgress: 'Semana de integracao',
  upcomingInPerson: 'Encontro de boas-vindas',
} as const;

const SAO_PAULO = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';

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

/** `12/10/2026, 19:00`: the feed card's absolute title, `absoluteTimeFormatter` in `feed-view`. */
const absolute = (epochMs: number, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));

/** `YYYY-MM-DD` of the São Paulo day `days` from now (the `en-CA` trick), for the form's date. */
const tenantDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));

/** The ICU plural's `one`/`other` branch with `#` filled ("1 confirmado", "2 presentes"). */
const plural = (message: string, n: number) => {
  const branch = n === 1 ? 'one' : 'other';
  const text = new RegExp(`${branch} \\{([^}]*)\\}`).exec(message)?.[1] ?? '';
  return text.replace('#', String(n));
};

/** "Confirmados · 2": a participants chip label with its `{count, number}` filled. */
const chipLabel = (message: string, n: number) => message.replace('{count, number}', String(n));

/** Escapes a literal for a `RegExp`. */
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The visible navigation (bottom on the phone, rail on the desktop). */
function visibleNav(page: Page): Locator {
  return page.locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible');
}

async function navLabels(page: Page): Promise<string[]> {
  return visibleNav(page)
    .locator('a')
    .evaluateAll((links) =>
      links.map((a) => a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''),
    );
}

const posterFor = (page: Page, title: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(`^${literal(title)}, `) });
const nextEvent = (page: Page) => page.getByTestId('next-event');
const infoValues = (page: Page) => page.getByTestId('event-info-value');
const toast = (page: Page, message: string) =>
  page.getByRole('status').filter({ hasText: message });

/** `{ status, code }` of one API call, so a 403 can never be read as a 404 by accident. */
async function answer(api: ApiFetch, path: string, host: string) {
  const res = await api(path, {}, host);
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

/** A second phone session (the member watching the admin's work). */
async function phoneContext(page: Page) {
  const browser = page.context().browser();
  if (!browser) throw new Error('no browser behind the page');
  return browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
}

let off: EventsTenant | null = null;
let offApi: ApiFetch | null = null;
let offEventId = '';
let offEventBefore: { id: string; startsAt: string; endsAt: string } | null = null;

let crit: EventsTenant | null = null;
const people = { walkIn: '', confirmed: '', notGoing: '' };
let liveEventId = '';

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  if (testInfo.project.name !== PHONE) return;

  // The DISABLED/FLIP tenant: provisioned with `events` AND `feed` on, one member and one event in
  // its check-in window, so the witnesses are a tenant that demonstrably HAD the module and a card.
  off = await createEventsTenant(OFF_SLUG, SEED_PASSWORD, ['feed']);
  offEventId = await insertEvent(off.tenantId, {
    title: 'Encontro do smoke',
    startsInMinutes: 30,
    endsInMinutes: 150,
  });
  offEventBefore = await readEventInstants(OFF_SLUG, 'Encontro do smoke');
  offApi = await apiSession(off.memberEmail, SEED_PASSWORD);

  // The criteria tenant: the admin's own events, plus one in its window with four members around it.
  crit = await createEventsTenant(CRIT_SLUG, SEED_PASSWORD);
  people.walkIn = await addEventsMember(crit, 'sem.resposta', 'Membro Sem Resposta');
  people.confirmed = await addEventsMember(crit, 'confirmado', 'Membro Confirmado');
  people.notGoing = await addEventsMember(crit, 'nao.vai', 'Membro Nao Vai');
  liveEventId = await insertEvent(crit.tenantId, {
    title: 'Encontro com check-in do smoke',
    startsInMinutes: 30,
    endsInMinutes: 150,
  });
  const rsvp = (email: string, value: 'going' | 'not_going') =>
    eventsApiAs(crit as EventsTenant, email, `/v1/events/${liveEventId}/rsvp`, {
      method: 'PUT',
      body: { answer: value },
    });
  await rsvp(people.confirmed, 'going');
  await rsvp(people.notGoing, 'not_going');
});

test.afterAll(async ({ browser: _browser }, testInfo) => {
  if (testInfo.project.name === PHONE) {
    await deleteEventsTenant(OFF_SLUG);
    await deleteEventsTenant(CRIT_SLUG);
  }
  await closeEventsAdmin();
  await closeTenantFixtures();
  await closeDomainsAdmin();
  await closeAdmin();
});

test.describe('Phase 6 smoke — events, in both directions of its flag, and the four criteria', () => {
  test('1. ENABLED: the Eventos tab, Próximos headed by the in-progress event, its Início card in check-in mode, and a detail on the tenant clock', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // D-55: the tab exists because the module's manifest declares it.
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']);

    // D-202: the seeded in-progress in-person event is the next event, and the member (no answer,
    // inside its window) gets the check-in CTA on the card, beside the row and not inside it.
    const inProgress = await readEventInstants('rede-demo', SEEDED.inProgress);
    await expect(page.getByRole('heading', { name: E.home.title, exact: true })).toBeVisible();
    await expect(nextEvent(page).getByTestId('next-event-title')).toHaveText(SEEDED.inProgress);
    await expect(page.getByTestId('next-event-checkin')).toHaveAttribute(
      'href',
      `/eventos/${inProgress.id}/check-in`,
    );
    await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);

    // The tab, tapped. Dispatched AT the element: under `next dev` the issues pill (`<nextjs-portal>`)
    // sits over the phone's BottomNav and intercepts a coordinate click (06-01 deviation 8).
    await visibleNav(page).getByRole('link', { name: E.nav, exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/eventos$/);
    await expect(
      page.getByRole('navigation', { name: E.list.filter.label }).getByRole('link', {
        name: E.list.filter.upcoming,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.locator('main').getByTestId('event-poster').first().getByTestId('event-poster-title'),
    ).toHaveText(SEEDED.inProgress);

    // A detail on the tenant's clock (UI-D-203): the stored UTC instants, formatted in São Paulo.
    const upcoming = await readEventInstants('rede-demo', SEEDED.upcomingInPerson);
    await page.goto(`${hosts.demo}/eventos/${upcoming.id}`);
    await expect(infoValues(page).nth(0)).toHaveText(day(upcoming.startsAt, SAO_PAULO));
    await expect(infoValues(page).nth(1)).toHaveText(
      E.info.timeRange
        .replace('{start}', clock(upcoming.startsAt, SAO_PAULO))
        .replace('{end}', clock(upcoming.endsAt, SAO_PAULO)),
    );
  });

  test('2. DISABLED: no Eventos tab, no Início card, no error card, and every events route answers 404 MODULE_DISABLED', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    const tenant = off;
    const api = offApi;
    if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
    const host = new URL(tenant.origin).hostname;

    await setTenantModuleFlag(tenant.slug, 'events', false);
    await expect
      .poll(async () => (await answer(api, '/v1/events', host)).status, { timeout: 35_000 })
      .toBe(404);

    await login(page, tenant.memberEmail, SEED_PASSWORD, tenant.origin);
    // The page renders and the module simply is not there. NOT an error card: a module a tenant did
    // not buy is an absence, never a failure (UI E04). The feed below still renders its region.
    await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
    expect(await navLabels(page)).not.toContain(E.nav);
    await expect(nextEvent(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: E.home.title, exact: true })).toHaveCount(0);

    // 404 MODULE_DISABLED on every route a member could reach. A 403 anywhere here would tell a
    // member the feature exists and is being withheld.
    for (const path of ['/v1/events', '/v1/events/next', `/v1/events/${offEventId}`]) {
      expect(await answer(api, path, host), path).toEqual({
        status: 404,
        code: 'MODULE_DISABLED',
      });
    }
  });

  test('3. the flag flips ON: the tab and the card return within the cache window, and the event row is untouched', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    const tenant = off;
    const api = offApi;
    if (!tenant || !api || !offEventBefore) {
      throw new Error('the throwaway tenant fixture did not initialise');
    }
    const host = new URL(tenant.origin).hostname;

    const flippedAt = Date.now();
    await setTenantModuleFlag(tenant.slug, 'events', true);
    // MODULE_FLAGS_TTL_MS is 30 s: the ceiling is bounded and the OBSERVED delay is annotated,
    // while the assertion stays exact (200, not "not 404").
    await expect
      .poll(async () => (await answer(api, '/v1/events', host)).status, { timeout: 35_000 })
      .toBe(200);
    test.info().annotations.push({
      type: 'flags-cache',
      description: `events flag visible to the API after ${Date.now() - flippedAt} ms (ceiling 35 s, MODULE_FLAGS_TTL_MS 30 s)`,
    });

    await login(page, tenant.memberEmail, SEED_PASSWORD, tenant.origin);
    expect(await navLabels(page)).toContain(E.nav);
    await expect(nextEvent(page).getByTestId('next-event-title')).toHaveText('Encontro do smoke');
    await expect(page.getByTestId('next-event-checkin')).toBeVisible();
    await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);

    // The row survived both flips exactly as it was written.
    expect(await readEventInstants(OFF_SLUG, 'Encontro do smoke')).toEqual(offEventBefore);
    const list = (await (await api('/v1/events', {}, host)).json()) as {
      items: { id: string }[];
    };
    expect(list.items.map((item) => item.id)).toContain(offEventId);
  });

  test('4. criterion 1: an admin creates, edits and cancels from the phone; a member sees it upcoming, cancelled and then past, on the tenant clock', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    if (!crit) throw new Error('the criteria tenant was not provisioned');
    const tenant = crit;
    const TITLE = 'Encontro criado no smoke';
    const RENAMED = 'Encontro criado no smoke renomeado';
    const submit = page.locator('[data-event-submit]');
    const segment = (label: string) =>
      page.getByRole('group', { name: E.form.format.label }).getByRole('button', { name: label });

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos`);
    await page.locator('[data-events-create]').click();
    await expect(page).toHaveURL(/\/eventos\/novo$/);
    // Hydration proof before typing: the segmented toggle flips under React's control.
    await segment(E.form.format.online).click();
    await segment(E.form.format.inPerson).click();
    await expect(segment(E.form.format.inPerson)).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#event-title').fill(TITLE);
    await page.locator('#event-start-date').fill(tenantDate(7));
    await page.locator('#event-start-time').fill('19:00');
    await expect(page.locator('#event-end-time')).toHaveValue('21:00');
    await page.locator('#event-venue').fill('Auditorio da sede');
    await page.locator('#event-address').fill('Rua das Flores, 100');
    await submit.click();
    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(toast(page, E.toasts.created)).toBeVisible();
    const eventId = page.url().split('/eventos/')[1]?.split(/[/?#]/)[0] ?? '';

    // The wall clock the admin typed is stored as the UTC instant of 19:00 in the tenant zone.
    const created = await readEventInstants(CRIT_SLUG, TITLE);
    expect(created.id).toBe(eventId);
    expect(clock(created.startsAt, SAO_PAULO)).toBe('19:00');

    const memberContext = await phoneContext(page);
    const member = await memberContext.newPage();
    try {
      // Upcoming: in Próximos, and the detail on the tenant clock.
      await login(member, tenant.memberEmail, tenant.password, tenant.origin);
      await member.goto(`${tenant.origin}/eventos`);
      await posterFor(member, TITLE).click();
      await expect(member).toHaveURL(new RegExp(`/eventos/${eventId}$`));
      await expect(infoValues(member).nth(0)).toHaveText(day(created.startsAt, SAO_PAULO));
      await expect(infoValues(member).nth(1)).toHaveText(
        E.info.timeRange.replace('{start}', '19:00').replace('{end}', '21:00'),
      );

      // Edit: a rename from the phone.
      await page.goto(`${tenant.origin}/eventos/${eventId}/editar`);
      await expect(page.locator('#event-start-time')).toHaveValue('19:00');
      await segment(E.form.format.online).click();
      await segment(E.form.format.inPerson).click();
      await expect(segment(E.form.format.inPerson)).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#event-title').fill(RENAMED);
      await submit.click();
      await expect(page).toHaveURL(new RegExp(`/eventos/${eventId}$`), { timeout: 30_000 });
      await expect(toast(page, E.toasts.saved)).toBeVisible();

      // Cancel: from the form's bottom row, confirmed (UI-D-211).
      await page.goto(`${tenant.origin}/eventos/${eventId}/editar`);
      await expect(segment(E.form.format.inPerson)).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-event-cancel]').dispatchEvent('click');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(E.confirm.cancel.title);
      await dialog.getByRole('button', { name: E.confirm.cancel.confirm }).click();
      await expect(page).toHaveURL(new RegExp(`/eventos/${eventId}$`), { timeout: 30_000 });
      await expect(toast(page, E.toasts.cancelled)).toBeVisible();

      // D-201: the member still sees it in Próximos, renamed and marked Cancelado.
      await member.goto(`${tenant.origin}/eventos`);
      await expect(posterFor(member, RENAMED).getByTestId('event-poster-pill')).toHaveText(
        E.state.cancelled,
      );

      // Over time: the event ends (moved to the past through the database's clock), and the
      // member's Passados lists it.
      await moveEventWindow(eventId, -180, -60);
      await member.goto(`${tenant.origin}/eventos?periodo=passados`);
      await expect(posterFor(member, RENAMED)).toBeVisible();
      await member.goto(`${tenant.origin}/eventos`);
      await expect(posterFor(member, RENAMED)).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });

  test('5. criterion 2: Vou moves the count, the in-window code check-in lands, and a no-RSVP check-in is a walk-in', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    if (!crit || !liveEventId) throw new Error('the criteria tenant was not provisioned');
    const tenant = crit;
    const { checkinCode } = await secretsFor(liveEventId);
    const codeField = page.getByLabel(E.checkin.codeLabel);
    const confirm = page.getByRole('button', { name: E.checkin.submit });

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${liveEventId}`);
    // One member answered Vou (the fixture); this member's Vou makes it two.
    await expect(infoValues(page).nth(3)).toHaveText(plural(E.count.confirmed, 1));
    const vou = page
      .getByRole('group', { name: E.rsvp.label })
      .getByRole('button', { name: E.rsvp.going, exact: true });
    await vou.dispatchEvent('click');
    await expect(vou).toHaveAttribute('aria-pressed', 'true');
    await expect(infoValues(page).nth(3)).toHaveText(plural(E.count.confirmed, 2));

    // Inside the window: the CTA opens the ticket and the organiser's code checks the member in.
    await page.getByRole('link', { name: E.checkin.cta }).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${liveEventId}/check-in$`));
    await expect(async () => {
      await codeField.fill(checkinCode);
      await expect(confirm).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await confirm.click();
    await expect(page.getByRole('heading', { name: E.checkin.doneTitle })).toBeVisible();
    expect(await attendanceFor(liveEventId, tenant.memberEmail)).toEqual({
      status: 'checked_in',
      checkinVia: 'code',
    });

    // A member who never answered checks in with the same code, through the member route, and is
    // recorded as a walk-in (D-216).
    await eventsApiAs(tenant, people.walkIn, `/v1/events/${liveEventId}/check-in`, {
      method: 'POST',
      body: { code: checkinCode },
    });
    expect(await attendanceFor(liveEventId, people.walkIn)).toEqual({
      status: 'walk_in',
      checkinVia: 'code',
    });
  });

  test('6. criterion 3: the admin sees confirmed apart from present, with the walk-in tagged', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    if (!crit || !liveEventId) throw new Error('the criteria tenant was not provisioned');
    const tenant = crit;

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${liveEventId}/participantes`);
    await expect(page.getByRole('heading', { level: 1, name: E.participants.title })).toBeVisible();

    // Confirmados counts `going` only (the one who said Vou and has not arrived); Presentes counts
    // the checked-in member AND the walk-in; Não vão the one refusal.
    const chips = page
      .getByRole('navigation', { name: E.participants.filter.label })
      .getByRole('link');
    await expect(chips).toHaveText([
      chipLabel(E.participants.filter.confirmed, 1),
      chipLabel(E.participants.filter.present, 2),
      chipLabel(E.participants.filter.notGoing, 1),
    ]);
    await expect(page.getByTestId('attendee-row')).toHaveCount(1);
    await expect(page.getByTestId('attendee-row')).toContainText('Membro Confirmado');

    await chips.nth(1).dispatchEvent('click');
    await expect(page).toHaveURL(
      new RegExp(`/eventos/${liveEventId}/participantes\\?lista=presentes$`),
    );
    await expect(page.getByTestId('attendee-row')).toHaveCount(2);
    await expect(
      page
        .getByTestId('attendee-row')
        .filter({ hasText: 'Membro Sem Resposta' })
        .getByTestId('walk-in-tag'),
    ).toHaveText(E.state.walkIn);
    await expect(
      page
        .getByTestId('attendee-row')
        .filter({ hasText: 'Membro Eventos' })
        .getByTestId('walk-in-tag'),
    ).toHaveCount(0);
  });

  test('7. criterion 4: the member gets an .ics file and a Google Calendar TEMPLATE link', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'one throwaway tenant, on the phone');
    if (!crit || !liveEventId) throw new Error('the criteria tenant was not provisioned');
    const tenant = crit;

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/eventos/${liveEventId}`);

    const google = new URL(
      (await page.getByTestId('event-calendar-google').getAttribute('href')) ?? '',
    );
    expect(google.host).toBe('calendar.google.com');
    expect(google.searchParams.get('action')).toBe('TEMPLATE');
    expect(google.searchParams.get('text')).toBe('Encontro com check-in do smoke');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('event-calendar-ics').click(),
    ]);
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(await download.path(), 'utf8');
    expect(download.suggestedFilename()).toBe('evento.ics');
    const lines = text.replace(/\r\n /g, '').split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('SUMMARY:Encontro com check-in do smoke');
    expect(lines.find((line) => line.startsWith('UID:'))).toMatch(
      new RegExp(`^UID:${liveEventId}@`),
    );
  });

  test('8. the tenant clock reaches the feed: rede-demo switched to America/Manaus reads a post one hour earlier', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE, 'flips the seeded tenant: one project only');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The first feed card's `<time>`: the ISO instant and its absolute title in São Paulo.
    const first = page.locator('main').getByRole('article').first().locator('time[datetime]');
    await expect(first).toHaveCount(1);
    const iso = (await first.getAttribute('datetime')) ?? '';
    const instant = Date.parse(iso);
    expect(Number.isNaN(instant)).toBe(false);
    await expect(first).toHaveAttribute('title', absolute(instant, SAO_PAULO));

    const previous = await setTenantTimezone('rede-demo', MANAUS);
    try {
      await page.reload();
      const same = page.locator(`main time[datetime="${iso}"]`).first();
      // Manaus is UTC-4, São Paulo UTC-3: the same instant reads one hour earlier, which is exactly
      // what São Paulo would have printed an hour before it.
      await expect(same).toHaveAttribute('title', absolute(instant, MANAUS));
      expect(absolute(instant, MANAUS)).toBe(absolute(instant - 3_600_000, SAO_PAULO));
    } finally {
      await setTenantTimezone('rede-demo', previous);
    }
    await page.reload();
    await expect(page.locator(`main time[datetime="${iso}"]`).first()).toHaveAttribute(
      'title',
      absolute(instant, SAO_PAULO),
    );
  });
});
