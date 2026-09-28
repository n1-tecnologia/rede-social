import { deriveBrandColors, NEUTRAL_BRAND } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import { renderInvite } from '../server/mail/templates/invite';
import {
  escapeHtml,
  type MailBrand,
  renderLayout,
  safeHttpUrl,
} from '../server/mail/templates/layout';
import { renderNeutral } from '../server/mail/templates/neutral';
import { renderRecovery } from '../server/mail/templates/recovery';

/**
 * The e-mail layout and the three pt-BR templates (D-38, T-02-23): every interpolation escaped, the
 * logo emitted only through an http(s) allow-list, the CTA in the PERSISTED colours, UTF-8 kept
 * verbatim (no entities for accents), the Rede Social footer, and a plain-text alternative carrying the link.
 * Hermetic: nothing here imports the kernel env.
 */

const demo: MailBrand = {
  displayName: 'Rede Demo',
  logoUrl: 'https://rede-demo.example/seed-logos/rede-demo.svg',
  primary: '#7c3aed',
  onPrimary: '#ffffff',
};

const LINK =
  'https://rede-demo.example/auth/confirm?next=/redefinir-senha&token_hash=abc&type=recovery';

function layout(brand: MailBrand, cta = true) {
  return renderLayout({
    brand,
    subject: 'Assunto',
    heading: 'Título',
    paragraphs: ['Primeiro parágrafo.'],
    cta: cta ? { label: 'Abrir', href: LINK } : undefined,
    closing: ['Linha final.'],
  });
}

describe('escapeHtml / safeHttpUrl', () => {
  it('escapes the five HTML characters and nothing else', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
    expect(escapeHtml('Associação São José')).toBe('Associação São José');
  });

  it('keeps https always, http only when allowed, and drops everything else', () => {
    expect(safeHttpUrl('https://x.example/logo.png', false)).toBe('https://x.example/logo.png');
    expect(safeHttpUrl('http://x.example/logo.png', false)).toBeNull();
    expect(safeHttpUrl('http://x.example/logo.png', true)).toBe('http://x.example/logo.png');
    expect(safeHttpUrl('javascript:alert(1)', true)).toBeNull();
    expect(safeHttpUrl('data:image/svg+xml,<svg/>', true)).toBeNull();
    expect(safeHttpUrl('/seed-logos/x.svg', true)).toBeNull();
    expect(safeHttpUrl(null, true)).toBeNull();
  });
});

