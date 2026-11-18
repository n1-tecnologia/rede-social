import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import chatMessages from '../messages/pt-BR/chat.json' with { type: 'json' };
import { closeAdmin, createMember, deleteUserByEmail, disallowEmail } from './admin';
import {
  closeChatAdmin,
  conversationIdOf,
  deleteVoiceAssetsOf,
  resetMemberConversation,
  SUPPORT_EMAIL,
} from './chat-admin';
import { hosts, login, SEED_PASSWORD } from './fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 12.5 (VOICE-09, VOICE-19, VOICE-20, VOICE-24; D-849, D-853, D-858): the voice message in a real
 * browser, on the phone (`mobile-chromium`) and on the desktop (`desktop-chromium`), both Chromium.
 *
 * Test 1 is the tracer: one recording walked from the member's microphone to the team's speakers through the
 * real screens of both sides, the fake microphone of Chromium standing in for a person (the member taps the
 * microphone, records about two seconds, taps send, sees the pending bubble and then the settled one; the
 * demo support user, in a second context, sees the inbox row with the microphone glyph and the length, opens
 * the thread, taps the disc and the audio element really plays, then pauses). The other tests pin what only a
 * browser can: the media gate seen from another member, the deleted state, the refused microphone and the
 * too-short discard.
 *
 * **WRITTEN AND LISTED, NEVER RUN BY AN AGENT** (project rule, Igor's word, as `chat-cases.spec.ts` was): this
 * file was loaded with `playwright test --list` and typechecked, nothing more. The run is a ledger row of plan
 * 12.5-18 and happens on Igor's word. It needs the API, the web app and the worker with ffmpeg (the worker
 * derives the stored `audio/mp4` file; `ensureWorker` brings one, as the notification specs do).
 *
 * **Fake microphone (research assumption A6, confirmed only by the run).** The launch arguments
 * `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` give `getUserMedia` a synthetic
 * tone and no prompt, and `permissions: ['microphone']` grants it. Playwright has no way to DENY a permission
 * while the fake-UI flag is on (the flag answers every prompt), so the refusal test answers the capture call
 * itself with the `NotAllowedError` a real denial raises; a real denial on a real phone is Igor's proof. If the
 * run shows the fake device does not work with these projects, the unit tests of plans 13 to 15 still cover the
 * logic and the finding goes to the ledger. The stored file is mono AAC `audio/mp4`: Playwright's bundled
 * Chromium may lack proprietary codecs, so the play step names that cause in its failure; set
 * `PLAYWRIGHT_VOICE_CHANNEL=chrome` to run the spec on the installed Google Chrome (see `fixtures/README.md`).
 *
 * **Neutrality (the 12.4 rules).** Everything here is a throwaway `e2evoice-` member (created and deleted by
 * this file, never a seeded one and never an account of the owner) and the seeded `support@` of the demo
 * tenant. The spec never resets or seeds the database, never edits the seeded support thread, never touches
 * the case counter, names no payment gateway and no push provider, writes no pt-BR sentence (every string is
 * read from the real `chat.json` through `createTranslator`), and prints no media path, cookie or token (it
 * asserts statuses only). It leaves no row behind: `beforeEach` and `afterAll` delete the throwaway members'
 * conversations (the messages and cases cascade), then their voice assets, then the members.
 *
 * `serviceWorkers: 'block'` is the 03-05 lesson: a worker answering a navigation from its own cache would
 * make these assertions read what a previous run left behind.
 */
const voiceChannel = process.env.PLAYWRIGHT_VOICE_CHANNEL;
test.use({
  serviceWorkers: 'block',
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
  ...(voiceChannel ? { channel: voiceChannel } : {}),
});
/** The tracer walks two browsers and a worker with ffmpeg: every case here gets the long budget. */
test.describe.configure({ timeout: 240_000 });

