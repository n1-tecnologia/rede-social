// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HomePromoView } from '@/lib/courses-home-view';
import { HOME_PROMO_COOKIE } from '@/lib/home-promo';
import { HomePromoChoice, type HomePromoOption } from './HomePromoChoice';

/**
 * 2026-10-27 — the administrator's pencil on Início's store promotion (front only): the same
 * invitation as `HomePromoBody` for the product of their pick, and the picker (the shipped
 * `BottomSheet`) with "Mais recente da loja" and every product as a named radiogroup. A pick swaps
 * the invitation at once and is kept in the per-device cookie. Real: the sheet, the body, the
 * cookie jar. The web workspace has no jest-dom: plain DOM assertions only.
 */

MotionGlobalConfig.skipAnimations = true;

const NEW = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';

const VIEW: HomePromoView = {
  kind: 'product',
  images: [],
  eyebrow: 'Destaque da loja',
  title: 'Formação X',
  body: 'Disponível agora na loja de Escola Demo.',
  chips: ['R$ 97,00'],
  cta: { href: `/loja/${NEW}`, label: 'Conhecer agora' },
};

const OPTIONS: HomePromoOption[] = [
  { id: NEW, name: 'Formação X', price: 'R$ 97,00', thumb: <span data-thumb={NEW} /> },
  { id: OLD, name: 'Mentoria Y', price: 'Grátis', thumb: <span data-thumb={OLD} /> },
];

const LABELS = {
  open: 'Escolher o destaque da loja',
  title: 'Destaque da loja',
  helper: 'Escolha o produto que aparece neste espaço do Início.',
  latest: 'Mais recente da loja',
  latestLine: 'Padrão · Formação X',
  device: 'Por enquanto, a escolha vale só neste aparelho.',
};

function draw(initialChoice: string | null = null) {
  return render(
    <HomePromoChoice view={VIEW} options={OPTIONS} initialChoice={initialChoice} labels={LABELS} />,
  );
}

const title = () => document.getElementById('courses-home-promo-title')?.textContent;
const cta = () => screen.getByTestId('courses-home-promo-cta').getAttribute('href');
const pencil = () => screen.getByTestId('courses-home-promo-edit');
const kept = () =>
  document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${HOME_PROMO_COOKIE}=`))
    ?.slice(HOME_PROMO_COOKIE.length + 1) ?? null;

async function openPicker() {
  fireEvent.click(pencil());
  const dialog = await screen.findByRole('dialog');
  return { dialog, radios: within(dialog).getAllByRole('radio') };
}

afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noDocumentCookie: resets the jar the component writes to
  document.cookie = `${HOME_PROMO_COOKIE}=; path=/; max-age=0`;
});

describe('HomePromoChoice', () => {
  it('draws the newest product by default, with the pencil that opens a dialog', () => {
    draw();
    expect(title()).toBe('Formação X');
    expect(cta()).toBe(`/loja/${NEW}`);
    expect(pencil().getAttribute('aria-label')).toBe('Escolher o destaque da loja');
    expect(pencil().getAttribute('aria-haspopup')).toBe('dialog');
    expect(pencil().getAttribute('aria-expanded')).toBe('false');
  });

  it("draws the device's pick from the first render (no flash of the newest)", () => {
    draw(OLD);
    expect(title()).toBe('Mentoria Y');
    expect(cta()).toBe(`/loja/${OLD}`);
    expect(screen.getByText('Grátis')).toBeTruthy();
  });

  it('lists the default and every product, the one shown checked', async () => {
    draw(OLD);
    const { dialog, radios } = await openPicker();
    expect(within(dialog).getByRole('radiogroup').getAttribute('aria-label')).toBe(
      'Destaque da loja',
    );
    expect(dialog.textContent).toContain('Por enquanto, a escolha vale só neste aparelho.');
    expect(radios.map((radio) => radio.getAttribute('data-promo-option'))).toEqual([
      'latest',
      NEW,
      OLD,
    ]);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    expect(radios[0]?.textContent).toContain('Padrão · Formação X');
  });

  it('a pick swaps the invitation at once, keeps it on the device and closes the picker', async () => {
    draw();
    const { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    expect(title()).toBe('Mentoria Y');
    expect(cta()).toBe(`/loja/${OLD}`);
    expect(kept()).toBe(OLD);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Mais recente da loja" goes back to the newest and forgets the pick', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the pick a previous visit left on the device
    document.cookie = `${HOME_PROMO_COOKIE}=${OLD}; path=/`;
    draw(OLD);
    const { radios } = await openPicker();
    fireEvent.click(radios[0] as HTMLElement);
    expect(title()).toBe('Formação X');
    expect(kept()).toBeNull();
  });

  it('the arrows walk the options without picking', async () => {
    draw();
    const { radios } = await openPicker();
    act(() => (radios[0] as HTMLElement).focus());
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[0]);
    expect(title()).toBe('Formação X');
  });
});
