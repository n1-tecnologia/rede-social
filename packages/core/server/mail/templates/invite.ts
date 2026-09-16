import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/** First-admin invite (D-29 copy): the link lands on the tenant's own `/aceitar-convite`. */
export function renderInvite(input: { brand: MailBrand; link: string }): RenderedMail {
  const { brand, link } = input;
  return renderLayout({
    brand,
    subject: `Convite para administrar ${brand.displayName}`,
    heading: `Você foi convidado(a) a administrar ${brand.displayName}`,
    paragraphs: ['Clique no botão abaixo para criar sua senha e aceitar o convite.'],
    cta: { label: 'Aceitar convite', href: link },
    closing: ['Se você não esperava este convite, ignore este e-mail.'],
  });
}
