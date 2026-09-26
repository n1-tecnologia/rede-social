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
 * Cases P1-P8 (05.2-08) are the "Destaque" row (D-111..D-115, UI-D-68..UI-D-71), which replaced
 * 05.1's "Publicar em" row: zero taps to publish tenant-wide, a community origin pre-filled with its
 * first highlight, the D-112 gate when the origin has none, a pending new highlight written by the
 * publish itself (D-114, one write), the landings and toasts, and the refusal grammar. The payload's
 * top-level keys are asserted in P1-P4 so the retiring `communityId` can never ride a publish again.
 * Cases 9-12 carry the row's remaining rules (origin on close, disabled while busy, re-pick, E11).
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
// the "Destaque" sheet and the discard dialog both animate (the community-picker-sheet pattern).
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
const {
  STORY_HIGHLIGHT_MAX_ITEMS,
  STORY_HIGHLIGHT_MAX_PER_PLACE,
  STORY_HIGHLIGHT_MAX_TITLE,
  STORY_MAX_CAPTION,
} = await import('@tria/module-stories/contracts');
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

    expect(publish).toHaveBeenCalledWith(
      {
        mediaAssetId: 'a1111111-1111-4111-8111-111111111111',
        mediaKind: 'image',
        caption: 'ola',
      },
      { communityId: null },
    );
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

/* ── 05.2-08: "Destaque" — the composer asks for a highlight (D-111..D-115) ───────────────────── */

const A = 'c1111111-1111-4111-8111-111111111111';
const B = 'c2222222-2222-4222-8222-222222222222';
const H_HOME = 'd0000000-0000-4000-8000-000000000000';
const H_A1 = 'd1111111-1111-4111-8111-111111111111';
const H_A2 = 'd1111112-1111-4111-8111-111111111111';
const IMAGE = 'a1111111-1111-4111-8111-111111111111';
const OTHER_IMAGE = 'a2222222-2222-4222-8222-222222222222';

const NAME_A = 'Comunidade Alfa';
const NAME_B = 'Comunidade Beta';
/** UI long-text backstop: a 60-character name must reach the alert in full. */
const LONG_A = 'Comunidade de Moradores do Condomínio Jardim das Palmeiras 1';
const HOME = lookup(catalog, 'highlights.place.home');

type Place = {
  key: string;
  label: string;
  communityId: string | null;
  rows: { id: string; title: string; cover: null }[];
};

/** Cover-less on purpose: the monogram branch renders, and no media request is ever made. */
const placesFor = (nameA = NAME_A): Place[] => [
  {
    key: 'home',
    label: HOME,
    communityId: null,
    rows: [{ id: H_HOME, title: 'Bastidores', cover: null }],
  },
  {
    key: A,
    label: nameA,
    communityId: A,
    rows: [
      { id: H_A1, title: 'Destaques', cover: null },
      { id: H_A2, title: 'Aulas', cover: null },
    ],
  },
  // A community with no highlight yet: it is still a place (its own "Novo destaque", UI E10 partial).
  { key: B, label: NAME_B, communityId: B, rows: [] },
];

type Selection =
  | { kind: 'none' }
  | { kind: 'choose' }
  | { kind: 'highlight'; highlightId: string }
  | { kind: 'pending'; communityId: string | null; title: string };

const withPlaces = (
  props: { places?: Place[]; originCommunityId?: string | null; initialSelection?: Selection } = {},
) =>
  render(
    <StoryComposer
      historyHref="/stories/meus"
      places={props.places ?? placesFor()}
      originCommunityId={props.originCommunityId ?? null}
      initialSelection={props.initialSelection ?? { kind: 'none' }}
    />,
  );

const NONE = lookup(catalog, 'publish.destination.none');
const CHOOSE = lookup(catalog, 'publish.destination.choose');
const LABEL = lookup(catalog, 'publish.destination.label');
const value = (place: string, title: string) =>
  lookup(catalog, 'publish.destination.value', { place, title });

/** The composer's "Destaque" row — located by its marker, since a sheet row may share its words. */
const destinationRow = () =>
  document.querySelector('[data-story-destination]') as HTMLButtonElement | null;
const destinationValue = () =>
  document.querySelector('[data-story-destination-value]')?.textContent ?? null;

/** The object `publishStoryAction` received — the FIRST argument of its last call. */
const lastPayload = () => (publish.mock.lastCall?.[0] ?? {}) as Record<string, unknown>;

async function publishNow() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: lookup(catalog, 'publish.submit') }));
  });
}

