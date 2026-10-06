import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/**
 * First-admin invite for an identity that ALREADY has a password (D-314, UI-D-325): the person is a
 * member of another community, so the mail carries no token of any kind. The CTA is a plain link to
 * the inviting tenant's `/entrar` on its verified primary host; the person signs in there with the
 * password they already have, and the accept screen asks only for the rules and the terms.
 *
 * `brand` is the INVITING tenant's (D-315): the copy names that community only and never the
 * person's other one (T-08.1-28). Sent by the app through the kernel `mailTransport`, never by
 * GoTrue (every GoTrue action for a confirmed identity mints a login token, T-08.1-26).
 */
export function renderInviteExisting(input: { brand: MailBrand; link: string }): RenderedMail {
  const { brand, link } = input;
  return renderLayout({
    brand,
    subject: `Convite para administrar ${brand.displayName}`,
    heading: `Você foi convidado(a) a administrar ${brand.displayName}`,
    paragraphs: [
      `Entre em ${brand.displayName} com este e-mail e use a senha que você já tem. Depois, aceite as regras da comunidade para começar.`,
    ],
    cta: { label: `Entrar em ${brand.displayName}`, href: link },
    closing: ['Se você não esperava este convite, ignore este e-mail.'],
  });
}
