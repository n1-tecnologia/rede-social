/**
 * FEED-07's share branch table (UI-SPEC §Post page contract "Share", E16).
 *
 * **Both surfaces are injected, and that is the point.** A helper allowed to read the browser's own
 * globals would be free to read the browser's own ORIGIN too — and the link a member then sent
 * another member would carry whichever ALIAS host they happened to be on. 02-08 already folded
 * aliases away at the proxy for exactly that reason (D-35), and T-04-51 keeps every browser global
 * out of this file: the url arrives already composed, server-side, from the tenant's VERIFIED
 * primary host. Injection is also what lets the whole table be proved without a browser.
 *
 * **Four outcomes, and the caller's table is total.** Nothing here throws, so the composition point
 * needs no catch:
 *
 * | Outcome       | How it is reached                                | What the caller does |
 * |---------------|--------------------------------------------------|----------------------|
 * | `'shared'`    | the share surface resolved                       | nothing              |
 * | `'dismissed'` | the share surface rejected with an `AbortError`  | **nothing**          |
 * | `'copied'`    | the clipboard write resolved                     | the copied toast     |
 * | `'failed'`    | no surface worked                                | the generic toast    |
 *
 * **`'dismissed'` is a first-class outcome, not an error.** The viewer closing the OS share sheet
 * is a normal thing to do; raising a failure toast for it would tell a member something went wrong
 * when they are the one who decided nothing should happen (T-04-53). It is also deliberately NOT
 * followed by a clipboard write: copying a link somebody just declined to share is the wrong answer
 * twice over.
 *
 * **The dismissal is matched by the error's `name`, never by its message.** Platforms localise the
 * message ("Share canceled", "Compartilhamento cancelado"), and a substring match on a translated
 * sentence would classify the SAME event differently depending on the phone's language.
 */

export type SharePostResult = 'shared' | 'dismissed' | 'copied' | 'failed';

/** What gets shared: the url composed on the server, and the tenant's own display name as title. */
export type SharePostPayload = { url: string; title: string };

/**
 * The two capabilities, injected by the composition point.
 *
 * `share` is absent wherever the Web Share API is (every desktop browser under test, and Firefox);
 * `clipboard` is absent in an insecure context. Either may also REJECT at call time — a share
 * outside a user gesture, a clipboard permission the member denied — which is why every arm of the
 * table below is reached by a real branch rather than by feature detection alone.
 */
export type SharePostSurfaces = {
  share?: (data: SharePostPayload) => Promise<void>;
  clipboard?: (text: string) => Promise<void>;
};

/** The DOM's name for "the user closed the sheet". Same string in every browser and every locale. */
const DISMISSED = 'AbortError';

function isDismissal(error: unknown): boolean {
  return error instanceof Error ? error.name === DISMISSED : false;
}

/** The fallback arm: a successful write is `'copied'`, a denied one and an absent surface `'failed'`. */
async function copy(
  url: string,
  clipboard: SharePostSurfaces['clipboard'],
): Promise<'copied' | 'failed'> {
  if (!clipboard) return 'failed';
  try {
    await clipboard(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export async function sharePost(
  payload: SharePostPayload,
  surfaces: SharePostSurfaces,
): Promise<SharePostResult> {
  const { share, clipboard } = surfaces;

  if (share) {
    try {
      await share({ url: payload.url, title: payload.title });
      return 'shared';
    } catch (error) {
      // The ONE early return: a dismissal must not fall through to the clipboard.
      if (isDismissal(error)) return 'dismissed';
    }
  }

  return copy(payload.url, clipboard);
}
