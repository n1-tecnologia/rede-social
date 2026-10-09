import { request as httpRequest } from 'node:http';
import { expect, type Locator, type Page, type Request, test } from '@playwright/test';
import eventsMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import platformMessages from '../messages/pt-BR/platform.json' with { type: 'json' };
import wizardMessages from '../messages/pt-BR/platform.wizard.json' with { type: 'json' };
import brandingMessages from '../messages/pt-BR/platformBranding.json' with { type: 'json' };
import domainsMessages from '../messages/pt-BR/platformDomains.json' with { type: 'json' };
import profileMessages from '../messages/pt-BR/profile.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { closeAdmin, deleteTenantBySlug, getTenantModuleFlag } from './admin';
import { closeBrandingAdmin, getTenantBranding } from './branding-admin';
import { hosts, isRemote } from './fixtures';
import {
  continueFromData,
  continueFromPersonalization,
  fillTenantData,
  WIZARD_INVITE_PATH,
} from './wizard';

/**
 * The tenant wizard and its preview device: `/plataforma/novo` shows the tenant's app in a phone
 * (`components/platform/preview`) beside the form. The draft is collected step by step (Dados,
 * Marca, Domínio, Resumo) with nothing sent to the API; the summary's confirmation creates the
 * tenant (then its logo and domain) and opens the invite step, `/plataforma/novo/{id}/convite`. The
 * device stays the SAME DOM node in the same place throughout — `novo/layout.tsx` owns it and App
 * Router layouts persist across their children — and a reload brings the created tenant back.
 *
 * Desktop only: the device shows from `xl` (1280 px) up; below that the form's own light/dark
 * `BrandPreview` frames stand in for it, and from `xl` up they are hidden beside the phone.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(isRemote, 'local stack only');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the platform e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

/** The catalog is the source of copy — never a literal in a spec. */
const EVENTS = eventsMessages.events;
const PROFILE = profileMessages.profile;
const PREVIEW = wizardMessages.platform.devicePreview;
const WIZARD = wizardMessages.platform.wizard;
const WIZARD_NEW = platformMessages.platform.new;
const BRANDING = brandingMessages.platformBranding;
const DOMAINS = domainsMessages.platformDomains;
const STORIES = storiesMessages.stories;
const FEED = feedMessages.feed;

const run = Date.now().toString(36).slice(-6);
const slug = `e2e-assistente-${run}`;
const name = `E2E Assistente ${run}`;
const host = `e2e-assistente-${run}.exemplo.test`;
/** Two more tenants: one whose host is refused after the creation, one whose answer is lost. */
const slugDomain = `${slug}-dominio`;
const slugLost = `${slug}-perdida`;
const LOGO = {
  name: 'logo.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 96"><rect width="320" height="96" rx="24" fill="#7c3aed"/></svg>',
  ),
};

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteTenantBySlug(slugDomain);
  await deleteTenantBySlug(slugLost);
  await closeAdmin();
  await closeBrandingAdmin();
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`${hosts.platform}/entrar`);
  await page.locator('#email').fill(SUPER_ADMIN_EMAIL);
  await page.locator('#password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** Tags the device's DOM node so a later read proves it is the same node (no remount). */
async function tag(device: Locator): Promise<void> {
  await device.evaluate((el) => {
    (el as HTMLElement & { e2eTag?: string }).e2eTag = 'same-node';
  });
}

async function tagOf(device: Locator): Promise<string | undefined> {
  return device.evaluate((el) => (el as HTMLElement & { e2eTag?: string }).e2eTag);
}

/**
 * Sends the page's request to the server from the test runner and lets the page hear nothing: the
 * server action runs (its write happens) while the caller's answer is lost. Node does not resolve
 * `*.localhost` the way Chrome does, so it dials 127.0.0.1 with the page's Host header (the tenant
 * resolution reads it) and the page's cookies.
 */
async function deliverWithoutAnswer(request: Request): Promise<void> {
  const url = new URL(request.url());
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(':')),
  );
  headers.host = url.host;
  await new Promise<void>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        method: request.method(),
        headers,
      },
      (incoming) => {
        incoming.resume();
        incoming.on('end', resolve);
        incoming.on('error', reject);
      },
    );
    outgoing.on('error', reject);
    outgoing.end(request.postDataBuffer() ?? undefined);
  });
}

/** The computed `font-family` of an element (the declared stack, loaded or not). */
async function fontFamilyOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).fontFamily);
}

/** The computed background of an element, `rgb(…)` whatever the stylesheet wrote. */
async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** The computed text colour of an element, `rgb(…)`. */
async function colorOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).color);
}

/** The computed value of a custom property on an element (trimmed). */
async function customPropertyOf(locator: Locator, name: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop).trim(), name);
}

/** The login screen the way the app reaches it: Perfil > Configurações > Sair, inside the phone. */
async function signOutInDevice(device: Locator): Promise<void> {
  await device.locator('[data-preview-tab="profile"]').click();
  await device.locator('a[href="/configuracoes"]').click();
  await device.locator('[data-preview-logout]').click();
  await expect(device.locator('[data-preview-screen]')).toHaveAttribute(
    'data-preview-screen',
    'login',
  );
}

