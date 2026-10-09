import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canGoBack,
  goBack,
  goBackTo,
  isReloadingStaleScreen,
  recordAppPath,
  replaceAppPath,
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

/**
 * What the browser reports about the current document's load. `transferSize` 0 is a page served
 * from the HTTP cache; the default is a page fetched from the network.
 */
const load = {
  type: 'navigate' as LoadType,
  entry: '',
  referrer: '',
  transferSize: 1200 as number | undefined,
};

beforeEach(() => {
  resetBackStack();
  load.type = 'navigate';
  load.entry = '';
  load.referrer = '';
  load.transferSize = 1200;
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(
    () =>
      [
        {
          name: new URL(load.entry || window.location.pathname, window.location.href).href,
          type: load.type,
          transferSize: load.transferSize,
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
function stored(): {
  paths: string[];
  forward: string[];
  pendingRoot?: string;
  pendingReplace?: string;
  pendingRefresh?: string;
  stepFrom?: string;
  stepsLeft?: number;
} | null {
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

/** A soft `router.replace`: Next replaces the URL, then the shell's pathname effect records it. */
function softReplace(path: string): void {
  window.history.replaceState(null, '', path);
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

/**
 * The review of 2026-10-09: one "Voltar" is one screen, and one step. The browser's history can
 * hold several entries of one screen (a chip that is a plain link changes only the query), and a
 * second tap during a slow cross-document back used to step twice (and could leave the app).
 */
describe('back stack: one tap, one screen', () => {
  /** `history.back()` as the browser answers it, landing on each of `stops` in turn. */
  function stubBacks(stops: string[]) {
    const queue = [...stops];
    return vi.spyOn(window.history, 'back').mockImplementation(() => {
      const next = queue.shift();
      if (next !== undefined) traverse(next);
    });
  }

  it('a step that lands on another entry of the screen it left steps on (same document)', () => {
    enter('/eventos/e1');
    soft('/eventos/e1/participantes');
    // Two chips that only changed the query: one screen, three history entries.
    window.history.pushState(null, '', '/eventos/e1/participantes?lista=presentes');
    window.history.pushState(null, '', '/eventos/e1/participantes?lista=naovao');
    const back = stubBacks([
      '/eventos/e1/participantes?lista=presentes',
      '/eventos/e1/participantes',
      '/eventos/e1',
    ]);

    expect(goBack('/eventos/e1')).toBe(true);
    expect(back).toHaveBeenCalledTimes(3);
    expect(window.location.pathname).toBe('/eventos/e1');
    expect(stored()).toEqual({ paths: ['/eventos/e1'], forward: ['/eventos/e1/participantes'] });
  });

  it('a step that LOADS another entry of the screen it left steps on from the new document', () => {
    enter('/eventos/e1');
    enter('/eventos/e1/participantes', 'navigate', '/eventos/e1');
    // A chip that is a plain link: a full load of the same screen, the stack unchanged.
    enter('/eventos/e1/participantes?lista=presentes', 'navigate', '/eventos/e1/participantes');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    expect(goBack('/eventos/e1')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    // The browser loads the previous entry, the same screen: that document steps on at once.
    enter('/eventos/e1/participantes', 'back_forward');
    expect(back).toHaveBeenCalledTimes(2);
    expect(stored()?.paths).toEqual(['/eventos/e1', '/eventos/e1/participantes']);
    // ...and the next one lands on the event: a plain back step.
    enter('/eventos/e1', 'back_forward');
    expect(back).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual({ paths: ['/eventos/e1'], forward: ['/eventos/e1/participantes'] });
  });

  it('a history made only of that screen stops stepping after a bounded number of steps', () => {
    enter('/inicio');
    soft('/eventos/e1/participantes');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      traverse('/eventos/e1/participantes?lista=outra');
    });

    expect(goBack('/inicio')).toBe(true);
    // The first step plus at most ten more, then the stack is left as a plain landing.
    expect(back).toHaveBeenCalledTimes(11);
    expect(stored()?.stepFrom).toBeUndefined();
  });

  it('a second tap while a cross-document step is on its way is the same step', () => {
    // Timeouts only: faking `performance` too would drop the load stub `enter` relies on.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    enter('/inicio');
    enter('/post/p1', 'navigate', '/inicio');
    // A slow return to /inicio: the old document gets no popstate until it is gone.
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    expect(goBack('/inicio')).toBe(true);
    expect(goBack('/inicio')).toBe(true);
    expect(goBackTo('/inicio')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);

    // A step the browser dropped stops blocking the next tap.
    vi.advanceTimersByTime(4000);
    expect(goBack('/inicio')).toBe(true);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('a step that lands clears the block at once', () => {
    enter('/inicio');
    soft('/perfil');
    soft('/configuracoes');
    const back = stubBacks(['/perfil', '/inicio']);

    expect(goBack('/perfil')).toBe(true);
    expect(window.location.pathname).toBe('/perfil');
    expect(goBack('/inicio')).toBe(true);
    expect(back).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/inicio');
  });
});

/**
 * The forms' ways out. Before these, every exit pushed its parent again: the parent's "Voltar" then
 * stepped back into the form the member had just closed or saved.
 */
describe('back stack: forms hand the navigation back', () => {
  it("a form's X with nothing behind it falls back by a soft navigation that starts a new stack", () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    enter('/comunidades/nova');
    expect(goBack('/comunidades')).toBe(false);

    // The form's router.push to its fallback.
    soft('/comunidades');
    expect(stored()).toEqual({ paths: ['/comunidades'], forward: [] });
    expect(canGoBack()).toBe(false);
  });

  it('a mark is spent by the navigation that follows it, whatever that is', () => {
    enter('/comunidades/nova');
    expect(goBack('/comunidades')).toBe(false);
    soft('/eventos');
    expect(stored()).toEqual({ paths: ['/comunidades/nova', '/eventos'], forward: [] });

    // So a later visit to the old fallback is an ordinary screen again.
    soft('/comunidades');
    expect(stored()?.paths).toEqual(['/comunidades/nova', '/eventos', '/comunidades']);
  });

  it("an edit's save returns to the screen it changed when that is the one behind", () => {
    enter('/comunidades');
    soft('/comunidades/c1');
    soft('/comunidades/c1/editar');
    const back = stubBack('/comunidades/c1');

    expect(goBackTo('/comunidades/c1')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual({
      paths: ['/comunidades', '/comunidades/c1'],
      forward: ['/comunidades/c1/editar'],
    });
    // The community's own "Voltar" now continues to the list, not into the form.
    expect(canGoBack()).toBe(true);
  });

  it('goBackTo leaves the caller to navigate when the screen behind is another one', () => {
    enter('/inicio');
    soft('/perfil/editar');
    const back = stubBack('/inicio');

    expect(goBackTo('/perfil')).toBe(false);
    expect(back).not.toHaveBeenCalled();
    // Nothing marked: the caller's push is an ordinary new screen.
    expect(stored()).toEqual({ paths: ['/inicio', '/perfil/editar'], forward: [] });

    // A form opened straight from a link has nothing behind it at all.
    enter('/comunidades/c1/editar');
    expect(goBackTo('/comunidades/c1')).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("a create's save replaces the form with what it made", () => {
    enter('/comunidades');
    soft('/comunidades/nova');
    replaceAppPath('/comunidades/c9');
    expect(stored()?.pendingReplace).toBe('/comunidades/c9');

    softReplace('/comunidades/c9');
    expect(stored()).toEqual({ paths: ['/comunidades', '/comunidades/c9'], forward: [] });

    const back = stubBack('/comunidades');
    expect(goBack('/comunidades')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual({ paths: ['/comunidades'], forward: ['/comunidades/c9'] });
  });

  it('a replace onto the screen under the top folds the two into one', () => {
    enter('/comunidades');
    soft('/comunidades/c1');
    soft('/comunidades/c1/editar');
    replaceAppPath('/comunidades/c1');
    softReplace('/comunidades/c1');

    expect(stored()).toEqual({ paths: ['/comunidades', '/comunidades/c1'], forward: [] });
  });

  it('a pending replace belongs to its document: a reload drops it', () => {
    enter('/comunidades');
    soft('/comunidades/nova');
    replaceAppPath('/comunidades/c9');
    enter('/comunidades/nova', 'reload');

    expect(stored()).toEqual({ paths: ['/comunidades', '/comunidades/nova'], forward: [] });
  });

  it('a save that stepped back to another document reloads that page when the browser restores it frozen', () => {
    enter('/comunidades');
    enter('/comunidades/c1', 'navigate', '/comunidades');
    // The edit form is a full load from the community (a plain link).
    enter('/comunidades/c1/editar', 'navigate', '/comunidades/c1');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

    expect(goBackTo('/comunidades/c1')).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(stored()?.pendingRefresh).toBe('/comunidades/c1');

    // The browser restores the community's frozen document: no popstate, a persisted pageshow.
    window.history.replaceState(null, '', '/comunidades/c1');
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual({
      paths: ['/comunidades', '/comunidades/c1'],
      forward: ['/comunidades/c1/editar'],
    });
  });

  it('a stale mark is spent without a reload by a same-document step or a fresh load', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    enter('/comunidades');
    soft('/comunidades/c1');
    soft('/comunidades/c1/editar');
    stubBack('/comunidades/c1');
    // Inside one document the popstate spends it (the form refreshes through its router).
    expect(goBackTo('/comunidades/c1')).toBe(true);
    expect(stored()).toEqual({
      paths: ['/comunidades', '/comunidades/c1'],
      forward: ['/comunidades/c1/editar'],
    });

    // Across documents, a page the browser loads afresh is already current.
    enter('/comunidades/c2', 'navigate', '/comunidades/c1');
    enter('/comunidades/c2/editar', 'navigate', '/comunidades/c2');
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    expect(goBackTo('/comunidades/c2')).toBe(true);
    enter('/comunidades/c2', 'back_forward');
    expect(stored()?.pendingRefresh).toBeUndefined();

    // And a frozen page restored without the mark never reloads.
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a page served from the HTTP cache after a save stepped back to it reloads once', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    enter('/comunidades/c1');
    // The edit form is a full load from the community (a plain link).
    enter('/comunidades/c1/editar', 'navigate', '/comunidades/c1');
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    expect(goBackTo('/comunidades/c1')).toBe(true);

    // Chrome answers a history load of a page that is not no-store from its cache: the page from
    // before the save.
    load.transferSize = 0;
    enter('/comunidades/c1', 'back_forward');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isReloadingStaleScreen()).toBe(true);
    expect(stored()).toEqual({ paths: ['/comunidades/c1'], forward: ['/comunidades/c1/editar'] });

    // The fresh copy the reload brings does not reload again.
    load.transferSize = 1200;
    enter('/comunidades/c1', 'reload');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isReloadingStaleScreen()).toBe(false);
  });

  it('a browser that does not say how it served the page is taken as its cache', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    enter('/comunidades/c1');
    enter('/comunidades/c1/editar', 'navigate', '/comunidades/c1');
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    expect(goBackTo('/comunidades/c1')).toBe(true);
    load.transferSize = undefined;
    enter('/comunidades/c1', 'back_forward');
    expect(reload).toHaveBeenCalledTimes(1);

    // POSITIVE CONTROL: a back/forward load nobody saved before never reloads, cached or not.
    reload.mockClear();
    enter('/comunidades/c1/editar', 'navigate', '/comunidades/c1');
    load.transferSize = 0;
    enter('/comunidades/c1', 'back_forward');
    expect(reload).not.toHaveBeenCalled();
  });

  it('without a mounted tracker the forms are never intercepted and nothing is marked', () => {
    window.history.pushState(null, '', '/comunidades/c1/editar');
    const back = stubBack('/comunidades/c1');

    expect(goBackTo('/comunidades/c1')).toBe(false);
    replaceAppPath('/comunidades/c9');
    expect(back).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });
});
