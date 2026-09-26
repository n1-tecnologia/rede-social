import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import {
  addStoryToHighlightAction,
  createHighlightAction,
  deleteHighlightAction,
  loadHighlightEditAction,
  loadHighlightItemsAction,
  loadHighlightSheetAction,
  removeStoryFromHighlightAction,
  renameHighlightAction,
  reorderHighlightsAction,
  setHighlightCoverAction,
} from './highlight-actions';

/**
 * 05.2-05 — the lazy group read behind every Início highlight circle (HIGHLIGHT-02, T-05.2-23).
 *
 * `/inicio`'s SSR never carries a highlight's items (N×M): the viewer asks for ONE highlight's
 * stories when the member enters its group, through this server action. A server action is a public
 * endpoint and its argument is untrusted, so the three claims worth a test are:
 *
 *  1. **An id that is not a uuid never reaches the API** — refused here, before any request.
 *  2. **Every API miss is ONE answer.** The API's bare 404 (another tenant's highlight, an empty one
 *     a member may not open, a deleted one) becomes `{ ok: false }` with no detail to tell them apart.
 *  3. **A hit is mapped with the SAME view builder the strip uses** (`storyViewerItem`), so a story
 *     looks identical whichever circle opened it — relative time already formatted on the server.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env` and `next/navigation`. What is
 * real: the uuid guard, `getHighlight`'s schema parse and the item mapping.
 */