/** The catalog is the source of copy, never a literal in a spec. */
const C = chatMessages.chat;
const V = C.voice;
const tc = createTranslator({
  locale: 'pt-BR',
  messages: chatMessages,
  namespace: 'chat',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Mensagem de voz · 0:0N" with any length of a few seconds, built from the catalog template. */
const PREVIEW = new RegExp(
  escapeRegExp(tc('voice.preview', { duration: '@@' })).replace('@@', '0:\\d\\d'),
);
/** A length label as the player and the preview draw it ("0:02"). */
const CLOCK = /\b0:\d\d\b/;

const stamp = Date.now();
const MEMBER = `e2evoice-${stamp}-a@rede-demo.local`;
const OTHER = `e2evoice-${stamp}-b@rede-demo.local`;
const THROWAWAY = [MEMBER, OTHER] as const;

let stopWorker: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  for (const email of THROWAWAY) await createMember(email, SEED_PASSWORD, 'rede-demo');
  stopWorker = await ensureWorker();
});

/** A clean slate for the throwaway members: conversations first (their messages hold the asset key), then assets. */
async function clean(): Promise<void> {
  for (const email of THROWAWAY) {
    await resetMemberConversation(email);
    await deleteVoiceAssetsOf(email);
  }
}

test.beforeEach(async () => {
  await clean();
});

test.afterAll(async () => {
  await clean().catch(() => {});
  for (const email of THROWAWAY) {
    await deleteUserByEmail(email);
    await disallowEmail(email);
  }
  await closeAdmin();
  await closeChatAdmin();
  await stopWorker();
});

// ── locators ─────────────────────────────────────────────────────────────────────────────────────

/** The visible thread column (the dev server's Fast Refresh can leave a hidden stale copy). */
const thread = (page: Page) => page.locator('[data-chat-thread]').filter({ visible: true });
/** The microphone of the composer: the same button as the send, named by the catalog. */
const micButton = (page: Page) => page.getByRole('button', { name: V.mic.label, exact: true });
/** The send of a recording: "Enviar mensagem de voz", or "Abrir chamado com a mensagem de voz" while the opener shows. */
const recordingSend = (page: Page) =>
  page.getByRole('button', {
    name: new RegExp(`^(${escapeRegExp(V.recording.send)}|${escapeRegExp(V.recording.sendNew)})$`),
  });
/** The elapsed counter of the recording row. */
const recordingTimer = (page: Page) => page.getByRole('timer', { name: V.recording.timer });
/** The own voice bubble still uploading (the ghost player, dimmed, with a progress bar). */
const pendingBubble = (page: Page) =>
  thread(page).locator('[data-chat-bubble="own"][data-pending]');
/** The own voice bubble the server answered: a real audio element and no pending mark. */
const settledBubble = (page: Page) =>
  thread(page)
    .locator('[data-chat-bubble="own"]:not([data-pending])')
    .filter({ has: page.locator('audio') });
/** The inbox rows IN the list pane (scoped on purpose, see `chat.spec.ts`). */
const listPane = (page: Page) => page.locator('[data-support-list]');
const inboxRow = (page: Page, conversationId: string) =>
  listPane(page).locator(`a[data-inbox-row][href^="/suporte/${conversationId}"]`);

// ── contexts ─────────────────────────────────────────────────────────────────────────────────────

type DeviceUse = Parameters<Browser['newContext']>[0];

/** The pieces of the project's device preset a second context must repeat to look the same. */
interface Device {
  contextOptions: DeviceUse;
  viewport: { width: number; height: number } | null;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string | undefined;
  deviceScaleFactor: number | undefined;
}

const deviceOf = (device: Device): DeviceUse => ({
  ...device.contextOptions,
  viewport: device.viewport,
  isMobile: device.isMobile,
  hasTouch: device.hasTouch,
  userAgent: device.userAgent,
  deviceScaleFactor: device.deviceScaleFactor,
});

/** A second, independent browser context (its own cookies) signed in as `email` on the demo host. */
async function contextAs(browser: Browser, email: string, use: DeviceUse) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, email, SEED_PASSWORD, hosts.demo);
  return { context, page };
}

