// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
 */

const { catalog, mediaCatalog, toast, push, publish, upload } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('stories').stories as Record<string, unknown>,
    mediaCatalog: read('media').media as Record<string, unknown>,
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
    lookup(namespace === 'media' ? mediaCatalog : catalog, key, values),
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