test.describe('Tenant wizard — the preview device', () => {
  test('collects the draft step by step, creates only on confirmation, and never remounts the device', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    // The title font's stylesheets come from Google: answered empty here, so the run never depends on
    // the network (the computed font-family is the declared stack, loaded or not).
    // On the context, not the page: the dev service worker fetches every request itself, and only a
    // context route sees those.
    await page
      .context()
      .route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      );
    await signIn(page);
    await page.goto(`${hosts.platform}/plataforma/novo`);

    const device = page.locator('[data-device-screen]');
    await expect(device).toBeVisible();
    // The scrollbar gutter is reserved, so the steps' different heights never shift the device
    // sideways (headless Chromium hides scrollbars, so the box check below cannot see that).
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
    ).toBe('stable');
    // Dados: who the tenant is (no colours here); the device follows the form as it is filled.
    await fillTenantData(page, { name, slug, email: `admin+${slug}@e2e.local` });
    await expect(device).toContainText(name);
    await expect(page.locator('#primary')).toHaveCount(0);
    await expect(page.locator('main').getByRole('switch')).toHaveCount(0);

    // "Continuar" validates and opens Personalização; the device is the same node in the same
    // place, and NOTHING exists on the server yet.
    const next = page.getByRole('button', { name: 'Continuar', exact: true });
    await next.scrollIntoViewIfNeeded();
    await tag(device);
    const before = await device.boundingBox();
    await continueFromData(page);
    expect(await tagOf(device)).toBe('same-node');
    const after = await device.boundingBox();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(await getTenantModuleFlag(slug, 'feed')).toBeNull();

    // Personalização: colours, modules, logo and icon. At xl the phone IS the preview: the step's
    // BrandPreview frames are hidden beside it, and they stay the only `[data-brand-scope]` in the
    // DOM (the phone carries none).
    const frames = page.locator('[data-brand-scope]');
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toBeHidden();
    await expect(frames.nth(1)).toBeHidden();
    await page.locator('#primary').fill('#7c3aed');
    await page.locator('#secondary').fill('#f59e0b');
    await expect(page.locator('main').getByRole('switch')).toHaveCount(7);

    // The light theme's ground: a dropdown of eight predefined tones (2026-10-03), never a free
    // colour. A tone turns the phone light and repaints its ground (Amarelado is the reference
    // cream, #f5efe5). The combobox is looked up inside its picker: the panel's own screen picker
    // is a native select, a combobox too.
    const lightTones = page.locator('[data-tone-picker="light"]');
    const lightCombo = lightTones.getByRole('combobox');
    await expect(lightTones.locator('input, select, textarea')).toHaveCount(0);
    await expect(lightCombo).toHaveAttribute('aria-expanded', 'false');
    await expect(lightTones.getByRole('option')).toHaveCount(0);
    await lightCombo.click();
    await expect(lightCombo).toHaveAttribute('aria-expanded', 'true');
    await expect(lightTones.getByRole('option')).toHaveCount(8);
    // The last option is reachable: neither clipped by the card nor under the next one.
    await lightTones.locator('[data-tone-option="esverdeado"]').click();
    await expect(lightCombo).toHaveAttribute('aria-expanded', 'false');
    await expect(device).toHaveAttribute('data-bg-tone', 'esverdeado');
    // The keyboard: Escape closes and keeps the focus on the trigger; typing jumps to a tone.
    await lightCombo.focus();
    await page.keyboard.press('ArrowDown');
    await expect(lightCombo).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(lightCombo).toHaveAttribute('aria-expanded', 'false');
    await expect(lightCombo).toBeFocused();
    await lightCombo.click();
    await lightTones.locator('[data-tone-option="amarelado"]').click();
    await expect(lightCombo).toContainText(WIZARD.brand.tones.light.amarelado);
    await expect(device).toHaveAttribute('data-theme', 'light');
    await expect(device).toHaveAttribute('data-bg-tone', 'amarelado');
    await expect.poll(() => backgroundOf(device)).toBe('rgb(245, 239, 229)');
    // The whole family, as the reference paints it (2026-10-03): the raised surfaces in its warm
    // white (a post of the feed here) and the floating bar's glass in that white too.
    await expect
      .poll(() => backgroundOf(device.locator('[role="article"]').first()))
      .toBe('rgb(255, 252, 246)');
    // Compared as a painted colour: the stylesheet may spell the value `#fffcf6d1` once minified.
    const glass = await device.evaluate((screen) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = getComputedStyle(screen).getPropertyValue('--theme-glass-bar');
      screen.appendChild(probe);
      const painted = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return painted;
    });
    expect(glass).toBe('rgba(255, 252, 246, 0.82)');
    // Below xl the mini-shells stand in for the phone, so they take the same look (hidden here).
    await expect(frames.nth(0)).toHaveAttribute('data-bg-tone', 'amarelado');

    // The dark theme's own colours: touching them turns the phone dark; a dark primary reaches the
    // phone's dark brand variable, and a dark tone its ground (the swatch's own paint).
    const darkCard = page.locator('[data-dark-colors]');
    await darkCard.locator('#darkPrimary').fill('#ffb4a8');
    await expect(device).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => customPropertyOf(device, '--brand-primary-dark')).toBe('#ffb4a8');
    // Both primaries of the dark screen: the gradient, the hover shade and the art follow it too.
    await expect.poll(() => customPropertyOf(device, '--brand-primary')).toBe('#ffb4a8');
    const darkCombo = darkCard.getByRole('combobox');
    await darkCombo.click();
    await darkCard.locator('[data-tone-option="cafe"]').click();
    await expect(device).toHaveAttribute('data-dark-tone', 'cafe');
    // The trigger's swatch shows the chosen tone, painted by the tone itself.
    const cafeGround = await backgroundOf(darkCombo.locator('[data-dark-tone]'));
    expect(cafeGround).not.toBe('rgb(15, 17, 24)');
    await expect.poll(() => backgroundOf(device)).toBe(cafeGround);
    await expect(frames.nth(1)).toHaveAttribute('data-dark-tone', 'cafe');

    // The buttons' own colours (2026-10-03), apart from the primary: the reference's gold button with
    // chocolate text. The light pair reaches the phone's raw keys and its filled buttons (the
    // "Completar agora" of the profile popup still up over Início) while the screen's accent stays
    // the primary; the dark theme inherits the pair until it gets its own fill.
    const buttonCard = page.locator('[data-button-colors]');
    const nudgeAction = device
      .locator('[data-preview-nudge]')
      .getByText(PROFILE.nudge.action, { exact: true });
    await buttonCard.locator('#buttonFillLight').fill('#e3af3f');
    await expect(device).toHaveAttribute('data-theme', 'light');
    await buttonCard.locator('#buttonInkLight').fill('#382317');
    await expect.poll(() => customPropertyOf(device, '--button-fill-light')).toBe('#e3af3f');
    await expect.poll(() => customPropertyOf(device, '--button-ink-light')).toBe('#382317');
    await expect.poll(() => backgroundOf(nudgeAction)).toBe('rgb(227, 175, 63)');
    await expect.poll(() => colorOf(nudgeAction)).toBe('rgb(56, 35, 23)');
    expect(await customPropertyOf(device, '--brand-accent')).toBe('#7c3aed');
    await expect(buttonCard.locator('[data-button-contrast="light"]')).toHaveText(
      WIZARD_NEW.contrast.ok.replace('{ratio}', '7,4'),
    );
    expect(await customPropertyOf(device, '--button-fill-dark')).toBe('#e3af3f');
    await expect(buttonCard.locator('[data-button-sample="dark"] button')).toHaveCSS(
      'background-color',
      'rgb(227, 175, 63)',
    );
    // A dark fill of its own: the phone turns dark, the dark key changes and the light pair stays.
    await buttonCard.locator('#buttonFillDark').fill('#f0cb7a');
    await expect(device).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => customPropertyOf(device, '--button-fill-dark')).toBe('#f0cb7a');
    await expect.poll(() => backgroundOf(nudgeAction)).toBe('rgb(240, 203, 122)');
    expect(await customPropertyOf(device, '--button-fill-light')).toBe('#e3af3f');
    // The hidden mini frames (below xl) carry each theme's own pair.
    expect(await customPropertyOf(frames.nth(0), '--button-fill-light')).toBe('#e3af3f');
    expect(await customPropertyOf(frames.nth(1), '--button-fill-dark')).toBe('#f0cb7a');

    // The style before the colours: "Degradê" turns every filled button into a gradient from the
    // first colour to the last, in both themes. Untouched, the last colour is the first moved 30%
    // away from the text (gold under chocolate brightens to #ebc779), so the text keeps its 7,4:1.
    await buttonCard
      .getByRole('button', { name: WIZARD.brand.buttons.styleGradient, exact: true })
      .click();
    await expect(buttonCard).toHaveAttribute('data-button-style', 'gradient');
    await expect
      .poll(() => customPropertyOf(device, '--button-image-light'))
      .toBe('linear-gradient(135deg, #e3af3f, #ebc779)');
    await expect(buttonCard.locator('[data-button-contrast="light"]')).toHaveText(
      WIZARD_NEW.contrast.ok.replace('{ratio}', '7,4'),
    );
    await buttonCard.locator('#buttonFillEndLight').fill('#ffd27a');
    await expect(device).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() => customPropertyOf(device, '--button-image-light'))
      .toBe('linear-gradient(135deg, #e3af3f, #ffd27a)');
    await expect
      .poll(() => nudgeAction.evaluate((el) => getComputedStyle(el).backgroundImage))
      .toBe('linear-gradient(135deg, rgb(227, 175, 63), rgb(255, 210, 122))');
    // The colour under the image stays the first colour (what the colour checks read). Polled: the
    // theme just turned light, and the button's colour eases there over its 150ms transition.
    await expect.poll(() => backgroundOf(nudgeAction)).toBe('rgb(227, 175, 63)');
    // Both themes always go out: the dark one keeps its own first colour and inherits the last.
    expect(await customPropertyOf(device, '--button-image-dark')).toBe(
      'linear-gradient(135deg, #f0cb7a, #ffd27a)',
    );
    expect(await customPropertyOf(frames.nth(0), '--button-image-light')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    expect(await customPropertyOf(frames.nth(1), '--button-image-dark')).toBe(
      'linear-gradient(135deg, #f0cb7a, #ffd27a)',
    );

    // The titles' ink, one per theme: each reaches the phone's marked titles in its own theme (a
    // name drawn white over a photo stays white), and the app name in the top bar (drawn while
    // there is no logo) takes its own. Início marks no title since its next-event card became the
    // Eventos tab's dot (2026-10-03), so the phone opens Eventos through the panel's screen picker,
    // which also answers the profile popup, as leaving Início does in the app. Its first marked
    // title not drawn white is the "Meus eventos" gallery's (2026-10-03, the REINE galleries: the
    // posters' names stay white over their photos), in the brand's ink until a colour is set.
    const screenPicker = page.getByLabel(PREVIEW.screens);
    await screenPicker.selectOption('events');
    const title = device
      .locator('[data-preview-title]:not([data-preview-app-name], .text-white)')
      .first();
    await expect(title).toHaveText(EVENTS.sections.mine.title);
    // Beside the inks, one sample per mode (2026-10-03), light on the left and dark on the right,
    // each painted with its own mode's inks on its own ground, whatever the phone shows.
    const inkSample = (mode: 'light' | 'dark') =>
      page.locator(`[data-font-color-sample="${mode}"]`);
    const sampleTitle = (mode: 'light' | 'dark') =>
      inkSample(mode).locator('[data-font-color-sample-title]').first();
    const sampleAppName = (mode: 'light' | 'dark') =>
      inkSample(mode).locator('[data-font-color-sample-app-name]');
    await expect(inkSample('light')).toBeVisible();
    await expect(inkSample('dark')).toBeVisible();
    expect((await inkSample('light').boundingBox())?.x ?? 0).toBeLessThan(
      (await inkSample('dark').boundingBox())?.x ?? 0,
    );
    await expect.poll(() => backgroundOf(inkSample('light'))).toBe('rgb(245, 239, 229)');
    await expect.poll(() => backgroundOf(inkSample('dark'))).toBe(cafeGround);
    await page.locator('#titleColorDark').fill('#ffd27a');
    await expect(device).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => colorOf(title)).toBe('rgb(255, 210, 122)');
    await expect.poll(() => colorOf(sampleTitle('dark'))).toBe('rgb(255, 210, 122)');
    await page.locator('#titleColorLight').fill('#7c2d12');
    await expect(device).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => colorOf(title)).toBe('rgb(124, 45, 18)');
    await expect.poll(() => colorOf(sampleTitle('light'))).toBe('rgb(124, 45, 18)');
    // Each sample keeps its own mode's ink.
    await expect.poll(() => colorOf(sampleTitle('dark'))).toBe('rgb(255, 210, 122)');
    await page.locator('#appNameColorLight').fill('#0f766e');
    await expect
      .poll(() => colorOf(device.locator('[data-preview-app-name]')))
      .toBe('rgb(15, 118, 110)');
    await expect.poll(() => colorOf(sampleAppName('light'))).toBe('rgb(15, 118, 110)');
    await expect.poll(() => colorOf(sampleAppName('dark'))).toBe('rgb(242, 245, 250)');
    // The admin view's filled controls carry the button colour too (review BTN-COV-1): they are
    // hand-written copies of the app's, not the Button primitive, so they are pinned here.
    const viewChip = (label: string) => page.getByRole('button', { name: label, exact: true });
    await viewChip(PREVIEW.views.admin).click();
    const eventsCreate = device.locator('[data-preview-admin="events-create"]');
    await expect.poll(() => backgroundOf(eventsCreate)).toBe('rgb(227, 175, 63)');
    await expect.poll(() => colorOf(eventsCreate)).toBe('rgb(56, 35, 23)');
    await screenPicker.selectOption('home');
    const compose = device.locator('[data-preview-admin="compose"]');
    await expect.poll(() => backgroundOf(compose)).toBe('rgb(227, 175, 63)');
    await expect.poll(() => colorOf(compose)).toBe('rgb(56, 35, 23)');
    await viewChip(PREVIEW.views.member).click();

    // The titles' font: Manrope until a Google family is picked; then only the marked titles of the
    // phone take it (the app name here), the rest of the app keeps Manrope, and Google is asked with
    // no referrer.
    const appName = device.locator('[data-preview-title]').first();
    expect(await fontFamilyOf(appName)).toMatch(/^Manrope/);
    // The search, the kinds and the list stay closed until "Editar" beside the chosen font.
    const editFont = page.locator('[data-font-edit]');
    await expect(editFont).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#titleFontSearch')).toBeHidden();
    await expect(page.locator('[data-font-list]')).toBeHidden();
    await editFont.click();
    await expect(editFont).toHaveAttribute('aria-expanded', 'true');
    await expect(editFont).toHaveText(WIZARD.brand.font.done);
    await expect(page.locator('#titleFontSearch')).toBeVisible();
    // Each option's radio sits in its own row, so picking a family far down the scrolled list never
    // moves the page (a radio positioned against the page would scroll it to its unscrolled spot).
    const fontList = page.locator('[data-font-list]');
    await fontList.scrollIntoViewIfNeeded();
    await fontList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const lastOption = page.locator('[data-font-option]:not([data-font-option=""])').last();
    expect(
      await lastOption.evaluate((label) => label.querySelector('input')?.offsetParent === label),
    ).toBe(true);
    const pageScroll = await page.evaluate(() => window.scrollY);
    await lastOption.click();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - pageScroll)).toBeLessThanOrEqual(
      1,
    );
    await page.locator('#titleFontSearch').fill('poppins');
    await page.locator('[data-font-option="Poppins"]').click();
    await expect.poll(() => fontFamilyOf(appName)).toMatch(/^Poppins, Manrope/);
    expect(await fontFamilyOf(device.locator('[data-preview-screen]'))).toMatch(/^Manrope/);
    await expect(
      page.locator('link[data-google-font][href*="family=Poppins:wght@700"]'),
    ).toHaveAttribute('referrerpolicy', 'no-referrer');
    // "Concluir" closes the editor again; the line keeps naming the choice.
    await editFont.click();
    await expect(editFont).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#titleFontSearch')).toBeHidden();
    await expect(page.locator('[data-font-chosen]')).toContainText('Poppins');
    // The picked logo shows here and in the device (a local object URL, no upload).
    await page.locator('[data-wizard-image="logo"] input[type="file"]').setInputFiles(LOGO);
    await expect(page.locator('[data-wizard-image="logo"] img')).toBeVisible();
    await expect(device.locator('img[src^="blob:"]').first()).toBeVisible();
    // The ink samples follow the font and, like the phone, drop the app name once there is a logo.
    expect(await fontFamilyOf(sampleTitle('light'))).toMatch(/^Poppins, Manrope/);
    await expect(page.locator('[data-font-color-sample-app-name]')).toHaveCount(0);
    await expect(sampleTitle('light')).toBeVisible();
    // The app icon (2026-10-09) is composed here, from the picked logo's file over the primary, and
    // kept in the draft like the logo: the confirmation uploads it as the square override.
    const iconEditor = page.locator('[data-wizard-image="icon"]');
    await iconEditor.getByRole('button', { name: BRANDING.appIcon.customize }).click();
    await expect(iconEditor.locator('[data-app-icon-logo-state="ready"]')).toBeAttached();
    await iconEditor.getByRole('button', { name: BRANDING.appIcon.apply }).click();
    await expect(iconEditor).toHaveAttribute('data-app-icon-editor', 'closed');
    await expect(iconEditor.locator('[data-home-tile="ios"] img')).toHaveAttribute('src', /^blob:/);
    await expect(iconEditor.getByRole('button', { name: BRANDING.appIcon.edit })).toBeVisible();
    await continueFromPersonalization(page);

    // Domínio: recorded only. A typed host keeps Resumo closed in the step row until "Continuar"
    // checks it, so an unchecked host never reaches the confirmation.
    await expect(page).toHaveURL(/\/plataforma\/novo\/dominio$/);
    const steps = page.getByRole('navigation', { name: WIZARD.steps.label });
    await expect(steps.getByRole('link', { name: WIZARD.steps.summary })).toHaveCount(1);
    await page.locator('#host').fill(host);
    await expect(steps.getByRole('link', { name: WIZARD.steps.summary })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);

    // Back and forth: the step row goes back to Dados with every field kept, and forward again.
    await steps.getByRole('link', { name: WIZARD.steps.data }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo$/);
    await expect(page.locator('#displayName')).toHaveValue(name);
    await expect(page.locator('#adminEmail')).toHaveValue(`admin+${slug}@e2e.local`);
    await steps.getByRole('link', { name: WIZARD.steps.summary }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);
    expect(await tagOf(device)).toBe('same-node');

    // Resumo: the draft, summarised; still nothing on the server.
    await expect(page.getByText(slug, { exact: true })).toBeVisible();
    await expect(page.getByText(host, { exact: true })).toBeVisible();
    await expect(page.locator('main img[src^="blob:"]').first()).toBeVisible();
    await expect(page.locator('[data-summary-font]')).toContainText('Poppins');
    // The look's colours, each where it belongs; saved with the tenant since 2026-10-03, so none is
    // marked "só na prévia" any more (checked once every block is found, below).
    const summaryGround = page.locator('[data-summary-background]');
    await expect(summaryGround).toContainText(WIZARD.brand.tones.light.amarelado);
    const summaryDark = page.locator('[data-summary-dark]');
    await expect(summaryDark).toContainText(/#ffb4a8/i);
    await expect(summaryDark).toContainText(WIZARD.brand.tones.dark.cafe);
    const summaryInks = page.locator('[data-summary-font-colors]');
    await expect(summaryInks).toContainText(/#ffd27a/i);
    await expect(summaryInks).toContainText(/#7c2d12/i);
    await expect(summaryInks).toContainText(/#0f766e/i);
    const summaryButtons = page.locator('[data-summary-buttons]');
    await expect(summaryButtons).toContainText(/#e3af3f/i);
    await expect(summaryButtons).toContainText(/#382317/i);
    await expect(summaryButtons).toContainText(/#f0cb7a/i);
    await expect(summaryButtons).toContainText(/#ffd27a/i);
    await expect(summaryButtons.locator('[data-summary-button-style]')).toContainText(
      WIZARD.brand.buttons.styleGradient,
    );
    for (const block of [
      page.locator('[data-summary-font]'),
      summaryGround,
      summaryDark,
      summaryInks,
      summaryButtons,
    ]) {
      await expect(block).not.toContainText(/só na prévia/i);
    }
    expect(await getTenantModuleFlag(slug, 'feed')).toBeNull();

    // "Criar tenant" asks first: the reduced preview and the summary, with the focus on "Voltar e
    // revisar"; Escape writes nothing, the confirmation creates the tenant, uploads the logo,
    // attaches the host.
    await page.getByRole('button', { name: WIZARD.summary.create, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(WIZARD.confirm.title);
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText(slug);
    await expect(dialog.locator('[data-brand-scope]')).toHaveCount(2);
    // The reduced preview shows what the rows under it list: the light frame on Amarelado, the
    // dark one on Café with the dark primary.
    const dialogLight = dialog.locator('[data-brand-scope][data-theme="light"]');
    const dialogDark = dialog.locator('[data-brand-scope][data-theme="dark"]');
    await expect(dialogLight).toHaveAttribute('data-bg-tone', 'amarelado');
    await expect.poll(() => backgroundOf(dialogLight)).toBe('rgb(245, 239, 229)');
    await expect(dialogDark).toHaveAttribute('data-dark-tone', 'cafe');
    await expect.poll(() => backgroundOf(dialogDark)).toBe(cafeGround);
    expect(await customPropertyOf(dialogDark, '--brand-primary-dark')).toBe('#ffb4a8');
    await expect(dialog.locator('[data-confirm-font]')).toContainText('Poppins');
    await expect(dialog.locator('[data-confirm-background]')).toContainText(
      WIZARD.brand.tones.light.amarelado,
    );
    await expect(dialog.locator('[data-confirm-dark]')).toContainText(WIZARD.brand.tones.dark.cafe);
    await expect(dialog.locator('[data-confirm-font-colors]')).toContainText(/#7C2D12/i);
    await expect(dialog).not.toContainText(/só na prévia/i);
    await expect(dialog.locator('[data-confirm-buttons]')).toContainText(/#E3AF3F/i);
    await expect.poll(() => backgroundOf(dialogLight.locator('button'))).toBe('rgb(227, 175, 63)');
    await expect.poll(() => colorOf(dialogLight.locator('button'))).toBe('rgb(56, 35, 23)');
    await expect.poll(() => backgroundOf(dialogDark.locator('button'))).toBe('rgb(240, 203, 122)');
    await expect(dialog.locator('[data-confirm-buttons]')).toContainText(
      WIZARD.summary.buttonParts.gradient,
    );
    await expect
      .poll(() =>
        dialogLight.locator('button').evaluate((el) => getComputedStyle(el).backgroundImage),
      )
      .toBe('linear-gradient(135deg, rgb(227, 175, 63), rgb(255, 210, 122))');
    await expect(dialog.getByRole('button', { name: WIZARD.confirm.cancel })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await getTenantModuleFlag(slug, 'feed')).toBeNull();

    await page.getByRole('button', { name: WIZARD.summary.create, exact: true }).click();
    await page.locator('[data-create-confirm]').click();
    await expect(page).toHaveURL(WIZARD_INVITE_PATH, { timeout: 60_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Tenant criado.' })).toBeVisible();
    expect(await tagOf(device)).toBe('same-node');
    expect(await getTenantModuleFlag(slug, 'feed')).toBe(true);
    expect((await getTenantBranding(slug)).logoUrl).not.toBeNull();
    // The composed app icon went up with the logo: the tenant has its own square override.
    expect((await getTenantBranding(slug)).iconUrl).not.toBeNull();
    // "Criar tenant" SAVED the look (2026-10-03): the created tenant's phone, fed from the stored
    // brand (`PreviewSeed`), keeps the title font, the grounds, the inks and the buttons.
    await expect
      .poll(() => fontFamilyOf(device.locator('[data-preview-title]').first()))
      .toMatch(/^Poppins, Manrope/);
    await page.getByRole('button', { name: BRANDING.preview.light, exact: true }).click();
    await expect(device).toHaveAttribute('data-theme', 'light');
    await expect(device).toHaveAttribute('data-bg-tone', 'amarelado');
    await expect(device).toHaveAttribute('data-title-color', '');
    await expect(device).toHaveAttribute('data-app-name-color', '');
    expect(await customPropertyOf(device, '--button-fill-light')).toBe('#e3af3f');
    expect(await customPropertyOf(device, '--button-image-light')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    expect(await customPropertyOf(device, '--button-fill-dark')).toBe('#f0cb7a');
    expect(await customPropertyOf(device, '--button-image-dark')).toBe(
      'linear-gradient(135deg, #f0cb7a, #ffd27a)',
    );
    await expect.poll(() => backgroundOf(device)).toBe('rgb(245, 239, 229)');
    await page.getByRole('button', { name: BRANDING.preview.dark, exact: true }).click();
    await expect(device).toHaveAttribute('data-theme', 'dark');
    await expect(device).toHaveAttribute('data-dark-tone', 'cafe');
    await expect.poll(() => backgroundOf(device)).toBe(cafeGround);
    await expect.poll(() => customPropertyOf(device, '--brand-primary-dark')).toBe('#ffb4a8');
    // The dark theme has a title ink of its own, and no app-name ink.
    await expect(device).toHaveAttribute('data-title-color', '');
    await expect(device).not.toHaveAttribute('data-app-name-color');

    // Convite: the first admin's invite and the domain it waits for; the draft steps are done.
    await expect(page.getByRole('heading', { level: 2, name: WIZARD.invite.title })).toBeVisible();
    await expect(page.getByText(`admin+${slug}@e2e.local`).first()).toBeVisible();
    await expect(page.getByText(host).first()).toBeVisible();
    await expect(steps.getByRole('link')).toHaveCount(0);

    // The device's own controls: another screen and the dark theme, inside the device only. The
    // "Complete seu perfil" popup was answered when the phone left Início for the titles' ink, so
    // it never came back and the tab bar is there.
    await expect(device.locator('[data-preview-nudge]')).toHaveCount(0);
    await signOutInDevice(device);
    await expect(device).toContainText(`Comunidade: ${name}`);
    await page.getByRole('button', { name: 'Escuro', exact: true }).click();
    await expect(device).toHaveAttribute('data-theme', 'dark');

    // A reload in the middle of the wizard brings the created tenant back into the device, its
    // saved look included.
    await page.reload();
    await expect(device).toContainText(name);
    await expect(device).toHaveAttribute('data-bg-tone', 'amarelado');
  });

  test('a refused creation writes nothing and sends the person back to fix the data', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    await signIn(page);
    // The slug the first test created is taken now: the API refuses it at the confirmation.
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await fillTenantData(page, { name: `${name} 2`, slug, email: `outro+${slug}@e2e.local` });
    await continueFromData(page);
    await continueFromPersonalization(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);
    await page.getByRole('button', { name: WIZARD.summary.create, exact: true }).click();
    await page.locator('[data-create-confirm]').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(WIZARD.confirm.failed.data);
    await dialog.getByRole('button', { name: WIZARD.confirm.failed.fix }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo$/);
    await expect(
      page.locator('form').getByRole('alert').filter({ hasText: 'Este slug já está em uso.' }),
    ).toBeVisible();
    await expect(page.locator('#displayName')).toHaveValue(`${name} 2`);
  });

  test('a host already in use still creates the tenant: the dialog says why, and closing it moves on to the invite', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    await signIn(page);
    // The first test attached `host` to its tenant: this one is refused (409) after the creation.
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await fillTenantData(page, {
      name: `${name} D`,
      slug: slugDomain,
      email: `dominio+${slug}@e2e.local`,
    });
    await continueFromData(page);
    await continueFromPersonalization(page);
    await page.locator('#host').fill(host);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);
    await page.getByRole('button', { name: WIZARD.summary.create, exact: true }).click();
    await page.locator('[data-create-confirm]').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(WIZARD.confirm.failed.partialTitle, { timeout: 60_000 });
    const domainTask = dialog.locator('[data-task="domain"]');
    await expect(domainTask).toHaveAttribute('data-state', 'failed');
    await expect(domainTask).toContainText(DOMAINS.errors.taken);
    expect(await getTenantModuleFlag(slugDomain, 'feed')).toBe(true);

    // The tenant exists: no way back to a summary that would create it again. Escape moves on to
    // its invite step, which clears the draft (the summary is closed again).
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(WIZARD_INVITE_PATH, { timeout: 30_000 });
    await expect(page.getByText(`dominio+${slug}@e2e.local`).first()).toBeVisible();
    await page.goto(`${hosts.platform}/plataforma/novo/resumo`);
    await expect(page).toHaveURL(/\/plataforma\/novo$/);
    await expect(page.locator('#displayName')).toHaveValue('');
  });

  test('an answer lost on the way back: the wizard recognises the tenant it created, with no false "slug in use"', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    await signIn(page);
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await fillTenantData(page, {
      name: `${name} P`,
      slug: slugLost,
      email: `perdida+${slug}@e2e.local`,
    });
    await continueFromData(page);
    await continueFromPersonalization(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);

    // The creation reaches the server (the tenant IS created) but its answer never reaches the
    // page. Asking again hears "slug taken": Next replays an action whose fetch failed (its offline
    // handling), and where it does not, the dialog offers "Tentar de novo" without claiming either
    // way. Both end the same: the slug is THIS draft's tenant (same slug, name and first admin), and
    // the wizard moves on to its invite step instead of sending the person to change the slug.
    let lost = false;
    await page.route('**/plataforma/novo/resumo', async (route) => {
      const request = route.request();
      if (!lost && request.method() === 'POST' && request.headers()['next-action']) {
        lost = true;
        await deliverWithoutAnswer(request);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: WIZARD.summary.create, exact: true }).click();
    await page.locator('[data-create-confirm]').click();
    const dialog = page.getByRole('dialog');
    const retry = dialog.getByRole('button', { name: WIZARD.confirm.failed.retry });
    await Promise.race([
      page.waitForURL(WIZARD_INVITE_PATH, { timeout: 60_000 }),
      retry.waitFor({ timeout: 60_000 }),
    ]);
    expect(lost).toBe(true);
    if (!WIZARD_INVITE_PATH.test(page.url())) {
      await expect(dialog).toContainText(WIZARD.confirm.failed.genericTitle);
      await retry.click();
    }
    await expect(page).toHaveURL(WIZARD_INVITE_PATH, { timeout: 60_000 });
    await expect(page.getByText(`perdida+${slug}@e2e.local`).first()).toBeVisible();
    expect(await getTenantModuleFlag(slugLost, 'feed')).toBe(true);
  });

  test('is navigable: tabs, the app links, the login and the like work inside the device only', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    await signIn(page);
    await page.goto(`${hosts.platform}/plataforma/novo`);

    const device = page.locator('[data-device-screen]');
    // The screen the app shows (the panel has no screen control the pointer sees).
    const app = device.locator('[data-preview-screen]');
    const on = (screen: string) => expect(app).toHaveAttribute('data-preview-screen', screen);
    await on('home');

    // The "Complete seu perfil" popup rises over Início inside the phone, as it does in the app,
    // and the tab bar steps aside until it is answered. "Completar agora" opens the profile and
    // ends it for the visit, so Início comes back without it.
    const nudge = device.locator('[data-preview-nudge]');
    await expect(nudge).toBeVisible();
    await expect(device.locator('[data-preview-tab="home"]')).toBeHidden();
    await nudge.getByText(PROFILE.nudge.action, { exact: true }).click();
    await on('profile');
    await device.locator('[data-preview-tab="home"]').click();
    await on('home');
    // Well past the popup's 500 ms, so that its absence means something.
    await page.waitForTimeout(1_000);
    await expect(nudge).toHaveCount(0);

    // 2026-10-03: the next event is the red dot on the Eventos tab, no longer a card on Início (the
    // sample screen lists an event for tomorrow, so the dot is always there).
    await expect(device.locator('[data-preview-tab="events"] [data-badge-dot]')).toHaveCount(1);
    await expect(device.locator('[data-preview-tab] [data-badge-dot]')).toHaveCount(1);
    await expect(app.locator('a[href="/eventos"]')).toHaveCount(0);

    // The tab bar: the screen changes. Eventos is the two galleries (2026-10-03), each under its
    // title and line, and no longer the list's subtitle.
    await device.locator('[data-preview-tab="events"]').click();
    await expect(device).toContainText(EVENTS.sections.mine.subtitle);
    await expect(device).toContainText(EVENTS.sections.others.subtitle);
    await expect(device).not.toContainText(EVENTS.list.subtitle);
    await on('events');
    await device.locator('[data-preview-tab="home"]').click();
    await on('home');

    // A press-and-drag scrolls the screen, and the release over a link is NOT a tap on it.
    const scroller = device.locator('.app-scroll');
    const author = app.locator('a[href="/membros"]').first();
    const from = await author.boundingBox();
    if (!from) throw new Error("the sample post's author link is not on screen");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 160, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await on('home');

    // The app's own links (the modules' cards and rows are plain `<a>`) open the preview's screen,
    // never a page of the panel's host: the post author's goes to the profile.
    await author.click();
    await on('profile');
    await expect(page).toHaveURL(/\/plataforma\/novo$/);

    // Back on Início, the like answers locally: the heart is pressed, no request leaves the panel.
    await device.locator('[data-preview-tab="home"]').click();
    await on('home');
    const like = device.locator('[role="article"] [data-like-state]').first();
    await expect(like).toHaveAttribute('data-like-state', 'unliked');
    await like.click();
    await expect(like).toHaveAttribute('data-like-state', 'liked');
    await expect(like).toHaveAttribute('aria-pressed', 'true');

    // Configurações: "Tema escuro" switches the device's theme, and "Sair" opens the login.
    await device.locator('[data-preview-tab="profile"]').click();
    await device.locator('a[href="/configuracoes"]').click();
    await on('settings');
    await device.getByRole('switch', { includeHidden: true }).click();
    await expect(device).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Escuro', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await device.locator('[data-preview-logout]').click();
    await on('login');

    // The login takes text and "Entrar" lands on Início, where the popup rises again: "Entrar" is a
    // sign-in and starts a new visit, as a submitted sign-in does in the app (the login screen
    // alone did not). "Mais tarde" closes it.
    const email = device.locator('#device-preview-email');
    await email.fill('membro@exemplo.com');
    await expect(email).toHaveValue('membro@exemplo.com');
    await device.locator('button', { hasText: /^Entrar$/ }).click();
    await on('home');
    await expect(nudge).toBeVisible();
    await nudge.getByText(PROFILE.nudge.dismiss, { exact: true }).click();
    await expect(nudge).toHaveCount(0);
    await expect(page).toHaveURL(/\/plataforma\/novo$/);

    // Still out of the keyboard's way: nothing inside the device takes Tab focus.
    const focusable = await device.evaluate(
      (el) =>
        Array.from(el.querySelectorAll('a[href], button, input, [tabindex]')).filter(
          (node) => node.getAttribute('tabindex') !== '-1',
        ).length,
    );
    expect(focusable).toBe(0);

    // The keyboard's way to the same screens: never under the pointer, still operable.
    const keyboardPicker = page.getByLabel(PREVIEW.screens);
    await expect(keyboardPicker).toHaveCSS('opacity', '0');
    await keyboardPicker.selectOption('events');
    await on('events');

    // The picker never raises the popup again: the login screen it shows is no sign-in.
    await keyboardPicker.selectOption('login');
    await on('login');
    await keyboardPicker.selectOption('home');
    await on('home');
    await page.waitForTimeout(1_000);
    await expect(nudge).toHaveCount(0);

    // And once a sign-in has raised it, the picker is the keyboard's way past it: the scrim covers
    // the whole phone, so only the picker can leave Início, and leaving answers it for the visit.
    await keyboardPicker.selectOption('login');
    await on('login');
    await device.locator('button', { hasText: /^Entrar$/ }).click();
    await on('home');
    await expect(nudge).toBeVisible();
    await keyboardPicker.selectOption('events');
    await on('events');
    await keyboardPicker.selectOption('home');
    await on('home');
    await page.waitForTimeout(1_000);
    await expect(nudge).toHaveCount(0);
  });

  test('the admin view shows the create and manage controls, and none of them does anything', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the device shows from xl up');
    await signIn(page);
    await page.goto(`${hosts.platform}/plataforma/novo`);

    const device = page.locator('[data-device-screen]');
    const app = device.locator('[data-preview-screen]');
    const on = (screen: string) => expect(app).toHaveAttribute('data-preview-screen', screen);
    const admin = device.locator('[data-preview-admin]');
    const view = (name: string) => page.getByRole('button', { name, exact: true });

    // The member's app first: none of the admin's controls.
    await expect(device.locator('[data-preview-view="member"]')).toBeVisible();
    await expect(admin).toHaveCount(0);
    // The "Complete seu perfil" popup over Início covers the screen until it is answered.
    const nudge = device.locator('[data-preview-nudge]');
    await expect(nudge).toBeVisible();
    await nudge.getByText(PROFILE.nudge.dismiss, { exact: true }).click();
    await expect(nudge).toHaveCount(0);

    await view(PREVIEW.views.admin).click();
    await expect(view(PREVIEW.views.admin)).toHaveAttribute('aria-pressed', 'true');
    await expect(device.locator('[data-preview-view="admin"]')).toBeVisible();

    // Início: the compose button and the two story circles the admin's permissions turn on.
    await expect(device.locator('[data-preview-admin="compose"]')).toBeVisible();
    await expect(device.getByText(STORIES.own.label, { exact: true })).toBeVisible();
    await expect(device.getByText(STORIES.highlights.circle.label, { exact: true })).toBeVisible();
    // The post's "…" sheet holds the author's rows; a row only closes the sheet.
    await device.locator(`[role="article"] button[aria-label="${FEED.actions.more}"]`).click();
    const menu = device.locator('[data-preview-post-menu]');
    await expect(menu.locator('[data-preview-admin="post-edit"]')).toBeVisible();
    await expect(menu.locator('[data-preview-admin="post-delete"]')).toBeVisible();
    await menu.locator('[data-preview-admin="post-delete"]').click();
    await expect(menu).toHaveCount(0);
    // The compose button opens nothing.
    await device.locator('[data-preview-admin="compose"]').click();
    await on('home');

    // Comunidades, Eventos, Reels: each list's create control, inert.
    await device.locator('[data-preview-tab="communities"]').click();
    await expect(device.locator('[data-preview-admin="communities-create"]')).toBeVisible();
    await device.locator('[data-preview-admin="communities-create"]').click();
    await on('communities');
    await device.locator('[data-preview-tab="events"]').click();
    const eventsCreate = device.locator('[data-preview-admin="events-create"]');
    await expect(eventsCreate).toBeVisible();
    // Beside the first gallery's title, "Meus eventos", as in the app (2026-10-03): on its row.
    const createBox = await eventsCreate.boundingBox();
    const firstTitle = await device
      .locator('[data-preview-title]', { hasText: EVENTS.sections.mine.title })
      .boundingBox();
    if (!createBox || !firstTitle) throw new Error('the events create control or title has no box');
    expect(createBox.y).toBeLessThan(firstTitle.y + firstTitle.height);
    expect(createBox.y + createBox.height).toBeGreaterThan(firstTitle.y);
    await device.locator('[data-preview-tab="reels"]').click();
    await expect(device.locator('[data-preview-admin="reels-create"]')).toBeVisible();
    await device.locator('[data-preview-admin="reels-create"]').click();
    await on('reels');
    await expect(page).toHaveURL(/\/plataforma\/novo$/);
    // Configurações: the Administração group (Mídia, Seus stories).
    await device.locator('[data-preview-tab="profile"]').click();
    await device.locator('a[href="/configuracoes"]').click();
    await expect(device.locator('[data-preview-admin="settings-admin"]')).toBeVisible();

    // Back to the member: the controls are gone, and the post sheet keeps only "Copiar link".
    await view(PREVIEW.views.member).click();
    await expect(admin).toHaveCount(0);
    await device.locator('[data-preview-tab="home"]').click();
    await expect(admin).toHaveCount(0);
    await expect(device.getByText(STORIES.own.label, { exact: true })).toHaveCount(0);
    await device.locator(`[role="article"] button[aria-label="${FEED.actions.more}"]`).click();
    await expect(device.locator('[data-preview-post-menu] button')).toHaveCount(1);
  });
});
