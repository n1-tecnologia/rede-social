import { describe, expect, it } from 'vitest';
import {
  type AnswerDef,
  type AnswerWords,
  answerView,
  answerWordsFrom,
  isoDayToBr,
} from './answer-view';
import { options } from './test-fixtures';

/**
 * 12-14 Task 1 (UI-D-591, T-12-32): the one answer mapper, all fourteen types. The words are the catalog's
 * (Sim, Não, Aceito, "{n} de 5", "Outro: {text}"); the mapper holds no copy of its own.
 */

const words: AnswerWords = {
  yes: 'Sim',
  no: 'Não',
  accepted: 'Aceito',
  other: (text) => `Outro: ${text}`,
  rating: (n) => `${n} de 5`,
};

const def = (type: AnswerDef['type'], labels: string[] = []): AnswerDef => ({
  type,
  options: options(...labels),
});

describe('answerView: professional_id (quick 261110-ij7)', () => {
  it('shows the stored canonical text as text, and a non-string as nothing', () => {
    expect(answerView(def('professional_id'), 'CRO-SP 123456', words)).toEqual({
      kind: 'text',
      text: 'CRO-SP 123456',
    });
    expect(answerView(def('professional_id'), '12.345.678/0001-95', words)).toEqual({
      kind: 'text',
      text: '12.345.678/0001-95',
    });
    expect(answerView(def('professional_id'), 123, words)).toBeNull();
    expect(answerView(def('professional_id'), '   ', words)).toBeNull();
    expect(answerView(def('professional_id'), null, words)).toBeNull();
  });
});