describe('renderLayout', () => {
  it('escapes a hostile display name in the header, the title and the alt text', () => {
    const { html } = layout({ ...demo, displayName: '<script>alert(1)</script>' });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });

  it('keeps accented names verbatim as UTF-8 in html and text (no entities)', () => {
    const { html, text } = layout({ ...demo, displayName: 'Associação São José', logoUrl: null });
    expect(html).toContain('Associação São José');
    expect(html).not.toContain('&atilde;');
    expect(html).not.toContain('&ccedil;');
    expect(text).toContain('Associação São José');
  });

  it('renders the display name as text in an <h1> when there is no logo (D-26)', () => {
    const { html } = layout({ ...demo, logoUrl: null });
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<h1[^>]*>Rede Demo<\/h1>/);
  });

  it('renders the logo as-is through <img src alt> when there is one', () => {
    const { html } = layout(demo);
    expect(html).toContain('<img src="https://rede-demo.example/seed-logos/rede-demo.svg"');
    expect(html).toContain('alt="Rede Demo"');
  });

  it('drops a logo URL that is not http(s) — javascript:, data: — and never emits <img> for it', () => {
    for (const logoUrl of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)/>']) {
      const { html } = layout({ ...demo, logoUrl });
      expect(html, logoUrl).not.toContain('<img');
      expect(html).not.toContain('javascript:');
    }
  });

  it('puts the PERSISTED primary/onPrimary on the CTA exactly', () => {
    const { html } = layout(demo);
    const cta = html.match(/<a href="[^"]+" style="([^"]+)">Abrir<\/a>/);
    expect(cta?.[1]).toContain('background:#7c3aed');
    expect(cta?.[1]).toContain('color:#ffffff');
  });

  it('falls back to the neutral derived pair when a hex is invalid', () => {
    const neutral = deriveBrandColors(NEUTRAL_BRAND);
    const { html } = layout({ ...demo, primary: 'purple', onPrimary: '#ffffff' });
    expect(html).toContain(`background:${neutral.primary}`);
    expect(html).toContain(`color:${neutral.onPrimary}`);
    expect(html).not.toContain('background:purple');
  });

  it('carries the footer in html and text, the href in text, and the html preamble', () => {
    const { html, text } = layout(demo);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('Enviado pela plataforma Rede Social');
    expect(text).toContain('Enviado pela plataforma Rede Social');
    expect(text).toContain(`Abrir: ${LINK}`);
    // The href is escaped inside the attribute and repeated as visible text for copy/paste.
    expect(html).toContain(`href="${LINK.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('copie e cole este endereço');
  });
});

describe('templates', () => {
  it('recovery: subject names the tenant with an em dash and the CTA carries the link', () => {
    const mail = renderRecovery({ brand: demo, link: LINK });
    expect(mail.subject).toBe('Redefina sua senha — Rede Demo');
    expect(mail.html).toContain('Redefina sua senha');
    expect(mail.html).toContain('Escolher nova senha');
    expect(mail.text).toContain(LINK);
  });

  it('invite: D-29 subject and heading', () => {
    const mail = renderInvite({ brand: demo, link: LINK });
    expect(mail.subject).toBe('Convite para administrar Rede Demo');
    expect(mail.html).toContain('Você foi convidado(a) a administrar Rede Demo');
    expect(mail.html).toContain('Aceitar convite');
    expect(mail.text).toContain(LINK);
  });

  it('neutral reauthentication: shows the code and no link', () => {
    const mail = renderNeutral({
      brand: demo,
      actionType: 'reauthentication',
      link: null,
      code: '482913',
    });
    expect(mail.subject).toBe('Seu código de confirmação — Rede Demo');
    expect(mail.html).toContain('482913');
    expect(mail.html).not.toContain('<a href');
    expect(mail.text).toContain('482913');
  });

  it('neutral password_changed_notification: informational, neither link nor code', () => {
    const mail = renderNeutral({
      brand: demo,
      actionType: 'password_changed_notification',
      link: null,
      code: null,
    });
    expect(mail.subject).toBe('Sua senha foi alterada — Rede Demo');
    expect(mail.html).not.toContain('<a href');
    expect(mail.html).not.toContain('letter-spacing');
  });

  it('neutral link types carry the CTA when a link is given', () => {
    const magic = renderNeutral({ brand: demo, actionType: 'magiclink', link: LINK, code: null });
    expect(magic.subject).toBe('Seu link de acesso — Rede Demo');
    expect(magic.html).toContain('>Entrar</a>');
    const signup = renderNeutral({ brand: demo, actionType: 'signup', link: LINK, code: null });
    expect(signup.subject).toBe('Confirme seu e-mail — Rede Demo');
    expect(signup.html).toContain('>Confirmar e-mail</a>');
    const change = renderNeutral({
      brand: demo,
      actionType: 'email_change',
      link: LINK,
      code: null,
    });
    expect(change.subject).toBe('Confirme seu novo e-mail — Rede Demo');
    expect(change.html).toContain('>Confirmar novo e-mail</a>');
  });

  it('neutral unknown type: generic subject', () => {
    const mail = renderNeutral({ brand: demo, actionType: 'made_up_type', link: null, code: null });
    expect(mail.subject).toBe('Aviso da sua conta — Rede Demo');
  });

  it('every template starts with the doctype and declares utf-8', () => {
    const mails = [
      renderRecovery({ brand: demo, link: LINK }),
      renderInvite({ brand: demo, link: LINK }),
      renderNeutral({ brand: demo, actionType: 'reauthentication', link: null, code: '1' }),
      renderNeutral({ brand: demo, actionType: 'made_up_type', link: null, code: null }),
    ];
    for (const mail of mails) {
      expect(mail.html.startsWith('<!doctype html>')).toBe(true);
      expect(mail.html).toContain('<meta charset="utf-8">');
      expect(mail.html).toContain('Enviado pela plataforma Rede Social');
    }
  });
});
