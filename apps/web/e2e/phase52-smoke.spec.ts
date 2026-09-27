import { fileURLToPath } from 'node:url';
import {
  type BrowserContextOptions,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import { STORY_MAX_PAGE_SIZE } from '@tria/module-stories/contracts';
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import {
  closeAdmin,
  deleteHighlightsByTitlePrefix,
  deleteStoriesByCaptionPrefix,
  envValue,
  hasStoryView,
  memberVisibleHighlightStoryIds,
  memberVisibleStoryIds,
  setStoryViews,
} from './admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 05.2 smoke (plan 05.2-12) — the developer's own six-step UAT (05.2-CONTEXT `<specifics>`)
 * replayed end to end in ONE spec, the way 05.1-05's replay closed 05.1 and 05-08's smoke closed
 * Phase 5. Each numbered step is its own `test`, in declaration order, run serially: a later step
 * builds on what an earlier one left (the highlights step 1 creates are what steps 3 and 4 curate,
 * and the photo step 2 publishes is one of the two unseen stories step 6 watches).
 *
 *   1. an admin creates an Início highlight and a community highlight from their MANAGE screens,
 *      reached through the "Gerenciar" circles (never through the API);
 *   2. publishing from that community's `+` arrives pre-filled with its FIRST highlight and lands on
 *      the community page, the story in it;
 *   3. the seeded EXPIRED story goes into one highlight from "Seus stories" and into the other from
 *      the viewer's "Destacar" — and plays from both;
 *   4. the admin reorders Início with the KEYBOARD and re-covers the highlight with a story frame;
 *      a reload of `/inicio` shows the new order and the new cover;
 *   5. a member finds the migrated `Destaques` (the retired pins, 05.2-01/11) still holding the seeded
 *      pinned stories, the expired one playing first;
 *   6. a member watches part of the tenant circle, leaves, reopens at the first unseen story, watches
 *      the rest and the ring turns neutral with no reload — then the SAME account in a SECOND browser
 *      context (a second device: separate cookies, separate storage) sees the neutral ring on load.
 *
 * **Run-scoped fixtures, swept both ways (T-05.2-56).** Every highlight this file creates is titled
 * `Teste Um {run}` / `Teste Dois {run}` (15 characters at most — the title cap) and every story it
 * publishes carries `CAPTION_PREFIX`; `beforeAll` and `afterAll` both remove them, put Início's seeded
 * order back dense and restore the seed's seen state, so the shared seed is left exactly as found and
 * a crashed run cannot leak into the next.
 *
 * **Image stories only.** The fake video provider never reports a playable video (05.2-10, R-D-I), so
 * a video segment can never be SHOWN here and would never be recorded as seen. Step 6 therefore pins
 * everything but the two newest IMAGE stories as already seen and watches those two; the seeded video
 * is part of the pinned prefix, not of the walk. A story watched through the deep link
 * `/stories/{id}` is not recorded as seen (only the row's viewer owns the write buffer) — known and
 * out of scope, so this walk opens the viewer from the row every time.
 *
 * **What this spec deliberately does not prove**, carried to the phone UAT at `/gsd-verify-work`:
 * reordering by DRAGGING the handle on a touch screen (the page must not scroll while dragging, a
 * swipe on the row body must), an UPLOADED cover image, and the cross-device ring on two physical
 * phones with an installed PWA (blocked on the deferred cloud phase 01.1).
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.skip(isRemote, 'local stack only (seeded tria-demo, direct DB fixtures, a local worker)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const S = storyMessages.stories;
const H = S.highlights;
const C = communityMessages.communities;

/**
 * Per-run tag: four base-36 characters of the clock, so `Teste Dois {run}` is exactly 15 characters —
 * the title cap — and a second project (a second worker) gets its own titles.
 */
const RUN = Date.now().toString(36).slice(-4);
const HOME_TITLE = `Teste Um ${RUN}`;
const COMMUNITY_TITLE = `Teste Dois ${RUN}`;
const TITLE_PREFIXES = ['Teste Um ', 'Teste Dois '] as const;
/** Every story this file publishes starts with this, so the sweep is exact. */
const CAPTION_PREFIX = 'Smoke 05.2';
const CAPTION = `${CAPTION_PREFIX} ${RUN} — publicado no destaque da comunidade`;

/**
 * What `scripts/seed.ts` writes for the demo tenant, mirrored rather than imported — the seed is a
 * top-level-await script that requires `SEED_PASSWORD` and opens a database connection at import.
 */
const SEEDED = {
  tenantName: 'TRIA Demo',
  /** `SEED_COMMUNITY_IDS['tria-demo'][0]` — community[0], home of the seeded `Destaques`. */
  communityId: '0d000000-0000-4000-8000-0000000000c1',
  communityName: 'Avisos da diretoria',
  /** `SEED_HIGHLIGHT_IDS['tria-demo']` and `SEED_HIGHLIGHT_TITLES`. */
  bastidoresId: '0d000000-0000-4000-8000-0000000002a1',
  aulasId: '0d000000-0000-4000-8000-0000000002a2',
  destaquesId: '0d000000-0000-4000-8000-0000000002a3',
  bastidores: 'Bastidores',
  aulas: 'Aulas',
  destaques: 'Destaques',
  /** `SEED_STORIES[3]`: the EXPIRED image (30 h old), in `Bastidores` AND the migrated `Destaques`. */
  expiredStoryId: '0d000000-0000-4000-8000-0000000000d4',
  expiredCaption: 'Publicado ontem, ja fora da regua.',
  /** `SEED_STORIES[1]`: the seeded story VIDEO, the migrated `Destaques`' second pinned story. */
  videoStoryId: '0d000000-0000-4000-8000-0000000000d2',
  /** `SEED_STORIES[0]` (newest image) and `[2]` (oldest active image). */
  newestActiveStoryId: '0d000000-0000-4000-8000-0000000000d1',
  oldestActiveStoryId: '0d000000-0000-4000-8000-0000000000d3',
} as const;

/** `SEED_STORY_VIEW_IDS` (05.2-10): what each demo login has seen on a fresh seed. */
const SEED_SEEN = {
  member: [SEEDED.oldestActiveStoryId],
  admin: [SEEDED.newestActiveStoryId, SEEDED.videoStoryId, SEEDED.oldestActiveStoryId],
} as const;

/** A REAL photo (a synthesised 1x1 PNG fails the worker's sharp decode — 05-05). */
const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
const DEMO_HOST = new URL(hosts.demo).hostname;

/** Learned as the walk goes: step 2's story, and the asset behind the expired story's frame. */
const state = { publishedStoryId: '', publishedAssetId: '', expiredAssetId: '' };

/** A real GoTrue session for a seeded user (Node side, no browser). */
async function sessionToken(email: string): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  if (!res.ok) throw new Error(`${email} sign-in failed: ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

function storiesApi(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': DEMO_HOST,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

interface StoryItem {
  id: string;
  caption: string;
  mediaAssetId: string;
  mediaKind: string;
  viewerSeen?: boolean;
}

/** One highlight's detail read (`GET /v1/stories/highlights/{id}`), as `email` sees it. */
async function highlightItems(email: string, highlightId: string): Promise<StoryItem[]> {
  const res = await storiesApi(await sessionToken(email), `/v1/stories/highlights/${highlightId}`);
  expect(res.status, `the highlight ${highlightId} is readable`).toBe(200);
  return ((await res.json()) as { items: StoryItem[] }).items;
}

/** The demo tenant's highlight catalogue (every place, curator read). */
async function catalog(): Promise<{ id: string; title: string; communityId: string | null }[]> {
  const res = await storiesApi(
    await sessionToken(users.demoAdmin),
    '/v1/stories/highlights/catalog',
  );
  expect(res.status, 'the catalogue is readable').toBe(200);
  return (
    (await res.json()) as { items: { id: string; title: string; communityId: string | null }[] }
  ).items;
}

/**
 * Removes every highlight and story this file creates, puts Início's seeded order back dense and
 * the seed's seen state back. Idempotent: safe before the walk (a crashed run) and after it.
 */
async function sweep(): Promise<void> {
  for (const prefix of TITLE_PREFIXES) await deleteHighlightsByTitlePrefix('tria-demo', prefix);
  await deleteStoriesByCaptionPrefix(CAPTION_PREFIX);
  const order = await storiesApi(
    await sessionToken(users.demoAdmin),
    '/v1/stories/highlights/order',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightIds: [SEEDED.bastidoresId, SEEDED.aulasId] }),
    },
  );
  expect(order.status, 'Início’s seeded order was put back').toBeLessThan(300);
  await setStoryViews(users.demoMember, 'tria-demo', SEED_SEEN.member);
  await setStoryViews(users.demoAdmin, 'tria-demo', SEED_SEEN.admin);
}

let stopWorker: (() => Promise<void>) | null = null;

test.beforeAll(async () => {
  // The variant worker readies step 2's photo; without it the story never reaches the row.
  stopWorker = await ensureWorker();
  await sweep();
});

test.afterAll(async () => {
  await stopWorker?.();
  await sweep();
  await closeAdmin();
});

/* ── Locators ─────────────────────────────────────────────────────────────────────────────────── */

const strip = (page: Page) => page.getByRole('list', { name: S.region });
const communityRow = (page: Page) => page.getByRole('list', { name: C.page.highlights });
const viewerOf = (page: Page) => page.getByRole('dialog', { name: S.viewer.dialog });
const highlightName = (title: string) => S.circle.highlight.replace('{title}', title);
const tenantCircleName = (unseen: boolean) =>
  (unseen ? S.circle.tenantUnseen : S.circle.tenant).replace('{tenant}', SEEDED.tenantName);
/** The tenant circle by its EXACT accessible name — the seen state is carried in the name. */
const tenantCircle = (page: Page, unseen: boolean) =>
  strip(page).getByRole('button', { name: tenantCircleName(unseen), exact: true });
const manageList = (page: Page) => page.getByRole('list', { name: H.manage.region });
const editSheet = (page: Page) => page.getByRole('dialog', { name: H.edit.title });
const switchName = (title: string, place: string) =>
  H.sheet.row.replace('{title}', title).replace('{place}', place);

/** A name that STARTS with a catalog template's text before its first placeholder. */
const startsWith = (template: string) =>
  new RegExp(`^${(template.split('{')[0] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** The manage list's highlight titles, in order, read off the "Editar destaque {title}" buttons. */
async function manageOrder(page: Page): Promise<string[]> {
  const prefix = H.manage.edit.split('{')[0] ?? '';
  const names = await manageList(page)
    .getByRole('button', { name: startsWith(H.manage.edit) })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  return names.map((name) => name.slice(prefix.length));
}

/**
 * The `/inicio` row's accessible names, in DOM order — the only honest reading of "the row's order"
 * (every circle is one control with one name, UI-D-61).
 */
async function rowNames(page: Page): Promise<string[]> {
  return strip(page)
    .locator('a[aria-label], button[aria-label]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
}

/** Creates a highlight on a manage screen already open, and closes the edit sheet it opens. */
async function createOnManageScreen(page: Page, title: string, place: string): Promise<void> {
  await page.getByRole('button', { name: H.manage.create }).click();
  const createSheet = page.getByRole('dialog', { name: H.create.title });
  await expect(createSheet.getByText(H.create.place.replace('{place}', place))).toBeVisible();
  await createSheet.getByLabel(H.create.label).fill(title);
  await createSheet.getByRole('button', { name: H.create.submit }).click();
  await expect(page.getByText(H.toasts.created)).toBeVisible();
  // UI-D-72: the new highlight's edit sheet opens on it, empty — the admin sees what they made.
  const sheet = editSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel(H.edit.name)).toHaveValue(title);
  await expect(sheet.getByText(H.edit.emptyTitle)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
}

/** Opens a highlight circle's viewer and asserts it plays the EXPIRED story as its first segment. */
async function expectExpiredPlaysFirst(page: Page, circle: Locator): Promise<void> {
  await circle.click();
  const viewer = viewerOf(page);
  await expect(viewer).toBeVisible();
  // D-103: oldest first by publish time, so the 30-hour-old story is segment 0 — the item row is
  // the expiry override (STORY-04 re-delivered through a highlight).
  await expect(viewer).toHaveAttribute('data-story-index', '0');
  await expect(page.getByTestId('story-caption')).toHaveText(SEEDED.expiredCaption);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
}

/**
 * Waits until the current segment has been SHOWN — current AND its image decoded, which is when the
 * clock starts and the view is recorded (D-105) — by reading the width the clock writes.
 */
async function waitUntilShown(page: Page, index: number): Promise<void> {
  await expect
    .poll(async () => (await page.getByTestId(`story-fill-${index}`).boundingBox())?.width ?? -1, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

test.describe('Phase 05.2 smoke — the UAT replay (CONTEXT <specifics>)', () => {
  test('1. an admin creates an Início highlight and a community highlight from their manage screens', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    // Início: the row's trailing "Gerenciar" circle is the door (D-109).
    await strip(page).getByRole('link', { name: H.circle.actionHome }).click();
    await expect(page).toHaveURL(/\/stories\/destaques$/);
    await expect(page.getByRole('heading', { name: H.manage.titleHome, level: 1 })).toBeVisible();
    await createOnManageScreen(page, HOME_TITLE, H.place.home);
    // Appended at the END of the place (UI-D-72), after the seeded pair.
    await expect
      .poll(() => manageOrder(page))
      .toEqual([SEEDED.bastidores, SEEDED.aulas, HOME_TITLE]);

    // community[0]: its Destaques row ends with the same "Gerenciar" circle.
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.communityId}`);
    await communityRow(page)
      .getByRole('link', {
        name: H.circle.actionCommunity.replace('{community}', SEEDED.communityName),
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/comunidades/${SEEDED.communityId}/destaques$`));
    await expect(
      page.getByRole('heading', {
        name: H.manage.titleCommunity.replace('{community}', SEEDED.communityName),
        level: 1,
      }),
    ).toBeVisible();
    await createOnManageScreen(page, COMMUNITY_TITLE, SEEDED.communityName);
    await expect.poll(() => manageOrder(page)).toEqual([SEEDED.destaques, COMMUNITY_TITLE]);

    // Both are real rows now, each in its own place — the server says so, not the screen.
    const rows = await catalog();
    expect(rows.find((row) => row.title === HOME_TITLE)?.communityId).toBeNull();
    expect(rows.find((row) => row.title === COMMUNITY_TITLE)?.communityId).toBe(SEEDED.communityId);
  });

  test('2. publishing from the community’s `+` is pre-filled with its FIRST highlight and lands on the community page with the story in it', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.communityId}`);
    const name = ((await page.locator('[data-community-name]').textContent()) ?? '').trim();
    expect(name).toBe(SEEDED.communityName);

    // The community's FIRST highlight by position is still the migrated `Destaques` — step 1's
    // highlight was appended after it.
    await expect.poll(() => manageOrderFromApi()).toEqual([SEEDED.destaques, COMMUNITY_TITLE]);

    await communityRow(page)
      .getByRole('link', { name: S.own.actionCommunity.replace('{community}', name) })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/stories/publicar\\?comunidade=${SEEDED.communityId}$`),
    );
    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    const caption = page.getByLabel(S.publish.captionLabel);
    await expect(caption).toBeVisible({ timeout: 30_000 });
    // D-112: "{community} · {its first highlight}", stated before "Publicar" is reachable.
    await expect(page.locator('[data-story-destination-value]')).toHaveText(
      S.publish.destination.value.replace('{place}', name).replace('{title}', SEEDED.destaques),
    );
    await caption.fill(CAPTION);
    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();

    // D-115 / UI-D-70: it lands on the community, and the toast names the highlight.
    await expect(page).toHaveURL(new RegExp(`/comunidades/${SEEDED.communityId}$`));
    await expect(
      page.getByText(
        S.publish.toastHighlightCommunity
          .replace('{title}', SEEDED.destaques)
          .replace('{community}', name),
        { exact: true },
      ),
    ).toBeVisible();

    // The story is IN the community's highlight once the worker has readied the photo (a member
    // never sees a non-ready story, and the admin's row reads the same predicate).
    await expect
      .poll(
        async () =>
          (await highlightItems(users.demoAdmin, SEEDED.destaquesId)).find(
            (item) => item.caption === CAPTION,
          )?.id ?? '',
        { timeout: 60_000 },
      )
      .not.toBe('');
    const items = await highlightItems(users.demoAdmin, SEEDED.destaquesId);
    const published = items.find((item) => item.caption === CAPTION);
    state.publishedStoryId = published?.id ?? '';
    state.publishedAssetId = published?.mediaAssetId ?? '';
    expect(published?.mediaKind).toBe('image');

    // …and on the page: it is `Destaques`' LAST segment (D-103, oldest first by publish time).
    await page.reload();
    await communityRow(page)
      .getByRole('button', { name: highlightName(SEEDED.destaques) })
      .click();
    const viewer = viewerOf(page);
    await expect(viewer).toBeVisible();
    const bars = page.getByTestId('story-progress-bars');
    await expect(bars).toHaveAttribute('data-story-count', String(items.length));
    for (let index = 1; index < items.length; index += 1) {
      await page.keyboard.press('ArrowRight');
      await expect(viewer).toHaveAttribute('data-story-index', String(index));
    }
    await expect(page.getByTestId('story-caption')).toHaveText(CAPTION);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
  });

  test('3. the EXPIRED story joins one highlight from "Seus stories" and the other from the viewer’s "Destacar", and plays from both', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    const ids = new Map((await catalog()).map((row) => [row.title, row.id]));
    const homeId = ids.get(HOME_TITLE) ?? '';
    const communityId = ids.get(COMMUNITY_TITLE) ?? '';
    expect(homeId).not.toBe('');
    expect(communityId).not.toBe('');

    // ── Door 1 (D-110 route 2): "Seus stories" → the row's menu → "Destacar".
    await page.goto(`${hosts.demo}/stories/meus`);
    const row = page
      .locator('[data-story-history-row]')
      .filter({ hasText: SEEDED.expiredCaption })
      .first();
    await expect(row).toBeVisible();
    await row.click();
    const menu = page.getByRole('dialog', { name: S.history.menu.title });
    await menu.getByText(S.history.menu.highlight, { exact: true }).click();
    const sheet = page.getByRole('dialog', { name: H.sheet.title });
    await expect(sheet).toBeVisible();
    const intoHome = sheet.getByRole('switch', { name: switchName(HOME_TITLE, H.place.home) });
    await expect(intoHome).toHaveAttribute('aria-checked', 'false');
    await intoHome.dispatchEvent('click');
    await expect(intoHome).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(H.toasts.added, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // ── Door 2 (D-110 route 1): the viewer. `Bastidores` plays the expired story FIRST, so the
    // admin opens it there and taps "Destacar" on that very segment.
    await page.goto(`${hosts.demo}/inicio`);
    await strip(page)
      .getByRole('button', { name: highlightName(SEEDED.bastidores) })
      .click();
    const viewer = viewerOf(page);
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId('story-caption')).toHaveText(SEEDED.expiredCaption);
    await viewer.getByRole('button', { name: S.viewer.highlight }).dispatchEvent('click');
    const viewerSheet = page.getByRole('dialog', { name: H.sheet.title });
    await expect(viewerSheet).toBeVisible();
    // The sheet opened on the expired story: it is already in the highlight door 1 just used.
    await expect(
      viewerSheet.getByRole('switch', { name: switchName(HOME_TITLE, H.place.home) }),
    ).toHaveAttribute('aria-checked', 'true');
    const intoCommunity = viewerSheet.getByRole('switch', {
      name: switchName(COMMUNITY_TITLE, SEEDED.communityName),
    });
    await expect(intoCommunity).toHaveAttribute('aria-checked', 'false');
    await intoCommunity.dispatchEvent('click');
    await expect(intoCommunity).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(H.toasts.added, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewerSheet).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // The server agrees: the expired story is in BOTH new highlights (and still in the seed's two).
    const memberships = await storiesApi(
      await sessionToken(users.demoAdmin),
      `/v1/stories/${SEEDED.expiredStoryId}/highlights`,
    );
    expect(memberships.status).toBe(200);
    const { highlightIds } = (await memberships.json()) as { highlightIds: string[] };
    expect([...highlightIds].sort()).toEqual(
      [SEEDED.bastidoresId, SEEDED.destaquesId, homeId, communityId].sort(),
    );

    // ── Each highlight plays it: Início's from the row, the community's from its page.
    await page.goto(`${hosts.demo}/inicio`);
    await expectExpiredPlaysFirst(
      page,
      strip(page).getByRole('button', { name: highlightName(HOME_TITLE) }),
    );
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.communityId}`);
    await expectExpiredPlaysFirst(
      page,
      communityRow(page).getByRole('button', { name: highlightName(COMMUNITY_TITLE) }),
    );

    // The asset behind the expired story's frame — step 4's cover must be exactly this one.
    const home = await highlightItems(users.demoAdmin, homeId);
    expect(home.map((item) => item.id)).toEqual([SEEDED.expiredStoryId]);
    state.expiredAssetId = home[0]?.mediaAssetId ?? '';
    expect(state.expiredAssetId).not.toBe('');
  });

  test('4. the admin reorders Início with the keyboard and re-covers the highlight with a story frame; a reload shows both', async ({
    page,
  }) => {
    expect(state.publishedStoryId, 'step 2 published a story').not.toBe('');
    expect(state.expiredAssetId, 'step 3 found the expired frame').not.toBe('');
    // The contrast that makes "re-covered" observable: two DIFFERENT frames.
    expect(state.publishedAssetId).not.toBe(state.expiredAssetId);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/stories/destaques`);
    await expect(manageList(page)).toBeVisible();

    // ── A second frame first (D-110 route 3, the picker): with step 2's photo added LAST, the
    // automatic cover (R-D-D rule 3, the most recently added image) is that photo — not the
    // expired frame the admin is about to choose.
    await manageList(page)
      .getByRole('button', { name: H.manage.edit.replace('{title}', HOME_TITLE) })
      .click();
    const sheet = editSheet(page);
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: H.edit.addStories }).click();
    await expect(sheet.getByRole('heading', { name: H.picker.title })).toBeVisible();
    const pickerSwitch = sheet.locator('li', { hasText: CAPTION }).getByRole('switch');
    await expect(pickerSwitch).toHaveAttribute('aria-checked', 'false');
    await pickerSwitch.click();
    await expect(pickerSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(H.toasts.added)).toBeVisible();
    await sheet.getByRole('button', { name: H.create.back }).click();
    await expect(sheet.getByRole('button', { name: startsWith(H.edit.remove) })).toHaveCount(2);

    // ── Re-cover with the EXPIRED story's frame: the option whose thumbnail is that asset.
    await sheet.getByRole('button', { name: H.edit.changeCover }).click();
    await expect(sheet.getByRole('heading', { name: H.cover.title })).toBeVisible();
    const options = sheet.getByRole('button', { name: startsWith(H.cover.option) });
    await expect(options).toHaveCount(2);
    await options.filter({ has: page.locator(`img[src*="${state.expiredAssetId}"]`) }).click();
    await expect(page.getByText(H.toasts.coverChanged)).toBeVisible();
    await expect(sheet.getByRole('button', { name: H.edit.changeCover })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // ── Reorder by KEYBOARD (UI-D-73): third → second. Focus stays on the handle; the live
    // region says where it went.
    const handle = manageList(page).getByRole('button', {
      name: H.manage.drag.replace('{title}', HOME_TITLE),
    });
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect(
      page.getByText(
        H.manage.moved
          .replace('{title}', HOME_TITLE)
          .replace('{position}', '2')
          .replace('{total}', '3'),
      ),
    ).toBeAttached();
    await expect(handle).toBeFocused();
    await expect
      .poll(() => manageOrder(page))
      .toEqual([SEEDED.bastidores, HOME_TITLE, SEEDED.aulas]);

    // ── After a reload, the Início ROW reads the saved order and wears the chosen cover.
    await page.goto(`${hosts.demo}/inicio`);
    await page.reload();
    const highlightControls = [
      highlightName(SEEDED.bastidores),
      highlightName(HOME_TITLE),
      S.circle.highlightEmpty.replace('{title}', SEEDED.aulas),
    ];
    await expect
      .poll(async () => (await rowNames(page)).filter((name) => highlightControls.includes(name)))
      .toEqual(highlightControls);
    const cover = strip(page)
      .getByRole('button', { name: highlightName(HOME_TITLE) })
      .locator('img');
    await expect(cover).toHaveAttribute('src', new RegExp(`/v1/media/${state.expiredAssetId}/`));
    await expect(cover).not.toHaveAttribute('src', new RegExp(state.publishedAssetId));
  });

  test('5. a member finds the migrated Destaques still holding the seeded pinned stories, the expired one first', async ({
    page,
  }, testInfo) => {
    // The member's own read of the migrated highlight: every seeded pin whose STORY still exists
    // survives as an item (D-116). The seeded story VIDEO may not exist any more:
    // `deleteTenantVideoAssets` (media-video.spec, phase3-smoke.spec, both earlier in a full run)
    // hard-deletes it with the rest of the demo video library. So this asks the database which
    // seeded stories a member can still be shown (the `activeReadyStoryCount` rule, 05-05) instead
    // of assuming the seed is intact. The condition is on the story, not on the item: a live pinned
    // story missing from the highlight still fails here. On a fresh seed both pins are asserted.
    const seededPins = [SEEDED.expiredStoryId, SEEDED.videoStoryId];
    const livePins = await memberVisibleStoryIds(seededPins);
    // The EXPIRED pin is an image; nothing in the suite removes it, so it must always be live.
    expect(livePins).toContain(SEEDED.expiredStoryId);
    if (!livePins.includes(SEEDED.videoStoryId)) {
      testInfo.annotations.push({
        type: 'seeded story video absent',
        description: `${SEEDED.videoStoryId} was removed by deleteTenantVideoAssets earlier in this run; its pin is not asserted`,
      });
    }
    const items = await highlightItems(users.demoMember, SEEDED.destaquesId);
    const ids = items.map((item) => item.id);
    for (const pin of livePins) expect(ids).toContain(pin);
    expect(ids[0]).toBe(SEEDED.expiredStoryId);
    // …and the API's read is exactly the database's member-visible items, in play order.
    expect(ids).toEqual(await memberVisibleHighlightStoryIds(SEEDED.destaquesId));

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/comunidades/${SEEDED.communityId}`);
    await expect(communityRow(page)).toBeVisible();
    // A member gets no `+` and no "Gerenciar" — only the circles (UI-D-64).
    await expect(communityRow(page).getByRole('link')).toHaveCount(0);
    const circle = communityRow(page).getByRole('button', {
      name: highlightName(SEEDED.destaques),
    });
    await expectExpiredPlaysFirst(page, circle);

    // …and the segment count on the page is the member's whole read of it.
    await circle.click();
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute(
      'data-story-count',
      String(items.length),
    );
    await page.keyboard.press('Escape');
    await expect(viewerOf(page)).toHaveCount(0);
    // The expired story is still absent from Início's tenant circle (its 24 h are over).
    const live = await storiesApi(
      await sessionToken(users.demoMember),
      `/v1/stories?limit=${STORY_MAX_PAGE_SIZE}`,
    );
    const strip24h = ((await live.json()) as { items: StoryItem[] }).items.map((item) => item.id);
    expect(strip24h).not.toContain(SEEDED.expiredStoryId);
  });

  test('6. a member resumes the tenant circle at the first unseen story, the ring greys when all are seen, and a second device agrees', async ({
    page,
    browser,
  }, testInfo) => {
    // The member's sequence, oldest first, with the member's OWN flags — from the read the row uses.
    const list = await storiesApi(
      await sessionToken(users.demoMember),
      `/v1/stories?limit=${STORY_MAX_PAGE_SIZE}`,
    );
    const sequence = [...((await list.json()) as { items: StoryItem[] }).items].reverse();
    const last = sequence.length - 1;
    const first = last - 1;
    // The two newest are IMAGES: the seed's newest and step 2's photo (see the file note on video).
    expect(sequence[first]?.id).toBe(SEEDED.newestActiveStoryId);
    expect(sequence[last]?.id).toBe(state.publishedStoryId);
    expect(sequence[first]?.mediaKind).toBe('image');
    expect(sequence[last]?.mediaKind).toBe('image');

    // Everything else already seen — the seeded video included, which cannot be SHOWN here.
    await setStoryViews(
      users.demoMember,
      'tria-demo',
      sequence.slice(0, first).map((story) => story.id),
    );

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const unseen = tenantCircle(page, true);
    await expect(unseen).toBeVisible();
    await expect(unseen.getByTestId('story-circle-ring')).toHaveClass(/border-brand/);
    await expect(tenantCircle(page, false)).toHaveCount(0);

    // ── Watch PART: it resumes at the first unseen story; leave as soon as it has been shown.
    await unseen.click();
    const viewer = viewerOf(page);
    await expect(viewer).toHaveAttribute('data-story-group', '0');
    await expect(viewer).toHaveAttribute('data-story-index', String(first));
    await expect(page).toHaveURL(new RegExp(`/stories/${sequence[first]?.id}$`));
    await waitUntilShown(page, first);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    // One story is still unseen, so the ring stays brand and the name still says so.
    await expect(tenantCircle(page, true)).toBeVisible();
    await expect.poll(() => hasStoryView(users.demoMember, SEEDED.newestActiveStoryId)).toBe(true);

    // ── Reopen: it resumes at the NEXT unseen story. Watch it to the end of the circle.
    await tenantCircle(page, true).click();
    await expect(viewer).toHaveAttribute('data-story-index', String(last));
    await expect(page).toHaveURL(new RegExp(`/stories/${state.publishedStoryId}$`));
    await waitUntilShown(page, last);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // Neutral on close, with NO reload: the plain name, the neutral ring (UI-D-61, R-P5).
    const seen = tenantCircle(page, false);
    await expect(seen).toBeVisible();
    await expect(tenantCircle(page, true)).toHaveCount(0);
    await expect(seen.getByTestId('story-circle-ring')).toHaveClass(/border-border/);
    await expect(seen.getByTestId('story-circle-ring')).not.toHaveClass(/border-brand/);
    // The close flushed it to the server — which is what the second device reads.
    await expect.poll(() => hasStoryView(users.demoMember, state.publishedStoryId)).toBe(true);

    // ── The SECOND device: a fresh browser context (its own cookies and storage), same account.
    const use = testInfo.project.use;
    const deviceOptions: BrowserContextOptions = {
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
      serviceWorkers: 'block',
    };
    const secondDevice = await browser.newContext(deviceOptions);
    try {
      const other = await secondDevice.newPage();
      await login(other, users.demoMember, SEED_PASSWORD, hosts.demo);
      const ring = tenantCircle(other, false);
      await expect(ring).toBeVisible();
      await expect(tenantCircle(other, true)).toHaveCount(0);
      await expect(ring.getByTestId('story-circle-ring')).toHaveClass(/border-border/);
      // Everything seen: a re-watch on the second device starts from the beginning (D-105).
      await ring.click();
      await expect(viewerOf(other)).toHaveAttribute('data-story-index', '0');
    } finally {
      await secondDevice.close();
    }
  });
});

/** Community[0]'s highlight titles in position order, from the curator's read (empty ones too). */
async function manageOrderFromApi(): Promise<string[]> {
  const res = await storiesApi(
    await sessionToken(users.demoAdmin),
    `/v1/stories/highlights?communityId=${SEEDED.communityId}&scope=all`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { title: string }[] }).items.map((item) => item.title);
}
