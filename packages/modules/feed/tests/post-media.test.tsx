// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@tria/ui';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AttachmentDescriptor, AttachmentRow } from '../ui/AttachmentRow';
import { PostMedia, type PostMediaImage } from '../ui/PostMedia';

/**
 * UI-02 / D-53 for the post media band: the gallery carousel (UI-D-09/UI-D-10), the injected video
 * node, and the attachment rows with their row-local pending state (UI-D-23).
 *
 * Everything asserted here is OBSERVABLE contract, never implementation: the shared ratio is read
 * off each slide's own `data-ratio`, the announced index off the `aria-live` region, and the
 * double-tap wiring off whether the callback fired — not off which component wraps which.
 *
 * Every label arrives as a prop, so the fixtures below use sentinel ASCII strings. A pt-BR literal
 * appearing in either component is caught separately by `scripts/check-ui-literals.sh`.
 */

// Springs have nothing to animate under happy-dom, and a cancelled one rejects AFTER the run ends.
// Skipping them makes mount/exit synchronous, exactly as the `packages/ui` harness does.
MotionGlobalConfig.skipAnimations = true;

const LABELS = { carousel: 'carousel-roledescription', attachmentError: 'attachment-error' };

/** Landscape 3:2 — inside the [4:5, 1.91:1] clamp, so it is its own clamped ratio. */
const LANDSCAPE = { width: 1200, height: 800 };

function image(n: number, size: { width: number | null; height: number | null } = LANDSCAPE) {
  return {
    assetId: `0000000${n}-0000-4000-8000-00000000000${n}`,
    variantWidths: [320, 640, 1080, 1600],
    alt: `alt ${n}`,
    label: `${n} of many`,
    width: size.width,
    height: size.height,
  } satisfies PostMediaImage;
}

function attachment(n: number, sizeLabel: string | null = '1,2 MB'): AttachmentDescriptor {
  return {
    assetId: `000000a${n}-0000-4000-8000-00000000000${n}`,
    filename: `documento-${n}.pdf`,
    typeLabel: 'PDF',
    sizeLabel,
    downloadLabel: `download-${n}`,
  };
}

const strip = () => screen.queryByTestId('post-gallery-strip');
const slides = () => screen.queryAllByTestId('post-gallery-slide');
const dots = () => screen.queryByTestId('post-gallery-dots');
const live = () => screen.queryByTestId('post-gallery-live');
const list = () => screen.queryByTestId('post-attachments');

/** Two `pointerup`s inside `DoubleTapHeart`'s 300 ms window. */
function doubleTap(target: Element) {
  fireEvent.pointerUp(target);
  fireEvent.pointerUp(target);
}

