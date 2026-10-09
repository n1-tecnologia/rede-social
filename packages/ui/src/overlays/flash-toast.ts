import type { ToastOptions } from './Toast';

/**
 * A toast that outlives its document (2026-10-09). A form's save that steps back to the screen it
 * changed (`goBackTo`) crosses documents when that form was a full load (a plain link opened it): the
 * page whose `ToastProvider` was showing "Alterações salvas." goes away with its toast. So the toast
 * is written here for the screen the step lands on, and that screen's `ToastProvider` shows it when
 * it mounts. A step inside one document keeps its toast on screen, and the form clears this.
 *
 * It is kept for one pathname and a few seconds, so it never surfaces later somewhere else. No React,
 * no Next: it touches `window` only when called, like `back-stack.ts`.
 */

const STORAGE_KEY = 'rede-social:flash-toast';
/** Long enough for a slow back navigation, short enough that a stray one never shows up later. */
const MAX_AGE_MS = 15_000;

interface StoredFlash extends ToastOptions {
  pathname: string;
  at: number;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps `options` for the next document that mounts at `pathname`. */
export function flashToast(options: ToastOptions, pathname: string): void {
  const storage = store();
  if (!storage) return;
  const flash: StoredFlash = { ...options, pathname, at: Date.now() };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(flash));
  } catch {
    // Storage full or blocked: the toast stays where it was shown.
  }
}

/** Drops a kept toast: the step it was kept for stayed in this document. */
export function clearFlashToast(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was kept where storage throws.
  }
}

/** The toast kept for `pathname`, read once: a stale one, or one for another screen, is dropped. */
export function takeFlashToast(pathname: string): ToastOptions | null {
  const storage = store();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  clearFlashToast();
  try {
    const flash = JSON.parse(raw) as Partial<StoredFlash>;
    const fresh = typeof flash.at === 'number' && Date.now() - flash.at <= MAX_AGE_MS;
    const tone = flash.tone;
    if (
      !fresh ||
      flash.pathname !== pathname ||
      typeof flash.message !== 'string' ||
      (tone !== 'success' && tone !== 'error' && tone !== 'info')
    ) {
      return null;
    }
    return { tone, message: flash.message };
  } catch {
    return null;
  }
}
