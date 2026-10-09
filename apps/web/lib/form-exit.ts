import { goBack, goBackTo, replaceAppPath } from '@rede-social/ui';

/**
 * How a form screen hands the navigation back (2026-10-09), now that every header's "Voltar" follows
 * the history (`back-stack.ts` in @rede-social/ui). The forms used to leave with a `router.push` to
 * their parent, which stacked a second copy of the screen they were opened from: that screen's
 * "Voltar" then stepped back into the form the member had just closed or saved.
 *
 * Each helper takes only the slice of Next's `useRouter()` it calls, so a form test's router stub
 * needs no more than it did. Without the shell's tracker (a unit test, a page outside the shell) the
 * back stack never intercepts and every helper navigates exactly as the form did before.
 */

/** The X and "Descartar": back to the screen the form was opened from, else `fallback`. */
export function leaveForm(router: { push(href: string): void }, fallback: string): void {
  // With nothing behind (a form opened from a link) the push starts a new stack at `fallback`.
  if (!goBack(fallback)) router.push(fallback);
}

/**
 * A create's success: what it made takes the form's place in the history, so "Voltar" on it returns
 * to the screen the form was opened from (and the browser's back skips the spent form).
 */
export function replaceFormWith(router: { replace(href: string): void }, href: string): void {
  replaceAppPath(href);
  router.replace(href);
}

/**
 * An edit's success: back to `href` when it is the screen behind the form, and true; otherwise
 * false, and the caller navigates as before. The browser restores that screen from Next's Router
 * Cache, whose payload predates the save even after the action's `revalidatePath` (the reason
 * `StoryComposer` refreshes after publishing), so it is refreshed once the restore has landed: Next's
 * own `popstate` listener was added first and queues the restore ahead of this refresh.
 */
export function returnAfterSave(router: { refresh(): void }, href: string): boolean {
  if (!goBackTo(href)) return false;
  window.addEventListener('popstate', () => router.refresh(), { once: true });
  return true;
}
