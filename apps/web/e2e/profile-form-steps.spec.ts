import { expect, type Page, test } from '@playwright/test';
import { membershipIdFor } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  answerFor,
  assertFreeDisk,
  builderRow,
  CLINIC_OPTIONS,
  clearForm,
  closeProfileForm,
  createAccount,
  enableProfileForm,
  expectContained,
  expectNoHorizontalScroll,
  expectScreenFits,
  gotoWhileRedirected,
  LAB,
  newPhonePage,
  newRunPrefix,
  openBuilder,
  openMemberAsStaff,
  PHONE_PROJECT,
  PROFILE_FORM_NAMESPACE,
  placementByTitle,
  questionBlock,
  resetProfileForm,
  seedClinicForm,
  seedQuestion,
  seedStep,
  seedTenSteps,
  seedWideForm,
  signInIntoGate,
  signInToLab,
  snapshot,
  stepTitles,
  storedAnswer,
} from './profile-form';

/**
 * 12.1-19, Task 1: the steps and the conditional questions of the profile form in a browser, on the phone
 * project, against the real API and database (PFORM-34, 35, 36, 37, 42; UI-D-661).
 *
 *   1   the admin builds a second step and a conditional question through the builder; the builder
 *       refuses a layout that puts the opener after its dependent; the preview walks without answers
 *   2   the member walks the stepper: the path grows when she opens the clinic questions, 'Avançar' saves
 *       one step, 'Concluir' leaves the gate; a second member who answers another option ends after step 1
 *   3   the erase story from 'Minhas respostas' (one scroll): the dialog lists the closed questions by
 *       TITLE, 'Rever respostas' saves nothing, 'Apagar e salvar' deletes, the staff read 'Não se aplica',
 *       and reopening the opener shows the clinic questions in place with focus still on the opener
 *   4a  the 320px backstop of the stepper with ten steps
 *   4b  the 320px backstop of the builder: wells, the question sheet with the condition editor (20 options
 *       of 80 characters), the preview with long step titles
 *   4c  the 320px backstop of the member screens: the erase dialog with five 120-character titles and
 *       'Minhas respostas' when every conditional row is omitted
 *
 * The wording of the clinic form is the team's EXAMPLE of the first client's case (Research A10). The
 * client's real question list is NOT in the repository and is never invented here: loading it in a staging
 * tenant is ledger row M5 of `12.1-MANUAL-PROOFS.md`. No answer below is a real member's: every value is a
 * neutral test string.
 *
 * Every row carries the run prefix and goes away with `resetProfileForm` (`beforeAll` and `afterAll`);
 * the module row is put back exactly as found. The specs locate by the accessible names and the catalog
 * texts of plans 14 to 18 (`profileForm.member.*` and `profileForm.admin.*`).
 *
 * Written under the disk limit of 2026-11-05 (about 4.6 GiB free; a run drops about 9 GiB) and NOT executed
 * by plan 12.1-19: listing and type-checking only. The first run is ledger row M3. The free-space guard
 * below refuses to start under 10 GiB, the precondition of Phase 12's row M8, so a run can never fill the
 * disk and hang Docker.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const email = (tag: string) => `${prefix}-${tag}@rede-lab.local`;
const open = (text: string) => `“${text}”`;

/** "Minhas respostas" on /perfil (the section renders `data-profile-section`, never an `id`). */
const MY_ANSWERS = '[data-profile-section="respostas"]';

/** The completion screen opened for editing: the same route and save the first answer used. */
const EDIT_URL = `${hosts.lab}/completar-perfil?next=%2Fperfil`;

let before: Awaited<ReturnType<typeof snapshot>>;

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, 'the steps story runs once, on the phone');
});

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  assertFreeDisk();
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

async function signInAdmin(page: Page): Promise<void> {
  await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
}

