import { describe, expect, it, vi } from 'vitest';
import { sharePost } from '../ui/sharePost';

/**
 * FEED-07 / UI-SPEC E16 — `sharePost`'s four outcomes, proved WITHOUT a browser.
 *
 * Both surfaces are injected, which is the whole reason this file can exist: a helper that reached
 * for a global `navigator` would need a DOM to test and, worse, would be free to reach for the
 * browser's own origin — the alias-host leak 02-08 folded away at the proxy and T-04-51 bans here.
 * Every case below hands in stubs and asserts what came back.
 *
 * The case that matters most is the DISMISSAL: the viewer closing the OS share sheet is a normal
 * outcome, not a failure. It must RESOLVE (so the caller's branch table stays total), it must
 * resolve to its own value (so the caller can stay silent), and it must NOT fall through to the
 * clipboard — copying a link somebody just declined to share is the wrong answer twice over.
 */

const payload = { url: 'https://comunidade.exemplo.invalid/post/abc', title: 'Comunidade Demo' };

/** The DOM's dismissal signal. Matched by `name`, never by message — platforms localise messages. */
function abortError(): Error {
  const error = new Error('Share canceled');
  error.name = 'AbortError';
  return error;
}

describe('sharePost (FEED-07, UI-SPEC E16)', () => {
  it('calls the share surface once with the url and title, and resolves "shared"', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboard = vi.fn().mockResolvedValue(undefined);

    await expect(sharePost(payload, { share, clipboard })).resolves.toBe('shared');

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url: payload.url, title: payload.title });
    // A successful native share is the whole interaction; nothing is copied behind the member's back.
    expect(clipboard).not.toHaveBeenCalled();
  });

  it('resolves "dismissed" on an AbortError and never touches the clipboard', async () => {
    const share = vi.fn().mockRejectedValue(abortError());
    const clipboard = vi.fn().mockResolvedValue(undefined);

    // RESOLVES — the caller raises no toast for this, so it must not be a rejection to catch.
    await expect(sharePost(payload, { share, clipboard })).resolves.toBe('dismissed');
    expect(clipboard).not.toHaveBeenCalled();
  });

  it('matches the dismissal by error NAME, not by its localised message', async () => {
    const localised = new Error('Compartilhamento cancelado pelo usuário');
    localised.name = 'AbortError';
    const share = vi.fn().mockRejectedValue(localised);
    const clipboard = vi.fn().mockResolvedValue(undefined);

    await expect(sharePost(payload, { share, clipboard })).resolves.toBe('dismissed');
    expect(clipboard).not.toHaveBeenCalled();
  });

  it('falls through to the clipboard when the share surface fails for any other reason', async () => {
    const share = vi.fn().mockRejectedValue(new TypeError('share is not allowed here'));
    const clipboard = vi.fn().mockResolvedValue(undefined);

    await expect(sharePost(payload, { share, clipboard })).resolves.toBe('copied');
    expect(clipboard).toHaveBeenCalledWith(payload.url);
  });

  it('resolves "failed" when the share surface fails AND the clipboard write is denied', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'));
    const clipboard = vi.fn().mockRejectedValue(new Error('NotAllowedError'));

    await expect(sharePost(payload, { share, clipboard })).resolves.toBe('failed');
  });

  it('goes straight to the clipboard with no share surface at all (the desktop path)', async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);

    await expect(sharePost(payload, { clipboard })).resolves.toBe('copied');
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard).toHaveBeenCalledWith(payload.url);
  });

  it('resolves "failed" with no share surface and a denied clipboard write', async () => {
    const clipboard = vi.fn().mockRejectedValue(new Error('denied'));

    await expect(sharePost(payload, { clipboard })).resolves.toBe('failed');
  });

  it('resolves "failed" — never throws — when neither surface exists', async () => {
    // Totality: the caller's branch table has four arms and no catch, so no input may reject.
    await expect(sharePost(payload, {})).resolves.toBe('failed');
  });
});
