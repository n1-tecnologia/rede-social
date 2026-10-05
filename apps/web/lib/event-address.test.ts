import { EVENT_MAX_ADDRESS } from '@rede-social/module-events/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADDRESS_CAPS,
  type AddressParts,
  addressIssues,
  addressMapsQuery,
  addressOneLine,
  cepDigits,
  composeEventAddress,
  EMPTY_ADDRESS_PARTS,
  extractCep,
  formatCep,
  isUf,
  parseEventAddress,
  UFS,
} from './event-address';

/**
 * PDF item #10: the address parts stored in the one `address` string. The claims:
 *
 *  - every composed string parses back to its parts (an exact round trip), through the awkward
 *    cases: no complemento, no bairro, "sem número" in any spelling, a rua or a bairro that holds
 *    `, ` or ` - `, a número with a comma, a lowercase UF, accents;
 *  - the worst case under `ADDRESS_CAPS` fits `EVENT_MAX_ADDRESS`;
 *  - legacy free text is `null`: the seed's "Rua das Flores, 100", the e2e four-line address, three
 *    lines without the CEP line, an unknown UF, and anything the format would write differently;
 *  - the maps query and the calendar line, and the CEP helpers.
 */

const parts = (overrides: Partial<AddressParts> = {}): AddressParts => ({
  ...EMPTY_ADDRESS_PARTS,
  cep: '01310200',
  street: 'Avenida Paulista',
  number: '1578',
  complement: 'Sala 12, bloco B',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
  ...overrides,
});

describe('composeEventAddress / parseEventAddress', () => {
  it('1. composes the canonical block, one group per line, CEP last', () => {
    expect(composeEventAddress(parts())).toBe(
      'Avenida Paulista, 1578\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200',
    );
  });

  it.each<[string, Partial<AddressParts>, string]>([
    [
      'no complemento: three lines',
      { complement: '' },
      'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\nCEP 01310-200',
    ],
    [
      'no bairro: the place line is the cidade alone',
      { district: '' },
      'Avenida Paulista, 1578\nSala 12, bloco B\nSão Paulo - SP\nCEP 01310-200',
    ],
    [
      'a rua that holds a comma',
      { street: 'Rodovia BR-116, km 23', number: '100' },
      'Rodovia BR-116, km 23, 100\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200',
    ],
    [
      'a bairro that holds ", " and " - "',
      { district: 'Jardim América, Setor 2 - Leste' },
      'Avenida Paulista, 1578\nSala 12, bloco B\nJardim América, Setor 2 - Leste, São Paulo - SP\nCEP 01310-200',
    ],
    [
      'a cidade that holds " - "',
      { city: 'Embu - Guaçu', district: '' },
      'Avenida Paulista, 1578\nSala 12, bloco B\nEmbu - Guaçu - SP\nCEP 01310-200',
    ],
  ])('2. round trip, %s', (_, overrides, stored) => {
    const value = parts(overrides);
    expect(composeEventAddress(value)).toBe(stored);
    expect(parseEventAddress(stored)).toEqual(value);
  });

  it.each([[''], ['   '], ['s/n'], ['S/N'], ['sn'], ['S/n.']])(
    '3. número "%s" is stored "s/n" and reads back empty',
    (number) => {
      const stored = composeEventAddress(parts({ number }));
      expect(stored.split('\n')[0]).toBe('Avenida Paulista, s/n');
      expect(parseEventAddress(stored)?.number).toBe('');
      expect(composeEventAddress(parseEventAddress(stored) as AddressParts)).toBe(stored);
    },
  );

  it('4. whitespace collapses, the número loses ", ", the cidade its commas, the UF goes up', () => {
    const stored = composeEventAddress(
      parts({
        street: '  Avenida\nPaulista ',
        number: 'km 23, 5',
        complement: ' Sala 12,\tbloco B ',
        city: 'São, Paulo',
        state: 'sp',
        cep: '01310-200',
      }),
    );
    expect(stored).toBe(
      'Avenida Paulista, km 23,5\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200',
    );
    expect(parseEventAddress(stored)).toEqual(
      parts({ number: 'km 23,5', complement: 'Sala 12, bloco B' }),
    );
  });

  it('5. the worst case under the caps fits the contract’s address cap', () => {
    const full = (size: number, letter: string) => letter.repeat(size);
    const worst = composeEventAddress({
      cep: '99999999',
      street: full(ADDRESS_CAPS.street, 'r'),
      number: full(ADDRESS_CAPS.number, '9'),
      complement: full(ADDRESS_CAPS.complement, 'c'),
      district: full(ADDRESS_CAPS.district, 'b'),
      city: full(ADDRESS_CAPS.city, 'á'),
      state: 'TO',
    });
    expect(worst).toHaveLength(295);
    expect(worst.length).toBeLessThanOrEqual(EVENT_MAX_ADDRESS);
    expect(parseEventAddress(worst)).not.toBeNull();
  });

  it.each([
    ['the seed and e2e one-liner', 'Rua das Flores, 100'],
    ['the e2e four-line address', 'Rua das Flores, 100\nBloco B, sala 12\nCentro\nSao Paulo - SP'],
    ['three lines without the CEP line', 'Rua das Flores, 100\nCentro\nSão Paulo - SP'],
    ['an unknown UF', 'Rua das Flores, 100\nCentro, São Paulo - XX\nCEP 01310-200'],
    ['a lowercase UF', 'Rua das Flores, 100\nCentro, São Paulo - sp\nCEP 01310-200'],
    ['no número separator', 'Rua das Flores 100\nCentro, São Paulo - SP\nCEP 01310-200'],
    ['an empty rua', ', 100\nCentro, São Paulo - SP\nCEP 01310-200'],
    ['a CEP without its hyphen', 'Rua das Flores, 100\nCentro, São Paulo - SP\nCEP 01310200'],
    ['"S/N" the format would write "s/n"', 'Rua das Flores, S/N\nSão Paulo - SP\nCEP 01310-200'],
    ['a double space', 'Rua das  Flores, 100\nSão Paulo - SP\nCEP 01310-200'],
    ['an empty complemento line', 'Rua das Flores, 100\n\nSão Paulo - SP\nCEP 01310-200'],
    ['CRLF line ends', 'Rua das Flores, 100\r\nSão Paulo - SP\r\nCEP 01310-200'],
    ['five lines', 'Rua, 1\nA\nB\nSão Paulo - SP\nCEP 01310-200'],
    ['nothing', ''],
  ])('6. legacy free text is null: %s', (_, value) => {
    expect(parseEventAddress(value)).toBeNull();
  });
});