const withToast = (node: ReactElement) => render(<ToastProvider>{node}</ToastProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PostMedia — the four branches (D-53)', () => {
  it('renders NOTHING at all for a post with no media and no attachments', () => {
    const { container } = render(
      <PostMedia mediaKind="none" images={[]} attachments={[]} labels={LABELS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders ONE slide with no strip and no dots for a single image, still double-tappable', () => {
    const onDoubleTapLike = vi.fn();
    render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1)]}
        attachments={[]}
        onDoubleTapLike={onDoubleTapLike}
        labels={LABELS}
      />,
    );

    expect(slides()).toHaveLength(1);
    expect(strip()).toBeNull();
    expect(dots()).toBeNull();

    // UI-D-07: the gesture still reaches the like, even without the strip.
    doubleTap(slides()[0] as Element);
    expect(onDoubleTapLike).toHaveBeenCalledTimes(1);
  });

  it('renders a snap strip, per-slide labels, a dot row and an announced index for three images', () => {
    render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1), image(2), image(3)]}
        attachments={[]}
        labels={LABELS}
      />,
    );

    const group = strip();
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-roledescription', LABELS.carousel);
    // Keyboard-operable (UI-SPEC §Motion & Accessibility).
    expect(group).toHaveAttribute('tabindex', '0');
    expect(group?.className).toContain('snap-x');

    expect(slides()).toHaveLength(3);
    for (const [index, slide] of slides().entries()) {
      expect(slide).toHaveAttribute('aria-label', `${index + 1} of many`);
      expect(slide.className).toContain('snap-center');
    }

    expect(within(dots() as HTMLElement).getAllByTestId('post-gallery-dot')).toHaveLength(3);
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live()).toHaveTextContent('1 of many');
  });

  it('moves one slide on the arrow keys and re-announces the active index', () => {
    render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1), image(2), image(3)]}
        attachments={[]}
        labels={LABELS}
      />,
    );

    const group = strip() as HTMLElement;
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(live()).toHaveTextContent('2 of many');
    const active = within(dots() as HTMLElement)
      .getAllByTestId('post-gallery-dot')
      .map((dot) => dot.getAttribute('data-active'));
    expect(active).toEqual(['false', 'true', 'false']);

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(live()).toHaveTextContent('1 of many');

    // The ends are hard stops, not a wrap-around: a swipe cannot wrap, so the keys must not either.
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(live()).toHaveTextContent('1 of many');
  });

  it('gives EVERY slide the FIRST image’s ratio, not its own (UI-D-09)', () => {
    render(
      <PostMedia
        mediaKind="gallery"
        images={[
          image(1, { width: 1200, height: 800 }),
          image(2, { width: 900, height: 1200 }),
          image(3, { width: 1000, height: 1000 }),
        ]}
        attachments={[]}
        labels={LABELS}
      />,
    );

    const ratios = slides().map((slide) => slide.getAttribute('data-ratio'));
    expect(new Set(ratios).size).toBe(1);
    expect(Number(ratios[0])).toBeCloseTo(1.5, 4);
  });

  it('clamps a 9:16 source to the 4:5 bound rather than letting it eat the screen', () => {
    render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1, { width: 900, height: 1600 })]}
        attachments={[]}
        labels={LABELS}
      />,
    );
    expect(Number(slides()[0]?.getAttribute('data-ratio'))).toBeCloseTo(0.8, 4);
  });

  it('clamps an ultra-wide source to the 1.91:1 bound, and squares an unknown size', () => {
    const wide = render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1, { width: 3000, height: 1000 })]}
        attachments={[]}
        labels={LABELS}
      />,
    );
    expect(Number(slides()[0]?.getAttribute('data-ratio'))).toBeCloseTo(1.91, 4);
    wide.unmount();

    render(
      <PostMedia
        mediaKind="gallery"
        images={[image(1, { width: null, height: null })]}
        attachments={[]}
        labels={LABELS}
      />,
    );
    expect(Number(slides()[0]?.getAttribute('data-ratio'))).toBeCloseTo(1, 4);
  });

  it('renders the INJECTED video node and never hijacks a double tap on it (D-53)', () => {
    const onDoubleTapLike = vi.fn();
    render(
      <PostMedia
        mediaKind="video"
        images={[]}
        video={<div data-testid="injected-player">player</div>}
        attachments={[]}
        onDoubleTapLike={onDoubleTapLike}
        labels={LABELS}
      />,
    );

    const player = screen.getByTestId('injected-player');
    expect(player).toBeInTheDocument();
    expect(strip()).toBeNull();
    expect(slides()).toHaveLength(0);

    // A double tap on a player is a SEEK gesture, not a like.
    doubleTap(player);
    expect(onDoubleTapLike).not.toHaveBeenCalled();
  });
});

describe('PostMedia — the attachment list sits under EVERY media kind', () => {
  it('renders no list node at all when there are zero attachments', () => {
    render(<PostMedia mediaKind="gallery" images={[image(1)]} attachments={[]} labels={LABELS} />);
    expect(list()).toBeNull();
  });

  it('renders rows under a gallery, under a video and under no media at all', () => {
    const gallery = withToast(
      <PostMedia
        mediaKind="gallery"
        images={[image(1)]}
        attachments={[attachment(1)]}
        labels={LABELS}
      />,
    );
    expect(within(list() as HTMLElement).getAllByRole('button')).toHaveLength(1);
    gallery.unmount();

    const video = withToast(
      <PostMedia
        mediaKind="video"
        images={[]}
        video={<div data-testid="injected-player">player</div>}
        attachments={[attachment(1), attachment(2)]}
        labels={LABELS}
      />,
    );
    expect(within(list() as HTMLElement).getAllByRole('button')).toHaveLength(2);
    video.unmount();

    // `media_kind = 'none'` with a `kind = 'file'` row: no media frame, one attachment row.
    withToast(
      <PostMedia mediaKind="none" images={[]} attachments={[attachment(1)]} labels={LABELS} />,
    );
    expect(slides()).toHaveLength(0);
    expect(within(list() as HTMLElement).getAllByRole('button')).toHaveLength(1);
  });
});