describe('answerView: text, number, date, phone, e-mail', () => {
  it('shows short and long text as text, keeping the line breaks for the CSS to render', () => {
    expect(answerView(def('short_text'), 'Designer', words)).toEqual({
      kind: 'text',
      text: 'Designer',
    });
    const long = 'Primeira linha.\nSegunda linha.\n\nTerceira.';
    expect(answerView(def('long_text'), long, words)).toEqual({ kind: 'text', text: long });
  });

  it('keeps markup-looking text as text (no parsing, React escapes it)', () => {
    const hostile = '<img src=x onerror=alert(1)> **negrito** [a](javascript:alert(1))';
    expect(answerView(def('short_text'), hostile, words)).toEqual({ kind: 'text', text: hostile });
  });

  it('writes a number the pt-BR way', () => {
    expect(answerView(def('number'), 1234.5, words)).toEqual({ kind: 'text', text: '1.234,5' });
    expect(answerView(def('number'), 4500, words)).toEqual({ kind: 'text', text: '4.500' });
    expect(answerView(def('number'), 7, words)).toEqual({ kind: 'text', text: '7' });
    expect(answerView(def('number'), -0.25, words)).toEqual({ kind: 'text', text: '-0,25' });
    expect(answerView(def('number'), 0, words)).toEqual({ kind: 'text', text: '0' });
  });

  it('writes a date dd/MM/yyyy by splitting the text', () => {
    expect(answerView(def('date'), '2026-02-03', words)).toEqual({
      kind: 'text',
      text: '03/02/2026',
    });
    expect(isoDayToBr('2026-12-31')).toBe('31/12/2026');
    expect(isoDayToBr('31/12/2026')).toBeNull();
    expect(answerView(def('date'), 'ontem', words)).toBeNull();
  });

  it('gives the same date text whatever the time zone of the process', () => {
    const original = process.env.TZ;
    try {
      const seen = new Set<string>();
      for (const zone of ['America/Sao_Paulo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
        process.env.TZ = zone;
        const view = answerView(def('date'), '2026-02-03', words);
        seen.add(view?.kind === 'text' ? view.text : 'wrong');
      }
      expect([...seen]).toEqual(['03/02/2026']);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('shows a phone with its mask, ten or eleven digits', () => {
    expect(answerView(def('phone'), '11912345678', words)).toEqual({
      kind: 'text',
      text: '(11) 91234-5678',
    });
    expect(answerView(def('phone'), '1112345678', words)).toEqual({
      kind: 'text',
      text: '(11) 1234-5678',
    });
  });

  it('shows an e-mail as plain text, never a link', () => {
    expect(answerView(def('email'), 'nome@exemplo.com.br', words)).toEqual({
      kind: 'text',
      text: 'nome@exemplo.com.br',
    });
  });
});

describe('answerView: link', () => {
  it('makes an anchor view only for http and https', () => {
    expect(answerView(def('link'), 'https://instagram.com/marina', words)).toEqual({
      kind: 'link',
      href: 'https://instagram.com/marina',
      text: 'https://instagram.com/marina',
    });
    expect(answerView(def('link'), 'http://exemplo.com.br/a?b=1', words)?.kind).toBe('link');
  });

  it('shows every other scheme and every non-URL as text', () => {
    for (const value of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://exemplo.com/arquivo',
      'mailto:nome@exemplo.com',
      'file:///etc/passwd',
      '//exemplo.com/x',
      '/perfil',
      'exemplo.com.br',
    ]) {
      expect(answerView(def('link'), value, words), value).toEqual({ kind: 'text', text: value });
    }
  });
});

describe('answerView: choices', () => {
  it('shows the label of a dropdown or single choice', () => {
    const d = def('dropdown', ['Instagram', 'Indicação de amigo']);
    const second = d.options[1]?.id ?? '';
    expect(answerView(d, { optionId: second, otherText: null }, words)).toEqual({
      kind: 'text',
      text: 'Indicação de amigo',
    });
    const s = def('single_choice', ['Sim, claro', 'Talvez']);
    expect(answerView(s, { optionId: s.options[0]?.id ?? '', otherText: null }, words)).toEqual({
      kind: 'text',
      text: 'Sim, claro',
    });
  });

  it('shows "Outro: texto" when the answer is Outro', () => {
    const d = def('single_choice', ['Instagram', 'Indicação']);
    expect(answerView(d, { optionId: null, otherText: 'Podcast' }, words)).toEqual({
      kind: 'text',
      text: 'Outro: Podcast',
    });
  });

  it('shows a multiple choice in the admin option order, plus Outro', () => {
    const d = def('multiple_choice', ['Liderança', 'Vendas', 'Produto']);
    const [a, b, c] = d.options.map((option) => option.id) as [string, string, string];
    // stored in a different order than the question's options
    expect(answerView(d, { optionIds: [c, a], otherText: null }, words)).toEqual({
      kind: 'text',
      text: 'Liderança, Produto',
    });
    expect(answerView(d, { optionIds: [b, a], otherText: 'Mentoria de carreira' }, words)).toEqual({
      kind: 'text',
      text: 'Liderança, Vendas, Outro: Mentoria de carreira',
    });
    expect(answerView(d, { optionIds: [], otherText: 'Só isto' }, words)).toEqual({
      kind: 'text',
      text: 'Outro: Só isto',
    });
  });

  it('keeps the label of an option that is no longer in the list out, never an id', () => {
    const d = def('single_choice', ['Instagram', 'Indicação']);
    expect(answerView(d, { optionId: 'removida', otherText: null }, words)).toBeNull();
  });
});

describe('answerView: yes/no, acceptance, rating', () => {
  it('writes Sim and Não, and Aceito', () => {
    expect(answerView(def('yes_no'), true, words)).toEqual({ kind: 'text', text: 'Sim' });
    expect(answerView(def('yes_no'), false, words)).toEqual({ kind: 'text', text: 'Não' });
    expect(answerView(def('acceptance'), true, words)).toEqual({ kind: 'text', text: 'Aceito' });
  });

  it('writes a rating as "{n} de 5" with its number', () => {
    expect(answerView(def('rating'), 4, words)).toEqual({ kind: 'rating', n: 4, text: '4 de 5' });
    expect(answerView(def('rating'), 1, words)).toEqual({ kind: 'rating', n: 1, text: '1 de 5' });
    expect(answerView(def('rating'), 0, words)).toBeNull();
    expect(answerView(def('rating'), 6, words)).toBeNull();
    expect(answerView(def('rating'), 3.5, words)).toBeNull();
  });
});

describe('answerView: no answer and wrong shapes', () => {
  it('returns null for no answer', () => {
    for (const type of [
      'short_text',
      'long_text',
      'dropdown',
      'multiple_choice',
      'single_choice',
      'number',
      'date',
      'phone',
      'email',
      'link',
      'yes_no',
      'acceptance',
      'rating',
    ] as const) {
      expect(answerView(def(type), null, words), type).toBeNull();
      expect(answerView(def(type), undefined, words), type).toBeNull();
    }
  });

  it('returns null for a stored shape that does not fit the type (never a guess)', () => {
    expect(answerView(def('number'), 'abc', words)).toBeNull();
    expect(answerView(def('yes_no'), 'sim', words)).toBeNull();
    expect(answerView(def('acceptance'), false, words)).toBeNull();
    expect(answerView(def('dropdown'), 'texto', words)).toBeNull();
    expect(answerView(def('short_text'), 42, words)).toBeNull();
  });
});

describe('answerWordsFrom', () => {
  it('builds the words from a translator scoped to profileForm.profile', () => {
    const calls: string[] = [];
    const w = answerWordsFrom((key, values) => {
      calls.push(key);
      return values ? `${key}:${JSON.stringify(values)}` : key;
    });
    expect(w.yes).toBe('values.yes');
    expect(w.no).toBe('values.no');
    expect(w.accepted).toBe('values.accepted');
    expect(w.other('x')).toBe('values.other:{"text":"x"}');
    expect(w.rating(3)).toBe('values.rating:{"n":3}');
  });
});
