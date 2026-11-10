import { describe, expect, it } from 'vitest';
import {
  BRAZILIAN_UF_CODES,
  canonicalizeProfessionalId,
  cnpjCheckDigits,
  formatProfessionalId,
  isProfessionalIdText,
  layoutProfessionalId,
  PROFESSIONAL_ID_EXAMPLES,
  PROFESSIONAL_ID_FORMATS,
  PROFESSIONAL_ID_MAX_INPUT,
  type ProfessionalIdFormat,
} from '../src/professional-id';

/**
 * Quick 261110-ij7 (D-591): the professional registry / CNPJ mask engine. The layout half is what the web
 * runs on every keystroke; the judge half is what `parseAnswer` runs (T-12-05, one judge).
 */

const layout = (format: ProfessionalIdFormat, raw: string) => layoutProfessionalId(format, raw);
const judge = (format: ProfessionalIdFormat, raw: string) =>
  canonicalizeProfessionalId(format, raw);

describe('the format list, the UF list and the examples', () => {
  it('lists the eight formats in the documented order', () => {
    expect(PROFESSIONAL_ID_FORMATS).toEqual([
      'cro',
      'crm',
      'crbm',
      'crf',
      'coren',
      'crefito',
      'crbio',
      'cnpj',
    ]);
  });

  it('lists the 27 real UF codes, upper case and unique', () => {
    expect(BRAZILIAN_UF_CODES).toHaveLength(27);
    expect(new Set(BRAZILIAN_UF_CODES).size).toBe(27);
    for (const uf of BRAZILIAN_UF_CODES) expect(uf).toMatch(/^[A-Z]{2}$/);
    expect([...BRAZILIAN_UF_CODES].sort()).toEqual(
      'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'
        .split(' ')
        .sort(),
    );
  });

  it('keeps the input bound at 64 UTF-16 units', () => {
    expect(PROFESSIONAL_ID_MAX_INPUT).toBe(64);
  });

  it('every example passes its own judge and equals its canonical text', () => {
    expect(PROFESSIONAL_ID_EXAMPLES).toEqual({
      cro: 'CRO-SP 123456',
      crm: 'CRM-SP 123456',
      crbm: 'CRBM-1 12345',
      crf: 'CRF-SP 123456',
      coren: 'COREN-SP 123456',
      crefito: 'CREFITO-3/123456-F',
      crbio: '003566/01-D',
      cnpj: '12.345.678/0001-95',
    });
    for (const format of PROFESSIONAL_ID_FORMATS) {
      const example = PROFESSIONAL_ID_EXAMPLES[format];
      expect(judge(format, example), format).toBe(example);
    }
  });
});