describe('AttachmentRow — geometry, the partial size line and UI-D-23', () => {
  let objectUrls: { created: number; revoked: number };

  beforeEach(() => {
    objectUrls = { created: 0, revoked: 0 };
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        objectUrls.created += 1;
        return 'blob:stub';
      }),
      revokeObjectURL: vi.fn(() => {
        objectUrls.revoked += 1;
      }),
    });
    // happy-dom does not implement a download navigation; the anchor click is a no-op we only
    // need to survive, so it is silenced rather than asserted on.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('truncates the filename with an accessible title and pairs the type with the size', () => {
    render(<AttachmentRow attachment={attachment(1)} onError={vi.fn()} />);

    const name = screen.getByText('documento-1.pdf');
    expect(name.className).toContain('truncate');
    expect(name).toHaveAttribute('title', 'documento-1.pdf');

    const meta = screen.getByTestId('attachment-meta');
    expect(meta).toHaveTextContent('PDF');
    expect(meta).toHaveTextContent('1,2 MB');
    expect(meta.className).toContain('tabular-nums');

    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('aria-label', 'download-1');
    expect(row.className).toContain('min-h-14');
  });

  it('renders the type ALONE when the stored size is missing — never a dangling separator', () => {
    render(<AttachmentRow attachment={attachment(1, null)} onError={vi.fn()} />);
    expect(screen.getByTestId('attachment-meta').textContent?.trim()).toBe('PDF');
  });

  it('goes busy while the file is fetched through the tenant-checked media path, then clears', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AttachmentRow attachment={attachment(1)} onError={vi.fn()} />);
    const row = screen.getByRole('button');
    fireEvent.click(row);

    await waitFor(() => expect(row).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByTestId('attachment-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-download-glyph')).toBeNull();

    // The fetch goes through the BFF media path for the asset's `original` variant — never a signed
    // Storage URL, and never a "give me a download URL" route (03-01).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/v1/media/${attachment(1).assetId}/original`,
    );

    // A second tap WHILE BUSY is a no-op — each one would otherwise burn another round trip.
    fireEvent.click(row);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(new Response(new Blob(['%PDF-1.4']), { status: 200 }));

    await waitFor(() => expect(row).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByTestId('attachment-download-glyph')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-spinner')).toBeNull();
    // The object URL never outlives the save.
    await waitFor(() => expect(objectUrls.revoked).toBe(objectUrls.created));
    expect(objectUrls.created).toBe(1);
  });

  it('restores the glyph and raises the failure EXACTLY once on a refusal, leaving the row tappable', async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    render(<AttachmentRow attachment={attachment(1)} onError={onError} />);
    const row = screen.getByRole('button');
    fireEvent.click(row);

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(row).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('attachment-download-glyph')).toBeInTheDocument();
    // No inline error line grew the row (UI-D-23: no reflow).
    expect(screen.queryByRole('alert')).toBeNull();
    expect(objectUrls.created).toBe(0);
  });

  it('raises the failure once for a thrown transport error too', async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );

    render(<AttachmentRow attachment={attachment(1)} onError={onError} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it('surfaces the host’s generic error toast when a row inside PostMedia fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    withToast(
      <PostMedia mediaKind="none" images={[]} attachments={[attachment(1)]} labels={LABELS} />,
    );
    fireEvent.click(within(list() as HTMLElement).getByRole('button'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(LABELS.attachmentError),
    );
  });
});