describe('addressIssues', () => {
  it('7. names every missing or invalid required part; número, complemento and bairro are optional', () => {
    expect(addressIssues(EMPTY_ADDRESS_PARTS)).toEqual(['cep', 'street', 'city', 'state']);
    expect(addressIssues(parts({ number: '', complement: '', district: '' }))).toEqual([]);
    expect(addressIssues(parts({ cep: '0131020' }))).toEqual(['cep']);
    expect(addressIssues(parts({ street: '   ' }))).toEqual(['street']);
    expect(addressIssues(parts({ city: ' , ' }))).toEqual(['city']);
    expect(addressIssues(parts({ state: 'XX' }))).toEqual(['state']);
    expect(addressIssues(parts({ state: 'sp' }))).toEqual([]);
  });
});

describe('addressMapsQuery / addressOneLine', () => {
  it('8. the maps query is Google’s Brazilian order, without the complemento', () => {
    expect(addressMapsQuery(parts())).toBe(
      'Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200',
    );
    expect(addressMapsQuery(parts({ number: '', district: '' }))).toBe(
      'Avenida Paulista, s/n, São Paulo - SP, 01310-200',
    );
  });

  it('9. the calendar line carries the complemento after the número, on one line', () => {
    expect(addressOneLine(parts())).toBe(
      'Avenida Paulista, 1578, Sala 12, bloco B - Bela Vista, São Paulo - SP, 01310-200',
    );
    expect(addressOneLine(parts({ complement: '' }))).toBe(addressMapsQuery(parts()));
  });
});

describe('the CEP helpers', () => {
  it('10. cepDigits keeps at most 8 digits; formatCep adds the hyphen with the 6th', () => {
    expect(cepDigits('01.310-200')).toBe('01310200');
    expect(cepDigits('013102009')).toBe('01310200');
    expect(cepDigits('abc')).toBe('');
    expect(formatCep('01310')).toBe('01310');
    expect(formatCep('013102')).toBe('01310-2');
    expect(formatCep('01310200')).toBe('01310-200');
  });

  it('11. extractCep finds a CEP inside free text, in any spelling, and nothing else', () => {
    expect(extractCep('Av. Paulista, 1578 - Bela Vista, CEP 01310-200')).toBe('01310200');
    expect(extractCep('Av. Paulista, 1578, 01310200, São Paulo')).toBe('01310200');
    expect(extractCep('Av. Paulista, 1578, 01.310-200')).toBe('01310200');
    expect(extractCep('Rua das Flores, 100')).toBe('');
    expect(extractCep('Fone (11) 98765-4321')).toBe('');
  });

  it('12. the 27 UFs, and nothing else', () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    expect(isUf('DF')).toBe(true);
    expect(isUf('sp')).toBe(false);
    expect(isUf('XX')).toBe(false);
  });
});