// The module graph reaches `lib/env`, which validates the process environment at import time.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'tria.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The sheet's place label ("Início") is read from the catalog on the server; the stub answers the
// one key the action reads and echoes any other, so a wrong key shows up as a wrong label.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    // The REAL pt-BR catalog: a wrong key or a reworded string turns the view assertions red.
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const HIGHLIGHT = '0000000a-1111-4111-8111-111111111111';
const STORY = '0d000000-0000-4000-8000-0000000000d4';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A `GET /v1/stories/highlights/{id}` body: the highlight and ONE expired story, oldest first. */
function detail() {
  const published = new Date(Date.now() - 30 * 3_600_000).toISOString();
  return {
    highlight: {
      id: HIGHLIGHT,
      communityId: null,
      title: 'Bastidores',
      position: 0,
      coverAssetId: null,
      coverVariantWidths: [],
      coverStoryId: null,
      coverChosen: false,
      itemCount: 1,
    },
    items: [
      {
        id: STORY,
        authorUserId: '0a000000-0000-4000-8000-000000000001',
        mediaAssetId: '0b000000-0000-4000-8000-000000000001',
        mediaKind: 'image',
        mediaVariantWidths: [640, 1080],
        mediaStatus: 'ready',
        mediaFailureReason: null,
        caption: 'Publicado ontem, ja fora da regua.',
        publishedAt: published,
        expiresAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
        isActive: false,
        durationSeconds: null,
        likeCount: 2,
        commentCount: 1,
        viewerLiked: true,
        highlightCount: 1,
        viewerSeen: false,
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(revalidatePath).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadHighlightItemsAction — the lazy highlight group read (T-05.2-23)', () => {
  it('1. an id that is not a uuid is refused WITHOUT a request', async () => {
    await expect(loadHighlightItemsAction('not-a-uuid')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('2. the API’s bare 404 is { ok: false } — no detail, no navigation', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(loadHighlightItemsAction(HIGHLIGHT)).resolves.toEqual({ ok: false });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${HIGHLIGHT}`);
  });

  it('3. a 200 maps every story with the strip’s own view builder — expired ones included', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, detail()));
    const result = await loadHighlightItemsAction(HIGHLIGHT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: STORY,
      mediaKind: 'image',
      mediaAssetId: '0b000000-0000-4000-8000-000000000001',
      mediaVariantWidths: [640, 1080],
      caption: 'Publicado ontem, ja fora da regua.',
      likeCount: 2,
      commentCount: 1,
      viewerLiked: true,
    });
    // The relative time is formatted HERE, on the server (UI-D-14) — a string, never a date.
    expect(typeof result.items[0]?.timeLabel).toBe('string');
    expect(result.items[0]?.timeLabel).not.toBe('');
  });

  it('4. a 401 is a NAVIGATION to /entrar, taken outside the try/catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(loadHighlightItemsAction(HIGHLIGHT)).rejects.toThrow('redirect:/entrar');
  });
});

/* ── 05.2-06: the highlight sheet's plumbing (D-110, HIGHLIGHT-02, T-05.2-26..28) ───────────── */

const COMMUNITY_A = '0c000000-0000-4000-8000-00000000000a';
const COMMUNITY_B = '0c000000-0000-4000-8000-00000000000b';
const ARCHIVED = '0c000000-0000-4000-8000-0000000000ff';

function summary(id: string, communityId: string | null, title: string, position: number) {
  return {
    id,
    communityId,
    title,
    position,
    coverAssetId: null,
    coverVariantWidths: [],
    coverStoryId: null,
    coverChosen: false,
    itemCount: 0,
  };
}

function community(id: string, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: 'active',
    lastActivityAt: new Date(0).toISOString(),
  };
}

const H_HOME = '0000000a-1111-4111-8111-000000000001';
const H_B = '0000000a-1111-4111-8111-000000000002';
const H_A = '0000000a-1111-4111-8111-000000000003';
const H_GONE = '0000000a-1111-4111-8111-000000000004';

/**
 * The three reads the sheet opens on. The catalogue lists community B BEFORE A (its own `position`
 * order) and one highlight of a community that is no longer active; the communities list says A
 * comes first. The sheet must follow the communities list and drop the orphan.
 */
function sheetRoutes(path: string): Response {
  if (path === '/v1/stories/highlights/catalog') {
    return json(200, {
      items: [
        summary(H_HOME, null, 'Bastidores', 0),
        summary(H_B, COMMUNITY_B, 'Ensaios', 0),
        summary(H_A, COMMUNITY_A, 'Assembleias', 0),
        summary(H_GONE, ARCHIVED, 'Antigo', 0),
      ],
    });
  }
  if (path === `/v1/stories/${STORY}/highlights`) return json(200, { highlightIds: [H_A] });
  if (path.startsWith('/v1/communities?')) {
    return json(200, {
      items: [community(COMMUNITY_A, 'Avisos'), community(COMMUNITY_B, 'Coral')],
      nextCursor: null,
    });
  }
  return json(404, { error: { code: 'NOT_FOUND' } });
}

describe('loadHighlightSheetAction — ONE read opens the sheet (05.2-06, UI E09 loading)', () => {
  it('5. a story id that is not a uuid is { ok: false } WITHOUT a request', async () => {
    await expect(loadHighlightSheetAction('x')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('6. catalogue, memberships and communities are read IN PARALLEL and composed into places', async () => {
    // Every response is held until all three requests have been ISSUED: a sequential
    // implementation would wait on the first forever, and this case would time out.
    const gate: Array<() => void> = [];
    vi.mocked(apiFetch).mockImplementation(
      (path) =>
        new Promise<Response>((resolve) => {
          gate.push(() => resolve(sheetRoutes(String(path))));
          if (gate.length === 3) for (const release of gate) release();
        }),
    );

    const result = await loadHighlightSheetAction(STORY);

    const paths = vi.mocked(apiFetch).mock.calls.map(([path]) => String(path));
    expect(paths).toContain('/v1/stories/highlights/catalog');
    expect(paths).toContain(`/v1/stories/${STORY}/highlights`);
    expect(result).toEqual({
      ok: true,
      selectedIds: [H_A],
      places: [
        {
          key: 'home',
          label: 'Início',
          communityId: null,
          rows: [{ id: H_HOME, title: 'Bastidores', cover: null }],
        },
        {
          key: COMMUNITY_A,
          label: 'Avisos',
          communityId: COMMUNITY_A,
          rows: [{ id: H_A, title: 'Assembleias', cover: null }],
        },
        {
          key: COMMUNITY_B,
          label: 'Coral',
          communityId: COMMUNITY_B,
          rows: [{ id: H_B, title: 'Ensaios', cover: null }],
        },
      ],
    });
  });

  it('7. a member’s 403 on the manage-only catalogue is { ok: false } — no sheet, no navigation (T-05.2-26)', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      String(path).startsWith('/v1/stories/')
        ? json(403, { error: { code: 'FORBIDDEN' } })
        : sheetRoutes(String(path)),
    );
    await expect(loadHighlightSheetAction(STORY)).resolves.toEqual({ ok: false });
  });
});

describe('add/removeStoryToHighlightAction — one toggle, one validated write (05.2-06)', () => {
  const HOME_QUIET = { communityId: null, revalidate: false };

  it('8. add with revalidate:false answers the new count and revalidates NOTHING (the viewer rule)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { highlighted: true, highlightCount: 2 }));

    await expect(addStoryToHighlightAction(STORY, H_HOME, HOME_QUIET)).resolves.toEqual({
      ok: true,
      highlightCount: 2,
    });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${H_HOME}/stories/${STORY}`, {
      method: 'PUT',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('9. revalidate:true in a community revalidates that community page', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { highlighted: true, highlightCount: 1 }));

    await addStoryToHighlightAction(STORY, H_A, { communityId: COMMUNITY_A, revalidate: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY_A}`);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('10. remove is a DELETE; revalidate:true in Início revalidates /inicio', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { highlighted: false, highlightCount: 0 }));

    await expect(
      removeStoryFromHighlightAction(STORY, H_HOME, { communityId: null, revalidate: true }),
    ).resolves.toEqual({ ok: true, highlightCount: 0 });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${H_HOME}/stories/${STORY}`, {
      method: 'DELETE',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/inicio');
  });

  it.each([
    [400, { error: { code: 'VALIDATION_FAILED', details: { highlight: 'archived' } } }, 'archived'],
    [400, { error: { code: 'VALIDATION_FAILED', details: { highlight: 'full' } } }, 'full'],
    [
      400,
      { error: { code: 'VALIDATION_FAILED', details: { highlight: 'order_stale' } } },
      'generic',
    ],
    [404, { error: { code: 'NOT_FOUND' } }, 'generic'],
    [403, { error: { code: 'FORBIDDEN' } }, 'generic'],
    [500, { error: { code: 'INTERNAL' } }, 'generic'],
  ])(
    '11. a %i refusal %j is the closed code %s, and nothing is revalidated',
    async (status, body, code) => {
      vi.mocked(apiFetch).mockResolvedValue(json(status, body));

      await expect(
        addStoryToHighlightAction(STORY, H_A, { communityId: COMMUNITY_A, revalidate: true }),
      ).resolves.toEqual({ ok: false, code });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('12. forged ids or a forged place are refused WITHOUT a request (T-05.2-27)', async () => {
    await expect(addStoryToHighlightAction('x', H_A, HOME_QUIET)).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    await expect(removeStoryFromHighlightAction(STORY, 'y', HOME_QUIET)).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    await expect(
      addStoryToHighlightAction(STORY, H_A, {
        communityId: '../inicio',
        revalidate: true,
      } as never),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('13. a 401 is a NAVIGATION to /entrar, taken outside the try/catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(addStoryToHighlightAction(STORY, H_A, HOME_QUIET)).rejects.toThrow(
      'redirect:/entrar',
    );
  });
});

/* ── 05.2-09: the manage screen's curation actions (HIGHLIGHT-01, T-05.2-39..43) ───────────── */

describe('createHighlightAction — a new highlight at the END of its place (UI-D-72)', () => {
  it('14. Início: the TRIMMED title is POSTed with no communityId, the row view answers, /inicio revalidates', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, summary(H_HOME, null, 'Teste', 2)));

    const result = await createHighlightAction({ communityId: null }, '  Teste ');

    expect(apiFetch).toHaveBeenCalledWith('/v1/stories/highlights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Teste' }),
    });
    expect(result).toEqual({
      ok: true,
      highlight: {
        id: H_HOME,
        communityId: null,
        title: 'Teste',
        meta: 'Vazio · só você vê',
        cover: null,
        coverChosen: false,
        itemCount: 0,
        editLabel: 'Editar destaque Teste',
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/inicio');
  });

  it('15. a community place POSTs its communityId and revalidates that community page', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, summary(H_A, COMMUNITY_A, 'Atas', 0)));

    await createHighlightAction({ communityId: COMMUNITY_A }, 'Atas');

    expect(apiFetch).toHaveBeenCalledWith('/v1/stories/highlights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ communityId: COMMUNITY_A, title: 'Atas' }),
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY_A}`);
  });

  it('16. a blank title is title_invalid WITHOUT a request; a forged place is generic without one', async () => {
    await expect(createHighlightAction({ communityId: null }, '   ')).resolves.toEqual({
      ok: false,
      code: 'title_invalid',
    });
    await expect(
      createHighlightAction({ communityId: '../inicio' } as never, 'Teste'),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      { error: { code: 'VALIDATION_FAILED', details: { highlight: 'title_invalid' } } },
      400,
      'title_invalid',
    ],
    [{ error: { code: 'VALIDATION_FAILED', details: { highlight: 'archived' } } }, 400, 'archived'],
    [{ error: { code: 'VALIDATION_FAILED', details: { highlight: 'full' } } }, 400, 'full'],
    [{ error: { code: 'NOT_FOUND' } }, 404, 'generic'],
    [{ error: { code: 'FORBIDDEN' } }, 403, 'generic'],
  ])(
    '17. a refusal %j (%i) is the closed code %s, and nothing is revalidated',
    async (body, status, code) => {
      vi.mocked(apiFetch).mockResolvedValue(json(status, body));
      await expect(createHighlightAction({ communityId: null }, 'Teste')).resolves.toEqual({
        ok: false,
        code,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe('reorderHighlightsAction — ONE full permutation per gesture (UI-D-73, R-D-C)', () => {
  it('18. PUTs the permutation (no communityId for Início) and answers the new row views', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, {
        items: [
          summary(H_B, null, 'Aulas', 0),
          { ...summary(H_HOME, null, 'Bastidores', 1), itemCount: 3 },
        ],
      }),
    );

    const result = await reorderHighlightsAction({ communityId: null }, [H_B, H_HOME]);

    expect(apiFetch).toHaveBeenCalledWith('/v1/stories/highlights/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightIds: [H_B, H_HOME] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => [item.id, item.meta])).toEqual([
      [H_B, 'Vazio · só você vê'],
      [H_HOME, '3 stories'],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/inicio');
  });

  it('19. a 400 order_stale is { ok: false, code: order_stale } and nothing is revalidated', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_FAILED', details: { highlight: 'order_stale' } } }),
    );
    await expect(
      reorderHighlightsAction({ communityId: COMMUNITY_A }, [H_A, H_B]),
    ).resolves.toEqual({ ok: false, code: 'order_stale' });
    expect(apiFetch).toHaveBeenCalledWith('/v1/stories/highlights/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ communityId: COMMUNITY_A, highlightIds: [H_A, H_B] }),
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('20. a non-uuid id in the permutation is generic WITHOUT a request (T-05.2-43)', async () => {
    await expect(reorderHighlightsAction({ communityId: null }, [H_A, 'x'])).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('rename / cover / delete — one validated PATCH or DELETE each (UI-D-74, UI-D-75)', () => {
  it('21. rename PATCHes the TRIMMED title and answers the row view; the place revalidates', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, summary(H_A, COMMUNITY_A, 'Novo', 0)));

    const result = await renameHighlightAction(H_A, ' Novo ', { communityId: COMMUNITY_A });

    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${H_A}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Novo' }),
    });
    expect(result).toMatchObject({ ok: true, highlight: { id: H_A, title: 'Novo' } });
    expect(revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY_A}`);
  });

  it('22. a cover by upload sends { cover: { assetId } }; automatic sends { cover: null }; a frame { storyId }', async () => {
    const ASSET = '0b000000-0000-4000-8000-0000000000c1';
    vi.mocked(apiFetch).mockImplementation(async () =>
      json(200, { ...summary(H_HOME, null, 'Bastidores', 0), coverChosen: true }),
    );

    await setHighlightCoverAction(H_HOME, { assetId: ASSET }, { communityId: null });
    await setHighlightCoverAction(H_HOME, null, { communityId: null });
    await setHighlightCoverAction(H_HOME, { storyId: STORY }, { communityId: null });

    const bodies = vi.mocked(apiFetch).mock.calls.map(([, init]) => init?.body);
    expect(bodies).toEqual([
      JSON.stringify({ cover: { assetId: ASSET } }),
      JSON.stringify({ cover: null }),
      JSON.stringify({ cover: { storyId: STORY } }),
    ]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(`/v1/stories/highlights/${H_HOME}`);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('23. a cover whose asset is not ready yet (the bare 404) is generic — the admin retries', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(
      setHighlightCoverAction(H_HOME, { assetId: STORY }, { communityId: null }),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    await expect(
      setHighlightCoverAction(H_HOME, { assetId: 'x' } as never, { communityId: null }),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('24. delete is a DELETE; a 204 is { ok: true } and the place revalidates; archived is not refused', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteHighlightAction(H_A, { communityId: COMMUNITY_A })).resolves.toEqual({
      ok: true,
    });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${H_A}`, { method: 'DELETE' });
    expect(revalidatePath).toHaveBeenCalledWith(`/comunidades/${COMMUNITY_A}`);
  });

  it('25. a 401 on any curation write is a NAVIGATION to /entrar, taken outside the try/catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(deleteHighlightAction(H_A, { communityId: null })).rejects.toThrow(
      'redirect:/entrar',
    );
  });
});

describe('loadHighlightEditAction — the edit sheet’s ONE read (UI-D-74)', () => {
  it('26. answers the row view and the stories with server dates, media pills and the resolved cover', async () => {
    const COVER_ASSET = '0b000000-0000-4000-8000-0000000000c2';
    const base = detail();
    const story = base.items[0] as (typeof base.items)[number];
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, {
        highlight: {
          ...base.highlight,
          coverAssetId: COVER_ASSET,
          coverVariantWidths: [640],
          itemCount: 1,
        },
        items: [
          {
            ...story,
            id: STORY,
            mediaAssetId: COVER_ASSET,
            publishedAt: '2026-09-20T12:00:00.000Z',
          },
          {
            ...story,
            id: '0d000000-0000-4000-8000-0000000000d5',
            mediaKind: 'video',
            mediaStatus: 'processing',
            publishedAt: '2026-09-21T12:00:00.000Z',
          },
        ],
      }),
    );

    const result = await loadHighlightEditAction(HIGHLIGHT);

    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${HIGHLIGHT}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.highlight).toMatchObject({ id: HIGHLIGHT, title: 'Bastidores', meta: '1 story' });
    expect(result.items).toHaveLength(2);
    const [first, second] = result.items;
    expect(first).toMatchObject({ id: STORY, mediaKind: 'image', isCover: true });
    expect(first?.status).toBeUndefined();
    expect(first?.dateLabel).toBe(
      new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
        new Date('2026-09-20T12:00:00.000Z'),
      ),
    );
    expect(first?.removeLabel).toBe(`Remover do destaque o story de ${first?.dateLabel}`);
    expect(second).toMatchObject({
      mediaKind: 'video',
      isCover: false,
      status: { tone: 'warning', label: 'Processando' },
    });
  });

  it('27. a non-uuid id is { ok: false } WITHOUT a request; the bare 404 is { ok: false }; a 401 navigates', async () => {
    await expect(loadHighlightEditAction('x')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();

    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(loadHighlightEditAction(HIGHLIGHT)).resolves.toEqual({ ok: false });

    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(loadHighlightEditAction(HIGHLIGHT)).rejects.toThrow('redirect:/entrar');
  });
});