test('1. admin: a second step and a conditional question through the builder, a refused layout, and the preview', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const stepOne = await seedStep(`${prefix} Sobre voce`);
  const opener = await seedQuestion({
    title: `${prefix} Você tem clínica, trabalha em clínica ou está aprendendo?`,
    type: 'single_choice',
    options: CLINIC_OPTIONS,
    stepId: stepOne.id,
  });
  const plain = await seedQuestion({
    title: `${prefix} Seu nome profissional`,
    type: 'short_text',
    required: true,
    stepId: stepOne.id,
  });
  const stepTwoTitle = `${prefix} Sobre a clinica`;
  const dependentTitle = `${prefix} Nome da clinica`;

  const admin = await newPhonePage(browser);
  try {
    await signInAdmin(admin.page);
    const { page } = admin;
    await openBuilder(page);

    // 'Adicionar etapa': the list lays itself into wells (one step is the plain list of Phase 12).
    await expect(page.getByRole('region', { name: stepOne.title })).toHaveCount(0);
    await page.getByRole('button', { name: 'Adicionar etapa' }).click();
    const stepSheet = page.getByRole('dialog', { name: 'Nova etapa' });
    await stepSheet.getByLabel('Título da etapa').fill(stepTwoTitle);
    await stepSheet.getByRole('button', { name: 'Salvar etapa' }).click();
    await expect(page.getByText('Etapa adicionada.')).toBeVisible();
    const wellTwo = page.getByRole('region', { name: stepTwoTitle });
    await expect(wellTwo).toBeVisible();
    await expect(page.getByRole('region', { name: stepOne.title })).toBeVisible();
    expect(await stepTitles(prefix)).toEqual([stepOne.title, stepTwoTitle]);

    // A question added from the second well lands in the second step.
    await page.getByRole('button', { name: `Adicionar pergunta à etapa: ${stepTwoTitle}` }).click();
    const editor = page.getByRole('dialog', { name: 'Nova pergunta' });
    await editor.locator('label[for="pf-type-short_text"]').click();
    await editor.getByRole('textbox', { name: 'Pergunta', exact: true }).fill(dependentTitle);
    const chosenStep = await editor
      .locator('#pf-step')
      .evaluate((element) => (element as HTMLSelectElement).selectedOptions[0]?.textContent);
    expect(chosenStep).toBe(stepTwoTitle);

    // ...and is made conditional on the opener: only 'Tenho uma clínica' opens it.
    await editor.getByRole('switch', { name: 'Mostrar só em alguns casos' }).click();
    await editor.locator('#pf-condition-opener').selectOption({ label: opener.title });
    await editor.getByRole('checkbox', { name: 'Tenho uma clínica' }).check();
    await editor.getByRole('button', { name: 'Salvar pergunta' }).click();
    await expect(page.getByText('Pergunta adicionada.')).toBeVisible();

    await expect(builderRow(page, dependentTitle)).toContainText('Condicional');
    await expect(builderRow(page, opener.title)).toContainText('Abre 1 pergunta');
    expect(await placementByTitle(dependentTitle)).toEqual({
      stepTitle: stepTwoTitle,
      conditionQuestionId: opener.id,
      conditionValues: [opener.optionIds[0]],
    });

    // A layout that puts the opener after its dependent is refused with the sentence naming both questions.
    await page.getByRole('button', { name: 'Reordenar' }).click();
    await page.getByRole('button', { name: `Subir etapa ${open(stepTwoTitle)}` }).click();
    await expect(
      page.getByText(
        `${open(dependentTitle)} precisa ficar depois de ${open(opener.title)}, que decide se ela aparece.`,
      ),
    ).toBeVisible();
    expect(await stepTitles(prefix)).toEqual([stepOne.title, stepTwoTitle]);
    await page.getByRole('button', { name: 'Concluir' }).click();

    // The preview: with no answer the member sees one step and two questions; answering the opener opens the
    // second step and 'Avançar' moves on although the required question is blank (a preview never validates).
    await page.getByRole('button', { name: 'Ver como o membro vê' }).click();
    const preview = page.getByRole('dialog', { name: 'Como o membro vê' });
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 2 perguntas.'),
    ).toBeVisible();
    await preview.getByRole('radio', { name: 'Tenho uma clínica' }).check();
    await expect(
      preview.getByText('Com estas respostas, o membro vê 2 etapas e 3 perguntas.'),
    ).toBeVisible();
    await expect(questionBlock(page, plain.id)).toBeVisible();
    await preview.getByRole('button', { name: 'Avançar' }).click();
    await expect(preview.getByText('Etapa 2 de 2')).toBeVisible();
    await expect(preview.getByRole('heading', { name: stepTwoTitle, level: 2 })).toBeVisible();
    await preview.getByRole('button', { name: 'Recomeçar' }).click();
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 2 perguntas.'),
    ).toBeVisible();
  } finally {
    await admin.context.close();
  }
});