// ── the recording ────────────────────────────────────────────────────────────────────────────────

/**
 * The member records about two seconds with the fake device and sends it. The wait is on the counter of the
 * recording row reaching two seconds (never a fixed sleep); the send is the same button as the microphone, named
 * by the catalog. Returns once the take is on its way (the bubble is the caller's assertion).
 */
async function recordAndSend(page: Page): Promise<void> {
  await page.goto(`${hosts.demo}/suporte`);
  await expect(micButton(page)).toBeEnabled();
  await micButton(page).click();
  await expect(recordingTimer(page)).toBeVisible();
  await expect(recordingTimer(page)).toHaveText(/^0:(0[2-9]|[1-5]\d)$/);
  await recordingSend(page).click();
}

/** The audio element of the thread's first voice bubble, as a handle `waitForFunction` can read. */
async function firstAudio(page: Page): Promise<Locator> {
  const audio = thread(page).locator('audio').first();
  await expect(audio).toHaveCount(1);
  return audio;
}

// ── 1. the tracer ────────────────────────────────────────────────────────────────────────────────

test.describe('mensagem de voz no navegador', () => {
  test('1. voice tracer: a member records and sends, the team sees the row, opens the thread and plays it', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }) => {
    await login(page, MEMBER, SEED_PASSWORD, hosts.demo);
    await recordAndSend(page);

    // The member sees the pending bubble at once, then the settled one with the stored length.
    await expect(pendingBubble(page)).toBeVisible();
    await expect(settledBubble(page)).toHaveCount(1, { timeout: 90_000 });
    await expect(pendingBubble(page)).toHaveCount(0);
    await expect(settledBubble(page)).toContainText(CLOCK);
    await expect(settledBubble(page).getByRole('group')).toHaveAccessibleName(
      new RegExp(`^${escapeRegExp(V.message)}`),
    );
    const conversationId = await conversationIdOf(MEMBER);

    // The team: a second context as the support user finds the row with the glyph and the length.
    const staff = await contextAs(
      browser,
      SUPPORT_EMAIL,
      deviceOf({ contextOptions, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }),
    );
    try {
      const sp = staff.page;
      await sp.goto(`${hosts.demo}/suporte`);
      const row = inboxRow(sp, conversationId);
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row.locator('[data-inbox-preview]')).toContainText(PREVIEW);
      await expect(row.locator('[data-inbox-preview] svg')).toHaveCount(1);

      await row.click();
      await expect(sp).toHaveURL(new RegExp(`/suporte/${conversationId}`));
      const theirs = thread(sp)
        .locator('[data-chat-bubble="other"]')
        .filter({ has: sp.locator('audio') });
      await expect(theirs).toHaveCount(1, { timeout: 30_000 });
      await expect(theirs).toContainText(CLOCK);

      // The disc plays the real file: the audio element reports `paused === false` and moving time.
      const audio = await firstAudio(sp);
      const canPlayAac = await audio.evaluate((el) =>
        (el as HTMLAudioElement).canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      );
      expect(
        canPlayAac,
        'this Chromium build cannot decode AAC: run with the installed Chrome (PLAYWRIGHT_VOICE_CHANNEL=chrome)',
      ).not.toBe('');
      await theirs.getByRole('button', { name: V.player.play, exact: true }).click();
      const handle = await audio.elementHandle();
      if (!handle) throw new Error('the audio element is gone');
      await sp.waitForFunction(
        (el) => {
          const media = el as HTMLAudioElement;
          return !media.paused && media.currentTime > 0;
        },
        handle,
        { timeout: 30_000 },
      );

      // And pauses again.
      await theirs.getByRole('button', { name: V.player.pause, exact: true }).click();
      await expect.poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused)).toBe(true);
      await expect(theirs.getByRole('button', { name: V.player.play, exact: true })).toBeVisible();
    } finally {
      await staff.context.close();
    }
  });
});