describe('layoutProfessionalId: the text, consumed and total', () => {
  const vectors: [ProfessionalIdFormat, string, string, number?, number?][] = [
    ['cro', 'S', 'CRO-S'],
    ['cro', 'sp', 'CRO-SP'],
    ['cro', 'SP123456', 'CRO-SP 123456'],
    ['cro', 'CRO-SP 123456', 'CRO-SP 123456'],
    ['cro', 'cro sp 12', 'CRO-SP 12'],
    ['cro', '1SP12', 'CRO-SP 12', 4, 5],
    ['cro', 'SP1234567890', 'CRO-SP 123456789', 11, 12],
    ['cro', '123', '', 0, 3],
    ['crm', 'crm-sp 123456', 'CRM-SP 123456'],
    ['crbm', '1', 'CRBM-1'],
    ['crbm', '112345', 'CRBM-1 12345'],
    ['crefito', '3', 'CREFITO-3'],
    ['crefito', '3123456', 'CREFITO-3/123456-F'],
    ['crefito', '1', 'CREFITO-1'],
    ['crefito', '12', 'CREFITO-12'],
    ['crefito', '123', 'CREFITO-12/3-F'],
    ['crefito', '1/', 'CREFITO-1/'],
    ['crefito', '1/23', 'CREFITO-1/23-F'],
    ['crefito', 'CREFITO-3/123456-F', 'CREFITO-3/123456-F'],
    ['crefito', 'CREFITO-20/1-F', 'CREFITO-20/1-F'],
    ['crefito', 'CREFITO-123/4', 'CREFITO-12/4-F', 3, 4],
    ['crbio', '003566', '003566'],
    ['crbio', '00356601D', '003566/01-D'],
    ['crbio', 'CRBio 003566/01-D', '003566/01-D'],
    ['cnpj', '12', '12'],
    ['cnpj', '12ABC', '12.ABC'],
    ['cnpj', '12345678000195', '12.345.678/0001-95'],
    ['cnpj', '1234567800019A', '12.345.678/0001-9', 13, 14],
  ];

  for (const [format, raw, text, consumed, total] of vectors) {
    it(`${format} ${JSON.stringify(raw)} gives ${JSON.stringify(text)}`, () => {
      const result = layout(format, raw);
      expect(result.text).toBe(text);
      expect(formatProfessionalId(format, raw)).toBe(text);
      if (consumed !== undefined) expect(result.consumed).toBe(consumed);
      if (total !== undefined) expect(result.total).toBe(total);
    });
  }

  it('is idempotent: formatting a result returns it (every vector)', () => {
    for (const [format, raw] of vectors) {
      const once = formatProfessionalId(format, raw);
      expect(formatProfessionalId(format, once), `${format} ${raw}`).toBe(once);
    }
  });

  it('does not let a German sharp s or other non-ASCII letters become mask letters', () => {
    expect(formatProfessionalId('cro', 'ßß 12')).toBe('');
    expect(formatProfessionalId('cnpj', 'ß1')).toBe('1');
  });

  it('a typed digit in the UF slot is dropped, a typed letter in the number slot is dropped', () => {
    expect(layout('cro', 'SP12A3').text).toBe('CRO-SP 123');
    expect(layout('crbio', '0A').text).toBe('0');
  });

  it('the caret map: the index in the text just after each placed character', () => {
    const cro = layout('cro', 'SP12');
    expect(cro.text).toBe('CRO-SP 12');
    expect(cro.ends).toEqual([5, 6, 8, 9]);
    const crefito = layout('crefito', '3123');
    expect(crefito.text).toBe('CREFITO-3/123-F');
    expect(crefito.ends).toEqual([9, 11, 12, 13]);
    const cnpj = layout('cnpj', '12ABC');
    expect(cnpj.text).toBe('12.ABC');
    expect(cnpj.ends).toEqual([1, 2, 4, 5, 6]);
  });

  it('a 100000-character raw returns without throwing and reads only the first 64 units', () => {
    const huge = `SP${'1'.repeat(100000)}`;
    const started = Date.now();
    const result = layout('cro', huge);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.text).toBe('CRO-SP 111111111');
    for (const format of PROFESSIONAL_ID_FORMATS) {
      expect(() => layout(format, 'A/1'.repeat(40000))).not.toThrow();
    }
  });
});

