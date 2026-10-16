import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { instagramOf, loadAuthorInstagrams, withAuthorInstagrams } from '@/lib/author-instagram';

/**
 * 2026-10-09 — the handle under each author's name, looked up from the author's public profile.
 *
 * The claims worth a test:
 *
 *  1. **One read per author.** A page with three posts by two authors asks the API twice, at
 *     `/v1/members/{membershipId}`, with a timeout signal; the map holds only the authors who HAVE a
 *     handle (a plain bio and no bio are absent).
 *  2. **Best effort.** A 404, a 500, a thrown fetch and a body that does not parse are all "no
 *     handle": nothing throws, nothing navigates, and the page still renders.
 *  3. **Nothing personal in the log.** A failure logs its status or its error name, never the bio.
 *  4. **`withAuthorInstagrams`** hands the page back untouched, and a failed read (`null`) costs no
 *     request.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport). What is real: the schema parse and the
 * bio split. React's `cache` passes through outside a render, so the dedupe asserted here is
 * `loadAuthorInstagrams`' own.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const ANA = '0e000000-0000-4000-8000-0000000000b1';
const BRUNO = '0e000000-0000-4000-8000-0000000000b2';
const CARLA = '0e000000-0000-4000-8000-0000000000b3';
const SECRET_BIO = 'Moro na rua das Flores, 12';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function profile(membershipId: string, bio: string | null) {
  return { membershipId, displayName: 'Pessoa', bio, avatarAssetId: null, avatarUrl: null };
}

const post = (membershipId: string) => ({ author: { membershipId } });

/** Answers each member's profile from `bios`; an id missing from it is the API's bare 404. */
function answerBios(bios: Record<string, string | null>) {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    const id = String(path).replace('/v1/members/', '');
    return id in bios
      ? json(200, profile(id, bios[id] ?? null))
      : json(404, { error: { code: 'NOT_FOUND' } });
  });
}

/** One spy for the file, cleared before each case, so a case sees only its own log lines. */
const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  logged.mockClear();
});

describe('loadAuthorInstagrams — one read per author (1)', () => {
  it('asks once per distinct author, with a timeout, and keeps only the handles', async () => {
    answerBios({ [ANA]: `${SECRET_BIO}\n\nInstagram: @ana.souza`, [BRUNO]: 'Professor.' });

    const instagrams = await loadAuthorInstagrams([post(ANA), post(BRUNO), post(ANA)]);

    expect(Object.fromEntries(instagrams)).toEqual({ [ANA]: 'ana.souza' });
    const calls = vi.mocked(apiFetch).mock.calls;
    expect(calls.map(([path]) => path)).toEqual([`/v1/members/${ANA}`, `/v1/members/${BRUNO}`]);
    for (const [, init] of calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('an author with no bio, or with only text, has no handle', async () => {
    answerBios({ [ANA]: null, [BRUNO]: 'Instagram: @bruno' });
    const instagrams = await loadAuthorInstagrams([post(ANA), post(BRUNO)]);
    expect(Object.fromEntries(instagrams)).toEqual({ [BRUNO]: 'bruno' });
  });

  it('a page with no posts asks nothing', async () => {
    expect((await loadAuthorInstagrams([])).size).toBe(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('instagramOf — best effort (2) with nothing personal in the log (3)', () => {
  it('a 404 is no handle and no log line', async () => {
    answerBios({});
    await expect(instagramOf(ANA)).resolves.toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it('a 500 is no handle, logged with its status only', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await expect(instagramOf(ANA)).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith('feed.author_instagram_failed', { status: 500 });
  });

  it('a thrown fetch (a timeout, the network) is no handle, logged with its name only', async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      Object.assign(new Error(`timed out reading ${SECRET_BIO}`), { name: 'TimeoutError' }),
    );
    await expect(instagramOf(ANA)).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith('feed.author_instagram_failed', {
      name: 'TimeoutError',
    });
  });

  it('a body that does not parse is no handle', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { ...profile(ANA, `${SECRET_BIO}\n\nInstagram: @ana.souza`), role: 'admin' }),
    );
    await expect(instagramOf(ANA)).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith('feed.author_instagram_failed', {
      status: 200,
      reason: 'invalid_body',
    });
  });

  it('a page whose every lookup fails still resolves, and no log line carries a bio', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (String(path).endsWith(ANA)) throw new TypeError(`fetch failed: ${SECRET_BIO}`);
      if (String(path).endsWith(BRUNO)) return json(503, { error: { message: SECRET_BIO } });
      return json(200, { bio: SECRET_BIO });
    });

    const instagrams = await loadAuthorInstagrams([post(ANA), post(BRUNO), post(CARLA)]);

    expect(instagrams.size).toBe(0);
    expect(logged).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET_BIO);
  });

  it('the membership id is escaped into the path', async () => {
    answerBios({});
    await instagramOf('a/b?c');
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/members/a%2Fb%3Fc');
  });
});

describe('withAuthorInstagrams — the page and its handles (4)', () => {
  it('hands the page back untouched, with its authors’ handles', async () => {
    answerBios({ [ANA]: 'Instagram: @ana.souza' });
    const page = { items: [post(ANA)], nextCursor: 'opaque' };

    const result = await withAuthorInstagrams(page);

    expect(result.page).toBe(page);
    expect(result.instagrams.get(ANA)).toBe('ana.souza');
  });

  it('a failed read (null) costs no request', async () => {
    const result = await withAuthorInstagrams(null);
    expect(result).toEqual({ page: null, instagrams: new Map() });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
