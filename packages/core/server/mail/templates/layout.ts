import {
  deriveBrandColors,
  hexColorSchema,
  LIGHT_BG,
  NAVY,
  NEUTRAL_BRAND,
} from '@rede-social/contracts';

/**
 * The one e-mail layout (D-38): table-based, inline styles, a 600 px card on the neutral light
 * background, the tenant's logo (as-is) or its display name as text in the header (D-26), a CTA in
 * the PERSISTED `colors.primary` / `colors.onPrimary` (no `color-mix` in e-mail, D-25), a plain-text
 * alternative and the small muted "Enviado pela plataforma Rede Social" footer. No Rede Social logo anywhere.
 *
 * Environment-free and dependency-light on purpose (RESEARCH rejected react-email): every
 * interpolation goes through `escapeHtml`, the logo is emitted only as an `<img>` whose URL passed
 * `safeHttpUrl`, and the hex values are validated before they reach a style attribute (T-02-23).
 * Phase 7 reuses this layout for notification mail.
 */

export type MailBrand = {
  displayName: string;
  logoUrl: string | null;
  primary: string;
  onPrimary: string;
};

export type RenderedMail = { subject: string; html: string; text: string };

// E-mail clients have no CSS variables: neutral hex constants, named here once. `LIGHT_BG`/`NAVY`
// are the same values the web shell uses (packages/contracts/src/branding.ts).
const TEXT = NAVY;
const MUTED = '#6b7280';
const CARD_BG = '#ffffff';
const BORDER = '#e5e7eb';
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FOOTER = 'Enviado pela plataforma Rede Social';
const COPY_HINT = 'Se o botão não funcionar, copie e cole este endereço no navegador:';

/** Escapes only `& < > " '` — accents stay literal UTF-8 (the D-38 encoding edge). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * `https:` only (or `http:` too when `allowHttp`, i.e. the local stack); anything else — `javascript:`,
 * `data:`, a relative path, garbage — is dropped so it can never land in `src`/`href`.
 */
export function safeHttpUrl(value: string | null | undefined, allowHttp: boolean): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.href;
  if (allowHttp && url.protocol === 'http:') return url.href;
  return null;
}

const NEUTRAL_COLORS = deriveBrandColors(NEUTRAL_BRAND);

/** Both hex values must validate; otherwise the neutral derived pair (never a raw string in a style). */
function ctaColors(brand: MailBrand): { background: string; color: string } {
  const primary = hexColorSchema.safeParse(brand.primary);
  const onPrimary = hexColorSchema.safeParse(brand.onPrimary);
  if (primary.success && onPrimary.success) {
    return { background: primary.data, color: onPrimary.data };
  }
  return { background: NEUTRAL_COLORS.primary, color: NEUTRAL_COLORS.onPrimary };
}

export type LayoutInput = {
  brand: MailBrand;
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  code?: string;
  closing?: string[];
};

function renderHeader(brand: MailBrand): string {
  const name = escapeHtml(brand.displayName);
  // Defence in depth: `toMailBrand` already filtered the URL by the deployment's scheme policy; the
  // layout still refuses anything that is not http(s), so no caller can ever emit `javascript:`.
  const logoUrl = safeHttpUrl(brand.logoUrl, true);
  if (logoUrl) {
    // D-26: the customer's asset as-is — never tinted, masked or re-encoded.
    return `<img src="${escapeHtml(logoUrl)}" alt="${name}" height="48" style="display:block;max-height:48px;max-width:220px;border:0">`;
  }
  return `<h1 style="margin:0;font-size:22px;line-height:28px;font-weight:700;color:${TEXT}">${name}</h1>`;
}

function renderParagraph(text: string, color = TEXT): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${color}">${escapeHtml(text)}</p>`;
}

export function renderLayout(input: LayoutInput): RenderedMail {
  const { brand, subject, heading, paragraphs, cta, code, closing = [] } = input;
  const colors = ctaColors(brand);

  const bodyParts: string[] = [];
  bodyParts.push(
    `<h2 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:700;color:${TEXT}">${escapeHtml(heading)}</h2>`,
  );
  for (const paragraph of paragraphs) bodyParts.push(renderParagraph(paragraph));
  if (cta) {
    const href = escapeHtml(cta.href);
    bodyParts.push(
      `<p style="margin:8px 0 24px"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:12px;font-weight:600;font-size:16px;line-height:24px;text-decoration:none;background:${colors.background};color:${colors.color}">${escapeHtml(cta.label)}</a></p>`,
    );
    bodyParts.push(renderParagraph(COPY_HINT, MUTED));
    bodyParts.push(
      `<p style="margin:0 0 16px;font-size:14px;line-height:20px;word-break:break-all"><a href="${href}" style="color:${TEXT}">${href}</a></p>`,
    );
  }
  if (code) {
    bodyParts.push(
      `<p style="margin:8px 0 24px;font-size:28px;line-height:36px;letter-spacing:8px;font-weight:700;color:${TEXT}">${escapeHtml(code)}</p>`,
    );
  }
  for (const line of closing) bodyParts.push(renderParagraph(line, MUTED));

  const html = [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${LIGHT_BG};font-family:${FONT}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LIGHT_BG}">`,
    '<tr><td align="center" style="padding:24px 12px">',
    // The primary colour also tops the card, so a mail without a CTA (notifications) is still branded.
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${CARD_BG};border:1px solid ${BORDER};border-top:4px solid ${colors.background};border-radius:16px">`,
    `<tr><td style="padding:24px 24px 8px">${renderHeader(brand)}</td></tr>`,
    `<tr><td style="padding:16px 24px 8px">${bodyParts.join('')}</td></tr>`,
    `<tr><td style="padding:8px 24px 24px"><p style="margin:0;font-size:12px;line-height:16px;color:${MUTED};text-align:center">${FOOTER}</p></td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');

  // Plain-text alternative: the brand name stands in for the header, then the same content.
  const textLines: string[] = [brand.displayName, '', heading, '', ...paragraphs];
  if (cta) textLines.push('', `${cta.label}: ${cta.href}`);
  if (code) textLines.push('', code);
  if (closing.length > 0) textLines.push('', ...closing);
  textLines.push('', `— ${FOOTER}`);

  return { subject, html, text: textLines.join('\n') };
}
