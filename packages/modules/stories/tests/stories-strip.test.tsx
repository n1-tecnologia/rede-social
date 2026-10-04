// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoriesStrip, type StoryStripCircle } from '../ui/StoriesStrip';
import { StoryCircle, StoryMonogram, StoryPhoto } from '../ui/StoryCircle';

/**
 * D-104 / D-105 / D-106 / UI-D-26 / UI-D-59..UI-D-63 — the strip and its circle, asserted as
 * observable contract rather than as pixels.
 *
 * The claims worth a test are the ones a later edit could quietly break:
 *
 *  1. **UI-D-26's all-or-nothing empty.** A viewer with no circle must get NO DOM node — not an
 *     empty state, not a reserved height, not a zero-height row. The `/inicio` column has to close
 *     up, and "renders nothing" is a fact about the container, so only the container can assert it.
 *     WHICH circles a viewer gets (the admin's `+`, the tenant circle, the highlights) is the HOST's
 *     decision (UI-D-59); the strip renders exactly the ordered descriptors it is handed.
 *  2. **One circle unit, every disc and ring** (UI-D-60..UI-D-63): the ring is a prop independent of
 *     the disc, and the monogram takes the first GRAPHEME — never a `.slice()` that could split a
 *     surrogate pair or a joined emoji.
 *  3. **UI-D-14's no-clock-in-render.** The label is a STRING the host already formatted; the
 *     component must never derive it. A sentinel string is what proves it is passed through.
 *
 * Both components ship NO words (PWA-03) and resolve no route (MOD-02): every string and every href
 * is a prop, sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const LADDER = [640, 1080] as const;

function asset(n: number): Extract<StoryStripCircle, { kind: 'open' }> {
  return {
    kind: 'open',
    key: `s${n}`,
    label: `label-${n}`,
    actionLabel: `open-${n}`,
    ring: 'brand',
    disc: {
      kind: 'asset',
      assetId: `0000000${n}-1111-4111-8111-111111111111`,
      variantWidths: LADDER,
    },
    group: 0,
    index: n - 1,
  };
}

const OWN: StoryStripCircle = {
  kind: 'link',
  key: 'own',
  href: '/stories/publicar',
  label: 'own-label',
  actionLabel: 'own-action',
  ring: 'dashed',
  disc: { kind: 'own' },
};

function strip(overrides: Partial<React.ComponentProps<typeof StoriesStrip>> = {}) {
  return render(<StoriesStrip circles={[]} regionLabel="strip-region" {...overrides} />);
}

describe('StoriesStrip — the ordered row of circle descriptors (UI-D-59, UI-D-26, D-104)', () => {
  it('1. an empty circle list renders no DOM node at all (UI-D-26)', () => {
    const { container } = strip({ circles: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('2. the link circle alone renders exactly one circle — an anchor to its href', () => {
    strip({ circles: [OWN] });
    const row = screen.getByRole('list', { name: 'strip-region' });
    expect(within(row).getAllByRole('listitem')).toHaveLength(1);
    expect(within(row).getByRole('link', { name: 'own-action' })).toHaveAttribute(
      'href',
      '/stories/publicar',
    );
  });

  it('3. descriptors render in the GIVEN order inside role="list"', () => {
    strip({ circles: [OWN, asset(1), asset(2), asset(3)] });
    const items = within(screen.getByRole('list', { name: 'strip-region' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.textContent)).toEqual([
      'own-label',
      'label-1',
      'label-2',
      'label-3',
    ]);
  });

  it('4. loading draws three skeleton circles and no listitem, so the feed below does not shift', () => {
    const { container } = strip({ circles: [], loading: true });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="story-circle-skeleton"]')).toHaveLength(3);
  });

  it('5. the row contains its own horizontal overscroll so a swipe never triggers back', () => {
    const { container } = strip({ circles: [asset(1)] });
    const row = container.querySelector('[data-testid="stories-strip"]');
    expect(row?.className).toContain('overscroll-x-contain');
    expect(row?.className).toContain('overflow-x-auto');
  });

  it('6. an open circle calls onOpen(group, index) with ITS OWN pair', () => {
    const onOpen = vi.fn();
    const highlight: StoryStripCircle = {
      ...asset(9),
      key: 'h1',
      actionLabel: 'open-highlight',
      ring: 'neutral',
      group: 2,
      index: 0,
    };
    strip({ circles: [asset(1), highlight], onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'open-highlight' }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(2, 0);
    fireEvent.click(screen.getByRole('button', { name: 'open-1' }));
    expect(onOpen).toHaveBeenLastCalledWith(0, 0);
  });

  it('7. without onOpen an open circle is inert — no button anywhere in the row', () => {
    strip({ circles: [asset(1), asset(2)] });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('7b. a static circle is inert even when the row has onOpen — a span, never a button', () => {
    const onOpen = vi.fn();
    const inert: StoryStripCircle = {
      kind: 'static',
      key: 'h-static',
      label: 'static-label',
      actionLabel: 'static-action',
      ring: 'neutral',
      disc: { kind: 'monogram', text: 'b' },
    };
    strip({ circles: [asset(1), inert], onOpen });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'static-action' })).toBeNull();
    expect(screen.getByText('static-label')).toBeInTheDocument();
  });

  it('8. only the first three discs of the row load eagerly', () => {
    // happy-dom reports every `<img>` as `complete` with a zero `naturalWidth`, so `MediaImage`
    // would take its degraded branch and drop the `<img>`; a decoded image is forced for this case
    // (the `media-image.test.tsx` idiom), with happy-dom's own accessors restored afterwards.
    const saved = ['complete', 'naturalWidth'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)] as const,
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 640,
    });
    try {
      const { container } = strip({ circles: [asset(1), asset(2), asset(3), asset(4)] });
      const loading = Array.from(container.querySelectorAll('img')).map((img) =>
        img.getAttribute('loading'),
      );
      expect(loading).toEqual(['eager', 'eager', 'eager', 'lazy']);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
        else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  });
});

describe('StoryCircle — 64x64, every disc and ring, one geometry (UI-D-60..UI-D-63)', () => {
  function ringOf(container: HTMLElement): string {
    return container.querySelector('[data-testid="story-circle-ring"]')?.className ?? '';
  }

  it('9. the label is the host string, verbatim and truncated — never derived from a clock', () => {
    render(
      <StoryCircle
        ring="brand"
        disc={{ kind: 'asset', assetId: null, variantWidths: [] }}
        label="ha 2 h"
        actionLabel="open"
      />,
    );
    const label = screen.getByText('ha 2 h');
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('max-w-16');
  });

  it('10. ring="brand" wears border-brand; neutral wears border-border; both keep the geometry', () => {
    const disc = { kind: 'asset', assetId: null, variantWidths: [] } as const;
    const brand = render(<StoryCircle ring="brand" disc={disc} label="l" actionLabel="a" />);
    expect(ringOf(brand.container)).toContain('border-brand');
    for (const cls of ['border-2', 'p-0.5', 'rounded-full']) {
      expect(ringOf(brand.container)).toContain(cls);
    }
    cleanup();
    const neutral = render(<StoryCircle ring="neutral" disc={disc} label="l" actionLabel="a" />);
    expect(ringOf(neutral.container)).toContain('border-border');
    expect(ringOf(neutral.container)).not.toContain('border-brand');
  });

  it('11. ring="dashed" is border-dashed on border-border-secondary, same geometry', () => {
    const { container } = render(
      <StoryCircle
        ring="dashed"
        disc={{ kind: 'asset', assetId: null, variantWidths: [] }}
        label="l"
        actionLabel="a"
      />,
    );
    const ring = ringOf(container);
    for (const cls of ['border-dashed', 'border-border-secondary', 'border-2', 'p-0.5']) {
      expect(ring).toContain(cls);
    }
  });

  it('12. a logo disc is an alt="" img, object-contain, inside a 48px box on bg-bg-secondary', () => {
    const { container } = render(
      <StoryCircle
        ring="brand"
        disc={{ kind: 'logo', src: '/logo.png' }}
        label="tenant"
        actionLabel="a"
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/logo.png');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.className).toContain('object-contain');
    expect(img?.parentElement?.className).toContain('h-12');
    expect(img?.parentElement?.className).toContain('w-12');
    expect(container.querySelector('[data-testid="story-disc-logo"]')?.className).toContain(
      'bg-bg-secondary',
    );
  });

  it('13. a monogram disc shows the first grapheme of its text, upper-cased', () => {
    const { container } = render(
      <StoryCircle
        ring="neutral"
        disc={{ kind: 'monogram', text: 'édson' }}
        label="l"
        actionLabel="a"
      />,
    );
    const mono = container.querySelector('[data-testid="story-monogram"]');
    expect(mono?.textContent).toBe('É');
    expect(mono?.className).toContain('text-on-brand');
    expect(mono?.className).toContain('font-bold');
  });

  it('14. a joined family emoji is ONE grapheme — the whole sequence, never a broken surrogate', () => {
    const family = '\u{1F469}‍\u{1F469}‍\u{1F467}';
    render(<StoryMonogram text={`${family} grupo`} />);
    expect(screen.getByTestId('story-monogram').textContent).toBe(family);
  });

  it('15. a glyph disc renders the host icon on bg-bg-tertiary', () => {
    const { container } = render(
      <StoryCircle
        ring="dashed"
        disc={{ kind: 'glyph', icon: <svg data-testid="host-icon" /> }}
        label="l"
        actionLabel="a"
      />,
    );
    expect(screen.getByTestId('host-icon')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="story-disc-glyph"]')?.className).toContain(
      'bg-bg-tertiary',
    );
  });

  it('16. the own disc is a CENTRED Plus on the tertiary ground, no photo and no badge; with an href it is an anchor, never a button', () => {
    const { container } = render(
      <StoryCircle
        ring="dashed"
        disc={{ kind: 'own' }}
        label="own-label"
        actionLabel="own-action"
        href="/stories/publicar"
      />,
    );
    expect(screen.getByRole('link', { name: 'own-action' })).toHaveAttribute(
      'href',
      '/stories/publicar',
    );
    expect(screen.queryByRole('button')).toBeNull();

    // UI-D-28 as amended (2026-10-02): the manage circle's glyph disc, with the module's own Plus
    // centred in it at the manage Pencil's size.
    const disc = container.querySelector('[data-testid="story-disc-own"]');
    expect(disc).not.toBeNull();
    for (const cls of [
      'grid',
      'h-16',
      'w-16',
      'place-items-center',
      'rounded-full',
      'bg-bg-tertiary',
      'text-text-secondary',
    ]) {
      expect(disc?.className).toContain(cls);
    }
    const plus = disc?.querySelector('svg');
    expect(plus).not.toBeNull();
    expect(plus).toHaveAttribute('width', '20');
    expect(plus).toHaveAttribute('aria-hidden', 'true');
    // The admin's photo and the corner badge are gone, and the disc sits in the same ring geometry.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="story-own-badge"]')).toBeNull();
    for (const cls of ['border-dashed', 'border-2', 'p-0.5']) {
      expect(ringOf(container)).toContain(cls);
    }
  });

  it('17. with onOpen the circle is one button carrying the action label; with neither it is inert', () => {
    const disc = { kind: 'monogram', text: 'x' } as const;
    const { rerender } = render(
      <StoryCircle ring="brand" disc={disc} label="l" actionLabel="open-me" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();

    rerender(
      <StoryCircle ring="brand" disc={disc} label="l" actionLabel="open-me" onOpen={() => {}} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'open-me' })).toBeInTheDocument();
  });
});

/**
 * #2b (2026-10-03, UI-D-60 as amended): the tenant circle wears the FACE of whoever published the
 * newest live story — and falls back to the tenant identity it wore before (the logo, or the
 * monogram) whenever that photo cannot be fetched. The claims a later edit could quietly break:
 *
 *  - the photo is cover-cropped to the WHOLE 64px disc (a face, not a wordmark), `alt=""`, and the
 *    control keeps the host's accessible name — the photo adds nothing to it and takes nothing away;
 *  - a failed photo is REPLACED by the fallback disc, at the identical geometry — never a broken
 *    image, never an empty ring — including a failure that happened before hydration;
 *  - the failure is keyed by `src`: a new photo retries instead of inheriting the old failure.
 */
