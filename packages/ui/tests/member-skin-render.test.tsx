import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemberSkin, SkinAmbient, SkinAtmos, SkinTileFx } from '../src/index';

/**
 * The member skin's scope and layers (2026-10-26) as a DOM contract. Sheets and dialogs render
 * inside the page, so the wrapper must stay a plain box: no class, no style (never a transform, an
 * isolation or a z-index) on the scope, the content in a `relative` box after the ground.
 */
describe('MemberSkin', () => {
  it('draws the scope, the ground first and the content in a relative box after it', () => {
    const { container } = render(
      <MemberSkin>
        <p>content-sentinel</p>
      </MemberSkin>,
    );
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-member-skin', '');
    expect(root?.getAttribute('class')).toBeNull();
    expect(root?.getAttribute('style')).toBeNull();
    expect(root?.children).toHaveLength(2);

    const backdrop = screen.getByTestId('member-skin-backdrop');
    expect(root?.firstElementChild).toBe(backdrop);
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop.className).toBe('ms-backdrop');
    expect(backdrop.querySelectorAll('.ms-blob')).toHaveLength(2);
    expect(backdrop.textContent).toBe('');

    const box = root?.lastElementChild;
    expect(box?.className).toBe('relative');
    expect(box?.getAttribute('style')).toBeNull();
    expect(box?.textContent).toBe('content-sentinel');
  });

  it('drops the ground for a scope that must not paint a second one', () => {
    const { container } = render(
      <MemberSkin backdrop={false}>
        <p>content-sentinel</p>
      </MemberSkin>,
    );
    expect(screen.queryByTestId('member-skin-backdrop')).toBeNull();
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('ships the decorative layers hidden by the CLASS, never the attribute, and wordless', () => {
    const { container } = render(
      <>
        <SkinTileFx />
        <SkinTileFx soft />
        <SkinAmbient />
        <SkinAtmos />
      </>,
    );
    const layers = [...container.querySelectorAll('span')];
    expect(layers.map((layer) => layer.className)).toEqual([
      'ms-tile-fx hidden',
      'ms-tile-fx ms-soft hidden',
      'ms-ambient hidden',
      'ms-atmos hidden',
    ]);
    for (const layer of layers) {
      // Tailwind's preflight forces `[hidden]` to `display: none !important`: the skin could not
      // show a layer hidden by the attribute.
      expect(layer.hasAttribute('hidden')).toBe(false);
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      expect(layer.textContent).toBe('');
    }
  });
});
