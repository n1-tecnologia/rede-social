import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerWords } from './answer-view';
import { branch, form, options, question, uuid } from './test-fixtures';

/**
 * 12-14 (D-584, D-593): the two profile readers never throw. `loadMyAnswers` maps the member form
 * (`getMemberForm` mocked) to ok, empty and error; `loadMemberAnswers` maps 200, 404 and everything else
 * (`apiFetch` mocked, so the real strict contract runs).
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), getMemberForm: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('./member-form', () => ({ getMemberForm: () => mocks.getMemberForm() }));

const { loadMemberAnswers, loadMyAnswers } = await import('./profile-reads');

const words: AnswerWords = {
  yes: 'Sim',
  no: 'Não',
  accepted: 'Aceito',
  other: (text) => `Outro: ${text}`,
  rating: (n) => `${n} de 5`,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.getMemberForm.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadMyAnswers', () => {
  it('maps each question to a row in the order the API returned, with its view and public flag', async () => {
    const choices = options('Instagram', 'Indicação');
    mocks.getMemberForm.mockResolvedValue(
      form(
        [
          question('short_text', { title: 'Cargo', answer: 'Designer', showOnProfile: true }),
          question('single_choice', {
            title: 'Como conheceu',
            options: choices,
            answer: { optionId: choices[1]?.id ?? null, otherText: null },
          }),
          question('date', { title: 'Nascimento', answer: null }),
        ],
        { mode: 'edit' },
      ),
    );
    const result = await loadMyAnswers(words);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.rows.map((row) => row.title)).toEqual(['Cargo', 'Como conheceu', 'Nascimento']);
    expect(result.rows[0]).toMatchObject({
      view: { kind: 'text', text: 'Designer' },
      isPublic: true,
    });
    expect(result.rows[1]).toMatchObject({
      view: { kind: 'text', text: 'Indicação' },
      isPublic: false,
    });
    expect(result.rows[2]).toMatchObject({ view: null, isPublic: false });
  });

  it('is empty when there is no active question (staff, module off, nothing asked)', async () => {
    mocks.getMemberForm.mockResolvedValue(form([], { mode: 'none' }));
    expect(await loadMyAnswers(words)).toEqual({ status: 'empty' });
  });

  it('is an error, never a throw, when the read fails or the body is off-contract', async () => {
    mocks.getMemberForm.mockRejectedValue(new Error('boom'));
    expect(await loadMyAnswers(words)).toEqual({ status: 'error' });
  });

  it('logs the error class only, never an answer', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getMemberForm.mockRejectedValue(new Error('resposta secreta do membro'));
    await loadMyAnswers(words);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secreta');
  });
});

const publicPayload = {
  kind: 'member',
  answers: [
    {
      questionId: uuid(1),
      title: 'Qual é o seu cargo?',
      type: 'short_text',
      options: [],
      value: 'Gerente de produto',
    },
  ],
};

const staffPayload = {
  kind: 'staff',
  answers: [
    {
      questionId: uuid(1),
      title: 'Qual é o seu cargo?',
      type: 'short_text',
      options: [],
      value: 'Gerente de produto',
      showOnProfile: true,
      position: 1,
      archivedAt: null,
      answered: true,
      required: false,
      condition: null,
    },
  ],
};

describe('loadMyAnswers: the derived-row rule (D-634, UI-D-659, D-641)', () => {
  it('marks a question whose branch the opener answer does not open as hidden, and no other row', async () => {
    const choices = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      options: choices,
      answer: { optionId: choices[1]?.id ?? null, otherText: null },
    });
    const forClinic = branch({ openerQuestionId: opener.id, values: [choices[0]?.id ?? ''] });
    const forStudent = branch({ openerQuestionId: opener.id, values: [choices[1]?.id ?? ''] });
    const closed = question('short_text', { title: 'Nome da clínica', branchId: forClinic.id });
    const open = question('short_text', {
      title: 'Como é a rotina',
      answer: 'Estudo',
      branchId: forStudent.id,
    });
    const plain = question('short_text', { title: 'Cidade' });
    mocks.getMemberForm.mockResolvedValue(
      form([opener, closed, open, plain], { mode: 'edit', branches: [forClinic, forStudent] }),
    );
    const result = await loadMyAnswers(words);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows.map((row) => [row.title, row.hidden])).toEqual([
      ['Qual é o seu caso?', false],
      ['Nome da clínica', true],
      ['Como é a rotina', false],
      ['Cidade', false],
    ]);
  });

  it('hides a question when ANY branch on its chain is closed, however deep', async () => {
    const choices = options('Sim', 'Não');
    const top = question('single_choice', {
      title: 'Topo',
      options: choices,
      answer: { optionId: choices[0]?.id ?? null, otherText: null },
    });
    const first = branch({ openerQuestionId: top.id, values: [choices[0]?.id ?? ''] });
    const middle = question('yes_no', { title: 'Meio', answer: false, branchId: first.id });
    const second = branch({ openerQuestionId: middle.id, values: ['true'] });
    const leaf = question('short_text', { title: 'Folha', answer: 'x', branchId: second.id });
    mocks.getMemberForm.mockResolvedValue(
      form([top, middle, leaf], { mode: 'edit', branches: [first, second] }),
    );
    const result = await loadMyAnswers(words);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows.map((row) => [row.title, row.hidden])).toEqual([
      ['Topo', false],
      ['Meio', false],
      ['Folha', true],
    ]);
  });
});

describe('loadMemberAnswers: the staff payload carries the branches, never a name (D-645, T-12.2-03)', () => {
  const branchRow = {
    id: uuid(51),
    openerQuestionId: uuid(1),
    values: ['true'],
  };

  it('gives the staff payload an empty branch list when the read has none', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(200, staffPayload));
    const result = await loadMemberAnswers('abc');
    if (result.status !== 'ok' || result.payload.kind !== 'staff')
      throw new Error('expected staff');
    expect(result.payload.branches).toEqual([]);
  });

  it('carries the branches of the staff payload, id, opener and values only', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      json(200, {
        ...staffPayload,
        answers: [{ ...staffPayload.answers[0], branchId: branchRow.id }],
        branches: [branchRow],
      }),
    );
    const result = await loadMemberAnswers('abc');
    if (result.status !== 'ok' || result.payload.kind !== 'staff')
      throw new Error('expected staff');
    expect(result.payload.branches).toEqual([branchRow]);
    expect(result.payload.answers[0]?.branchId).toBe(branchRow.id);
    expect(Object.keys(result.payload.branches[0] ?? {}).sort()).toEqual([
      'id',
      'openerQuestionId',
      'values',
    ]);
  });

  it('a branch that carries a name breaks the strict contract: error, nothing rendered', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      json(200, { ...staffPayload, branches: [{ ...branchRow, name: 'Donos de clínica' }] }),
    );
    expect(await loadMemberAnswers('abc')).toEqual({ status: 'error' });
  });

  it('the public payload is untouched', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(200, publicPayload));
    const result = await loadMemberAnswers('abc');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.payload.kind).toBe('member');
    expect(result.payload).not.toHaveProperty('branches');
  });
});

describe('loadMemberAnswers', () => {
  it('maps a 200 to the parsed payload of either kind', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(200, publicPayload));
    const member = await loadMemberAnswers('abc');
    expect(member).toMatchObject({ status: 'ok', payload: { kind: 'member' } });
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/members/abc/profile-answers');

    mocks.apiFetch.mockResolvedValueOnce(json(200, staffPayload));
    expect(await loadMemberAnswers('abc')).toMatchObject({
      status: 'ok',
      payload: { kind: 'staff' },
    });
  });

  it('maps the bare 404 to absent', async () => {
    mocks.apiFetch.mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    expect(await loadMemberAnswers('abc')).toEqual({ status: 'absent' });
  });

  it('maps a 500, a transport failure and an off-contract body to error', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    expect(await loadMemberAnswers('abc')).toEqual({ status: 'error' });

    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await loadMemberAnswers('abc')).toEqual({ status: 'error' });

    // the contract is strict: an extra key (here an e-mail) is refused, never rendered
    mocks.apiFetch.mockResolvedValueOnce(
      json(200, {
        kind: 'member',
        answers: [{ ...publicPayload.answers[0], email: 'x@y.com' }],
      }),
    );
    expect(await loadMemberAnswers('abc')).toEqual({ status: 'error' });
  });

  it('encodes the id in the path', async () => {
    mocks.apiFetch.mockResolvedValue(json(404, {}));
    await loadMemberAnswers('a/b');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/members/a%2Fb/profile-answers');
  });
});
