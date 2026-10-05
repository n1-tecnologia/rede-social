// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The feed composer's video readiness (quick-260929-ltf).
 *
 * On 2026-09-29 the composer set a picked video to `processing` once and never re-read it, so the
 * player said "Processando" forever, while `Publicar` stayed enabled and the API answered
 * `asset_not_usable` three times: the feed API accepts only a `ready` video (`validateAssets`), and
 * a provider video is `pending` until its webhook lands. The locked decision (option b) is that a
 * feed post REQUIRES a ready video, so the composer polls with `useAssetReadiness`, explains the
 * wait and disables `Publicar` until the video is ready. Stories keep publish-while-processing.
 *
 * The catalogs are the REAL pt-BR files (the `StoryComposer.test.tsx` harness), so the helper copy
 * is asserted as the admin reads it. Stubbed at their seams: the upload hook (its handlers are
 * captured and driven), the readiness poll (a tiny external store a test flips inside `act`), the
 * player (it renders the status it is handed) and the two server actions.
 */

const { catalogs, toast, push, createPost, updatePost, upload, readiness } = await vi.hoisted(
  async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (name: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
    const listeners = new Set<() => void>();
    return {
      catalogs: {
        feed: read('feed').feed as Record<string, unknown>,
        media: read('media').media as Record<string, unknown>,
        communities: read('communities').communities as Record<string, unknown>,
      },
      toast: { show: vi.fn(), dismiss: vi.fn() },
      push: vi.fn(),
      createPost: vi.fn(),
      updatePost: vi.fn(),
      upload: {
        shell: { pick: vi.fn(), reject: vi.fn(), cancel: vi.fn(), reset: vi.fn() },
        handlers: {} as Record<
          string,
          { onCompleted?: unknown; onHandedToProvider?: (assetId: string) => void }
        >,
      },
      readiness: {
        value: { phase: 'waiting' } as { phase: string; issue?: string | null },
        ids: [] as (string | null)[],
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(value: { phase: string; issue?: string | null }) {
          this.value = value;
          for (const listener of listeners) listener();
        },
      },
    };
  },
);

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
        ? catalogs.media
        : namespace === 'communities'
          ? catalogs.communities
          : catalogs.feed,
      key,
      values,
    ),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/criar/actions', () => ({ createPostAction: createPost }));
vi.mock('@/app/(app)/inicio/feed-actions', () => ({ updatePostAction: updatePost }));

