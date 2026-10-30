import { expect, test } from '@playwright/test';
import { membershipIdFor } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  answerFor,
  BACKSTOP_WIDTHS,
  clearForm,
  closeProfileForm,
  createAccount,
  enableProfileForm,
  expectNoHorizontalScroll,
  expectScreenFits,
  gotoWhileRedirected,
  LAB,
  longTitle,
  newPhonePage,
  newRunPrefix,
  noticeDismissedAt,
  PASSWORD,
  PHONE_PROJECT,
  PROFILE_FORM_NAMESPACE,
  questionBlock,
  questionByTitle,
  resetProfileForm,
  seedQuestion,
  signInIntoGate,
  signInToLab,
  snapshot,
  storedAnswer,
} from './profile-form';

/**
 * 12-18, Task 2 (member half): the member's stories of the profile form in a browser, on the phone
 * project, against the real API and database.
 *
 *   1  one control of each of the 13 types, one "Salvar", released
 *   2  returning mode: only the missing required question is flagged; the error summary and its jump
 *   3  the admin changes the form while the member types: the refreshed list keeps what she typed
 *   4  "Minhas respostas" on /perfil, "Editar", the "Visível no seu perfil" row, the new-questions notice
 *   5  another member sees only the public answers; the staff see every answer, archived ones included
 *   6  the 320px and 390px backstops on the member form (E07), Minhas respostas (E08), the public
 *      block (E09) and the staff block (E10), with 120-character titles and a 1000-character answer
 *
 * Every row carries the run prefix and goes away with `resetProfileForm` (`beforeAll` and `afterAll`);
 * the module row is put back exactly as found. Each test starts from an empty form (`clearForm`) so one
 * test's required question never gates another's members; 4 and 5 share one form on purpose.
 *
 * Written under Igor's decision of 2026-10-30 (the disk could not hold a Next server and a browser) and
 * NOT executed by plan 12-18: the first run is recorded in `12-MANUAL-PROOFS.md` (rows M8, M9).
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const email = (tag: string) => `${prefix}-${tag}@rede-lab.local`;
const title = (tag: string) => `${prefix} ${tag}`;

let before: Awaited<ReturnType<typeof snapshot>>;

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, 'the member story runs once, on the phone');
});

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  await resetProfileForm(LAB, PROFILE_FORM_NAMESPACE);
  before = await snapshot(LAB, PROFILE_FORM_NAMESPACE);
  await enableProfileForm();
});

test.afterAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  await resetProfileForm(LAB, PROFILE_FORM_NAMESPACE);
  expect(await snapshot(LAB, PROFILE_FORM_NAMESPACE)).toEqual(before);
  await closeProfileForm();
});

test('1. one control of each of the 13 types, one "Salvar", and the member is released', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const who = email('thirteen');
  await createAccount(who);

  const shortText = await seedQuestion({
    title: title('01 Cargo atual'),
    type: 'short_text',
    required: true,
  });
  const longText = await seedQuestion({
    title: title('02 Conte sobre voce'),
    type: 'long_text',
    required: true,
  });
  const dropdown = await seedQuestion({
    title: title('03 Area de atuacao'),
    type: 'dropdown',
    required: true,
    options: ['Ensino', 'Saude', 'Tecnologia'],
    allowOther: true,
  });
  const multiple = await seedQuestion({
    title: title('04 Interesses'),
    type: 'multiple_choice',
    required: true,
    options: ['Musica', 'Esporte', 'Leitura'],
    allowOther: true,
  });
  const single = await seedQuestion({
    title: title('05 Turno preferido'),
    type: 'single_choice',
    required: true,
    options: ['Manha', 'Tarde'],
    allowOther: true,
  });
  const number = await seedQuestion({
    title: title('06 Anos de experiencia'),
    type: 'number',
    required: true,
    limits: { min: 0, max: 60 },
  });
  const date = await seedQuestion({
    title: title('07 Data de nascimento'),
    type: 'date',
    required: true,
  });
  const phone = await seedQuestion({
    title: title('08 Telefone de contato'),
    type: 'phone',
    required: true,
  });
  const mail = await seedQuestion({
    title: title('09 E-mail profissional'),
    type: 'email',
    required: true,
  });
  const link = await seedQuestion({ title: title('10 Seu site'), type: 'link', required: true });
  const yesNo = await seedQuestion({
    title: title('11 Voce tem filhos'),
    type: 'yes_no',
    required: true,
  });
  const acceptance = await seedQuestion({
    title: title('12 Li e aceito o regulamento'),
    type: 'acceptance',
    required: true,
  });
  const rating = await seedQuestion({
    title: title('13 Nota para a comunidade'),
    type: 'rating',
    required: true,
  });

  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, who);
    await expect(page.locator('[data-question]')).toHaveCount(13);

    // 1 short text, 2 long text.
    await questionBlock(page, shortText.id).getByRole('textbox').fill('Analista');
    await questionBlock(page, longText.id)
      .getByRole('textbox')
      .fill('Primeira linha.\nSegunda linha.');
    // 3 dropdown.
    await questionBlock(page, dropdown.id).getByRole('combobox').selectOption({ label: 'Saude' });
    // 4 multiple choice.
    await questionBlock(page, multiple.id).getByRole('checkbox', { name: 'Musica' }).check();
    await questionBlock(page, multiple.id).getByRole('checkbox', { name: 'Leitura' }).check();
    // 5 single choice, through "Outro" and its "Qual?".
    await questionBlock(page, single.id).getByRole('radio', { name: 'Outro', exact: true }).check();
    await questionBlock(page, single.id).getByLabel('Qual?').fill('Noite');
    // 6 number: the comma is the decimal separator, and the field settles it on blur.
    const numberInput = questionBlock(page, number.id).getByRole('textbox');
    await numberInput.fill('12,5');
    await numberInput.blur();
    await expect(numberInput).toHaveValue('12,5');
    // 7 date.
    await questionBlock(page, date.id).locator('input[type="date"]').fill('1990-05-17');
    // 8 phone, masked.
    const phoneInput = questionBlock(page, phone.id).getByRole('textbox');
    await phoneInput.fill('11912345678');
    await phoneInput.blur();
    await expect(phoneInput).toHaveValue('(11) 91234-5678');
    // 9 e-mail.
    await questionBlock(page, mail.id).getByRole('textbox').fill('pessoa@exemplo.com.br');
    // 10 link without a scheme: the field adds the https:// on blur.
    const linkInput = questionBlock(page, link.id).getByRole('textbox');
    await linkInput.fill('exemplo.com.br');
    await linkInput.blur();
    await expect(linkInput).toHaveValue('https://exemplo.com.br');
    // 11 yes / no.
    const yes = questionBlock(page, yesNo.id).getByRole('button', { name: 'Sim', exact: true });
    await yes.click();
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    // 12 acceptance.
    await questionBlock(page, acceptance.id).getByRole('checkbox').check();
    // 13 rating: the star is a visually hidden radio under a 44px label.
    await questionBlock(page, rating.id).locator(`label[for="pf-${rating.id}-control-4"]`).click();
    await expect(
      questionBlock(page, rating.id).getByRole('radio', { name: '4 estrelas' }),
    ).toBeChecked();

    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

    // What the member typed is what the table holds.
    expect(await storedAnswer(who, shortText.id)).toBe('Analista');
    expect(await storedAnswer(who, longText.id)).toBe('Primeira linha.\nSegunda linha.');
    expect(await storedAnswer(who, dropdown.id)).toEqual({
      optionId: dropdown.optionIds[1],
      otherText: null,
    });
    expect(await storedAnswer(who, multiple.id)).toEqual({
      optionIds: [multiple.optionIds[0], multiple.optionIds[2]],
      otherText: null,
    });
    expect(await storedAnswer(who, single.id)).toEqual({ optionId: null, otherText: 'Noite' });
    expect(await storedAnswer(who, number.id)).toBe(12.5);
    expect(await storedAnswer(who, date.id)).toBe('1990-05-17');
    expect(await storedAnswer(who, phone.id)).toBe('11912345678');
    expect(await storedAnswer(who, mail.id)).toBe('pessoa@exemplo.com.br');
    expect(String(await storedAnswer(who, link.id))).toMatch(/^https:\/\/exemplo\.com\.br\/?$/);
    expect(await storedAnswer(who, yesNo.id)).toBe(true);
    expect(await storedAnswer(who, acceptance.id)).toBe(true);
    expect(await storedAnswer(who, rating.id)).toBe(4);
  } finally {
    await context.close();
  }
});

test('2. returning mode flags only the missing required question, and the error summary jumps to it', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const who = email('returning');
  await createAccount(who);

  const hobby = await seedQuestion({ title: title('20 Hobby'), type: 'short_text' });
  const city = await seedQuestion({
    title: title('21 Cidade'),
    type: 'short_text',
    required: true,
  });
  await answerFor(who, hobby.id, 'Xadrez');
  await answerFor(who, city.id, 'Recife');
  // A new required question arrives after she had answered the form.
  const work = await seedQuestion({
    title: title('22 Cargo no trabalho'),
    type: 'short_text',
    required: true,
  });

  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, who);
    await expect(
      page.getByRole('heading', { name: 'Faltam algumas respostas', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/Falta 1 pergunta obrigatória\./)).toBeVisible();

    // Only the missing question is flagged; the answered ones keep what she wrote.
    await expect(page.locator('[data-flagged]')).toHaveCount(1);
    await expect(questionBlock(page, work.id)).toHaveAttribute('data-flagged', 'true');
    await expect(questionBlock(page, work.id)).toContainText('Falta responder');
    await expect(questionBlock(page, city.id)).not.toHaveAttribute('data-flagged', /.*/);
    await expect(questionBlock(page, city.id).getByRole('textbox')).toHaveValue('Recife');
    await expect(questionBlock(page, hobby.id).getByRole('textbox')).toHaveValue('Xadrez');

    // A bad save: the summary appears and its link puts focus on the first invalid control.
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Revise 1 campo antes de salvar.' });
    await expect(summary).toBeVisible();
    await summary.getByRole('link', { name: 'Ir para o primeiro' }).click();
    await expect(questionBlock(page, work.id).getByRole('textbox')).toBeFocused();
    await expect(questionBlock(page, work.id)).toContainText('Responda esta pergunta.');

    await questionBlock(page, work.id).getByRole('textbox').fill('Coordenadora');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await storedAnswer(who, work.id)).toBe('Coordenadora');
  } finally {
    await context.close();
  }
});