describe('the photo disc — a face with the tenant identity behind it (#2b, UI-D-60 amended)', () => {
  const PHOTO = '/v1/media/0000000f-1111-4111-8111-111111111111/w128';

  /**
   * happy-dom reports every `<img>` as `complete` with a zero `naturalWidth` — what a failed fetch
   * looks like — so the photo would take its fallback on mount. A decoded image is forced for the
   * cases that need the photo itself (case 8's idiom), and happy-dom's accessors are restored after.
   */
  function withDecodedImages(run: () => void) {
    const saved = ['complete', 'naturalWidth'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)] as const,
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 128,
    });
    try {
      run();
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
        else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  }

  function photoCircle(
    fallback: { kind: 'logo'; src: string } | { kind: 'monogram'; text: string },
  ) {
    return render(
      <StoryCircle
        ring="brand"
        disc={{ kind: 'photo', src: PHOTO, fallback }}
        label="Rede Demo"
        actionLabel="open-tenant"
        onOpen={() => {}}
      />,
    );
  }

  it('18. the photo fills the 64px disc, cover-cropped, alt="", under the SAME accessible name', () => {
    withDecodedImages(() => {
      const { container } = photoCircle({ kind: 'logo', src: '/logo.png' });

      const button = screen.getByRole('button', { name: 'open-tenant' });
      const img = button.querySelector('img');
      expect(img).toHaveAttribute('src', PHOTO);
      expect(img).toHaveAttribute('alt', '');
      for (const cls of ['h-16', 'w-16', 'rounded-full', 'object-cover']) {
        expect(img?.className).toContain(cls);
      }
      const disc = container.querySelector('[data-testid="story-photo"]');
      for (const cls of ['h-16', 'w-16', 'rounded-full', 'overflow-hidden', 'bg-bg-tertiary']) {
        expect(disc?.className).toContain(cls);
      }
      // A face, not the logo: the fallback is not drawn while the photo stands.
      expect(container.querySelector('[data-testid="story-disc-logo"]')).toBeNull();
      expect(container.querySelector('[data-testid="story-monogram"]')).toBeNull();
      // The label under the circle is the host's string (the tenant), untouched by the photo.
      expect(screen.getByText('Rede Demo')).toBeInTheDocument();
      expect(button).toHaveAccessibleName('open-tenant');
    });
  });

  it('19. a photo that fails to load is REPLACED by the logo disc — the same 64px geometry, no broken image', () => {
    withDecodedImages(() => {
      const { container } = photoCircle({ kind: 'logo', src: '/logo.png' });
      const photo = container.querySelector(`img[src="${PHOTO}"]`);
      expect(photo).not.toBeNull();
      fireEvent.error(photo as HTMLImageElement);

      expect(container.querySelector(`img[src="${PHOTO}"]`)).toBeNull();
      expect(container.querySelector('[data-testid="story-photo"]')).toBeNull();
      const logo = container.querySelector('[data-testid="story-disc-logo"]');
      expect(logo?.className).toContain('h-16');
      expect(logo?.querySelector('img')).toHaveAttribute('src', '/logo.png');
      // Still the one control, still the host's name.
      expect(screen.getByRole('button', { name: 'open-tenant' })).toBeInTheDocument();
    });
  });

  it('20. a photo that failed BEFORE hydration (complete, zero width) shows the monogram fallback on mount', () => {
    // happy-dom's own default IS the failed-fetch signature, so no override here.
    const { container } = photoCircle({ kind: 'monogram', text: 'rede demo' });
    expect(container.querySelector(`img[src="${PHOTO}"]`)).toBeNull();
    expect(container.querySelector('[data-testid="story-monogram"]')?.textContent).toBe('R');
    expect(screen.getByRole('button', { name: 'open-tenant' })).toBeInTheDocument();
  });

  it('21. the failure is keyed by src — a NEW photo is tried again instead of inheriting the old failure', () => {
    withDecodedImages(() => {
      const fallback = <span data-testid="fallback" />;
      const { container, rerender } = render(<StoryPhoto src={PHOTO} fallback={fallback} />);
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      expect(screen.getByTestId('fallback')).toBeInTheDocument();

      const next = '/v1/media/0000000f-2222-4222-8222-222222222222/w128';
      rerender(<StoryPhoto src={next} fallback={fallback} />);
      expect(screen.queryByTestId('fallback')).toBeNull();
      expect(container.querySelector('img')).toHaveAttribute('src', next);
    });
  });

  it('22. at the viewer header’s 32px slot the photo is h-8 w-8, and eager only when asked', () => {
    withDecodedImages(() => {
      const { container, rerender } = render(
        <StoryPhoto src={PHOTO} size={32} fallback={<span />} />,
      );
      const img = container.querySelector('img');
      expect(img?.className).toContain('h-8');
      expect(img?.className).toContain('w-8');
      expect(container.querySelector('[data-testid="story-photo"]')?.className).toContain('h-8');
      expect(img).toHaveAttribute('loading', 'lazy');

      rerender(<StoryPhoto src={PHOTO} size={32} eager fallback={<span />} />);
      expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
    });
  });

  it('23. in the strip the tenant circle’s photo is one of the eager first three', () => {
    withDecodedImages(() => {
      const tenant: StoryStripCircle = {
        kind: 'open',
        key: 'tenant',
        label: 'Rede Demo',
        actionLabel: 'open-tenant',
        ring: 'brand',
        disc: { kind: 'photo', src: PHOTO, fallback: { kind: 'monogram', text: 'R' } },
        group: 0,
        index: 0,
      };
      const { container } = strip({ circles: [OWN, tenant] });
      expect(container.querySelector(`img[src="${PHOTO}"]`)).toHaveAttribute('loading', 'eager');
    });
  });
});
