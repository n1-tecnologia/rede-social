import { describe, expect, it } from 'vitest';
import type { HomePromoView } from './courses-home-view';
import { parseHomePromoChoice, promoWithProduct } from './home-promo';

/**
 * 2026-10-27 — the administrator's pick for Início's store promotion (front only): a per-device
 * cookie holding ONE product id, read back strictly, and the promotion redrawn for the picked
 * product with the view's own words around it.
 */

const ID = '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e';

const VIEW: HomePromoView = {
  kind: 'product',
  images: ['img-1', 'cover-1'],
  eyebrow: 'Destaque da loja',
  title: 'Formação X',
  body: 'Disponível agora na loja de Escola Demo.',
  chips: ['R$ 97,00'],
  cta: { href: '/loja/p1', label: 'Conhecer agora' },
};

describe('parseHomePromoChoice', () => {
  it('reads a product id back, lower-cased', () => {
    expect(parseHomePromoChoice(ID)).toBe(ID);
    expect(parseHomePromoChoice(ID.toUpperCase())).toBe(ID);
  });

  it('anything else is no pick (the newest product again)', () => {
    expect(parseHomePromoChoice(undefined)).toBeNull();
    expect(parseHomePromoChoice(null)).toBeNull();
    expect(parseHomePromoChoice('')).toBeNull();
    expect(parseHomePromoChoice('p1')).toBeNull();
    expect(parseHomePromoChoice(`${ID}.x`)).toBeNull();
    expect(parseHomePromoChoice(`/loja/${ID}`)).toBeNull();
  });
});

describe('promoWithProduct', () => {
  it("puts the picked product's name, price and page in, and keeps the view's words", () => {
    const view = promoWithProduct(VIEW, { id: ID, name: 'Mentoria Y', price: 'R$ 1.200,00' });
    expect(view).toEqual({
      ...VIEW,
      title: 'Mentoria Y',
      chips: ['R$ 1.200,00'],
      cta: { href: `/loja/${ID}`, label: 'Conhecer agora' },
    });
  });

  it('never edits the view it was given', () => {
    promoWithProduct(VIEW, { id: ID, name: 'Mentoria Y', price: 'Grátis' });
    expect(VIEW.title).toBe('Formação X');
    expect(VIEW.cta.href).toBe('/loja/p1');
  });
});
