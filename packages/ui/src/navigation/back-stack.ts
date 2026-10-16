/**
 * The in-app back stack (2026-10-09): "voltar" steps back to the screen the member came from, not to
 * a fixed parent. The shell's `BackStackTracker` (`@rede-social/core/ui`) starts it and records every
 * pathname the shell shows; a `BackLink` asks `goBack(fallbackHref)` on a plain click. With an app
 * screen behind the current one that is `history.back()`, so the browser restores that screen with
 * its URL and query (a filtered list comes back filtered). With none (a fresh tab, a shared link, a
 * reload with nothing behind it) it answers false and the link's own href, the screen's static
 * parent, navigates exactly as before.
 *
 * **Why a stack and not `history.length`.** The session history also holds what came before the app
 * (the sign-in screen, another site) and never says where an entry points. The stack holds only what
 * the shell itself saw, so `history.back()` runs only when the entry behind is an app screen.
 *
 * **Persisted per tab.** Many in-app links are plain `<a href>` full loads (community cards,
 * notification rows, inbox rows, post headers, posters, chips, tabs), so the stack lives in
 * `sessionStorage` and every document classifies how it was reached (`startBackStack`). Only
 * PATHNAMES are kept: a query-only `router.replace` (a search field, a filter chip) or a same-URL
 * `pushState` (the highlight viewer) is not a new screen. Where storage throws (a private window,
 * blocked site data) the stack lives in memory, which still covers the soft navigations.
 *
 * **Forms hand the navigation back.** A form's way out used to push its parent again, which now
 * stacked a second copy of the screen it came from, and that screen's "Voltar" reopened the form. So
 * the X and "Descartar" step back like a back link (`goBack`), an edit's save returns to the screen
 * it changed when that is the one behind (`goBackTo`), and a create's save replaces the form with
 * what it made (`replaceAppPath` before the router's `replace`); `apps/web/lib/form-exit.ts` wraps the
 * three for the forms.
 *
 * **One "Voltar" is one screen** (review of 2026-10-09). The browser's history can hold several
 * entries of ONE screen (a chip that is a plain link changes only the query; the Reels overlay's
 * `?reel=` entry stays behind after a reload), and a step that lands on the screen it left steps on,
 * up to `MAX_SAME_SCREEN_STEPS`. And a step is one step: a second tap while a slow cross-document
 * back is still on its way is the same step (`stepping`), never a second one that would skip a
 * screen or leave the app.
 *
 * No React, no Next: it touches `window` only when called, so importing it on the server is harmless.
 */

const STORAGE_KEY = 'rede-social:back-stack';
/** Far more screens than anyone walks back through; the oldest fall off. */
const MAX_PATHS = 50;
/** How many entries of the screen being left one "Voltar" walks past before it gives up. */
const MAX_SAME_SCREEN_STEPS = 10;
/** A step that never lands (a back the browser cancelled) stops blocking the next tap after this. */
const STEP_TIMEOUT_MS = 4000;

interface BackStackState {
  /** The screens behind the current one, then the current one (the top). */
  paths: string[];
  /** The screens a back step left, newest last: where the browser's forward button goes. */
  forward: string[];
  /**
   * Set when a back link fell back to its href: the document that load opens is a new root, so its
   * own back link takes ITS fallback instead of returning to the screen the member just left. A
   * form's X falls back with a soft navigation instead, and `recordAppPath` roots it the same way.
   */
  pendingRoot?: string;
  /**
   * Set by `replaceAppPath`: the next screen recorded at this path takes the top's place, as the
   * browser's `replaceState` gave it the top's history entry.
   */
  pendingReplace?: string;
  /**
   * Set by `goBackTo`: the screen it steps back to predates a save. Inside one document the form
   * refreshes it on that step's popstate; when the step crosses documents (the form was a full load)
   * and the browser restores that screen from its back/forward cache, the restored page reloads
   * (`onPageShow`). Any other traversal or document load spends it.
   */
  pendingRefresh?: string;
  /**
   * Set by a back step: the pathname it left. A traversal that lands on that same pathname found
   * another entry of the screen being left, and steps on while `stepsLeft` lasts.
   */
  stepFrom?: string;
  stepsLeft?: number;
}

// Document-level state: a module instance lives exactly as long as its document.
/** A back step is on its way: a second tap is the same step (cleared on landing, or timed out). */
let stepping = false;
let steppingTimer: ReturnType<typeof setTimeout> | undefined;
/** This document was loaded by a back step onto the screen it left: `startBackStack` steps on. */
let stepOnLoad = false;
/**
 * This document is a screen a save stepped back to (`pendingRefresh`), served from the HTTP cache:
 * it predates the save, so `startBackStack` reloads it once (`isReloadingStaleScreen`).
 */
