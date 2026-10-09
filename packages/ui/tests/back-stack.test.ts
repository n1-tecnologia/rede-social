import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canGoBack,
  goBack,
  recordAppPath,
  resetBackStack,
  startBackStack,
} from '../src/navigation/back-stack';

/**
 * 2026-10-09 — the in-app back stack behind every header's "Voltar": the shell records the screens
 * the member walks through, and a back link steps back through history only when the entry behind
 * is one of them; otherwise its own href (the screen's static parent) navigates as before.
 *
 * happy-dom keeps one window for the whole file, so a "document" here is simulated: `enter` resets
 * the module's per-document state while the session storage stays (as it does across the documents
 * of one tab), and stubs what the browser says about the load (the Navigation Timing entry and
 * `document.referrer`). `history.back()` is stubbed the way the browser answers it: the URL moves and
 * `popstate` fires.
 */

const KEY = 'rede-social:back-stack';

type LoadType = 'navigate' | 'reload' | 'back_forward';

/** What the browser reports about the current document's load. */
const load = { type: 'navigate' as LoadType, entry: '', referrer: '' };

beforeEach(() => {
  resetBackStack();
  load.type = 'navigate';
  load.entry = '';
  load.referrer = '';
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(
    () =>
      [
        {
          name: new URL(load.entry || window.location.pathname, window.location.href).href,
          type: load.type,
        },
      ] as unknown as PerformanceEntryList,
  );
  vi.spyOn(document, 'referrer', 'get').mockImplementation(() => load.referrer);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'navigation');
  resetBackStack();
});