test('3. a form changed while she types returns the refreshed list with her typed answers kept', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const who = email('typing');
  await createAccount(who);
  const first = await seedQuestion({
    title: title('30 Cargo'),
    type: 'short_text',
    required: true,
  });

  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, who);
    await questionBlock(page, first.id).getByRole('textbox').fill('Diretora');

    // The admin adds a question while the page is open.
    const added = await seedQuestion({ title: title('31 Novidade'), type: 'short_text' });

    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'O formulário mudou enquanto você respondia.' }),
    ).toBeVisible();
    await expect(questionBlock(page, added.id)).toBeVisible();
    await expect(questionBlock(page, first.id).getByRole('textbox')).toHaveValue('Diretora');

    // Nothing was saved by the refused attempt; the second press saves everything.
    expect(await storedAnswer(who, first.id)).toBeUndefined();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await storedAnswer(who, first.id)).toBe('Diretora');
  } finally {
    await context.close();
  }
});

// Tests 4 and 5 share one form and one member on purpose: 5 reads what 4 left.
const profileOwner = email('owner');
const ownerName = `${prefix} Paula Teste`;
let publicQuestionTitle = '';
let privateAnswer = '';
const archivedAnswer = 'Segredo antigo guardado';

test('4. "Minhas respostas" on /perfil, "Editar", the public row and the new-questions notice', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  await createAccount(profileOwner, 'member', ownerName);
  const publicQ = await seedQuestion({
    title: title('40 Cargo no perfil'),
    type: 'short_text',
    required: true,
    showOnProfile: true,
  });
  const privateQ = await seedQuestion({
    title: title('41 Cidade reservada'),
    type: 'short_text',
  });
  const archivedQ = await seedQuestion({
    title: title('42 Pergunta antiga'),
    type: 'short_text',
    archived: true,
  });
  publicQuestionTitle = publicQ.title;
  privateAnswer = 'Recife';
  await answerFor(profileOwner, publicQ.id, 'Analista');
  await answerFor(profileOwner, privateQ.id, privateAnswer);
  await answerFor(profileOwner, archivedQ.id, archivedAnswer);

  const { context, page } = await newPhonePage(browser);
  try {
    await signInToLab(page, profileOwner);
    await gotoWhileRedirected(page, `${hosts.lab}/perfil`);
    const section = page.locator('#respostas');
    await expect(section).toContainText('Analista');
    await expect(section).toContainText(privateAnswer);
    // Only the public question's row carries the marker; the archived one is not listed.
    await expect(section.getByText('Visível no seu perfil')).toHaveCount(1);
    await expect(section).not.toContainText(archivedAnswer);
    // No question is new yet, so no notice.
    await expect(page.locator('[data-new-questions-notice]')).toHaveCount(0);

    // "Editar" opens the same screen with "Cancelar", and a save returns to /perfil.
    await section.getByRole('link', { name: 'Editar minhas respostas' }).click();
    await expect(page).toHaveURL(/\/completar-perfil\?next=%2Fperfil/);
    await expect(page.getByRole('heading', { name: 'Minhas respostas', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cancelar' })).toHaveAttribute('href', '/perfil');
    await questionBlock(page, publicQ.id).getByRole('textbox').fill('Diretora');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page).toHaveURL(/\/perfil$/, { timeout: 30_000 });
    await expect(page.locator('#respostas')).toContainText('Diretora');
    expect(await storedAnswer(profileOwner, publicQ.id)).toBe('Diretora');

    // An optional question added later raises the notice; "Agora não" keeps it away after a reload.
    await seedQuestion({ title: title('43 Novidade opcional'), type: 'short_text' });
    await gotoWhileRedirected(page, `${hosts.lab}/perfil`);
    const notice = page.locator('[data-new-questions-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Há perguntas novas no seu perfil');
    await notice.getByRole('button', { name: 'Agora não' }).click();
    await expect(notice).toBeHidden();
    await expect
      .poll(async () => (await noticeDismissedAt(profileOwner)) !== null, {
        message: 'the dismissal is stored on the server',
      })
      .toBe(true);
    await page.reload();
    await expect(page.locator('#respostas')).toBeVisible();
    await expect(page.locator('[data-new-questions-notice]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('5. another member sees only the public answers; the staff see every answer, archived ones included', async ({
  browser,
}) => {
  const ownerMembership = await membershipIdFor(profileOwner, LAB);
  // The viewer is a complete member: she has answered every required question of the form.
  const viewer = email('viewer');
  await createAccount(viewer);
  const publicQuestion = await questionByTitle(publicQuestionTitle);
  if (!publicQuestion) throw new Error('test 4 left no public question to answer');
  await answerFor(viewer, publicQuestion.id, 'Visitante');

  const member = await newPhonePage(browser);
  try {
    await signInToLab(member.page, viewer);
    await gotoWhileRedirected(member.page, `${hosts.lab}/membros/${ownerMembership}`);
    const blockPublic = member.page.locator('[data-member-answers="public"]');
    await expect(blockPublic).toBeVisible();
    await expect(member.page.getByText(`Sobre ${ownerName}`)).toBeVisible();
    await expect(blockPublic).toContainText(publicQuestionTitle);
    await expect(blockPublic).toContainText('Diretora');
    // Private and archived answers never reach another member.
    await expect(member.page.getByText(privateAnswer, { exact: true })).toHaveCount(0);
    await expect(member.page.getByText(archivedAnswer)).toHaveCount(0);
    await expect(member.page.locator('[data-member-answers="staff"]')).toHaveCount(0);
  } finally {
    await member.context.close();
  }

  const supportUser = email('support');
  await createAccount(supportUser, 'support_tenant');
  for (const [who, password] of [
    [users.labAdmin, SEED_PASSWORD],
    [supportUser, PASSWORD],
  ] as const) {
    const staff = await newPhonePage(browser);
    try {
      await login(staff.page, who, password, hosts.lab);
      await gotoWhileRedirected(staff.page, `${hosts.lab}/membros/${ownerMembership}`);
      const blockStaff = staff.page.locator('[data-member-answers="staff"]');
      await expect(blockStaff).toBeVisible();
      await expect(blockStaff).toContainText('Respostas do formulário');
      await expect(blockStaff).toContainText('Diretora');
      await expect(blockStaff).toContainText(privateAnswer);
      // The archived question's answer is still there, under its own heading and pill.
      await expect(blockStaff).toContainText('Perguntas arquivadas');
      await expect(blockStaff).toContainText(archivedAnswer);
      await expect(blockStaff.getByText('Arquivada', { exact: true })).toHaveCount(1);
      // The privacy marker sits on the public question only.
      await expect(blockStaff.getByText('Público no perfil', { exact: true })).toHaveCount(1);
    } finally {
      await staff.context.close();
    }
  }
});

for (const width of BACKSTOP_WIDTHS) {
  test(`6. at ${width}px the member form and the profile blocks keep every control on screen`, async ({
    browser,
  }) => {
    await clearForm(LAB, prefix);
    const tag = `w${width}`;
    const subject = email(`${tag}-subject`);
    const viewer = email(`${tag}-viewer`);
    await createAccount(subject, 'member', `${prefix} ${tag} Nome muito comprido de membro`);
    await createAccount(viewer);

    const help = `${'Texto de apoio comprido. '.repeat(10)}${'u'.repeat(50)}`.slice(0, 300);
    const longShort = await seedQuestion({
      title: longTitle(prefix, `${tag}a`),
      type: 'short_text',
      required: true,
      helpText: help,
      showOnProfile: true,
    });
    const options = Array.from({ length: 20 }, (_, index) =>
      `Opcao ${String(index + 1).padStart(2, '0')} ${'a'.repeat(80)}`.slice(0, 80),
    );
    const choice = await seedQuestion({
      title: longTitle(prefix, `${tag}b`),
      type: 'single_choice',
      required: true,
      options,
      allowOther: true,
    });
    const stars = await seedQuestion({
      title: longTitle(prefix, `${tag}c`),
      type: 'rating',
      required: true,
    });
    const longText = await seedQuestion({
      title: longTitle(prefix, `${tag}d`),
      type: 'long_text',
      showOnProfile: true,
    });
    const longAnswer = `${'palavra '.repeat(110)}${'x'.repeat(60)}`.slice(0, 1000);
    const longLink = await seedQuestion({
      title: longTitle(prefix, `${tag}e`),
      type: 'link',
      showOnProfile: true,
    });

    // The viewer is complete, so she reaches the subject's page.
    await answerFor(viewer, longShort.id, 'ok');
    await answerFor(viewer, choice.id, { optionId: choice.optionIds[0], otherText: null });
    await answerFor(viewer, stars.id, 3);

    // The member form.
    const form = await newPhonePage(browser, width);
    try {
      await signInIntoGate(form.page, subject);
      expect(await form.page.evaluate(() => window.innerWidth)).toBe(width);
      await expectScreenFits(form.page, `E07 ${width}px member form`, {
        Salvar: form.page.getByRole('button', { name: 'Salvar', exact: true }),
        Sair: form.page.getByRole('button', { name: 'Sair', exact: true }),
        'first text control': questionBlock(form.page, longShort.id).getByRole('textbox'),
        'first star': questionBlock(form.page, stars.id).locator(
          `label[for="pf-${stars.id}-control-1"]`,
        ),
      });

      // The error state (the summary and one message per question) fits too.
      await form.page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(
        form.page.getByRole('alert').filter({ hasText: /Revise \d+ campos? antes/ }),
      ).toBeVisible();
      await expectNoHorizontalScroll(form.page, `E07 ${width}px member form with errors`);

      await questionBlock(form.page, longShort.id).getByRole('textbox').fill('Resposta curta');
      await questionBlock(form.page, choice.id).getByRole('radio').last().check();
      await questionBlock(form.page, choice.id).getByLabel('Qual?').fill('Resposta escrita');
      await questionBlock(form.page, stars.id)
        .locator(`label[for="pf-${stars.id}-control-5"]`)
        .click();
      await form.page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(form.page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    } finally {
      await form.context.close();
    }

    // The profile blocks, with a 1000-character answer under a 120-character title.
    await answerFor(subject, longText.id, longAnswer);
    await answerFor(subject, longLink.id, `https://exemplo.com.br/${'a'.repeat(200)}`);
    const subjectMembership = await membershipIdFor(subject, LAB);

    const own = await newPhonePage(browser, width);
    try {
      await signInToLab(own.page, subject);
      await gotoWhileRedirected(own.page, `${hosts.lab}/perfil`);
      await expect(own.page.locator('#respostas')).toBeVisible();
      await expectScreenFits(own.page, `E08 ${width}px Minhas respostas`, {
        Editar: own.page
          .locator('#respostas')
          .getByRole('link', { name: 'Editar minhas respostas' }),
      });
    } finally {
      await own.context.close();
    }

    const other = await newPhonePage(browser, width);
    try {
      await signInToLab(other.page, viewer);
      await gotoWhileRedirected(other.page, `${hosts.lab}/membros/${subjectMembership}`);
      await expect(other.page.locator('[data-member-answers="public"]')).toBeVisible();
      await expectNoHorizontalScroll(other.page, `E09 ${width}px public answers`);
    } finally {
      await other.context.close();
    }

    const staff = await newPhonePage(browser, width);
    try {
      await login(staff.page, users.labAdmin, SEED_PASSWORD, hosts.lab);
      await gotoWhileRedirected(staff.page, `${hosts.lab}/membros/${subjectMembership}`);
      await expect(staff.page.locator('[data-member-answers="staff"]')).toBeVisible();
      await expectNoHorizontalScroll(staff.page, `E10 ${width}px staff answers`);
    } finally {
      await staff.context.close();
    }
  });
}