let reloadOnLoad = false;
let reloading = false;
/** The popstate / pageshow listeners are attached (once per document). */
let listening = false;
/** This document's load was classified (by its first `startBackStack`). */
let classified = false;
/** A tracker is mounted, so the stack follows the navigation and back links may use it. */
let active = false;
/** The tracker unmounted for good (the shell left): the next mount starts a new stack. */
let left = false;
/** The latest mount: a cleanup's deferred check sees whether anything mounted after it. */
let mounted: object | null = null;
/** The stack where storage throws, and the last state saved everywhere else. */
let memory: BackStackState = { paths: [], forward: [] };
let storageBroken = false;

const rooted = (path: string): BackStackState => ({ paths: [path], forward: [] });

/**
 * A new history entry at `path`: a new screen on top, or the top itself again when only the query
 * changed (a chip that is a plain link reloads the same screen), which is never a second screen.
 */
const pushed = ({ paths }: BackStackState, path: string): BackStackState => ({
  paths: paths.at(-1) === path ? paths : [...paths, path],
  forward: [],
});

/**
 * The top's history entry now shows `path` (a `replaceState` to another screen). When that is the
 * screen under the top, the two fold into one: a stack that kept both would step back to the same
 * screen and fall out of step with the URL.
 */
const replaced = ({ paths }: BackStackState, path: string): BackStackState => {
  const under = paths.slice(0, -1);
  return { paths: under.at(-1) === path ? under : [...under, path], forward: [] };
};

/**
 * A history traversal landed on `path`: the top again (a query step, a same-URL entry) changes
 * nothing, the screen behind is a back step, the last screen left is a forward step, and anything
 * else is a place the stack cannot put, so it starts over there.
 */
function traversed({ paths, forward }: BackStackState, path: string): BackStackState {
  const top = paths.at(-1);
  if (path === top) return { paths, forward };
  if (top !== undefined && paths.at(-2) === path) {
    return { paths: paths.slice(0, -1), forward: [...forward, top] };
  }
  if (forward.at(-1) === path) return { paths: [...paths, path], forward: forward.slice(0, -1) };
  return rooted(path);
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parse(raw: string | null): BackStackState {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value === 'object' && value !== null) {
      const { paths, forward, pendingRoot, pendingReplace, pendingRefresh, stepFrom, stepsLeft } =
        value as Record<string, unknown>;
      if (isPathList(paths) && isPathList(forward)) {
        return {
          paths,
          forward,
          ...(typeof pendingRoot === 'string' ? { pendingRoot } : {}),
          ...(typeof pendingReplace === 'string' ? { pendingReplace } : {}),
          ...(typeof pendingRefresh === 'string' ? { pendingRefresh } : {}),
          ...(typeof stepFrom === 'string' && typeof stepsLeft === 'number'
            ? { stepFrom, stepsLeft }
            : {}),
        };
      }
    }
  } catch {
    // Not a value this module wrote: start over.
  }
  return { paths: [], forward: [] };
}

function sessionStore(): Storage | null {
  if (storageBroken) return null;
  try {
    return window.sessionStorage;
  } catch {
    storageBroken = true;
    return null;
  }
}

function load(): BackStackState {
  const store = sessionStore();
  if (!store) return memory;
  try {
    return parse(store.getItem(STORAGE_KEY));
  } catch {
    storageBroken = true;
    return memory;
  }
}

function save(state: BackStackState): void {
  memory = {
    ...state,
    paths: state.paths.slice(-MAX_PATHS),
    forward: state.forward.slice(-MAX_PATHS),
  };
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    storageBroken = true;
  }
}

/** The pathname of `href` against this document, or `null` for a value that is not a URL. */
function pathOf(href: string): string | null {
  try {
    return new URL(href, window.location.href).pathname;
  } catch {
    return null;
  }
}

/** The pathname this document came from, when that was a page of this origin. */
function referrerPath(): string | null {
  try {
    const from = new URL(document.referrer);
    return from.origin === window.location.origin ? from.pathname : null;
  } catch {
    return null;
  }
}

function navigationEntry(): PerformanceNavigationTiming | undefined {
  try {
    return performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  } catch {
    return undefined;
  }
}

/**
 * How this document was reached, read once by its first `startBackStack`. A pending root (a back
 * link's fallback) is this document's to consume whatever it decides. Then: the shell entered by a
 * soft navigation from outside it (the document was loaded as `/entrar`), a tab with no history or
 * an unknown load type start a new stack; a reload keeps it; a back/forward load is a traversal; and
 * a plain navigation continues the stack only when it came from the screen at its top (an in-app
 * `<a href>` full load). Anything else (a typed URL, a link from outside the app) starts over. A
 * pending replace belonged to a soft navigation of the previous document and is dropped. A back
 * step that loaded another entry of the screen it left keeps its mark and steps on (`stepOnLoad`).
 */
