// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkPreviewCard, type LinkPreviewView } from '../ui/LinkPreviewCard';

/**
 * UI-D-282 / E15 (08-08): the click-to-play variant of the link preview card. Labels are sentinel
 * ASCII props (the module ships no language); the pt-BR copy is the host's catalog.
 */
const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0';

function preview(overrides: Partial<LinkPreviewView> = {}): LinkPreviewView {
  return {
    status: 'resolved',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    hostname: 'youtube.com',
    title: 'A title',
    description: 'A description',
    provider: 'youtube',
    imageAssetId: null,
    imageVariantWidths: [],
    ...overrides,
  };
}

const LABELS = {
  ariaLabel: 'open-external',
  providerLabel: 'provider-label',
  playLabel: 'play-titled',
  playUntitledLabel: 'play-untitled',
  frameTitle: 'frame-title',
};

afterEach(cleanup);

describe('LinkPreviewCard — click-to-play (UI-D-282)', () => {
  it('renders the black 16:9 stage and the play disc, and NO iframe before the tap', () => {
    const { container } = render(
      <LinkPreviewCard preview={preview({ embedUrl: EMBED })} {...LABELS} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    const stage = screen.getByTestId('post-link-preview-stage');
    expect(stage).toHaveClass('aspect-video', 'w-full', 'bg-black');
    expect(stage.querySelector('img')).toBeNull(); // no remote thumbnail, ever
    expect(screen.getByRole('button', { name: 'play-titled' })).toBeInTheDocument();
    // The text block stays the external link.
    const link = screen.getByRole('link', { name: 'open-external' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a tap swaps in the sandboxed iframe with the exact attributes, never top-level navigation', () => {
    render(<LinkPreviewCard preview={preview({ embedUrl: EMBED })} {...LABELS} />);
    fireEvent.click(screen.getByRole('button', { name: 'play-titled' }));

    const frame = screen.getByTestId('post-link-preview-frame');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', EMBED);
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-presentation allow-popups',
    );
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame).toHaveAttribute(
      'allow',
      'autoplay; encrypted-media; picture-in-picture; fullscreen',
    );
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame).toHaveAttribute('title', 'frame-title');
    expect(frame).toHaveClass('aspect-video', 'w-full');
    expect(screen.queryByTestId('post-link-preview-stage')).toBeNull();
    expect(screen.queryByRole('button', { name: 'play-titled' })).toBeNull();
    // The external link survives the swap.
    expect(screen.getByRole('link', { name: 'open-external' })).toBeInTheDocument();
  });

  it('names the play button with the untitled label when the preview has no title', () => {
    render(<LinkPreviewCard preview={preview({ embedUrl: EMBED, title: null })} {...LABELS} />);
    expect(screen.getByRole('button', { name: 'play-untitled' })).toBeInTheDocument();
  });

  it('without embedUrl, the shipped external card renders: one link, no button, no frame', () => {
    const { container } = render(<LinkPreviewCard preview={preview()} {...LABELS} />);
    const card = screen.getByTestId('post-link-preview');
    expect(card.tagName).toBe('A');
    expect(card).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('provider-label')).toBeInTheDocument();
  });

  it('with embedUrl but no labels from the host, it keeps the shipped card rather than an unnamed control', () => {
    render(
      <LinkPreviewCard
        preview={preview({ embedUrl: EMBED })}
        ariaLabel="open-external"
        providerLabel="provider-label"
      />,
    );
    expect(screen.getByTestId('post-link-preview').tagName).toBe('A');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a pending or failed preview still renders nothing, embedUrl or not', () => {
    const { container } = render(
      <LinkPreviewCard preview={preview({ status: 'failed', embedUrl: EMBED })} {...LABELS} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
