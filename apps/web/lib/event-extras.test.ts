import { describe, expect, it } from 'vitest';
import {
  composeEventDescription,
  EMPTY_EVENT_EXTRAS,
  type EventExtras,
  hasEventExtras,
  hasGoodToKnow,
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
  schedule: [],
};

/** A two-day programme, as the form stores it (sorted by day and time). */
const TWO_DAYS: EventExtras = {
  ...EMPTY_EVENT_EXTRAS,
  schedule: [
    { day: 1, time: '08:00', title: 'Credenciamento e boas-vindas' },
    { day: 1, time: '12:30', title: 'Almoço · networking' },
    { day: 2, time: '09:00', title: 'Abertura do segundo dia' },
  ],
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
      schedule: [],
    });
    expect(stored).toBe(
      'T\n\nInformações úteis\nTraje: Casual leve\nIncluso no ingresso: Café, bolo · Almoço\nCertificado: sim',
    );
  });

  it('the programme closes the block: one line per moment, the day named once any is past day 1', () => {
    expect(
      composeEventDescription('T', {
        ...EMPTY_EVENT_EXTRAS,
        certificate: { hours: 8 },
        schedule: [
          { day: 1, time: '09:00', title: 'Abertura' },
          { day: 1, time: '08:00', title: 'Credenciamento' },
        ],
      }),
    ).toBe(
      'T\n\nInformações úteis\nCertificado: 8 horas\nProgramação\n08:00 · Credenciamento\n09:00 · Abertura',
    );
    expect(composeEventDescription('', TWO_DAYS)).toBe(
      [
        'Informações úteis',
        'Programação',
        'Dia 1 · 08:00 · Credenciamento e boas-vindas',
        'Dia 1 · 12:30 · Almoço · networking',
        'Dia 2 · 09:00 · Abertura do segundo dia',
      ].join('\n'),
    );
  });

  it('drops a moment with no text, a time that is not HH:MM, a day out of range or a repeat', () => {
    const stored = composeEventDescription('T', {
      ...EMPTY_EVENT_EXTRAS,
      schedule: [
        { day: 1, time: '08:00', title: '  Café\n da manhã ' },
        { day: 1, time: '8:00', title: 'Sem zero' },
        { day: 1, time: '24:00', title: 'Meia-noite' },
        { day: 0, time: '10:00', title: 'Dia zero' },
        { day: 1, time: '11:00', title: '   ' },
        { day: 1, time: '08:00', title: 'Café da manhã' },
      ],
    });
    expect(stored).toBe('T\n\nInformações úteis\nProgramação\n08:00 · Café da manhã');
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

  it('reads the programme back, days and a middot inside the text included', () => {
    const withAll = { ...FULL, schedule: TWO_DAYS.schedule };
    const stored = composeEventDescription('Imersão.', withAll);
    expect(splitEventDescription(stored)).toEqual({ text: 'Imersão.', extras: withAll });
    const oneDay: EventExtras = {
      ...EMPTY_EVENT_EXTRAS,
      schedule: [{ day: 1, time: '19:00', title: 'Live de perguntas' }],
    };
    expect(splitEventDescription(composeEventDescription('', oneDay))).toEqual({
      text: '',
      extras: oneDay,
    });
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
      // The programme: a heading with nothing under it, a line that is not a moment, the day
      // named on some lines only, and moments out of order.
      'Texto\n\nInformações úteis\nProgramação',
      'Texto\n\nInformações úteis\nProgramação\nTraje: Casual',
      'Texto\n\nInformações úteis\nProgramação\n08:00 · A\nDia 2 · 09:00 · B',
      'Texto\n\nInformações úteis\nProgramação\n09:00 · B\n08:00 · A',
    ]) {
      expect(splitEventDescription(stored)).toEqual({ text: stored, extras: null });
    }
  });

  it('hasEventExtras says whether there is anything to show', () => {
    expect(hasEventExtras(null)).toBe(false);
    expect(hasEventExtras(EMPTY_EVENT_EXTRAS)).toBe(false);
    expect(hasEventExtras(FULL)).toBe(true);
    expect(hasEventExtras(TWO_DAYS)).toBe(true);
  });

  it('hasGoodToKnow leaves the programme to its own section', () => {
    expect(hasGoodToKnow(null)).toBe(false);
    expect(hasGoodToKnow(TWO_DAYS)).toBe(false);
    expect(hasGoodToKnow(FULL)).toBe(true);
  });
});
