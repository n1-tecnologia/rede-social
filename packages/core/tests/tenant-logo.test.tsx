// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TenantLogo } from '../ui';

afterEach(() => {
  cleanup();
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
});
