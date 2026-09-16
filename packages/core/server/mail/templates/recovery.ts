import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/** Password recovery (AUTH-03, D-38): subject and body name the tenant, CTA in its primary color. */
export function renderRecovery(input: { brand: MailBrand; link: string }): RenderedMail {
  const { brand, link } = input;
  return renderLayout({
    brand,
    subject: `Redefina sua senha — ${brand.displayName}`,
    heading: 'Redefina sua senha',
    paragraphs: [
      `Recebemos um pedido para redefinir a senha da sua conta em ${brand.displayName}.`,
      'Clique no botão abaixo para escolher uma nova senha.',
    ],
    cta: { label: 'Escolher nova senha', href: link },
    closing: ['Se você não pediu isso, ignore este e-mail. O link expira em breve.'],
  });
}