// A PLAIN factory: the real module imports server actions (`lib/api` -> `lib/env`), which fail fast
// on browser env vars a unit test has no business supplying.
vi.mock('@/components/media/useSignedUpload', () => ({
  formatMediaLimit: (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`,
  useSignedUpload: (options: { kind: string; [key: string]: unknown }) => {
    upload.handlers[options.kind] = options as never;
    return { state: 'idle', progress: 0, error: null, ...upload.shell };
  },
}));

vi.mock('@/components/media/VideoPlayer', () => ({
  VideoPlayer: ({ status }: { assetId: string; status: string }) => (
    <div data-testid="video-player-stub" data-status={status} />
  ),
}));

vi.mock('@/components/media/useAssetReadiness', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAssetReadiness: (id: string | null) => {
      const value = useSyncExternalStore(
        (listener) => readiness.subscribe(listener),
        () => readiness.value,
      );
      readiness.ids.push(id);
      return id ? value : { phase: 'idle' };
    },
  };
});

const { ComposerForm } = await import('./ComposerForm');
type Draft = NonNullable<Parameters<typeof ComposerForm>[0]['initial']>;

const composer = catalogs.feed.composer as Record<string, string>;
const WAITING_COPY = composer.videoWaiting as string;
const WAITING_EDIT_COPY = composer.videoWaitingEdit as string;
const PUBLISH = composer.publish as string;
const SAVE = composer.save as string;
const REMOVE_VIDEO = composer.removeVideo as string;
const CAPTION_LABEL = composer.captionLabel as string;

// `createPostSchema` types `videoAssetId` as a uuid, so the id must be uuid-shaped to reach the action.
const VIDEO_ID = '0b9a3c2e-5d1f-4e7a-9c3b-2f6d8e1a4b70';

const player = () => screen.getByTestId('video-player-stub');
const form = () => document.querySelector('form[data-composer]') as HTMLFormElement;

function typeCaption(value: string) {
  fireEvent.change(screen.getByLabelText(CAPTION_LABEL), { target: { value } });
}

async function handVideoToProvider(assetId: string) {
  const handler = upload.handlers.video?.onHandedToProvider;
  if (!handler) throw new Error('the composer registered no video hand-off');
  await act(async () => {
    handler(assetId);
  });
}

function setReadiness(value: { phase: string; issue?: string | null }) {
  act(() => {
    readiness.set(value);
  });
}

function draft(video: Draft['video']): Draft {
  return {
    caption: 'Legenda antiga',
    images: [],
    video,
    attachments: [],
    hasLinkPreview: false,
    community: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upload.handlers = {};
  readiness.value = { phase: 'waiting' };
  readiness.ids = [];
  createPost.mockResolvedValue({ ok: true, postId: 'POST_NEW' });
  updatePost.mockResolvedValue({ ok: true, postId: 'OLD_POST' });
});
afterEach(cleanup);

describe('ComposerForm — a feed post needs a READY video (quick-260929-ltf)', () => {
  it('C1: a video handed to the provider is polled, explained, and blocks Publicar', async () => {
    render(<ComposerForm mode="create" tenantName="Rede Demo" />);
    typeCaption('Olá, comunidade');
    await handVideoToProvider(VIDEO_ID);

    expect(readiness.ids).toContain(VIDEO_ID);
    expect(player().dataset.status).toBe('processing');
    expect(screen.getByText(WAITING_COPY)).toBeTruthy();
    expect((screen.getByRole('button', { name: PUBLISH }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.submit(form());
    await act(async () => {});
    expect(createPost).not.toHaveBeenCalled();
  });

  it('C2: at ready the helper disappears and Publicar sends the video asset id', async () => {
    render(<ComposerForm mode="create" tenantName="Rede Demo" />);
    typeCaption('Olá, comunidade');
    await handVideoToProvider(VIDEO_ID);
    setReadiness({ phase: 'ready' });

    expect(player().dataset.status).toBe('ready');
    expect(screen.queryByText(WAITING_COPY)).toBeNull();
    const publish = screen.getByRole('button', { name: PUBLISH }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);

    fireEvent.click(publish);
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({ videoAssetId: VIDEO_ID });
  });

  it('C3: a failed or rejected video shows the failed player and Publicar stays disabled', async () => {
    render(<ComposerForm mode="create" tenantName="Rede Demo" />);
    typeCaption('Olá, comunidade');
    await handVideoToProvider(VIDEO_ID);

    setReadiness({ phase: 'failed', issue: 'transcode_failed' });
    expect(player().dataset.status).toBe('failed');
    expect(screen.queryByText(WAITING_COPY)).toBeNull();
    expect((screen.getByRole('button', { name: PUBLISH }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.submit(form());
    await act(async () => {});
    expect(createPost).not.toHaveBeenCalled();

    setReadiness({ phase: 'failed', issue: 'duration_too_long' });
    expect(player().dataset.status).toBe('rejected');

    setReadiness({ phase: 'failed', issue: null });
    expect(player().dataset.status).toBe('failed');
  });

  it('C4: edit mode with a READY video never polls and never blocks Salvar alterações', () => {
    render(
      <ComposerForm
        mode="edit"
        postId="OLD_POST"
        tenantName="Rede Demo"
        initial={draft({ assetId: 'OLD', status: 'ready' })}
      />,
    );
    typeCaption('Legenda nova');

    expect(readiness.ids.length).toBeGreaterThan(0);
    expect(readiness.ids.every((id) => id === null)).toBe(true);
    expect(player().dataset.status).toBe('ready');
    expect(screen.queryByText(WAITING_EDIT_COPY)).toBeNull();
    expect((screen.getByRole('button', { name: SAVE }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('C5: edit mode with a FAILED video never polls and blocks Salvar alterações', () => {
    render(
      <ComposerForm
        mode="edit"
        postId="OLD_POST"
        tenantName="Rede Demo"
        initial={draft({ assetId: 'OLD', status: 'failed' })}
      />,
    );

    expect(readiness.ids.every((id) => id === null)).toBe(true);
    expect(player().dataset.status).toBe('failed');
    expect((screen.getByRole('button', { name: SAVE }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('C6: removing a waiting video stops the poll and a caption alone is publishable again', async () => {
    render(<ComposerForm mode="create" tenantName="Rede Demo" />);
    typeCaption('Olá, comunidade');
    await handVideoToProvider(VIDEO_ID);
    expect(screen.getByText(WAITING_COPY)).toBeTruthy();

    readiness.ids = [];
    fireEvent.click(screen.getByRole('button', { name: REMOVE_VIDEO }));

    expect(readiness.ids.length).toBeGreaterThan(0);
    expect(readiness.ids.at(-1)).toBeNull();
    expect(screen.queryByText(WAITING_COPY)).toBeNull();
    expect((screen.getByRole('button', { name: PUBLISH }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

/**
 * 2026-10-02 (PDF #5): the composer is a TASK screen. The form root declares it, and tokens.css hides
 * the shell's floating BottomNav (and drops its end-padding reserve) while such a form is mounted, so
 * the pill never sits over the caption or a picker. Both modes are the same form, so both declare it.
 */
describe('ComposerForm — a task screen hides the BottomNav by declaration', () => {
  it('C7: the form root carries data-shell-hide="nav" in create and in edit mode', () => {
    const { unmount } = render(<ComposerForm mode="create" tenantName="Rede Demo" />);
    expect(form().getAttribute('data-shell-hide')).toBe('nav');
    unmount();

    render(
      <ComposerForm
        mode="edit"
        postId="OLD_POST"
        tenantName="Rede Demo"
        initial={draft({ assetId: 'OLD', status: 'ready' })}
      />,
    );
    expect(form().getAttribute('data-shell-hide')).toBe('nav');
  });
});
