import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/**
 * The fallback for every GoTrue `email_action_type` that has no dedicated template (D-37). Still
 * rendered in the resolved brand — "neutral" names the copy, not the colours. `signup`/`email` are
 * only reachable once per-tenant e-mail confirmation is enabled (D-04); `reauthentication` is
 * code-only; the `*_notification` types are informational (no link, no code).
 */

type Copy = {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: string;
  kind: 'link' | 'code' | 'notice';
};

const IGNORE = 'Se você não pediu isso, ignore este e-mail.';
const NOT_YOU = 'Se não foi você, entre em contato com o suporte da sua comunidade.';

function copyFor(actionType: string, tenant: string): Copy {
  switch (actionType) {
    case 'signup':
    case 'email':
      return {
        subject: `Confirme seu e-mail — ${tenant}`,
        heading: 'Confirme seu e-mail',
        paragraphs: [`Confirme seu endereço de e-mail para ativar sua conta em ${tenant}.`],
        cta: 'Confirmar e-mail',
        kind: 'link',
      };
    case 'magiclink':
      return {
        subject: `Seu link de acesso — ${tenant}`,
        heading: 'Seu link de acesso',
        paragraphs: [`Use o botão abaixo para entrar em ${tenant}.`],
        cta: 'Entrar',
        kind: 'link',
      };
    case 'email_change':
      return {
        subject: `Confirme seu novo e-mail — ${tenant}`,
        heading: 'Confirme seu novo e-mail',
        paragraphs: [`Confirme a alteração do e-mail da sua conta em ${tenant}.`],
        cta: 'Confirmar novo e-mail',
        kind: 'link',
      };
    case 'reauthentication':
      return {
        subject: `Seu código de confirmação — ${tenant}`,
        heading: 'Seu código de confirmação',
        paragraphs: ['Use o código abaixo para confirmar a operação.'],
        kind: 'code',
      };
    case 'password_changed_notification':
      return {
        subject: `Sua senha foi alterada — ${tenant}`,
        heading: 'Sua senha foi alterada',
        paragraphs: [`A senha da sua conta em ${tenant} foi alterada.`, NOT_YOU],
        kind: 'notice',
      };
    case 'email_changed_notification':
      return {
        subject: `Seu e-mail foi alterado — ${tenant}`,
        heading: 'Seu e-mail foi alterado',
        paragraphs: [`O e-mail da sua conta em ${tenant} foi alterado.`, NOT_YOU],
        kind: 'notice',
      };
    case 'identity_linked_notification':
      return {
        subject: `Nova forma de acesso vinculada — ${tenant}`,
        heading: 'Nova forma de acesso vinculada',
        paragraphs: [`Uma nova forma de acesso foi vinculada à sua conta em ${tenant}.`, NOT_YOU],
        kind: 'notice',
      };
    case 'identity_unlinked_notification':
      return {
        subject: `Forma de acesso desvinculada — ${tenant}`,
        heading: 'Forma de acesso desvinculada',
        paragraphs: [`Uma forma de acesso foi desvinculada da sua conta em ${tenant}.`, NOT_YOU],
        kind: 'notice',
      };
    case 'mfa_factor_enrolled_notification':
      return {
        subject: `Verificação em duas etapas ativada — ${tenant}`,
        heading: 'Verificação em duas etapas ativada',
        paragraphs: [
          `A verificação em duas etapas foi ativada na sua conta em ${tenant}.`,
          NOT_YOU,
        ],
        kind: 'notice',
      };
    case 'mfa_factor_unenrolled_notification':
      return {
        subject: `Verificação em duas etapas desativada — ${tenant}`,
        heading: 'Verificação em duas etapas desativada',
        paragraphs: [
          `A verificação em duas etapas foi desativada na sua conta em ${tenant}.`,
          NOT_YOU,
        ],
        kind: 'notice',
      };
    case 'phone_changed_notification':
      return {
        subject: `Seu telefone foi alterado — ${tenant}`,
        heading: 'Seu telefone foi alterado',
        paragraphs: [`O telefone da sua conta em ${tenant} foi alterado.`, NOT_YOU],
        kind: 'notice',
      };
    default:
      return {
        subject: `Aviso da sua conta — ${tenant}`,
        heading: 'Aviso da sua conta',
        paragraphs: [`Houve uma atualização na sua conta em ${tenant}.`],
        kind: 'notice',
      };
  }
}

/** Action types whose mail carries a link (when `token_hash` is present and `redirect_to` parses). */
export const LINK_ACTION_TYPES: ReadonlySet<string> = new Set([
  'signup',
  'email',
  'magiclink',
  'email_change',
]);

export function renderNeutral(input: {
  brand: MailBrand;
  actionType: string;
  link: string | null;
  code: string | null;
}): RenderedMail {
  const { brand, actionType, link, code } = input;
  const copy = copyFor(actionType, brand.displayName);
  const withCta = copy.kind === 'link' && copy.cta && link;
  return renderLayout({
    brand,
    subject: copy.subject,
    heading: copy.heading,
    paragraphs: copy.paragraphs,
    cta: withCta ? { label: copy.cta as string, href: link } : undefined,
    code: copy.kind === 'code' && code ? code : undefined,
    closing: copy.kind === 'link' || copy.kind === 'code' ? [IGNORE] : undefined,
  });
}
