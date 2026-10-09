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
 * No React, no Next: it touches `window` only when called, so importing it on the server is harmless.
 */

const STORAGE_KEY = 'rede-social:back-stack';
/** Far more screens than anyone walks back through; the oldest fall off. */
const MAX_PATHS = 50;

interface BackStackState {
  /** The screens behind the current one, then the current one (the top). */
  paths: string[];
  /** The screens a back step left, newest last: where the browser's forward button goes. */
  forward: string[];
  /**
   * Set when a back link fell back to its href: the document that load opens is a new root, so its
   * own back link takes ITS fallback instead of returning to the screen the member just left.
   */
  pendingRoot?: string;
}

// Document-level state: a module instance lives exactly as long as its document.
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
      const { paths, forward, pendingRoot } = value as Record<string, unknown>;
      if (isPathList(paths) && isPathList(forward)) {
        return typeof pendingRoot === 'string'
          ? { paths, forward, pendingRoot }
          : { paths, forward };
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
 * `<a href>` full load). Anything else (a typed URL, a link from outside the app) starts over.
 */
function classify(path: string, { pendingRoot, ...state }: BackStackState): BackStackState {
  if (pendingRoot === path) return rooted(path);
  const entry = navigationEntry();
  if (entry && pathOf(entry.name) !== path) return rooted(path);
  if (window.history.length < 2) return rooted(path);
  const top = state.paths.at(-1);
  switch (entry?.type) {
    case 'reload':
      return top === path ? state : rooted(path);
    case 'back_forward':
      return traversed(state, path);
    case 'navigate': {
      const from = referrerPath();
      return from !== null && from === top ? pushed(state, path) : rooted(path);
    }
    default:
      return rooted(path);
  }
}

/** A back or forward step inside this document, or a page restored from the back/forward cache. */
function follow(): void {
  if (active) save(traversed(load(), window.location.pathname));
}

function onPopState(): void {
  follow();
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) follow();
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
 * The top again (a traversal already placed it, or only the query changed) records nothing.
 */
export function recordAppPath(pathname: string): void {
  if (!active) return;
  const state = load();
  if (state.paths.at(-1) === pathname) return;
  save(pushed(state, pathname));
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
 * a mounted tracker it never intercepts.
 */
export function goBack(fallbackHref: string): boolean {
  if (!active) return false;
  if (canGoBack()) {
    window.history.back();
    return true;
  }
  const pendingRoot = pathOf(fallbackHref);
  if (pendingRoot !== null) save({ ...load(), pendingRoot });
  return false;
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
}