/**
 * Whether a back/forward load came out of the HTTP cache: a browser may serve a history entry from
 * its cache without asking the server (Chrome does for a page that is not `no-store`), and a page
 * that does not say how it was served is treated the same way.
 */
function fromCache(entry: PerformanceNavigationTiming | undefined): boolean {
  const size: unknown = entry?.transferSize;
  return typeof size !== 'number' || size === 0;
}

function classify(
  path: string,
  { pendingRoot, pendingRefresh, paths, forward, stepFrom, stepsLeft = 0 }: BackStackState,
): BackStackState {
  const state: BackStackState = { paths, forward };
  if (pendingRoot === path) return rooted(path);
  const entry = navigationEntry();
  if (entry && pathOf(entry.name) !== path) return rooted(path);
  if (window.history.length < 2) return rooted(path);
  const top = state.paths.at(-1);
  switch (entry?.type) {
    case 'reload':
      return top === path ? state : rooted(path);
    case 'back_forward':
      if (stepFrom === path && stepsLeft > 0) {
        stepOnLoad = true;
        return { ...state, stepFrom, stepsLeft: stepsLeft - 1 };
      }
      // A save stepped back here and the browser served the page from its cache: it is the page
      // from before the save. The traversal is recorded, and the page reloads once.
      if (pendingRefresh === path && fromCache(entry)) reloadOnLoad = true;
      return traversed(state, path);
    case 'navigate': {
      const from = referrerPath();
      return from !== null && from === top ? pushed(state, path) : rooted(path);
    }
    default:
      return rooted(path);
  }
}

/** A step is on its way until it lands, or until `STEP_TIMEOUT_MS` says the browser dropped it. */
function armStepping(): void {
  stepping = true;
  clearTimeout(steppingTimer);
  steppingTimer = setTimeout(() => {
    stepping = false;
  }, STEP_TIMEOUT_MS);
}

function landed(): void {
  stepping = false;
  clearTimeout(steppingTimer);
}

/** "Voltar"'s `history.back()`, marked with the screen it leaves (`stepFrom`). */
function stepBack(state: BackStackState, from: string): void {
  save({ ...state, stepFrom: from, stepsLeft: MAX_SAME_SCREEN_STEPS });
  armStepping();
  window.history.back();
}

/**
 * A back or forward step inside this document, or a page restored from the back/forward cache. A
 * back step that landed on another entry of the screen it left steps on; anything else is a
 * traversal, which spends every pending mark (`traversed` keeps only the screens).
 */
function follow(): void {
  if (!active) return;
  const state = load();
  const path = window.location.pathname;
  const stepsLeft = state.stepsLeft ?? 0;
  if (state.stepFrom === path && stepsLeft > 0) {
    save({ ...state, stepsLeft: stepsLeft - 1 });
    armStepping();
    window.history.back();
    return;
  }
  landed();
  save(traversed(state, path));
}

function onPopState(): void {
  follow();
}

/**
 * A page restored from the back/forward cache. When a save stepped back to it from another document
 * (`goBackTo` marked it), the frozen page still shows what it showed before that save, and no script
 * of the form's document runs here to refresh it: it reloads.
 */
function onPageShow(event: PageTransitionEvent): void {
  if (!event.persisted) return;
  const state = active ? load() : null;
  const path = window.location.pathname;
  // A landing on the screen the step left steps on instead (`follow`), and never reloads here.
  const stale = state?.pendingRefresh === path && state.stepFrom !== path;
  follow();
  if (stale) window.location.reload();
}

/**
 * Starts the stack for a mounted shell and returns the cleanup. The first call in a document
 * classifies how the document was reached; a later call after the shell really left (the cleanup's
 * deferred check found nothing mounted since, e.g. a sign-out to `/entrar` or the root error page)
 * starts a new stack where the shell came back. A Strict Mode remount in the same task changes
 * nothing.
 */
export function startBackStack(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!listening) {
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pageshow', onPageShow);
    listening = true;
  }
  const path = window.location.pathname;
  if (!classified) {
    classified = true;
    save(classify(path, load()));
    if (stepOnLoad) {
      stepOnLoad = false;
      armStepping();
      window.history.back();
    } else if (reloadOnLoad) {
      reloadOnLoad = false;
      reloading = true;
      window.location.reload();
    }
  } else if (left) {
    save(rooted(path));
  }
  left = false;
  active = true;
  const mount = {};
  mounted = mount;
  return () => {
    active = false;
    setTimeout(() => {
      if (mounted === mount) left = true;
    }, 0);
  };
}

