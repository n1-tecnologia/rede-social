import { isStandalone, type WindowLike } from '@/components/pwa/InstallHint';
import { subscriptionBody } from './push-sw';

/**
 * The client half of Web Push (NOTIF-03, PWA-02, D-233, D-234): ONE module shared by the soft-ask
 * card and the Configurações switch (UI-D-255/256), so the gesture rule, the iOS gate and the
 * resync exist once. Every call reaches the BFF (`/api/push/subscriptions`), never the API or
 * Supabase directly.
 *
 * Facts a reader must not "fix":
 *
 * 1. **The prompt is the FIRST await of a tap** (RESEARCH Pitfall 6). `enablePush` awaits
 *    `Notification.requestPermission()` before anything else, and its callers obtain the service
 *    worker registration and the VAPID key before the tap. An `await` before the prompt breaks the
 *    iOS gesture chain and the prompt is silently refused. Nothing here ever prompts from an effect.
 * 2. **iOS and iPadOS need the Home Screen app** for push, whichever browser is used (D-234).
 *    `isIosLike` also catches iPadOS, which announces itself as a Mac with touch (Pitfall 13).
 * 3. **The resync keeps the VAPID pair `costly`, not one-way.** On every open with permission granted
 *    the current subscription is re-saved (an idempotent upsert), and a subscription made with
 *    another key is replaced without a prompt (`syncPushOnOpen`).
 * 4. **Logout never waits on the network for long.** `disablePush` bounds each step to 2 s and never
 *    throws, so a dead network cannot keep a member signed in on a shared device.
 * 5. **The soft-ask dismissal is a UX preference** (T-02-78): storage failures read as "not
 *    dismissed", and the flag never authorises anything; the server decides every subscription.
 * 6. **The first-open ask is a second, separate surface** (quick 261007-kyp): a one-time sheet on the
 *    first open of the INSTALLED app, with its own key (`rede_push_firstopen_asked`), apart from the
 *    /notificacoes soft-ask card, which stays the member's second chance. Unlike the card, an
 *    unreadable store reads as ALREADY asked: when the answer cannot be remembered, nagging on every
 *    open is worse than silence. It still never prompts from an effect, only from a tap (fact 1).
 */

export const PUSH_SOFTASK_DISMISSED_KEY = 'rede_push_softask_dismissed';

/** Each logout-time step (unsubscribe, DELETE) waits at most this long. */
export const PUSH_STEP_TIMEOUT_MS = 2000;

const SUBSCRIPTIONS_URL = '/api/push/subscriptions';

export type PushSupport = 'unsupported' | 'ios-install' | 'available';

export type PushState = 'checking' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied';

/** The slice of `window` the support check reads (the real window satisfies it). */
export type PushWindowLike = WindowLike & {
  navigator?: WindowLike['navigator'] & {
    userAgent?: string;
    maxTouchPoints?: number;
    serviceWorker?: unknown;
  };
  PushManager?: unknown;
  Notification?: { permission?: string };
};

/** The slice of `PushSubscription` this module uses. */
export type PushSubscriptionLike = {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null } | null;
  toJSON(): { endpoint?: string | null; keys?: Record<string, string> | null };
  unsubscribe(): Promise<boolean>;
};

/** The slice of `ServiceWorkerRegistration` this module uses. */
export type PushRegistrationLike = {
  pushManager: {
    getSubscription(): Promise<PushSubscriptionLike | null>;
    subscribe(options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    }): Promise<PushSubscriptionLike>;
  };
};

/** iPhone, iPod, iPad, and iPadOS's desktop-class UA (`Macintosh` with more than one touch point). */
export function isIosLike(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * `unsupported`: no VAPID key, or no service worker / `PushManager` / `Notification` (iOS standalone
 * below 16.4 lands here). `ios-install`: iOS or iPadOS outside the Home Screen app. Else `available`.
 */
export function pushSupport(win: PushWindowLike, vapidKey: string | null | undefined): PushSupport {
  if (!vapidKey) return 'unsupported';
  const nav = win.navigator;
  if (isIosLike(nav?.userAgent ?? '', nav?.maxTouchPoints ?? 0) && !isStandalone(win)) {
    return 'ios-install';
  }
  if (!nav?.serviceWorker || !win.PushManager || !win.Notification) return 'unsupported';
  return 'available';
}

/** The row's state after mount (`checking` is only the server render). */
export async function readPushState(
  registration: PushRegistrationLike | null,
  { win, vapidKey }: { win: PushWindowLike; vapidKey: string | null | undefined },
): Promise<Exclude<PushState, 'checking'>> {
  const support = pushSupport(win, vapidKey);
  if (support !== 'available') return support;
  const permission = win.Notification?.permission;
  if (permission === 'denied') return 'denied';
  if (!registration) return 'unsupported';
  if (permission !== 'granted') return 'off';
  try {
    return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** `true` when the subscription was made with `vapidKey` (an unknown key counts as the same). */
function sameKey(subscription: PushSubscriptionLike, vapidKey: string): boolean {
  const stored = subscription.options?.applicationServerKey;
  if (!stored) return true;
  const a = new Uint8Array(stored);
  const b = urlBase64ToUint8Array(vapidKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '');
}

/** POSTs the subscription to the BFF; throws on anything but a 2xx. */
async function saveSubscription(subscription: PushSubscriptionLike): Promise<void> {
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscriptionBody(subscription.toJSON(), userAgent())),
  });
  if (!res.ok) throw new Error(`push.save_failed:${res.status}`);
}