async function openSheet() {
  const button = destinationRow();
  if (!button) throw new Error('the Destaque row is not rendered');
  await act(async () => {
    fireEvent.click(button);
  });
  return screen.getByRole('dialog');
}

async function tap(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const sheetItem = (dialog: HTMLElement, item: string) =>
  dialog.querySelector(`[data-highlight-sheet-item="${item}"]`) as HTMLElement | null;

/** The title step: type the name and confirm — the sheet records a PENDING highlight and closes. */
async function confirmTitle(dialog: HTMLElement, title: string) {
  fireEvent.change(within(dialog).getByLabelText(lookup(catalog, 'highlights.create.label')), {
    target: { value: title },
  });
  await tap(
    within(dialog).getByRole('button', { name: lookup(catalog, 'highlights.create.submit') }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('StoryComposer — "Destaque" (05.2-08, D-111..D-115, UI-D-68..UI-D-71)', () => {
  it('P1. no context: the row reads "Destaque · Nenhum", and Publicar publishes tenant-wide with no destination and lands on /inicio', async () => {
    withPlaces();
    await completeUpload('image', IMAGE);

    const row = destinationRow();
    expect(row?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(row?.textContent).toContain(LABEL);
    expect(destinationValue()).toBe(NONE);

    await publishNow();
    // Zero taps (05.1 criterion 5): the body is exactly the plain publish.
    expect(Object.keys(lastPayload())).toStrictEqual(['mediaAssetId', 'mediaKind', 'caption']);
    expect(Object.keys(lastPayload())).not.toContain('communityId');
    expect(publish).toHaveBeenCalledWith(
      { mediaAssetId: IMAGE, mediaKind: 'image', caption: '' },
      { communityId: null },
    );
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toast'),
    });
    expect(push).toHaveBeenCalledWith('/inicio');
  });

  it('P2. an origin WITH highlights arrives pre-filled with its first one; publishing sends that highlightId and lands on the community', async () => {
    withPlaces({
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await completeUpload('image', IMAGE);

    expect(destinationValue()).toBe(value(NAME_A, 'Destaques'));
    await publishNow();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      { mediaAssetId: IMAGE, mediaKind: 'image', caption: '', highlightId: H_A1 },
      { communityId: A },
    );
    expect(Object.keys(lastPayload())).not.toContain('communityId');
    expect(Object.keys(lastPayload())).not.toContain('newHighlight');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toastHighlightCommunity', {
        title: 'Destaques',
        community: NAME_A,
      }),
    });
    expect(push).toHaveBeenCalledWith(`/comunidades/${A}`);
  });

  it('P3. an origin with NO highlight reads "Escolher destaque": Publicar opens the sheet instead of publishing; a new title is sent as newHighlight; an explicit "Nenhum" resolves it too', async () => {
    const first = withPlaces({ originCommunityId: B, initialSelection: { kind: 'choose' } });
    await completeUpload('image', IMAGE);
    expect(destinationValue()).toBe(CHOOSE);

    // The D-112 gate: "Publicar" stays enabled, sends NOTHING, and opens the sheet on the origin's
    // "Novo destaque".
    await publishNow();
    expect(publish).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    const create = sheetItem(dialog, `create:${B}`);
    expect(create).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(create));

    await tap(create as HTMLElement);
    await confirmTitle(dialog, 'Teste Um');
    // Nothing was created by the sheet (D-114): no request yet, the row states the pending choice.
    expect(publish).not.toHaveBeenCalled();
    expect(destinationValue()).toBe(value(NAME_B, 'Teste Um'));

    await publishNow();
    expect(publish).toHaveBeenCalledWith(
      {
        mediaAssetId: IMAGE,
        mediaKind: 'image',
        caption: '',
        newHighlight: { communityId: B, title: 'Teste Um' },
      },
      { communityId: B },
    );
    expect(Object.keys(lastPayload())).not.toContain('communityId');
    expect(Object.keys(lastPayload())).not.toContain('highlightId');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toastHighlightCommunity', {
        title: 'Teste Um',
        community: NAME_B,
      }),
    });
    expect(push).toHaveBeenLastCalledWith(`/comunidades/${B}`);
    first.unmount();

    // …or the admin SEES the choice and picks "Nenhum": the row resolves, the next tap publishes.
    publish.mockClear();
    withPlaces({ originCommunityId: B, initialSelection: { kind: 'choose' } });
    await completeUpload('image', IMAGE);
    await publishNow();
    const again = screen.getByRole('dialog');
    await tap(sheetItem(again, 'none') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(destinationValue()).toBe(NONE);
    await publishNow();
    expect(Object.keys(lastPayload())).toStrictEqual(['mediaAssetId', 'mediaKind', 'caption']);
    expect(publish).toHaveBeenLastCalledWith(
      { mediaAssetId: IMAGE, mediaKind: 'image', caption: '' },
      { communityId: null },
    );
  });

  it('P4. an Início highlight chosen in the sheet lands on /inicio and names the highlight in the toast', async () => {
    withPlaces();
    await completeUpload('image', IMAGE);

    const dialog = await openSheet();
    // The sheet's order: no origin, so "Nenhum" leads, then Início, then every community.
    expect(within(dialog).getByText(lookup(catalog, 'highlights.select.helper'))).toBeTruthy();
    await tap(
      within(dialog).getByRole('button', {
        name: lookup(catalog, 'highlights.select.row', { title: 'Bastidores', place: HOME }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(destinationValue()).toBe(value(HOME, 'Bastidores'));

    await publishNow();
    expect(publish).toHaveBeenCalledWith(
      { mediaAssetId: IMAGE, mediaKind: 'image', caption: '', highlightId: H_HOME },
      { communityId: null },
    );
    expect(Object.keys(lastPayload())).not.toContain('communityId');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup(catalog, 'publish.toastHighlight', { title: 'Bastidores' }),
    });
    expect(push).toHaveBeenCalledWith('/inicio');
  });

  it('P5. archived at publish: nothing publishes, media and caption stay, the row reads "Nenhum", the community leaves the sheet and the alert names it', async () => {
    withPlaces({
      places: placesFor(LONG_A),
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
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
    expect(destinationValue()).toBe(NONE);
    expect(screen.getByTestId('story-preview')).toBeTruthy();
    expect(
      (screen.getByLabelText(lookup(catalog, 'publish.captionLabel')) as HTMLTextAreaElement).value,
    ).toBe('ola');

    const dialog = await openSheet();
    expect(sheetItem(dialog, `label:${A}`)).toBeNull();
    expect(sheetItem(dialog, `create:${A}`)).toBeNull();
    expect(sheetItem(dialog, `label:${B}`)).not.toBeNull();
    // The next publish is tenant-wide only after the admin saw the reset row.
    await tap(sheetItem(dialog, 'none') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await publishNow();
    expect(publish).toHaveBeenLastCalledWith(
      { mediaAssetId: IMAGE, mediaKind: 'image', caption: 'ola' },
      { communityId: null },
    );
  });

  it('P6. title_invalid: the alert states the rule; the row returns to "Escolher destaque" when the origin forced it, else to "Nenhum"', async () => {
    const forced = withPlaces({ originCommunityId: B, initialSelection: { kind: 'choose' } });
    await completeUpload('image', IMAGE);
    await publishNow();
    let dialog = screen.getByRole('dialog');
    await tap(sheetItem(dialog, `create:${B}`) as HTMLElement);
    await confirmTitle(dialog, 'Teste Um');

    publish.mockResolvedValueOnce({ ok: false, code: 'title_invalid' });
    await publishNow();
    expect(screen.getByRole('alert').textContent).toBe(
      lookup(catalog, 'publish.errors.titleInvalid', { limit: STORY_HIGHLIGHT_MAX_TITLE }),
    );
    expect(destinationValue()).toBe(CHOOSE);
    expect(push).not.toHaveBeenCalled();
    forced.unmount();

    withPlaces();
    await completeUpload('image', IMAGE);
    dialog = await openSheet();
    await tap(sheetItem(dialog, 'create:home') as HTMLElement);
    await confirmTitle(dialog, 'Teste Dois');
    expect(destinationValue()).toBe(value(HOME, 'Teste Dois'));

    publish.mockResolvedValueOnce({ ok: false, code: 'title_invalid' });
    await publishNow();
    expect(destinationValue()).toBe(NONE);
  });

  it('P7. a bare 404 keeps the generic publish error AND the selection', async () => {
    withPlaces({
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await completeUpload('image', IMAGE);

    publish.mockResolvedValueOnce({ ok: false, code: 'not_found' });
    await publishNow();

    expect(screen.getByRole('alert').textContent).toBe(lookup(catalog, 'publish.errors.failed'));
    expect(destinationValue()).toBe(value(NAME_A, 'Destaques'));
    expect(push).not.toHaveBeenCalled();
  });

  it('P8. a caller without stories.story.manage gets no row, before or after a pick, and publishes plain', async () => {
    withPlaces({ places: [] });
    expect(destinationRow()).toBeNull();
    await completeUpload('image', IMAGE);
    expect(destinationRow()).toBeNull();

    await publishNow();
    expect(Object.keys(lastPayload())).toStrictEqual(['mediaAssetId', 'mediaKind', 'caption']);
  });

  it('P9. `full` for a highlightId destination states the ITEM cap from the contracts and keeps the selection (WR-03)', async () => {
    withPlaces({
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await completeUpload('image', IMAGE);

    publish.mockResolvedValueOnce({ ok: false, code: 'full' });
    await publishNow();

    const alert = screen.getByRole('alert').textContent;
    expect(alert).toBe(
      lookup(catalog, 'highlights.errors.full', { limit: STORY_HIGHLIGHT_MAX_ITEMS }),
    );
    expect(alert).not.toBe(lookup(catalog, 'publish.errors.failed'));
    expect(destinationValue()).toBe(value(NAME_A, 'Destaques'));
    expect(screen.getByTestId('story-preview')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('P10. `full` for a newHighlight destination states the PLACE cap from the contracts and keeps the pending choice (WR-03)', async () => {
    withPlaces({ originCommunityId: B, initialSelection: { kind: 'choose' } });
    await completeUpload('image', IMAGE);
    await publishNow();
    const dialog = screen.getByRole('dialog');
    await tap(sheetItem(dialog, `create:${B}`) as HTMLElement);
    await confirmTitle(dialog, 'Teste Um');

    publish.mockResolvedValueOnce({ ok: false, code: 'full' });
    await publishNow();

    const alert = screen.getByRole('alert').textContent;
    expect(alert).toBe(
      lookup(catalog, 'highlights.errors.placeFull', { limit: STORY_HIGHLIGHT_MAX_PER_PLACE }),
    );
    expect(alert).not.toBe(lookup(catalog, 'publish.errors.failed'));
    expect(destinationValue()).toBe(value(NAME_B, 'Teste Um'));
    expect(push).not.toHaveBeenCalled();
  });

  it('9. close and a confirmed discard return to the ORIGIN: /comunidades/{A} when pre-filled, /inicio otherwise', async () => {
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

    const first = withPlaces({
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await leave();
    expect(push.mock.calls.map(([path]) => path)).toStrictEqual([
      `/comunidades/${A}`,
      `/comunidades/${A}`,
    ]);
    first.unmount();

    push.mockClear();
    withPlaces();
    await leave();
    expect(push.mock.calls.map(([path]) => path)).toStrictEqual(['/inicio', '/inicio']);
  });

  it('10. while a publish is in flight the row is disabled, so the destination cannot change mid-publish (UI E11 loading)', async () => {
    withPlaces({
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await completeUpload('image', IMAGE);

    publish.mockReturnValueOnce(new Promise(() => {}));
    await publishNow();

    expect(destinationRow()?.disabled).toBe(true);
    expect(destinationRow()?.className).toContain('disabled:opacity-50');
  });

  it('11. the destination survives a re-pick of the media', async () => {
    withPlaces();
    await completeUpload('image', IMAGE);

    const dialog = await openSheet();
    await tap(
      within(dialog).getByRole('button', {
        name: lookup(catalog, 'highlights.select.row', { title: 'Aulas', place: NAME_A }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await completeUpload('image', OTHER_IMAGE);

    expect(destinationValue()).toBe(value(NAME_A, 'Aulas'));
    await publishNow();
    expect(publish).toHaveBeenLastCalledWith(
      { mediaAssetId: OTHER_IMAGE, mediaKind: 'image', caption: '', highlightId: H_A2 },
      { communityId: A },
    );
  });

  it('12. UI E11 overflow: one min-h-11 line where ONLY the value shrinks — "Destaque" and the chevron are shrink-0', async () => {
    withPlaces({
      places: placesFor(LONG_A),
      originCommunityId: A,
      initialSelection: { kind: 'highlight', highlightId: H_A1 },
    });
    await completeUpload('image', IMAGE);

    const row = destinationRow() as HTMLButtonElement;
    expect(row.className).toContain('min-h-11');
    expect(row.className).toContain('bg-black/45');
    const [label, valueNode, chevron] = Array.from(row.children);
    expect(label?.textContent).toBe(LABEL);
    expect(label?.className).toContain('shrink-0');
    expect(valueNode?.className).toContain('min-w-0');
    expect(valueNode?.className).toContain('flex-1');
    expect(valueNode?.className).toContain('truncate');
    expect(chevron?.getAttribute('class')).toContain('shrink-0');
  });
});