/** The persisted stack, as the next document of this tab reads it. */
function stored(): { paths: string[]; forward: string[]; pendingRoot?: string } | null {
  const raw = window.sessionStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

/**
 * A new document of this tab at `path`, reached the way `type` says (`from`: the same-origin page
 * that linked here), and the shell mounting in it. Returns the tracker's cleanup.
 */
function enter(path: string, type: LoadType = 'navigate', from = ''): () => void {
  const kept = window.sessionStorage.getItem(KEY);
  resetBackStack();
  if (kept !== null) window.sessionStorage.setItem(KEY, kept);
  window.history.pushState(null, '', path);
  load.type = type;
  load.entry = path;
  load.referrer = from ? new URL(from, window.location.href).href : '';
  return startBackStack();
}

/** A soft navigation: Next pushes the URL, then the shell's pathname effect records it. */
function soft(path: string): void {
  window.history.pushState(null, '', path);
  recordAppPath(new URL(path, window.location.href).pathname);
}

/** A traversal inside the document (back, forward, `history.go`): the URL moves, popstate fires. */
function traverse(to: string): void {
  window.history.replaceState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** `history.back()` as the browser answers it, landing on `to`. */
function stubBack(to: string) {
  return vi.spyOn(window.history, 'back').mockImplementation(() => traverse(to));
}

describe('back stack: one document', () => {
  it('a fresh tab has nothing to go back to: goBack leaves the link alone and marks its href', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    enter('/configuracoes');
    const back = stubBack('/inicio');

    expect(canGoBack()).toBe(false);
    expect(goBack('/perfil?aba=1')).toBe(false);
    expect(back).not.toHaveBeenCalled();
    // The link's own navigation lands on the fallback, which the next document takes as a root.
    expect(stored()).toEqual({ paths: ['/configuracoes'], forward: [], pendingRoot: '/perfil' });
  });

  it('after soft navigations goBack steps back once through history', () => {
    enter('/inicio');
    soft('/perfil');
    soft('/configuracoes');
    const back = stubBack('/perfil');

    expect(canGoBack()).toBe(true);
    expect(goBack('/perfil')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/perfil');
    expect(stored()).toEqual({ paths: ['/inicio', '/perfil'], forward: ['/configuracoes'] });
    // Next then renders /perfil and the shell records it: already the top, nothing changes.
    recordAppPath('/perfil');
    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);
  });

  it('a step back to the first screen leaves nothing behind it', () => {
    enter('/inicio');
    soft('/perfil');
    stubBack('/inicio');

    expect(goBack('/inicio')).toBe(true);
    expect(canGoBack()).toBe(false);
    expect(stored()).toEqual({ paths: ['/inicio'], forward: ['/perfil'] });
  });

  it("the browser's forward puts the screen back on top", () => {
    enter('/inicio');
    soft('/perfil');
    traverse('/inicio');
    traverse('/perfil');

    expect(stored()).toEqual({ paths: ['/inicio', '/perfil'], forward: [] });
    expect(canGoBack()).toBe(true);
  });

  it('a new screen drops the forward ones', () => {
    enter('/inicio');
    soft('/perfil');
    traverse('/inicio');
    soft('/eventos');

    expect(stored()).toEqual({ paths: ['/inicio', '/eventos'], forward: [] });
  });

  it('a jump the stack cannot place starts over there', () => {
    enter('/inicio');
    soft('/perfil');
    soft('/configuracoes');
    traverse('/eventos');

    expect(stored()).toEqual({ paths: ['/eventos'], forward: [] });
    expect(canGoBack()).toBe(false);
  });

  it('a traversal to the same path and a query-only change record nothing', () => {
    enter('/inicio');
    soft('/configuracoes/membros');
    const before = stored();

    traverse('/configuracoes/membros?q=ana');
    window.history.replaceState(null, '', '/configuracoes/membros?q=ana&status=blocked');
    recordAppPath('/configuracoes/membros');

    expect(stored()).toEqual(before);
    expect(canGoBack()).toBe(true);
  });

  it("the stories viewer's /stories/{id} entry is pushed when opened and popped when closed", () => {
    enter('/inicio');
    soft('/stories/s1');
    expect(stored()?.paths).toEqual(['/inicio', '/stories/s1']);

    // Closing is `history.back()`; Next then reports /inicio again, already the top.
    traverse('/inicio');
    recordAppPath('/inicio');
    expect(stored()).toEqual({ paths: ['/inicio'], forward: ['/stories/s1'] });

    // A highlight pushes the SAME URL: neither the push nor its pop is a new screen.
    soft('/inicio');
    traverse('/inicio');
    expect(stored()).toEqual({ paths: ['/inicio'], forward: ['/stories/s1'] });
  });

  it('keeps the latest 50 screens', () => {
    enter('/inicio');
    for (let i = 1; i <= 60; i += 1) soft(`/post/p${i}`);

    const paths = stored()?.paths ?? [];
    expect(paths).toHaveLength(50);
    expect(paths.at(-1)).toBe('/post/p60');
    expect(paths[0]).toBe('/post/p11');
  });
});

describe('back stack: how a document was reached', () => {
  it('a plain link from the screen on top (an in-app full load) continues the stack', () => {
    enter('/notificacoes');
    enter('/post/p1', 'navigate', '/notificacoes');

    expect(stored()?.paths).toEqual(['/notificacoes', '/post/p1']);
    expect(canGoBack()).toBe(true);
  });

  it('a plain link to the same screen (a chip changing only the query) is not a second screen', () => {
    enter('/eventos/e1');
    soft('/eventos/e1/participantes');
    enter('/eventos/e1/participantes?lista=presentes', 'navigate', '/eventos/e1/participantes');

    expect(stored()).toEqual({ paths: ['/eventos/e1', '/eventos/e1/participantes'], forward: [] });
  });

  it('a typed address, a link from elsewhere or another origin start a new stack', () => {
    enter('/notificacoes');
    enter('/post/p1', 'navigate');
    expect(stored()?.paths).toEqual(['/post/p1']);

    enter('/post/p2', 'navigate', '/inicio');
    expect(stored()?.paths).toEqual(['/post/p2']);

    enter('/post/p3', 'navigate', 'https://outro.exemplo/post/p2');
    expect(stored()?.paths).toEqual(['/post/p3']);
  });

  it('a reload keeps the stack, unless its top is another page', () => {
    enter('/inicio');
    soft('/perfil');
    enter('/perfil', 'reload');
    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);

    enter('/eventos', 'reload');
    expect(stored()?.paths).toEqual(['/eventos']);
  });

  it('a back/forward load is a traversal: back, forward, or a new stack', () => {
    enter('/notificacoes');
    enter('/post/p1', 'navigate', '/notificacoes');

    enter('/notificacoes', 'back_forward');
    expect(stored()).toEqual({ paths: ['/notificacoes'], forward: ['/post/p1'] });

    enter('/post/p1', 'back_forward');
    expect(stored()).toEqual({ paths: ['/notificacoes', '/post/p1'], forward: [] });

    enter('/eventos', 'back_forward');
    expect(stored()).toEqual({ paths: ['/eventos'], forward: [] });
  });

  it('a page restored from the back/forward cache traverses too', () => {
    enter('/notificacoes');
    enter('/post/p1', 'navigate', '/notificacoes');
    // Back to the frozen /notificacoes document: its module state was kept, only the URL moved.
    // (happy-dom's PageTransitionEvent is a plain Event, so `persisted` is set by hand.)
    window.history.replaceState(null, '', '/notificacoes');
    const fresh = new Event('pageshow');
    window.dispatchEvent(fresh);
    expect(stored()).toEqual({ paths: ['/notificacoes', '/post/p1'], forward: [] });

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    expect(stored()).toEqual({ paths: ['/notificacoes'], forward: ['/post/p1'] });
  });

  it('the shell entered by a soft navigation from outside it (the sign-in) starts a new stack', () => {
    enter('/notificacoes');
    window.history.pushState(null, '', '/inicio');
    const kept = window.sessionStorage.getItem(KEY);
    resetBackStack();
    if (kept !== null) window.sessionStorage.setItem(KEY, kept);
    load.entry = '/entrar';
    load.referrer = new URL('/notificacoes', window.location.href).href;
    startBackStack();

    expect(stored()?.paths).toEqual(['/inicio']);
  });

  it('a tab with a single entry starts a new stack whatever the referrer says', () => {
    enter('/notificacoes');
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    enter('/post/p1', 'navigate', '/notificacoes');

    expect(stored()?.paths).toEqual(['/post/p1']);
  });

  it("a back link's fallback is the next document's root, consumed whatever that document is", () => {
    enter('/configuracoes');
    expect(goBack('/perfil')).toBe(false);

    // The link's own navigation: a plain link from /configuracoes, which would otherwise continue.
    enter('/perfil', 'navigate', '/configuracoes');
    expect(stored()).toEqual({ paths: ['/perfil'], forward: [] });
    expect(canGoBack()).toBe(false);

    // A fallback the server redirected (the platform host's /perfil lands on /inicio) still clears
    // the mark; that document is then classified like any plain link.
    enter('/configuracoes');
    expect(goBack('/perfil')).toBe(false);
    enter('/inicio', 'navigate', '/configuracoes');
    expect(stored()).toEqual({ paths: ['/configuracoes', '/inicio'], forward: [] });
  });
});