describe('canonicalizeProfessionalId: the judge', () => {
  it('cro accepts masked and unmasked text', () => {
    expect(judge('cro', 'cro-sp 123456')).toBe('CRO-SP 123456');
    expect(judge('cro', 'SP123456')).toBe('CRO-SP 123456');
    expect(judge('cro', 'CRO-RJ 1')).toBe('CRO-RJ 1');
    expect(judge('cro', 'CRO-SP 000123')).toBe('CRO-SP 000123');
  });

  it('cro refuses a non-UF, no number, ten digits, a dropped digit and another council', () => {
    expect(judge('cro', 'CRO-XX 1')).toBeNull();
    expect(judge('cro', 'CRO-SP')).toBeNull();
    expect(judge('cro', 'CRO-SP 1234567890')).toBeNull();
    expect(judge('cro', '1SP12')).toBeNull();
    expect(judge('cro', 'CRM-SP 123456')).toBeNull();
    expect(judge('cro', '')).toBeNull();
  });

  it('crm accepts its example and a second case, refuses the others', () => {
    expect(judge('crm', 'CRM-SP 123456')).toBe('CRM-SP 123456');
    expect(judge('crm', 'crm-mg 9')).toBe('CRM-MG 9');
    expect(judge('crm', 'CRO-SP 123456')).toBeNull();
    expect(judge('crm', 'CRM-ZZ 1')).toBeNull();
  });

  it('crf accepts its example and a second case, refuses the others', () => {
    expect(judge('crf', 'CRF-SP 123456')).toBe('CRF-SP 123456');
    expect(judge('crf', 'crf-ba 77')).toBe('CRF-BA 77');
    expect(judge('crf', 'CRM-SP 123456')).toBeNull();
    expect(judge('crf', 'CRF-SP')).toBeNull();
  });

  it('coren accepts its example and a second case, refuses the others', () => {
    expect(judge('coren', 'COREN-SP 123456')).toBe('COREN-SP 123456');
    expect(judge('coren', 'COREN-RJ 12')).toBe('COREN-RJ 12');
    expect(judge('coren', 'CRM-SP 123456')).toBeNull();
    expect(judge('coren', 'COREN-QQ 12')).toBeNull();
  });

  it('crbm takes one region digit 1 to 9 and a number', () => {
    expect(judge('crbm', 'CRBM-1 12345')).toBe('CRBM-1 12345');
    expect(judge('crbm', '1 12345')).toBe('CRBM-1 12345');
    expect(judge('crbm', 'CRBM-5 9')).toBe('CRBM-5 9');
    expect(judge('crbm', 'CRBM-0 123')).toBeNull();
    expect(judge('crbm', 'CRBM-1')).toBeNull();
    expect(judge('crbm', 'CRBM-1 1234567890')).toBeNull();
  });

  it('crefito takes a region 1 to 19, a number and the fixed -F suffix', () => {
    expect(judge('crefito', '3123456')).toBe('CREFITO-3/123456-F');
    expect(judge('crefito', 'CREFITO-17/123-F')).toBe('CREFITO-17/123-F');
    expect(judge('crefito', 'CREFITO-3/123456')).toBe('CREFITO-3/123456-F');
    expect(judge('crefito', 'CREFITO-19/1-F')).toBe('CREFITO-19/1-F');
    expect(judge('crefito', 'CREFITO-1/5')).toBe('CREFITO-1/5-F');
    expect(judge('crefito', 'CREFITO-20/1-F')).toBeNull();
    expect(judge('crefito', 'CREFITO-0/5')).toBeNull();
    expect(judge('crefito', 'CREFITO-31/123-F')).toBeNull();
    expect(judge('crefito', 'CREFITO-123/4')).toBeNull();
    expect(judge('crefito', 'CREFITO-3')).toBeNull();
    expect(judge('crefito', 'CREFITO-3/')).toBeNull();
    expect(judge('crefito', 'CREFITO-3/12-T')).toBeNull();
    expect(judge('crefito', 'CREFITO-3/12-TO')).toBeNull();
  });

  it('crbio takes exactly 6 digits, a slash, 2 digits, a dash and one letter', () => {
    expect(judge('crbio', '003566/01-D')).toBe('003566/01-D');
    expect(judge('crbio', '00356601d')).toBe('003566/01-D');
    expect(judge('crbio', 'CRBio 003566/01-D')).toBe('003566/01-D');
    expect(judge('crbio', '3566/01-D')).toBeNull();
    expect(judge('crbio', '003566/01')).toBeNull();
    expect(judge('crbio', '003566/01-1')).toBeNull();
    expect(judge('crbio', '003566/011-D')).toBeNull();
  });

  it('cnpj accepts the valid traditional and alphanumeric numbers in three input styles', () => {
    const valid = [
      '11.222.333/0001-81',
      '12.345.678/0001-95',
      '12.ABC.345/01DE-35',
      'AB.1CD.2EF/3GH4-90',
      'A0.B1C.2D3/E4F5-08',
      '00.000.000/0001-91',
    ];
    for (const masked of valid) {
      const raw = masked.replace(/[./-]/g, '');
      expect(judge('cnpj', masked), masked).toBe(masked);
      expect(judge('cnpj', raw), raw).toBe(masked);
      expect(judge('cnpj', masked.toLowerCase()), masked.toLowerCase()).toBe(masked);
    }
  });

  it('cnpj refuses wrong digits, identical characters, a letter in a check slot and 13 characters', () => {
    expect(judge('cnpj', '12.345.678/0001-90')).toBeNull();
    expect(judge('cnpj', '11.222.333/0001-82')).toBeNull();
    expect(judge('cnpj', '00.000.000/0000-00')).toBeNull();
    expect(judge('cnpj', '12.ABC.345/01DE-3A')).toBeNull();
    expect(judge('cnpj', '12.345.678/0001-9')).toBeNull();
    expect(judge('cnpj', '')).toBeNull();
  });

  it('refuses any input longer than 64 units, even when it would otherwise be valid', () => {
    expect(judge('cro', `CRO-SP 123456${' '.repeat(60)}`)).toBeNull();
    expect(judge('cnpj', `12.345.678/0001-95${' '.repeat(60)}`)).toBeNull();
    expect(judge('cro', `CRO-SP 123456${' '.repeat(40)}`)).toBe('CRO-SP 123456');
  });

  it('canonical text is idempotent and stable under the judge', () => {
    for (const format of PROFESSIONAL_ID_FORMATS) {
      const once = judge(format, PROFESSIONAL_ID_EXAMPLES[format].toLowerCase());
      expect(once, format).toBe(PROFESSIONAL_ID_EXAMPLES[format]);
      expect(judge(format, once as string)).toBe(once);
    }
  });

  it('isProfessionalIdText is true for a canonical text of any format and false otherwise', () => {
    for (const format of PROFESSIONAL_ID_FORMATS) {
      expect(isProfessionalIdText(PROFESSIONAL_ID_EXAMPLES[format]), format).toBe(true);
    }
    expect(isProfessionalIdText('cro-sp 123456')).toBe(false);
    expect(isProfessionalIdText('')).toBe(false);
    expect(isProfessionalIdText('CRO-XX 1')).toBe(false);
    expect(isProfessionalIdText('12.345.678/0001-90')).toBe(false);
  });
});

