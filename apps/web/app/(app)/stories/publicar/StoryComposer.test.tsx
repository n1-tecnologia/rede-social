// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * STORY-01's publish screen (UI-D-39, D-81), exercised through what an admin can actually see and
 * do rather than through pixels.
 *
 * The catalog is the REAL `stories.json`, so an assertion here fails when the pt-BR copy drifts —
 * the `AvatarUploadField.test.ts` pattern, one phase later. What is stubbed: the upload hook (its
 * own state machine is already covered by the Phase 3 suites), the server action and the router.
 * What is real: the two-state screen, the caption cap, the client-side no-media refusal and the
 * asynchronous processing note.
 *
 * The five claims worth a test are the five a later edit could quietly break:
 *
 *  1. **UI empty/E07.** Before a pick there is nothing to publish, so `Publicar` does not exist —
 *     not disabled, ABSENT. A disabled button invites a tap that can never work.
 *  2. **The pick-time refusal is client-side and costs no request** (the sketch's "pré-escolha com
 *     erro" frame). Submitting with no media shows the no-media copy and the action is not called.
 *  3. **UI-D-39's post-pick state** is the media filling a black screen with the caption overlaid
 *     and `Publicar` present — the frame members will see, which is the only affordance that
 *     prevents a cropped or unreadable story.
 *  4. **Publishing a VIDEO says the 24 h window starts NOW**, rather than silently losing story
 *     life while the provider transcodes (Pitfall 5).
 *  5. **The caption cap is the CONTRACT's**, not a number typed into this file.
 *
 * Cases 7-15 (05.1-04) are the "Publicar em" row, ROADMAP criteria 3 and 5 as one mechanism: the
 * composer states where the story goes before it can be published (D-97, UI-D-54), arrives
 * pre-filled from a community page (D-93), sends ONE write with `communityId` only when one is
 * chosen (D-99), lands where the story went (D-94, UI-D-57) and recovers legibly when the chosen
 * community is archived under the admin's feet (UI-D-58). The `communities` catalog is real too, so
 * the row's and the sheet's words are asserted against the shipped copy.
 */

const { catalog, mediaCatalog, communitiesCatalog, toast, push, publish, upload } =
  await vi.hoisted(async () => {
    // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (name: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
    return {
      catalog: read('stories').stories as Record<string, unknown>,
      mediaCatalog: read('media').media as Record<string, unknown>,
      communitiesCatalog: read('communities').communities as Record<string, unknown>,
      toast: { show: vi.fn(), dismiss: vi.fn() },
      push: vi.fn(),
      publish: vi.fn(),
      upload: {
        image: { pick: vi.fn(), reject: vi.fn(), cancel: vi.fn(), reset: vi.fn() },
        video: { pick: vi.fn(), reject: vi.fn(), cancel: vi.fn(), reset: vi.fn() },
        handlers: {} as Record<string, { onCompleted?: unknown; onHandedToProvider?: unknown }>,
      },
    };
  });

// Springs have nothing to animate under happy-dom, and a cancelled one rejects AFTER the run ends —
// the "Publicar em" sheet and the discard dialog both animate (the community-picker-sheet pattern).
MotionGlobalConfig.skipAnimations = true;

const lookup = (tree: Record<string, unknown>, key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
    lookup(
      namespace === 'media'
        ? mediaCatalog
        : namespace === 'communities'
          ? communitiesCatalog
          : catalog,
      key,
      values,
    ),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({ publishStoryAction: publish }));

/**
 * The hook is stubbed at its SEAM rather than its internals: the test captures the callbacks the
 * composer registers and drives them directly, which is how "a video handed to the provider" and
 * "an image completed in Storage" become two one-line scenarios instead of two fake transports.
 */
// A PLAIN factory, not a spread of the original: the real module imports the profile server
// actions, which import `lib/api` -> `lib/env`, which fails fast on the browser env vars a unit
// test has no business supplying. The composer uses nothing else from this module.
vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: (options: { kind: string; [key: string]: unknown }) => {
    upload.handlers[options.kind] = options as never;
    const shell = options.kind === 'video' ? upload.video : upload.image;
    return { state: 'idle', progress: 0, error: null, ...shell };
  },
}));

const { MEDIA_LIMITS } = await import('@tria/contracts/media');
const { STORY_MAX_CAPTION } = await import('@tria/module-stories/contracts');
const { StoryComposer } = await import('./StoryComposer');