test('2. member: the stepper grows when she opens the clinic questions, saves one step on "Avançar" and leaves the gate on "Concluir"', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const form = await seedClinicForm(prefix);
  const owner = email('owner');
  const learner = email('learner');
  await createAccount(owner);
  await createAccount(learner);

  const first = await newPhonePage(browser);
  try {
    const { page } = first;
    await signInIntoGate(page, owner);
    await expect(
      page.getByRole('heading', { name: 'Complete seu perfil', level: 1 }),
    ).toBeVisible();

    // Step 2 holds only clinic questions nobody opened yet: the path is one step, so there is no progress line.
    await expect(page.getByText(/^Etapa \d+ de \d+$/)).toHaveCount(0);
    await expect(questionBlock(page, form.plain.id)).toBeVisible();
    await expect(questionBlock(page, form.clinicRequired.id)).toHaveCount(0);

    await questionBlock(page, form.plain.id).getByRole('textbox').fill('Resposta de teste');
    const clinic = questionBlock(page, form.opener.id).getByRole('radio', {
      name: 'Tenho uma clínica',
    });
    await clinic.check();
    // The answer opened the second step: the progress line appears and the button reads 'Avançar'.
    await expect(page.getByText('Etapa 1 de 2', { exact: true })).toBeVisible();
    await expect(clinic).toBeFocused();
    await page.getByRole('button', { name: 'Avançar' }).click();

    // One step was saved; the second step's heading takes focus and nothing of step 2 exists yet.
    await expect(page.getByText('Etapa 2 de 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: form.stepTwo.title, level: 2 })).toBeFocused();
    await expect
      .poll(() => storedAnswer(owner, form.opener.id))
      .toEqual({ optionId: form.opener.optionIds[0], otherText: null });
    expect(await storedAnswer(owner, form.plain.id)).toBe('Resposta de teste');
    expect(await storedAnswer(owner, form.clinicRequired.id)).toBeUndefined();

    // 'Concluir' with the required clinic question blank saves nothing and says why.
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(questionBlock(page, form.clinicRequired.id)).toContainText(
      'Responda esta pergunta.',
    );
    await expect(page).toHaveURL(/\/completar-perfil/);

    await questionBlock(page, form.clinicRequired.id)
      .getByRole('textbox')
      .fill('Resposta de teste');
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await storedAnswer(owner, form.clinicRequired.id)).toBe('Resposta de teste');
  } finally {
    await first.context.close();
  }

  // Another option: step 2 has nothing visible, so the form ends after step 1.
  const second = await newPhonePage(browser);
  try {
    const { page } = second;
    await signInIntoGate(page, learner);
    await questionBlock(page, form.plain.id).getByRole('textbox').fill('Resposta de teste');
    await questionBlock(page, form.opener.id)
      .getByRole('radio', { name: 'Estou aprendendo' })
      .check();
    await expect(page.getByText(/^Etapa \d+ de \d+$/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Avançar' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await storedAnswer(learner, form.opener.id)).toEqual({
      optionId: form.opener.optionIds[2],
      otherText: null,
    });
    expect(await storedAnswer(learner, form.clinicRequired.id)).toBeUndefined();
  } finally {
    await second.context.close();
  }
});

