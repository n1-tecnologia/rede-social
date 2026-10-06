import { describe, expect, it } from 'vitest';
import {
  composeEventDescription,
  EMPTY_EVENT_EXTRAS,
  type EventExtras,
  hasEventExtras,
  splitEventDescription,
} from './event-extras';

/**
 * 2026-10-06 — the "Informações úteis" block stored at the end of the event's description. Claims:
 * the composed string is human-readable, parsing is an exact round trip, a description without the
 * block (or with something that only looks like one) stays plain text, and normalisation keeps the
 * format unambiguous.
 */

const FULL: EventExtras = {
  dressCode: 'Casual + scrub',
  included: ['Coffee break', 'Material de apoio'],
  bring: ['Documento com foto', 'Notebook'],
  certificate: { hours: 16 },
};

describe('composeEventDescription', () => {
  it('appends the readable block after a blank line, only the lines that have a value', () => {
    expect(composeEventDescription('Dois dias de imersão.', FULL)).toBe(
      [
        'Dois dias de imersão.',
        '',
        'Informações úteis',
        'Traje: Casual + scrub',
        'Incluso no ingresso: Coffee break · Material de apoio',
        'O que levar: Documento com foto · Notebook',
        'Certificado: 16 horas',
      ].join('\n'),
    );
    expect(
      composeEventDescription('Texto', { ...EMPTY_EVENT_EXTRAS, certificate: { hours: null } }),
    ).toBe('Texto\n\nInformações úteis\nCertificado: sim');
    expect(
      composeEventDescription('Texto', { ...EMPTY_EVENT_EXTRAS, certificate: { hours: 1 } }),
    ).toBe('Texto\n\nInformações úteis\nCertificado: 1 hora');
  });

  it('stores the text alone when there is nothing useful, and the block alone without text', () => {
    expect(composeEventDescription('  Só texto  ', EMPTY_EVENT_EXTRAS)).toBe('Só texto');
    expect(composeEventDescription('', { ...EMPTY_EVENT_EXTRAS, dressCode: 'Esporte fino' })).toBe(
      'Informações úteis\nTraje: Esporte fino',
    );
  });

  it('normalises: one line per value, middots out of items, empties dropped', () => {
    const stored = composeEventDescription('T', {
      dressCode: '  Casual\n  leve ',
      included: ['Café · bolo', '   ', 'Almoço'],
      bring: [],
      certificate: { hours: 0 },
    });
    expect(stored).toBe(
      'T\n\nInformações úteis\nTraje: Casual leve\nIncluso no ingresso: Café, bolo · Almoço\nCertificado: sim',
    );
  });
});

describe('splitEventDescription', () => {
  it('reads back exactly what was composed', () => {
    const stored = composeEventDescription('Dois dias de imersão.\n\nTurma de 120.', FULL);
    expect(splitEventDescription(stored)).toEqual({
      text: 'Dois dias de imersão.\n\nTurma de 120.',
      extras: FULL,
    });
    const blockOnly = composeEventDescription('', FULL);
    expect(splitEventDescription(blockOnly)).toEqual({ text: '', extras: FULL });
  });

  it('a description without the block is plain text', () => {
    expect(splitEventDescription('Encontro anual.')).toEqual({
      text: 'Encontro anual.',
      extras: null,
    });
    expect(splitEventDescription('')).toEqual({ text: '', extras: null });
  });

  it('something that only looks like the block stays text (no exact round trip)', () => {
    for (const stored of [
      'Texto\n\nInformações úteis\nComo chegar: de metrô',
      'Texto\n\nInformações úteis\nTraje: Casual\n',
      'Texto\n\nInformações úteis',
      'Texto\n\nInformações úteis\nCertificado: dezesseis horas',
      'Texto\n\nInformações úteis\nCertificado: 16 horas\nTraje: Casual',
    ]) {
      expect(splitEventDescription(stored)).toEqual({ text: stored, extras: null });
    }
  });

  it('hasEventExtras says whether there is anything to show', () => {
    expect(hasEventExtras(null)).toBe(false);
    expect(hasEventExtras(EMPTY_EVENT_EXTRAS)).toBe(false);
    expect(hasEventExtras(FULL)).toBe(true);
  });
});