/** Drives the captured `onCompleted` / `onHandedToProvider` seam for one kind. */
async function completeUpload(kind: 'image' | 'video', assetId: string) {
  const options = upload.handlers[kind] as {
    onCompleted?: (asset: { id: string }) => unknown;
    onHandedToProvider?: (assetId: string) => unknown;
  };
  await act(async () => {
    if (kind === 'video' && options.onHandedToProvider) await options.onHandedToProvider(assetId);
    else await options.onCompleted?.({ id: assetId });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upload.handlers = {};
  publish.mockResolvedValue({ ok: true });
  // happy-dom does not implement object URLs; the preview only needs a stable string.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:story-preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const composer = () => render(<StoryComposer historyHref="/stories/meus" />);

describe('StoryComposer — the two-state publish screen (UI-D-39, D-81)', () => {
  it('1. before a pick: both pickers, the duration helper, and NO Publicar control at all', () => {
    composer();
    // TWO nodes per picker, and that is the approved drawing: the mobile ROW (`md:hidden`) and the
    // desktop DROP ZONE render the same words and drive the SAME hidden input, so a breakpoint
    // cannot offer a picker the other one lacks.
    expect(screen.getAllByText(lookup(catalog, 'publish.pickPhoto'))).toHaveLength(2);
    expect(screen.getAllByText(lookup(catalog, 'publish.pickVideo'))).toHaveLength(2);
    // UI-D-05: the cap is INTERPOLATED from MEDIA_LIMITS, never typed into the copy — and it is
    // formatted by the SAME `>= 60 -> minutes` rule `useSignedUpload` applies to the duration
    // REFUSAL, so the number a member is promised and the number they are refused with can never be
    // rounded two different ways. Derived here rather than written out, which is what makes the
    // assertion fail if the cap moves and the copy does not.
    const cap = MEDIA_LIMITS.video.story?.maxDurationSeconds ?? 0;
    const capLabel = cap >= 60 ? `${Math.round(cap / 60)} min` : `${cap} s`;
    expect(screen.getByTestId('story-duration-helper').textContent).toBe(
      lookup(catalog, 'publish.helper', { limit: capLabel }),
    );
    expect(screen.queryByRole('button', { name: lookup(catalog, 'publish.submit') })).toBeNull();
  });

  it('2. submitting with no media shows the no-media copy and never calls the action', async () => {
    composer();
    await act(async () => {
      fireEvent.submit(screen.getByTestId('story-composer'));
    });
    expect(screen.getByRole('alert').textContent).toBe(lookup(catalog, 'publish.errors.noMedia'));
    expect(publish).not.toHaveBeenCalled();
  });

  it('3. after a pick the screen becomes the story FRAME: object-contain media + caption + Publicar', async () => {
    const { container } = composer();
    await completeUpload('image', 'a1111111-1111-4111-8111-111111111111');

    expect(container.querySelector('[data-testid="story-preview"]')?.className).toContain(
      'object-contain',
    );
    expect(screen.getByLabelText(lookup(catalog, 'publish.captionLabel'))).toBeTruthy();
    expect(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') })).toBeTruthy();
    // The pickers are gone: there is one thing to do on this screen now.
    expect(screen.queryAllByText(lookup(catalog, 'publish.pickPhoto'))).toHaveLength(0);
  });

  it('4. publishing an image sends the asset id and the caption, then leaves for /inicio', async () => {
    composer();
    await completeUpload('image', 'a1111111-1111-4111-8111-111111111111');

    fireEvent.change(screen.getByLabelText(lookup(catalog, 'publish.captionLabel')), {
      target: { value: 'ola' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') }));
    });

    expect(publish).toHaveBeenCalledWith({
      mediaAssetId: 'a1111111-1111-4111-8111-111111111111',
      mediaKind: 'image',
      caption: 'ola',
    });
    expect(push).toHaveBeenCalledWith('/inicio');
  });

  it('5. a VIDEO carries the processing note — the 24 h window starts at publish, not at ready', async () => {
    composer();
    await completeUpload('video', 'b1111111-1111-4111-8111-111111111111');
    expect(screen.getByText(lookup(catalog, 'publish.processingNote'))).toBeTruthy();
  });

  it('6. the caption counter reads the CONTRACT cap, never a number typed into the screen', async () => {
    composer();
    await completeUpload('image', 'a1111111-1111-4111-8111-111111111111');
    const field = screen.getByLabelText(lookup(catalog, 'publish.captionLabel'));
    expect(field.getAttribute('maxlength')).toBe(String(STORY_MAX_CAPTION));
    expect(screen.getByTestId('story-caption-counter').textContent).toBe(`0/${STORY_MAX_CAPTION}`);
  });
});

/* ── 05.1-04: "Publicar em" — the composer asks where the story goes ─────────────────────────── */

const A = 'c1111111-1111-4111-8111-111111111111';
const B = 'c2222222-2222-4222-8222-222222222222';
const IMAGE = 'a1111111-1111-4111-8111-111111111111';
const OTHER_IMAGE = 'a2222222-2222-4222-8222-222222222222';
const VIDEO = 'b1111111-1111-4111-8111-111111111111';

/** Cover-less on purpose: the gradient branch renders, and no media request is ever made. */
const row = (id: string, name: string) => ({
  id,
  name,
  coverAssetId: null,
  coverVariantWidths: [] as number[],
  coverAlt: lookup(communitiesCatalog, 'picker.cover', { community: name }),
});
const NAME_A = 'Comunidade Alfa';
const NAME_B = 'Comunidade Beta';
/** UI long-text backstop: a 60-character name must reach the alert in full. */
const LONG_A = 'Comunidade de Moradores do Condomínio Jardim das Palmeiras 1';
const COMMUNITIES = [row(A, NAME_A), row(B, NAME_B)];

const NONE = lookup(catalog, 'publish.destination.none');
const rowName = (value: string) => `${lookup(communitiesCatalog, 'picker.label')} ${value}`;

const withCommunities = (
  props: { initialCommunityId?: string | null; communities?: ReturnType<typeof row>[] } = {},
) =>
  render(
    <StoryComposer
      historyHref="/stories/meus"
      communities={props.communities ?? COMMUNITIES}
      initialCommunityId={props.initialCommunityId ?? null}
    />,
  );

/** The composer's "Publicar em" row — located by its marker, since a sheet row shares its name. */
const destinationRow = () =>
  document.querySelector('[data-story-destination]') as HTMLButtonElement | null;

async function publishNow() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') }));
  });
}

async function openSheet() {
  const button = destinationRow();
  if (!button) throw new Error('the Publicar em row is not rendered');
  await act(async () => {
    fireEvent.click(button);
  });
  return screen.getByRole('dialog');
}

async function choose(dialog: HTMLElement, name: string) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name }));
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('StoryComposer — "Publicar em" (05.1-04, D-93..D-99, UI-D-54..UI-D-58)', () => {
  it('7. the row sits above the caption, reads "Nenhuma comunidade" by default, and the tenant-wide body is exactly today’s', async () => {
    withCommunities();
    await completeUpload('video', VIDEO);

    const button = screen.getByRole('button', { name: rowName(NONE) });
    expect(button).toBe(destinationRow());
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-label')).toBeNull();
    // Order in the bottom block: processing row -> "Publicar em" -> caption + Publicar (D-97).
    const processing = screen.getByText(lookup(catalog, 'publish.processingNote'));
    const caption = screen.getByLabelText(lookup(catalog, 'publish.captionLabel'));
    expect(
      processing.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await publishNow();
    // `toStrictEqual` on the key list: the `communityId` key is OMITTED, never sent as null (D-99).
    expect(Object.keys(publish.mock.calls[0]?.[0] ?? {})).toStrictEqual([
      'mediaAssetId',
      'mediaKind',
      'caption',
    ]);
    expect(publish).toHaveBeenCalledWith({ mediaAssetId: VIDEO, mediaKind: 'video', caption: '' });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toast'),
    });
    expect(push).toHaveBeenCalledWith('/inicio');
  });

  it('8. a resolved ?comunidade= pre-fills the row; publishing sends it, names it in the toast and lands on it', async () => {
    withCommunities({ initialCommunityId: A });
    await completeUpload('image', IMAGE);

    expect(screen.getByRole('button', { name: rowName(NAME_A) })).toBe(destinationRow());
    await publishNow();

    expect(publish).toHaveBeenCalledWith({
      mediaAssetId: IMAGE,
      mediaKind: 'image',
      caption: '',
      communityId: A,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toastCommunity', { community: NAME_A }),
    });
    expect(push).toHaveBeenCalledWith(`/comunidades/${A}`);
  });

  it('9. the sheet re-picks: B sends B and lands on B; "Nenhuma comunidade" sends none and lands on /inicio; each choice closes it and clears the error', async () => {
    withCommunities();
    await completeUpload('image', IMAGE);

    // A shown error first, so the sheet choice has something to clear.
    publish.mockResolvedValueOnce({ ok: false, code: 'not_found' });
    await publishNow();
    expect(screen.getByRole('alert')).toBeTruthy();

    let dialog = await openSheet();
    // The sheet teaches D-96 before the choice, and "Nenhuma comunidade" leads the list (D-98).
    expect(within(dialog).getByText(lookup(catalog, 'publish.destination.helper'))).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: NONE }).hasAttribute('data-picker-default'),
    ).toBe(true);
    await choose(dialog, lookup(communitiesCatalog, 'picker.row', { community: NAME_B }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(destinationRow()?.textContent).toContain(NAME_B);

    await publishNow();
    expect(publish).toHaveBeenLastCalledWith({
      mediaAssetId: IMAGE,
      mediaKind: 'image',
      caption: '',
      communityId: B,
    });
    expect(push).toHaveBeenLastCalledWith(`/comunidades/${B}`);

    dialog = await openSheet();
    await choose(dialog, NONE);
    expect(destinationRow()?.textContent).toContain(NONE);

    await publishNow();
    expect(Object.keys(publish.mock.lastCall?.[0] ?? {})).not.toContain('communityId');
    expect(push).toHaveBeenLastCalledWith('/inicio');
  });

  it('10. close and a confirmed discard return to the ORIGIN: /comunidades/{A} when pre-filled, /inicio otherwise', async () => {
    const leave = async () => {
      // Before a pick: the header's close control leaves at once.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: lookup(catalog, 'publish.close') }));
      });
      await completeUpload('image', IMAGE);
      // After a pick: the close control asks first, and the confirm leaves.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: lookup(catalog, 'publish.close') }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: lookup(catalog, 'publish.discard.confirm') }),
        );
      });
    };

    const first = withCommunities({ initialCommunityId: A });
    await leave();
    expect(push.mock.calls.map(([path]) => path)).toStrictEqual([
      `/comunidades/${A}`,
      `/comunidades/${A}`,
    ]);
    first.unmount();

    push.mockClear();
    withCommunities();
    await leave();
    expect(push.mock.calls.map(([path]) => path)).toStrictEqual(['/inicio', '/inicio']);
  });

  it('11. archived while composing: nothing publishes, the alert names it, the row resets, it leaves the sheet, and the next publish is tenant-wide', async () => {
    withCommunities({ communities: [row(A, LONG_A), row(B, NAME_B)], initialCommunityId: A });
    await completeUpload('image', IMAGE);
    fireEvent.change(screen.getByLabelText(lookup(catalog, 'publish.captionLabel')), {
      target: { value: 'ola' },
    });

    publish.mockResolvedValueOnce({ ok: false, code: 'archived' });
    await publishNow();

    expect(LONG_A).toHaveLength(60);
    expect(screen.getByRole('alert').textContent).toBe(
      lookup(catalog, 'publish.errors.archived', { community: LONG_A }),
    );
    expect(push).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: rowName(NONE) })).toBe(destinationRow());
    // Media and caption are kept: the admin re-picks or publishes, and loses nothing.
    expect(screen.getByTestId('story-preview')).toBeTruthy();
    expect(
      (screen.getByLabelText(lookup(catalog, 'publish.captionLabel')) as HTMLTextAreaElement).value,
    ).toBe('ola');
    expect(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') })).toBeTruthy();

    const dialog = await openSheet();
    expect(
      within(dialog).queryByRole('button', {
        name: lookup(communitiesCatalog, 'picker.row', { community: LONG_A }),
      }),
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', {
        name: lookup(communitiesCatalog, 'picker.row', { community: NAME_B }),
      }),
    ).toBeTruthy();
    await choose(dialog, NONE);

    await publishNow();
    expect(publish).toHaveBeenLastCalledWith({
      mediaAssetId: IMAGE,
      mediaKind: 'image',
      caption: 'ola',
    });
  });

  it('12. a bare 404 keeps the generic publish error AND the selection', async () => {
    withCommunities({ initialCommunityId: A });
    await completeUpload('image', IMAGE);

    publish.mockResolvedValueOnce({ ok: false, code: 'not_found' });
    await publishNow();

    expect(screen.getByRole('alert').textContent).toBe(lookup(catalog, 'publish.errors.failed'));
    expect(screen.getByRole('button', { name: rowName(NAME_A) })).toBe(destinationRow());
  });

  it('13. with no communities there is no "Publicar em" row, before or after a pick', async () => {
    withCommunities({ communities: [] });
    expect(document.querySelector('[data-story-destination]')).toBeNull();
    await completeUpload('image', IMAGE);
    expect(document.querySelector('[data-story-destination]')).toBeNull();
    expect(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') })).toBeTruthy();
  });

  it('14. while a publish is in flight the row is disabled, so the destination cannot change mid-publish', async () => {
    withCommunities({ initialCommunityId: A });
    await completeUpload('image', IMAGE);

    publish.mockReturnValueOnce(new Promise(() => {}));
    await publishNow();

    expect(destinationRow()?.disabled).toBe(true);
  });

  it('15. the destination survives a re-pick of the media', async () => {
    withCommunities();
    await completeUpload('image', IMAGE);

    const dialog = await openSheet();
    await choose(dialog, lookup(communitiesCatalog, 'picker.row', { community: NAME_B }));
    await completeUpload('image', OTHER_IMAGE);

    expect(screen.getByRole('button', { name: rowName(NAME_B) })).toBe(destinationRow());
    await publishNow();
    expect(publish).toHaveBeenLastCalledWith({
      mediaAssetId: OTHER_IMAGE,
      mediaKind: 'image',
      caption: '',
      communityId: B,
    });
  });
});