describe('cnpjCheckDigits', () => {
  it('returns the verified digits for the seven bases', () => {
    expect(cnpjCheckDigits('112223330001')).toBe('81');
    expect(cnpjCheckDigits('123456780001')).toBe('95');
    expect(cnpjCheckDigits('12ABC34501DE')).toBe('35');
    expect(cnpjCheckDigits('AB1CD2EF3GH4')).toBe('90');
    expect(cnpjCheckDigits('A0B1C2D3E4F5')).toBe('08');
    expect(cnpjCheckDigits('000000000001')).toBe('91');
    expect(cnpjCheckDigits('112223330002')).toBe('62');
  });

  it('applies the weights 5..2,9..2 then 6..2,9..2 with value = ASCII code minus 48', () => {
    // 11.222.333/0001-81 by hand: values 1 1 2 2 2 3 3 3 0 0 0 1
    const values = [1, 1, 2, 2, 2, 3, 3, 3, 0, 0, 0, 1];
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum1 = values.reduce((acc, v, i) => acc + v * (w1[i] as number), 0);
    const r1 = sum1 % 11;
    const d1 = r1 < 2 ? 0 : 11 - r1;
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum2 = [...values, d1].reduce((acc, v, i) => acc + v * (w2[i] as number), 0);
    const r2 = sum2 % 11;
    const d2 = r2 < 2 ? 0 : 11 - r2;
    expect(`${d1}${d2}`).toBe('81');
    expect(cnpjCheckDigits('112223330001')).toBe(`${d1}${d2}`);
    // A is 65 - 48 = 17: the letter value is its ASCII distance from '0'.
    expect('A'.charCodeAt(0) - 48).toBe(17);
    expect('Z'.charCodeAt(0) - 48).toBe(42);
  });

  it('a flipped check digit fails the judge, traditional and alphanumeric alike', () => {
    expect(judge('cnpj', '12.345.678/0001-95')).not.toBeNull();
    expect(judge('cnpj', '12.345.678/0001-94')).toBeNull();
    expect(judge('cnpj', '12.345.678/0001-85')).toBeNull();
    expect(judge('cnpj', '12.ABC.345/01DE-35')).not.toBeNull();
    expect(judge('cnpj', '12.ABC.345/01DE-36')).toBeNull();
    expect(judge('cnpj', '12.ABC.345/01DE-25')).toBeNull();
  });

  it('the example Igor wrote, ...0001-90, fails; with 95 it passes', () => {
    expect(judge('cnpj', '12.345.678/0001-90')).toBeNull();
    expect(judge('cnpj', '12.345.678/0001-95')).toBe('12.345.678/0001-95');
  });
});