test('3. member: "Minhas respostas" is one scroll; changing the opener asks before it erases, and the staff read "Não se aplica"', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const form = await seedClinicForm(prefix);
  const who = email('editor');
  await createAccount(who);
  await answerFor(who, form.opener.id, { optionId: form.opener.optionIds[0], otherText: null });
  await answerFor(who, form.plain.id, 'Resposta de teste');
  await answerFor(who, form.clinicRequired.id, 'Resposta de teste');
  await answerFor(who, form.clinicOptional.id, 'Resposta de teste');

  const member = await newPhonePage(browser);
  try {
    const { page } = member;
    await signInToLab(page, who);
    await gotoWhileRedirected(page, EDIT_URL);

    // One scroll: the step titles are headings, there is one 'Salvar' and no stepper.
    await expect(page.getByRole('heading', { name: 'Minhas respostas', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: form.stepOne.title, level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: form.stepTwo.title, level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Avançar' })).toHaveCount(0);
    await expect(page.getByText(/^Etapa \d+ de \d+$/)).toHaveCount(0);

    // Changing the opener closes the clinic questions in place.
    const learning = questionBlock(page, form.opener.id).getByRole('radio', {
      name: 'Estou aprendendo',
    });
    await learning.check();
    await expect(questionBlock(page, form.clinicRequired.id)).toHaveCount(0);
    await expect(questionBlock(page, form.clinicOptional.id)).toHaveCount(0);

    // The dialog lists the closed questions by title (never an answer) and 'Rever respostas' saves nothing.
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const erase = page.getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' });
    await expect(erase).toBeVisible();
    const list = erase.getByRole('list', { name: 'Perguntas que serão apagadas' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText(form.clinicRequired.title);
    await expect(list).toContainText(form.clinicOptional.title);
    await expect(list).not.toContainText(form.plain.title);
    await erase.getByRole('button', { name: 'Rever respostas' }).click();
    await expect(erase).toBeHidden();
    await expect(learning).toBeChecked();
    expect(await storedAnswer(who, form.opener.id)).toEqual({
      optionId: form.opener.optionIds[0],
      otherText: null,
    });
    expect(await storedAnswer(who, form.clinicRequired.id)).toBe('Resposta de teste');

    // 'Apagar e salvar' saves the opener and deletes the two answers in the same save.
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' })
      .getByRole('button', { name: 'Apagar e salvar' })
      .click();
    await expect(page).toHaveURL(/\/perfil$/, { timeout: 30_000 });
    expect(await storedAnswer(who, form.opener.id)).toEqual({
      optionId: form.opener.optionIds[2],
      otherText: null,
    });
    expect(await storedAnswer(who, form.clinicRequired.id)).toBeUndefined();
    expect(await storedAnswer(who, form.clinicOptional.id)).toBeUndefined();
    await expect(page.locator(MY_ANSWERS)).not.toContainText(form.clinicRequired.title);

    // Reopening the clinic option shows the questions in place; focus stays on the opener.
    await gotoWhileRedirected(page, EDIT_URL);
    const clinic = questionBlock(page, form.opener.id).getByRole('radio', {
      name: 'Tenho uma clínica',
    });
    await clinic.check();
    await expect(questionBlock(page, form.clinicRequired.id)).toBeVisible();
    await expect(questionBlock(page, form.clinicOptional.id)).toBeVisible();
    await expect(clinic).toBeFocused();
    await expect(page.getByText('Apareceram 2 novas perguntas.')).toBeAttached();
  } finally {
    await member.context.close();
  }

  // The staff read the closed questions as 'Não se aplica'.
  const membershipId = await membershipIdFor(who, LAB);
  const staff = await newPhonePage(browser);
  try {
    await signInAdmin(staff.page);
    await openMemberAsStaff(staff.page, membershipId);
    const block = staff.page.locator('[data-member-answers="staff"]');
    await expect(block).toContainText(form.clinicRequired.title);
    await expect(block).toContainText('Não se aplica');
  } finally {
    await staff.context.close();
  }
});

test('4a. at 320px the stepper with ten steps keeps every control on screen', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const ten = await seedTenSteps(prefix);
  const who = email('ten');
  await createAccount(who);

  const { context, page } = await newPhonePage(browser, 320);
  try {
    await signInIntoGate(page, who);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);
    await expect(page.getByText('Etapa 1 de 10', { exact: true })).toBeVisible();
    await expectScreenFits(page, 'E3 320px stepper, step 1 of 10', {
      Avançar: page.getByRole('button', { name: 'Avançar' }),
      'first text control': page.getByRole('textbox').first(),
    });

    const firstQuestion = ten.questions[0];
    if (!firstQuestion) throw new Error('the ten-step form has no first question');
    await questionBlock(page, firstQuestion.id).getByRole('textbox').fill('Resposta de teste');
    await page.getByRole('button', { name: 'Avançar' }).click();
    await expect(page.getByText('Etapa 2 de 10', { exact: true })).toBeVisible();
    await expectScreenFits(page, 'E3 320px stepper, step 2 of 10', {
      Voltar: page.getByRole('button', { name: 'Voltar' }),
      Avançar: page.getByRole('button', { name: 'Avançar' }),
    });
  } finally {
    await context.close();
  }
});

test('4b. at 320px the builder wells, the condition editor and the preview keep every control on screen', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const wide = await seedWideForm(prefix);
  const dependent = wide.dependents[0];
  if (!dependent) throw new Error('the wide form has no conditional question');

  const admin = await newPhonePage(browser, 320);
  try {
    const { page } = admin;
    await signInAdmin(page);
    await openBuilder(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);

    // E3: the wells with 60-character step titles, 120-character question titles and the condition lines.
    await expect(page.getByRole('region', { name: wide.stepTwo.title })).toBeVisible();
    await expectNoHorizontalScroll(page, 'E3 320px builder wells');
    await page.getByRole('button', { name: 'Reordenar' }).click();
    await expectNoHorizontalScroll(page, 'E3 320px builder wells in reorder mode');
    await page.getByRole('button', { name: 'Concluir' }).click();

    // E5: the condition editor of a conditional question with a long title, an opener of 20 options of 80
    // characters.
    await builderRow(page, dependent.title).click();
    const sheet = page.getByRole('dialog', { name: 'Editar pergunta' });
    await expect(sheet.locator('[data-condition-values]')).toBeVisible();
    await expect(sheet.locator('[data-condition-values] input[type="checkbox"]')).toHaveCount(20);
    await expectContained(sheet, 'E5 320px condition editor');
    await expectNoHorizontalScroll(page, 'E5 320px condition editor, page');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // E7: the preview with a long step title; answering the opener opens the second step.
    await page.getByRole('button', { name: 'Ver como o membro vê' }).click();
    const preview = page.getByRole('dialog', { name: 'Como o membro vê' });
    await expectContained(preview, 'E7 320px preview, step 1');
    await preview.getByRole('radio').first().check();
    await preview.getByRole('button', { name: 'Avançar' }).click();
    await expect(
      preview.getByRole('heading', { name: wide.stepTwo.title, level: 2 }),
    ).toBeVisible();
    await expectContained(preview, 'E7 320px preview, long step title');
    await expectNoHorizontalScroll(page, 'E7 320px preview, page');
  } finally {
    await admin.context.close();
  }
});

test('4c. at 320px the erase dialog with five long titles and "Minhas respostas" with every conditional row omitted keep every control on screen', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const wide = await seedWideForm(prefix);
  const eraser = email('eraser');
  const stale = email('stale');
  await createAccount(eraser);
  await createAccount(stale);
  await answerFor(eraser, wide.opener.id, { optionId: wide.opener.optionIds[0], otherText: null });
  for (const dependent of wide.dependents) {
    await answerFor(eraser, dependent.id, 'Resposta de teste');
    // The other member holds the same answers with NO opener answer: every conditional row is omitted.
    await answerFor(stale, dependent.id, 'Resposta de teste');
  }

  // E8: the erase dialog lists five 120-character titles.
  const first = await newPhonePage(browser, 320);
  try {
    const { page } = first;
    await signInToLab(page, eraser);
    await gotoWhileRedirected(page, EDIT_URL);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);
    await expectNoHorizontalScroll(page, 'E8 320px one-scroll edit');
    await questionBlock(page, wide.opener.id).getByRole('radio').nth(1).check();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const erase = page.getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' });
    await expect(erase).toBeVisible();
    await expect(
      erase.getByRole('list', { name: 'Perguntas que serão apagadas' }).getByRole('listitem'),
    ).toHaveCount(5);
    await expectContained(erase, 'E8 320px erase dialog with five 120-character titles');
    await expectNoHorizontalScroll(page, 'E8 320px erase dialog, page');
    await erase.getByRole('button', { name: 'Rever respostas' }).click();
    await expect(erase).toBeHidden();
    // Nothing was saved by looking.
    expect(await storedAnswer(eraser, wide.opener.id)).toEqual({
      optionId: wide.opener.optionIds[0],
      otherText: null,
    });
  } finally {
    await first.context.close();
  }

  // E9: nothing of hers applies, so Phase 12's empty state shows instead of five 'Sem resposta' rows.
  const second = await newPhonePage(browser, 320);
  try {
    const { page } = second;
    await signInToLab(page, stale);
    await gotoWhileRedirected(page, `${hosts.lab}/perfil`);
    const section = page.locator(MY_ANSWERS);
    await expect(section).toBeVisible();
    await expect(section).toContainText('Você ainda não respondeu');
    for (const dependent of wide.dependents) {
      await expect(section).not.toContainText(dependent.title);
    }
    await expectNoHorizontalScroll(
      page,
      'E9 320px Minhas respostas, every conditional row omitted',
    );
  } finally {
    await second.context.close();
  }
});
