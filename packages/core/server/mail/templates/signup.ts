import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/** Sign-up e-mail confirmation: subject and body name the tenant the person signed up on, CTA in its primary color. */
export function renderSignup(input: { brand: MailBrand; link: string }): RenderedMail {
  const { brand, link } = input;
  return renderLayout({
    brand,
    subject: `Confirme seu e-mail — ${brand.displayName}`,
    heading: 'Confirme seu e-mail',
    paragraphs: [
      `Falta só um passo para ativar sua conta em ${brand.displayName}.`,
      'Clique no botão abaixo para confirmar seu endereço de e-mail e entrar na comunidade.',
    ],
    cta: { label: 'Confirmar e-mail', href: link },
    closing: ['Se você não criou esta conta, ignore este e-mail. O link expira em breve.'],
  });
}