describe('back stack: mounts and guards', () => {
  it('a remount in the same task (Strict Mode) keeps the stack; a real exit and return start over', () => {
    vi.useFakeTimers();
    const first = enter('/inicio');
    soft('/perfil');

    first();
    const second = startBackStack();
    vi.runAllTimers();
    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);

    // ...and so does a later one: the first cleanup's deferred check saw the second mount.
    second();
    const third = startBackStack();
    vi.runAllTimers();
    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);
    expect(canGoBack()).toBe(true);

    // The shell leaves (a sign-out to /entrar); traversals meanwhile are not followed.
    third();
    vi.runAllTimers();
    expect(canGoBack()).toBe(false);
    traverse('/entrar');
    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);

    // Signed in again: the shell mounts at /inicio with a new stack.
    window.history.pushState(null, '', '/inicio');
    startBackStack();
    expect(stored()).toEqual({ paths: ['/inicio'], forward: [] });
  });

  it('never steps back when the browser says it cannot, or the stack is out of step with the URL', () => {
    enter('/inicio');
    soft('/perfil');
    expect(canGoBack()).toBe(true);

    Reflect.set(window, 'navigation', { canGoBack: false });
    expect(canGoBack()).toBe(false);
    Reflect.set(window, 'navigation', { canGoBack: true });
    expect(canGoBack()).toBe(true);

    // The URL moved without the shell recording it.
    window.history.replaceState(null, '', '/eventos');
    expect(canGoBack()).toBe(false);
    window.history.replaceState(null, '', '/perfil');

    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    expect(canGoBack()).toBe(false);
  });

  it('where storage throws the stack lives in memory and still steps back', () => {
    window.history.pushState(null, '', '/inicio');
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    startBackStack();
    soft('/perfil');
    const back = stubBack('/inicio');

    expect(canGoBack()).toBe(true);
    expect(goBack('/inicio')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(canGoBack()).toBe(false);

    blocked.mockRestore();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a storage that stops taking writes (quota) is left for memory, never read back stale', () => {
    enter('/inicio');
    soft('/perfil');
    // A stand-in, not a spy on the real one: happy-dom's Storage is a Proxy that keeps own properties.
    const real = window.sessionStorage;
    const full = {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: (key: string) => real.removeItem(key),
    } as unknown as Storage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(full);
    soft('/configuracoes');

    expect(stored()?.paths).toEqual(['/inicio', '/perfil']);
    expect(canGoBack()).toBe(true);
    const back = stubBack('/perfil');
    expect(goBack('/perfil')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('without a mounted tracker a back link is never intercepted', () => {
    window.history.pushState(null, '', '/perfil');
    const back = stubBack('/inicio');
    expect(canGoBack()).toBe(false);
    expect(goBack('/inicio')).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(stored()).toBeNull();

    // After the shell unmounted, the same.
    const stop = enter('/inicio');
    soft('/perfil');
    stop();
    expect(goBack('/inicio')).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('a value it did not write reads as an empty stack', () => {
    window.sessionStorage.setItem(KEY, '{"paths":"nope"}');
    window.history.pushState(null, '', '/inicio');
    startBackStack();
    expect(stored()).toEqual({ paths: ['/inicio'], forward: [] });
  });
});
