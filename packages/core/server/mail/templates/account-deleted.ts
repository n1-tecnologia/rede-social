import { type MailBrand, type RenderedMail, renderLayout } from './layout';

/**
 * The completion e-mail of "Excluir minha conta" (13-13, D-609, NATIVE-21, Apple 5.1.1(v): the person is told the
 * deletion finished). It carries the tenant name, the date and ONE sentence that the personal data was erased,
 * and nothing else (T-13-31): no address, no member name, no link, no code.
 *
 * Every interpolation goes through the layout's `escapeHtml`, so a tenant called `Associação São João & Cia <b>`
 * renders as text; the accents stay literal UTF-8 and the transport's MIME layer encodes the subject (RFC 2047),
 * which is why the subject here only has its line breaks removed (header injection). The date is formatted by the
 * caller in the TENANT's time zone (`formatDeletionDate`).
 */

/** Line breaks and other control characters out of a header value; whitespace collapsed. */
function oneLine(value: string): string {
  const kept = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
    return control ? ' ' : char;
  });
  return kept.join('').replace(/\s+/g, ' ').trim();
}

/**
 * The date as pt-BR long text in `timeZone` ("5 de novembro de 2026"). An unknown zone falls back to UTC rather
 * than throwing: the zone column has no CHECK, and a mail must not fail over a date format.
 */
export function formatDeletionDate(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(date);
  }
}

export function renderAccountDeleted(input: {
  brand: MailBrand;
  /** Already formatted (`formatDeletionDate`). */
  date: string;
}): RenderedMail {
  const { brand, date } = input;
  const tenant = oneLine(brand.displayName);
  return renderLayout({
    brand,
    subject: `Sua conta em ${tenant} foi excluída`,
    heading: 'Conta excluída',
    paragraphs: [`Em ${date}, os seus dados pessoais foram apagados de ${brand.displayName}.`],
  });
}