/**
 * The shell now shows `pathname`: a new screen on top of the stack, which drops the forward screens.
 * The top again (a traversal already placed it, or only the query changed) records nothing. A screen
 * announced by `replaceAppPath` takes the top's place instead, and a back link's fallback reached by
 * a soft navigation (a form's X with nothing behind it) starts a new stack there, exactly as its full
 * load would. Both marks belong to the navigation that follows them, so it spends them either way.
 */
export function recordAppPath(pathname: string): void {
  if (!active) return;
  const { pendingRoot, pendingReplace, pendingRefresh, paths, forward } = load();
  const state: BackStackState = { paths, forward };
  if (pendingRoot === pathname) {
    save(rooted(pathname));
  } else if (pendingReplace === pathname) {
    save(replaced(state, pathname));
  } else if (paths.at(-1) !== pathname) {
    save(pushed(state, pathname));
  } else if (
    pendingRoot !== undefined ||
    pendingReplace !== undefined ||
    pendingRefresh !== undefined
  ) {
    save(state);
  }
}

/** The Navigation API's own answer where the browser has one (Chromium); `undefined` elsewhere. */
function navigationCanGoBack(): boolean | undefined {
  const navigation: unknown = Reflect.get(window, 'navigation');
  if (typeof navigation !== 'object' || navigation === null) return undefined;
  const answer: unknown = Reflect.get(navigation, 'canGoBack');
  return typeof answer === 'boolean' ? answer : undefined;
}

/**
 * Whether the entry behind this one is an app screen the shell recorded: a tracker is mounted, the
 * stack has a screen under its top, the top is the page on screen (a stack out of step with the URL
 * is never trusted), and the browser agrees there is somewhere to go back to.
 */
export function canGoBack(): boolean {
  if (!active) return false;
  const { paths } = load();
  if (paths.length < 2 || paths.at(-1) !== window.location.pathname) return false;
  if (window.history.length < 2) return false;
  return navigationCanGoBack() !== false;
}

/**
 * A back link's click. With an app screen behind, `history.back()` and true: the caller prevents the
 * link's own navigation. Otherwise false, and the link navigates to `fallbackHref` as a plain link
 * does (a new entry, so the browser's back still returns here); that load becomes a new root. Without
 * a mounted tracker it never intercepts. A tap while a step is still on its way (a slow return to
 * another document) answers true without stepping again.
 */
export function goBack(fallbackHref: string): boolean {
  if (!active) return false;
  if (stepping) return true;
  if (canGoBack()) {
    stepBack(load(), window.location.pathname);
    return true;
  }
  const pendingRoot = pathOf(fallbackHref);
  if (pendingRoot !== null) save({ ...load(), pendingRoot });
  return false;
}

/**
 * An edit's save hands the member back: with `href`'s screen right behind this one,
 * `history.back()` and true, so the screen the save changed is not stacked a second time and its own
 * "Voltar" continues to the screen before it. Otherwise false with nothing marked, and the caller
 * navigates as it did before (a form opened from somewhere else still lands on `href`).
 *
 * The screen it returns to predates the save, so it is marked stale (`pendingRefresh`): a restore
 * from the back/forward cache reloads it, and the caller refreshes a same-document restore.
 */
export function goBackTo(href: string): boolean {
  if (active && stepping) return true;
  if (!canGoBack()) return false;
  const path = pathOf(href);
  const state = load();
  if (path === null || state.paths.at(-2) !== path) return false;
  stepBack({ ...state, pendingRefresh: path }, window.location.pathname);
  return true;
}

/**
 * The next screen the shell records at `href` takes the current one's place instead of stacking on
 * it: a create's save that `router.replace`s its form with what it made. The browser keeps one entry
 * for the two, so the stack keeps one too, and "Voltar" on the new screen returns to the screen the
 * form was opened from. Called right before the router's `replace`; without a tracker it does nothing.
 */
export function replaceAppPath(href: string): void {
  if (!active) return;
  const path = pathOf(href);
  if (path !== null) save({ ...load(), pendingReplace: path });
}

/**
 * This document is reloading because it was a stale copy of a screen a save stepped back to: what it
 * would show (a toast kept for it, `flash-toast.ts`) belongs to the fresh copy that follows.
 */
export function isReloadingStaleScreen(): boolean {
  return reloading;
}

/** A fresh document with an empty stack: listeners off, flags cleared, storage emptied (tests). */
export function resetBackStack(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('pageshow', onPageShow);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was persisted where storage throws.
    }
  }
  listening = false;
  classified = false;
  active = false;
  left = false;
  mounted = null;
  memory = { paths: [], forward: [] };
  storageBroken = false;
  landed();
  stepOnLoad = false;
  reloadOnLoad = false;
  reloading = false;
}
