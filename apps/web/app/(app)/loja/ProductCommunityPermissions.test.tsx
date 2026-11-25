// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 11.1-12 — the permission group of one chosen community (UI-D-883, UI-D-885, UI-D-896), against the
 * REAL merged pt-BR catalogs through next-intl's own `createTranslator`, so a copy drift fails here.
 * The component is controlled: it draws what it is given and answers every tick with the whole next
 * value. The web workspace has no jest-dom: plain DOM assertions only.
 */

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { ProductCommunityPermissions } = await import('./ProductCommunityPermissions');
const { defaultPermissions } = await import('@/lib/store-permissions');

const COMMUNITY = { id: '22222222-2222-4222-8222-222222222222', name: 'Mentoria ao vivo' };

afterEach(cleanup);

function renderGroup(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const view = render(
    <ProductCommunityPermissions
      community={COMMUNITY}
      value={defaultPermissions()}
      onChange={onChange}
      disabled={false}
      {...overrides}
    />,
  );
  return { onChange, ...view };
}

const boxes = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

describe('ProductCommunityPermissions (UI-D-883)', () => {
  it('1. one fieldset with the legend and five native checkboxes in the fixed order, the defaults ticked', () => {
    renderGroup();

    const fieldsets = document.querySelectorAll('fieldset');
    expect(fieldsets).toHaveLength(1);
    expect(fieldsets[0]?.querySelector('legend')?.textContent).toBe(
      'Quem comprar pode: em Mentoria ao vivo',
    );
    const labels = ['Curtir', 'Comentar', 'Compartilhar', 'Postar na comunidade', 'Postar story'];
    expect(boxes().map((box) => box.closest('label')?.textContent)).toEqual(labels);
    expect(boxes().map((box) => box.checked)).toEqual([true, true, true, false, false]);
    for (const box of boxes()) {
      expect(box.className).toBe('size-5 shrink-0 rounded border-border accent-brand');
      expect(box.closest('label')?.className).toContain('min-h-11');
    }
  });

  it('2. the " em {community}" suffix is sr-only and the visible legend is the plain sentence', () => {
    renderGroup();
    const suffix = document.querySelector('legend .sr-only');
    expect(suffix?.textContent).toBe(' em Mentoria ao vivo');
    const legend = document.querySelector('legend');
    expect(legend?.firstChild?.textContent).toBe('Quem comprar pode:');
  });

  it('3. ticking a box answers the WHOLE next value with only that flag flipped', () => {
    const { onChange } = renderGroup();

    fireEvent.click(screen.getByLabelText('Postar na comunidade'));
    expect(onChange).toHaveBeenCalledWith({
      like: true,
      comment: true,
      share: true,
      post: true,
      story: false,
    });

    fireEvent.click(screen.getByLabelText('Curtir'));
    expect(onChange).toHaveBeenLastCalledWith({
      like: false,
      comment: true,
      share: true,
      post: false,
      story: false,
    });
  });

  it('4. all five unticked is drawn as is: no warning, no master control', () => {
    renderGroup({
      value: { like: false, comment: false, share: false, post: false, story: false },
    });
    expect(boxes().map((box) => box.checked)).toEqual([false, false, false, false, false]);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelectorAll('input')).toHaveLength(5);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('5. disabled disables the five boxes', () => {
    renderGroup({ disabled: true });
    expect(boxes().every((box) => box.disabled)).toBe(true);
  });

  it('6. a community name is React text, never markup (T-11.1-46)', () => {
    const name = '<img src=x onerror=alert(1)> {community}';
    renderGroup({ community: { id: COMMUNITY.id, name } });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('legend .sr-only')?.textContent).toBe(` em ${name}`);
  });
});