function subscribeWith(registration: PushRegistrationLike, vapidKey: string) {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
}

export type EnablePushInput = { registration: PushRegistrationLike; vapidKey: string };
export type EnablePushResult = 'on' | 'denied' | 'dismissed';

/**
 * Turns push on from a TAP. The permission prompt is the first await (fact 1). `denied` and
 * `dismissed` (the prompt closed with no choice) change nothing. A save failure unsubscribes again
 * and throws, so the device never holds a subscription the server does not know.
 */
export async function enablePush(input: EnablePushInput): Promise<EnablePushResult> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  const { registration, vapidKey } = input;

  const existing = await registration.pushManager.getSubscription();
  if (existing && !sameKey(existing, vapidKey)) await existing.unsubscribe();
  const subscription =
    existing && sameKey(existing, vapidKey)
      ? existing
      : await subscribeWith(registration, vapidKey);
  try {
    await saveSubscription(subscription);
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return 'on';
}

/** Resolves `promise`, or `fallback` after `ms` (never rejects). */
async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Turns push off on this device: unsubscribes and DELETEs its row, each step bounded to 2 s and best
 * effort (fact 4). `unsubscribed` tells the switch whether the device really stopped; logout ignores
 * the result.
 */
export async function disablePush(
  registration: PushRegistrationLike | null | undefined,
): Promise<{ unsubscribed: boolean; deleted: boolean }> {
  if (!registration) return { unsubscribed: true, deleted: false };
  const subscription = await within(
    registration.pushManager.getSubscription(),
    PUSH_STEP_TIMEOUT_MS,
    null,
  );
  if (!subscription) return { unsubscribed: true, deleted: false };
  const endpoint = subscription.endpoint;
  const [unsubscribed, deleted] = await Promise.all([
    within(subscription.unsubscribe(), PUSH_STEP_TIMEOUT_MS, false),
    within(
      fetch(SUBSCRIPTIONS_URL, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
        keepalive: true,
      }).then((res) => res.ok),
      PUSH_STEP_TIMEOUT_MS,
      false,
    ),
  ]);
  return { unsubscribed, deleted };
}

/**
 * Every app open with permission granted (fact 3): re-save the current subscription, or replace one
 * made with another VAPID key without a prompt. No subscription (after a logout) stays off: turning it
 * back on is the member's choice. Never throws.
 */
export async function syncPushOnOpen(
  registration: PushRegistrationLike,
  vapidKey: string,
): Promise<'skipped' | 'none' | 'synced' | 'resubscribed' | 'failed'> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return 'skipped';
  }
  try {
    const current = await registration.pushManager.getSubscription();
    if (!current) return 'none';
    if (sameKey(current, vapidKey)) {
      await saveSubscription(current);
      return 'synced';
    }
    await current.unsubscribe();
    const fresh = await subscribeWith(registration, vapidKey);
    await saveSubscription(fresh);
    return 'resubscribed';
  } catch {
    return 'failed';
  }
}

/** The soft-ask dismissal (UX only). A storage failure reads as "not dismissed". */
export function readSoftAskDismissed(): boolean {
  try {
    return window.localStorage.getItem(PUSH_SOFTASK_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeSoftAskDismissed(): void {
  try {
    window.localStorage.setItem(PUSH_SOFTASK_DISMISSED_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode quota): the card simply leaves for this session.
  }
}

export const PUSH_FIRSTOPEN_ASKED_KEY = 'rede_push_firstopen_asked';

/** What the member answered the first-open sheet (the stored value is the choice, nothing else). */
export type FirstOpenAnswer = 'later' | 'denied' | 'enabled';

/** The first-open answer exists. An unreadable store counts as asked (fact 6). */
export function readFirstOpenAsked(): boolean {
  try {
    return window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY) !== null;
  } catch {
    return true;
  }
}

export function writeFirstOpenAsked(choice: FirstOpenAnswer): void {
  try {
    window.localStorage.setItem(PUSH_FIRSTOPEN_ASKED_KEY, choice);
  } catch {
    // Storage unavailable: the sheet closes for this session; the next open reads "asked" anyway.
  }
}

/**
 * The first-open sheet is due only in the installed app (`standalone`), with push possible and not
 * yet decided (`state` `off`: supported, permission still `default`, not subscribed), and never
 * answered before. `denied`, `on`, `unsupported`, `ios-install` and `checking` never qualify.
 */
export function firstOpenAskDue({
  standalone,
  state,
  asked,
}: {
  standalone: boolean;
  state: PushState;
  asked: boolean;
}): boolean {
  return standalone && state === 'off' && !asked;
}

/**
 * Another modal dialog is open (the kernel keys the BottomNav hiding on the same selector). The
 * profile nudge popup rises on Início and traps focus; two focus traps at once ping-pong, so the
 * first-open sheet waits. `root` only needs a `querySelector`.
 */
export function anotherModalOpen(root: { querySelector(selector: string): unknown }): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}

/**
 * The page's service worker registration, awaited on mount (BEFORE any tap, fact 1). Null when the
 * browser has no service worker support; otherwise it resolves once the worker is active.
 */
export async function pushRegistration(): Promise<PushRegistrationLike | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.ready) as unknown as PushRegistrationLike;
  } catch {
    return null;
  }
}

/** The registration for logout, bounded to 2 s (a worker that never activates cannot hold logout). */
export function pushRegistrationWithin(ms = PUSH_STEP_TIMEOUT_MS) {
  return within(pushRegistration(), ms, null);
}
