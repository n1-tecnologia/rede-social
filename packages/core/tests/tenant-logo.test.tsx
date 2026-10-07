// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantLogo } from '../ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TenantLogo (D-26: logo as-is, display name fallback)', () => {
  it('renders the logo as an <img> whose alt is the display name', () => {
    render(<TenantLogo logoUrl="/seed-logos/rede-demo.svg" displayName="Rede Demo" size="auth" />);
    const img = screen.getByRole('img', { name: 'Rede Demo' });
    expect(img).toHaveAttribute('src', '/seed-logos/rede-demo.svg');
    expect(img).toHaveClass('object-contain');
    expect(screen.queryByText('Rede Demo')).not.toBeInTheDocument();
  });

  it('renders the display name as text when there is no logo', () => {
    render(<TenantLogo logoUrl={null} displayName="Associação São José" size="topbar" />);
    expect(screen.getByText('Associação São José')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each(['topbar', 'rail', 'auth', 'home', 'thread'] as const)(
    'never tints or reshapes the logo (%s)',
    (size) => {
      const { container } = render(
        <TenantLogo logoUrl="/logo.png" displayName="Tenant" size={size} />,
      );
      const html = container.innerHTML;
      for (const forbidden of ['filter', 'mask', 'mix-blend', 'clip-path', 'rounded']) {
        expect(html).not.toContain(forbidden);
      }
      const img = container.querySelector('img');
      expect(img?.getAttribute('style')).toBeNull();
    },
  );

  it('keeps the auth/home fallback at the large weight and the topbar/rail fallback truncated', () => {
    const { unmount } = render(<TenantLogo logoUrl={null} displayName="Tenant" size="home" />);
    expect(screen.getByText('Tenant')).toHaveClass('text-2xl');
    unmount();
    render(<TenantLogo logoUrl={null} displayName="Tenant" size="rail" />);
    expect(screen.getByText('Tenant')).toHaveClass('truncate');
  });

  it('thread (07-09, UI-D-258): a 64px-capped box, and NOTHING without a logo', () => {
    const { container, unmount } = render(
      <TenantLogo logoUrl="/logo-wide.png" displayName="Rede Demo" size="thread" />,
    );
    const img = screen.getByRole('img', { name: 'Rede Demo' });
    expect(img).toHaveClass('max-h-8', 'object-contain');
    expect(container.firstElementChild).toHaveClass('h-8', 'max-w-[64px]');
    unmount();
    const empty = render(<TenantLogo logoUrl={null} displayName="Rede Demo" size="thread" />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('a logo that fails to load is omitted (thread always, home with hideOnError)', () => {
    const thread = render(<TenantLogo logoUrl="/broken.png" displayName="Rede" size="thread" />);
    fireEvent.error(screen.getByRole('img', { name: 'Rede' }));
    expect(thread.container).toBeEmptyDOMElement();
    thread.unmount();
    const home = render(
      <TenantLogo logoUrl="/broken.png" displayName="Rede" size="home" hideOnError />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Rede' }));
    expect(home.container).toBeEmptyDOMElement();
  });

  // 2026-10-02: the TopBar and the rail show the logo ALONE, so a failing logo counts as no logo and
  // the display name takes its place; a broken glyph or an empty brand slot is never shown.
  it.each(['topbar', 'rail', 'auth', 'home'] as const)(
    'the %s logo that fails to load gives way to the display name',
    (size) => {
      render(<TenantLogo logoUrl="/broken.png" displayName="Rede Demo" size={size} />);
      fireEvent.error(screen.getByRole('img', { name: 'Rede Demo' }));
      expect(screen.getByText('Rede Demo')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );

  it('a logo that failed BEFORE hydration (no error event reaches React) gives way too', async () => {
    // The element's own record: `complete` with no natural width, and decode() rejects.
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('EncodingError'));
    render(<TenantLogo logoUrl="/broken.png" displayName="Rede Demo" size="topbar" />);
    expect(await screen.findByText('Rede Demo')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('an SVG with no intrinsic size is NOT taken for a broken logo (decode() resolves)', async () => {
    // happy-dom reports every image `complete` with a zero natural width, the SVG-without-size case.
    render(<TenantLogo logoUrl="/wordmark.svg" displayName="Rede Demo" size="topbar" />);
    await act(async () => {});
    expect(screen.getByRole('img', { name: 'Rede Demo' })).toHaveAttribute('src', '/wordmark.svg');
    expect(screen.queryByText('Rede Demo')).not.toBeInTheDocument();
  });

  it('a new logo after a failure is tried again (the failure is keyed by src)', () => {
    const { rerender } = render(
      <TenantLogo logoUrl="/broken.png" displayName="Rede Demo" size="topbar" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Rede Demo' }));
    expect(screen.getByText('Rede Demo')).toBeInTheDocument();
    rerender(<TenantLogo logoUrl="/novo.png" displayName="Rede Demo" size="topbar" />);
    expect(screen.getByRole('img', { name: 'Rede Demo' })).toHaveAttribute('src', '/novo.png');
    expect(screen.queryByText('Rede Demo')).not.toBeInTheDocument();
  });
});

describe('TenantLogo — the larger header logo (2026-10-06)', () => {
  it('the TopBar logo is 40px tall, the rail logo up to 48px', () => {
    const top = render(<TenantLogo logoUrl="/logo.png" displayName="Rede Demo" size="topbar" />);
    expect(screen.getByRole('img', { name: 'Rede Demo' })).toHaveClass('h-10', 'max-w-full');
    expect(top.container.firstElementChild).toHaveClass('h-10');
    top.unmount();
    render(<TenantLogo logoUrl="/logo.png" displayName="Rede Demo" size="rail" />);
    expect(screen.getByRole('img', { name: 'Rede Demo' })).toHaveClass('max-h-12');
  });
});
