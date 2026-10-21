import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PR-12, T-09.1-93, T-09.1-94 (09.1-20): the repository is public, a real delivery carries a buyer's
 * e-mail, tax id, phone, address, IP and card digits, and a real HMAC under a short token can be attacked
 * offline. Every file under the gateway fixtures folder must be free of personal-data-shaped values and of
 * anything that looks like a token or a signature. A fixture added carelessly later fails the build here
 * instead of reaching GitHub. The detectors are exercised on crafted bad samples first, so a broken
 * pattern cannot pass vacuously.
 *
 * The only e-mail domain allowed is the reserved `example.test`; the only IP addresses allowed are the
 * documentation ranges; a tax-id, phone or long digit run is allowed only when it is one repeated digit
 * (`00000000000`), which no real person owns. The fixtures carry no signature at all (the vendor signs in
 * the request URL, not in the body), and the tests derive theirs from a throwaway token.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/payments', import.meta.url));

/** Every file below the fixtures folder, recursively, as `[relative path, text]`. */
function filesBelow(dir: string, prefix = ''): [string, string][] {
  const found: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path, `${prefix}${entry.name}/`));
    else found.push([`${prefix}${entry.name}`, readFileSync(path, 'utf8')]);
  }
  return found;
}

const allSameDigit = (token: string) => {
  const digits = token.replace(/\D/g, '');
  return digits.length > 0 && /^(\d)\1*$/.test(digits);
};

const inCidr = (ip: string, prefix: string) => ip.startsWith(prefix);
const DOCUMENTATION_V4 = ['192.0.2.', '198.51.100.', '203.0.113.'];

/** Every violation found in `text`, each as a short label that never echoes the value (so a log stays clean). */
function violations(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
    if ((match[1] ?? '').toLowerCase() !== 'example.test') found.push('e-mail outside example.test');
  }

  const digitShapes: [string, RegExp][] = [
    ['formatted CPF', /(?<![\d.-])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d-])/g],
    ['formatted CNPJ', /(?<![\d.-])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![\d-])/g],
    ['international phone', /\+\d{8,15}(?!\d)/g],
    ['national phone', /(?<![\w.-])\(?\d{2}\)?\s?9?\d{4}-\d{4}(?![\d-])/g],
    ['11 or 14 digit tax id', /(?<![\w.-])\d{11}(?:\d{3})?(?![\w.-])/g],
    ['13 to 19 digit run', /(?<!\d)\d{13,19}(?!\d)/g],
  ];
  for (const [label, pattern] of digitShapes) {
    for (const match of text.matchAll(pattern)) {
      if (!allSameDigit(match[0])) found.push(label);
    }
  }

  for (const match of text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
    if (!DOCUMENTATION_V4.some((prefix) => inCidr(match[0], prefix))) {
      found.push('IPv4 outside the documentation ranges');
    }
  }

  for (const match of text.matchAll(/(?<![0-9a-z:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![0-9a-z:])/gi)) {
    const candidate = match[0].toLowerCase();
    const looksLikeV6 = candidate.includes('::') || candidate.split(':').length === 8;
    if (looksLikeV6 && !candidate.startsWith('2001:db8')) {
      found.push('IPv6 outside the documentation range');
    }
  }

  if (/"(?:signature|token|secret|webhook_token|authorization)"\s*:/i.test(text)) {
    found.push('a signature, token or secret key');
  }
  if (/[?&]signature=/i.test(text)) found.push('a signature query value');
  if (/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/i.test(text)) found.push('a 40 hex run (an HMAC-SHA1)');
  if (/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i.test(text)) found.push('a 64 hex run (an HMAC-SHA256)');

  return found;
}

describe('the detectors catch what they claim to (a guard that cannot fail is no guard)', () => {
  const bad: [string, string, string][] = [
    ['a personal e-mail', '"email": "maria.silva@gmail.com"', 'e-mail outside example.test'],
    ['an example.com e-mail', '"email": "a@example.com"', 'e-mail outside example.test'],
    ['a formatted CPF', '"CPF": "123.456.789-09"', 'formatted CPF'],
    ['a formatted CNPJ', '"cnpj": "12.345.678/0001-95"', 'formatted CNPJ'],
    ['a bare CPF', '"CPF": "32229436605"', '11 or 14 digit tax id'],
    ['a bare CNPJ', '"cnpj": "10596098266798"', '11 or 14 digit tax id'],
    ['an international mobile', '"mobile": "+5511987654321"', 'international phone'],
    ['a national mobile', '"mobile": "(11) 98765-4321"', 'national phone'],
    ['a public IPv4', '"ip": "93.184.216.34"', 'IPv4 outside the documentation ranges'],
    [
      'a full IPv6',
      '"ip": "afa1:894b:c015:8ce5:d6:376a:249f:cd69"',
      'IPv6 outside the documentation range',
    ],
    ['a compressed IPv6', '"ip": "2606:4700::1111"', 'IPv6 outside the documentation range'],
    ['a card number', '"card": "4909160000006650"', '13 to 19 digit run'],
    ['a signature key', '{"signature": "abc"}', 'a signature, token or secret key'],
    ['a signature query', 'https://x.test/hook?signature=abc', 'a signature query value'],
    [
      'an HMAC-SHA1 hex',
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      'a 40 hex run (an HMAC-SHA1)',
    ],
  ];
  for (const [name, sample, label] of bad) {
    it(`flags ${name}`, () => {
      expect(violations(sample)).toContain(label);
    });
  }

  const good: [string, string][] = [
    ['the reserved e-mail domain', '"email": "comprador.teste@example.test"'],
    ['a zeroed CPF', '"CPF": "000.000.000-00"'],
    ['a zeroed bare CPF and CNPJ', '"CPF": "00000000000", "cnpj": "00000000000000"'],
    ['a zeroed mobile', '"mobile": "+00000000000"'],
    ['a documentation IPv4', '"ip": "203.0.113.7"'],
    ['a documentation IPv6', '"ip": "2001:db8::1"'],
    ['a timestamp with seconds and zone', '"start_date": "2026-10-25T12:54:20.463Z"'],
    ['a synthetic uuid', '"order_id": "00000000-0000-4000-8000-5afe01000001"'],
    ['an ISO date and a short number', '"created_at": "2026-10-21 12:51", "charge_amount": 7602'],
  ];
  for (const [name, sample] of good) {
    it(`accepts ${name}`, () => {
      expect(violations(sample)).toEqual([]);
    });
  }
});

describe('every committed gateway fixture is free of personal data, tokens and signatures', () => {
  const files = filesBelow(FIXTURES);

  it('reads the real folder (an unreadable folder cannot pass)', () => {
    const names = files.map(([name]) => name);
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain('kiwify/CAPTURE.md');
    expect(names.filter((name) => name.endsWith('.json')).length).toBeGreaterThanOrEqual(14);
  });

  for (const [name, text] of files) {
    it(`${name} holds no personal-data-shaped value, token or signature`, () => {
      expect(violations(text)).toEqual([]);
    });
  }
});
