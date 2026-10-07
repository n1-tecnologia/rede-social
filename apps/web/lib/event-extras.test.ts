import { describe, expect, it } from 'vitest';
import {
  composeEventDescription,
  EMPTY_EVENT_EXTRAS,
  type EventExtras,
  EXTRAS_CAPS,
  effectiveSchedule,
  hasEventExtras,
  hasGoodToKnow,
  splitEventDescription,
} from './event-extras';

/**
 * 2026-10-06 — the "Informações úteis" block stored at the end of the event's description. Claims:
 * the composed string is human-readable, parsing is an exact round trip, a description without the
 * block (or with something that only looks like one) stays plain text, and normalisation keeps the
 * format unambiguous.
 *
 * 2026-10-07 (quick 261007-n1g) — the programme lives in `events.schedule` now: `compose` no longer
 * writes it, while `split` still READS the old "Programação" lines (a legacy, read-only format kept
 * for events written before the column). The legacy fixtures below are therefore string LITERALS:
 * the compose function can no longer produce them.
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

  it('never writes the programme: the schedule has its own field (events.schedule)', () => {
    // With a certificate, only the certificate line is under the heading.
    expect(
      composeEventDescription('T', {
        ...EMPTY_EVENT_EXTRAS,
        certificate: { hours: 8 },
        schedule: [
          { day: 1, time: '09:00', title: 'Abertura' },
          { day: 1, time: '08:00', title: 'Credenciamento' },
        ],
      }),
    ).toBe('T\n\nInformações úteis\nCertificado: 8 horas');
    // With only a schedule there is no block at all: the trimmed text alone.
    expect(composeEventDescription('  Só texto ', TWO_DAYS)).toBe('Só texto');
    expect(composeEventDescription('', TWO_DAYS)).toBe('');
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

  it('still reads the LEGACY programme, days and a middot inside the text included', () => {
    // The storage format of events written before events.schedule, as literals.
    const legacy = [
      'Imersão.',
      '',
      'Informações úteis',
      'Traje: Casual + scrub',
      'Incluso no ingresso: Coffee break · Material de apoio',
      'O que levar: Documento com foto · Notebook',
      'Certificado: 16 horas',
      'Programação',
      'Dia 1 · 08:00 · Credenciamento e boas-vindas',
      'Dia 1 · 12:30 · Almoço · networking',
      'Dia 2 · 09:00 · Abertura do segundo dia',
    ].join('\n');
    expect(splitEventDescription(legacy)).toEqual({
      text: 'Imersão.',
      extras: { ...FULL, schedule: TWO_DAYS.schedule },
    });
    const oneDay = 'Informações úteis\nProgramação\n19:00 · Live de perguntas';
    expect(splitEventDescription(oneDay)).toEqual({
      text: '',
      extras: {
        ...EMPTY_EVENT_EXTRAS,
        schedule: [{ day: 1, time: '19:00', title: 'Live de perguntas' }],
      },
    });
  });

  it('a legacy block re-composed by the new compose loses its programme and keeps the rest', () => {
    const legacy = 'Texto.\n\nInformações úteis\nTraje: Casual\nProgramação\n08:00 · A\n09:00 · B';
    const read = splitEventDescription(legacy);
    expect(read.extras?.schedule).toHaveLength(2);
    expect(
      composeEventDescription(read.text, { ...EMPTY_EVENT_EXTRAS, ...read.extras, schedule: [] }),
    ).toBe('Texto.\n\nInformações úteis\nTraje: Casual');
    // With nothing else under the heading the block disappears altogether.
    const only = splitEventDescription('Texto.\n\nInformações úteis\nProgramação\n08:00 · A');
    expect(
      composeEventDescription(only.text, { ...EMPTY_EVENT_EXTRAS, ...only.extras, schedule: [] }),
    ).toBe('Texto.');
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

describe('effectiveSchedule', () => {
  const stored = [
    { day: 2, time: '09:00', title: 'Abertura' },
    { day: 1, time: '08:00', title: 'Credenciamento' },
  ];
  const legacy = [{ day: 1, time: '19:00', title: 'Jantar' }];

  it('the stored list wins when it has items, normalised', () => {
    expect(effectiveSchedule(stored, legacy)).toEqual([
      { day: 1, time: '08:00', title: 'Credenciamento' },
      { day: 2, time: '09:00', title: 'Abertura' },
    ]);
  });

  it('falls back to the legacy list when the stored one is empty or absent', () => {
    expect(effectiveSchedule([], legacy)).toEqual(legacy);
    expect(effectiveSchedule(undefined, legacy)).toEqual(legacy);
  });

  it('is empty when both are, and normalises the fallback too', () => {
    expect(effectiveSchedule(undefined, [])).toEqual([]);
    expect(
      effectiveSchedule(undefined, [
        { day: 1, time: '10:00', title: ' B  ' },
        { day: 1, time: '09:00', title: 'A' },
        { day: 1, time: '25:00', title: 'Hora invalida' },
      ]),
    ).toEqual([
      { day: 1, time: '09:00', title: 'A' },
      { day: 1, time: '10:00', title: 'B' },
    ]);
  });
});

describe('EXTRAS_CAPS', () => {
  it('the programme caps are the contract limits (one definition)', () => {
    expect(EXTRAS_CAPS.scheduleTitle).toBe(80);
    expect(EXTRAS_CAPS.scheduleItems).toBe(30);
    expect(EXTRAS_CAPS.scheduleDays).toBe(31);
  });
});
