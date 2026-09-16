// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TenantLogo } from '../ui';

afterEach(() => {
  cleanup();
});

describe('TenantLogo (D-26: logo as-is, display name fallback)', () => {
  it('renders the logo as an <img> whose alt is the display name', () => {
    render(<TenantLogo logoUrl="/seed-logos/tria-demo.svg" displayName="TRIA Demo" size="auth" />);
    const img = screen.getByRole('img', { name: 'TRIA Demo' });
    expect(img).toHaveAttribute('src', '/seed-logos/tria-demo.svg');
    expect(img).toHaveClass('object-contain');
    expect(screen.queryByText('TRIA Demo')).not.toBeInTheDocument();
  });

  it('renders the display name as text when there is no logo', () => {
    render(<TenantLogo logoUrl={null} displayName="Associação São José" size="topbar" />);
    expect(screen.getByText('Associação São José')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each(['topbar', 'rail', 'auth', 'home'] as const)(
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
});
