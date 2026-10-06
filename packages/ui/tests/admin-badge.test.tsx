import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ICONS,
  AdminBadge,
  AdminIconGlyph,
  DEFAULT_ADMIN_ICON,
  isAdminIcon,
} from '../src/index';

/**
 * The administrator's mark (2026-10-06): the crown by default, any of the ten glyphs on request,
 * always named by the host's label and always in the tenant's SECONDARY colour.
 */
describe('AdminBadge', () => {
  it('draws the crown by default, named by the label, in the secondary colour', () => {
    render(<AdminBadge label="admin-badge" />);
    const badge = screen.getByRole('img', { name: 'admin-badge' });
    expect(DEFAULT_ADMIN_ICON).toBe('crown');
    expect(badge).toHaveAttribute('data-admin-badge', 'crown');
    expect(badge.className).toContain('text-brand-secondary');
    // The glyph itself is decorative: the span carries the name.
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden');
  });

  it('draws every picked glyph, each with its own drawing', () => {
    const drawings = new Set<string>();
    for (const icon of ADMIN_ICONS) {
      const { container, unmount } = render(<AdminBadge label="admin-badge" icon={icon} />);
      const badge = screen.getByRole('img', { name: 'admin-badge' });
      expect(badge).toHaveAttribute('data-admin-badge', icon);
      const svg = container.querySelector(`svg[data-admin-icon="${icon}"]`);
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('fill')).toBe('currentColor');
      drawings.add(svg?.innerHTML ?? '');
      unmount();
    }
    expect(drawings.size).toBe(ADMIN_ICONS.length);
  });

  it('falls back to the crown for an unknown or empty pick', () => {
    // An id the list does not know (an old cookie, a typo) never draws nothing.
    render(<AdminBadge label="admin-badge" icon={'unicorn' as never} />);
    expect(screen.getByRole('img', { name: 'admin-badge' })).toHaveAttribute(
      'data-admin-badge',
      'crown',
    );
  });

  it('sizes the glyph', () => {
    const { container } = render(<AdminIconGlyph icon="star" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('isAdminIcon accepts the ten ids and nothing else', () => {
    expect(ADMIN_ICONS).toHaveLength(10);
    for (const icon of ADMIN_ICONS) expect(isAdminIcon(icon)).toBe(true);
    for (const value of ['', 'Crown', 'unicorn', null, undefined, 1]) {
      expect(isAdminIcon(value)).toBe(false);
    }
  });
});
