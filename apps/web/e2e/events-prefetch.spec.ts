import { expect, test } from '@playwright/test';
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import {
  attendanceFor,
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsTenant,
  type EventsTenant,
  insertEvent,
} from './events-admin';
import { login, SEED_PASSWORD } from './fixtures';

/**
 * D-218 on a PRODUCTION build (06-06, Pitfall 6): rendering the detail of an in-window ONLINE event
 * records nothing. Next prefetches only in production ("Prefetching is only enabled in production"),
 * so a dev-server run cannot detect a regression — this spec runs through `playwright.pwa.config.ts`
 * (`next build && next start` on :3100) and self-skips unless `PWA_PROD=1`, so it can never pass
 * vacuously on the dev server.
 *
 * The negative: a member opens the detail with its `Entrar` anchor visible, the page settles
 * (`load`, `networkidle`), the anchor is hovered and 2 s pass. No request to any
 * `/eventos/{id}/entrar` was issued (captured on the CONTEXT, so service-worker traffic counts too)
 * and the member's attendance row is ABSENT. The positive control, same test: a real tap on `Entrar`
 * opens the meeting (a popup whose navigation request goes to the stored URL, redirected from
 * `/entrar`) and the row appears with `checkin_via = 'online'`, so the negative is not an artefact of a route that never records.
 *
 * One throwaway tenant, on ONE project (`iphone-chromium`): web and API cache host → tenant for 60 s,
 * so re-provisioning the same slug on the next project inside that window would point its session at
 * a deleted tenant.
 */
test.skip(
  process.env.PWA_PROD !== '1',
  'run with playwright.pwa.config.ts (production build): prefetching only exists in production',
);

const E = eventMessages.events;
const SLUG = 'e2e-events-prefetch';
const MEETING = 'https://meet.example.test';
const PROJECT = 'iphone-chromium';

test.describe('events entrar — a render records nothing (D-218, production build)', () => {
  test.describe.configure({ mode: 'serial' });

  let tenant: EventsTenant | null = null;
  let eventId = '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== PROJECT) return;
    tenant = await createEventsTenant(SLUG, SEED_PASSWORD);
    eventId = await insertEvent(tenant.tenantId, {
      title: 'Live pre-carregamento',
      format: 'online',
      meetingUrl: `${MEETING}/prefetch`,
      startsInMinutes: 30,
      endsInMinutes: 150,
    });
  });

  test.afterAll(async ({ browser: _browser }, testInfo) => {
    if (testInfo.project.name !== PROJECT) return;
    await deleteEventsTenant(SLUG);
    await closeEventsAdmin();
  });

  test('the detail renders, settles and is hovered with NO request to /entrar and no attendance; a real tap then records via online', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'one throwaway tenant, on one phone project');
    if (!tenant) throw new Error('the prefetch tenant was not provisioned');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    // From here on, every request of the context (pages and service worker alike) is captured.
    const enterRequest = /\/eventos\/[^/?#]+\/entrar(\?|$)/;
    const captured: string[] = [];
    context.on('request', (request) => {
      captured.push(request.url());
    });

    await page.goto(`${tenant.origin}/eventos/${eventId}`);
    const anchor = page.getByTestId('event-actions-enter');
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveText(E.online.enter);
    await expect(anchor).toHaveAttribute('href', `/eventos/${eventId}/entrar`);
    await expect(anchor).toHaveAttribute('data-no-prefetch', '');
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle');
    await anchor.hover();
    await page.waitForTimeout(2_000);

    const fired = captured.filter((url) => enterRequest.test(new URL(url).pathname));
    expect(fired, 'no render, viewport entry or hover may request /entrar').toEqual([]);
    expect(captured.length, 'the capture saw the page load').toBeGreaterThan(0);
    expect(await attendanceFor(eventId, tenant.memberEmail)).toBeNull();

    // Positive control: a human tap opens the meeting and IS the check-in. The meeting host never
    // resolves and Playwright routes only the first url of a redirect chain, so the proof is the
    // popup's navigation REQUEST to the stored URL, redirected from `/entrar`.
    const meeting = context.waitForEvent('request', {
      predicate: (request) => request.url() === `${MEETING}/prefetch`,
      timeout: 20_000,
    });
    const popup = context.waitForEvent('page');
    await anchor.click();
    const request = await meeting;
    expect(request.isNavigationRequest()).toBe(true);
    const hop = request.redirectedFrom();
    expect(hop ? new URL(hop.url()).pathname : '').toBe(`/eventos/${eventId}/entrar`);
    expect(await attendanceFor(eventId, tenant.memberEmail)).toEqual({
      status: 'walk_in',
      checkinVia: 'online',
    });
    expect(captured.some((url) => enterRequest.test(new URL(url).pathname))).toBe(true);
    await (await popup).close();
  });
});
