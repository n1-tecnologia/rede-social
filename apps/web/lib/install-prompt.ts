/**
 * The early capture of the Android install prompt (quick 261007-kyp). `beforeinstallprompt` fires
 * at most once per page load and only after the browser decides the app is installable, so the
 * listener has to exist as early as the root layout's client chunk: this module registers it at
 * import time, before any component renders and long before a member taps anything. The event is
 * default-prevented (the browser's own mini-infobar stays out of the way) and kept for the
 * "Instalar app" button of the install gate.
 *
 * A tab where the app is already installed never receives the event, and neither does a browser
 * that does not implement it (Safari, Firefox): the Android screen therefore always has manual menu
 * steps for the `none` state.
 *
 * Exposed as an external store (`subscribeInstallPrompt` + `getInstallPromptState`, a stable
 * primitive snapshot) for `useSyncExternalStore`.
 */

export type InstallPromptState = 'none' | 'available' | 'installed';

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
let prompting = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function getInstallPromptState(): InstallPromptState {
  if (installed) return 'installed';
  return deferred ? 'available' : 'none';
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shows the browser's install dialog. Called straight from a click handler, so the FIRST thing done
 * with the stored event is `prompt()` (the browser requires the user gesture); nothing is awaited
 * before it. The event is single use: once the choice is known it is dropped, and an accepted
 * outcome marks the app installed.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event || prompting) return 'unavailable';
  prompting = true;
  try {
    const shown = event.prompt();
    await shown;
    const choice = await event.userChoice;
    deferred = null;
    if (choice.outcome === 'accepted') installed = true;
    notify();
    return choice.outcome;
  } catch {
    deferred = null;
    notify();
    return 'dismissed';
  } finally {
    prompting = false;
  }
}
