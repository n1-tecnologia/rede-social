import { expect, type Locator, type Page, test } from '@playwright/test';
import { membershipIdFor } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  activeTitles,
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
  seedClinicTreeForm,
  seedLongTreeForm,
  seedQuestion,
  seedStep,
  signInIntoGate,
  signInToLab,
  snapshot,
  storedAnswer,
} from './profile-form';

/**
 * 12.2-21, Task 1: the conditional BRANCHES of the profile form in a browser, on the phone project, against the real
 * API and database (PFORM-56, 57, 58, 59, 60; UI-D-679, UI-D-682, UI-D-684). A branch groups the questions one answer of
 * an opener opens, to three levels; the member sees the block appear under one rail, the admin builds it in the Lista,
 * reads it in the Fluxo and previews it.
 *
 *   1   the admin builds the clinic form through the builder: 'Criar ramo' for the first option of the opener, two
 *       questions added into it through the footer, a yes/no inside it that opens a nested branch with one question,
 *       then a third level; the Lista reads as three indented blocks with the opener pill; 'Fluxo' draws the edges
 *       with the answers (no sideways scroll), a node tap and an edge tap open the editors; 'Ver como o membro vê'
 *       shows the whole block when the opener is ticked
 *   2   the Lista on the seeded depth-3 form: the opener pill, a branch arrow reorders two runs of one opener, a
 *       question arrow never changes a branch, a public question cannot be made public under a private opener,
 *       'Desfazer ramo' shows the member impact before it confirms and leaves the questions visible, 'Arquivar
 *       ramo' moves the block to Arquivadas where 'Reativar ramo' brings it back
 *   3   the member walks the stepper: the block appears as one under one rail with focus on the opener, the nested
 *       block appears, changing the opener opens the erase dialog with the titles of every level in form order,
 *       'Rever respostas' saves nothing, 'Apagar e continuar' deletes in the save, the staff read 'Não se aplica',
 *       and a second member who answers another option never sees the block
 *   4a  the 320px backstop of the builder (Lista with three levels, the question sheet of an opener with 20 options
 *       of 80 characters, the branch sheet with a 60-character name, the Fluxo with 20 answers on an edge, Arquivadas)
 *   4b  the 320px backstop of the member screens (the nested block with long titles and long option labels, the erase
 *       dialog with seven 120-character titles)
 *
 * The wording of the clinic form is the team's EXAMPLE of the first client's case (Research A10). The client's real
 * question list is NOT in the repository and is never invented here. No answer below is a real member's: every value
 * is a neutral test string. The 320px assertions read the pixels the jsdom class assertions of plans 14 to 19 could
 * not (the UI Considerations backstop rows E3, E4, E10 and E11).
 *
 * Every row carries the run prefix and goes away with `resetProfileForm` (`beforeAll` and `afterAll`); the module row
 * is put back exactly as found. The specs locate by the accessible names and the catalog texts of plans 13 to 19
 * (`profileForm.member.*` and `profileForm.admin.*`).
 *
 * Written under the disk limit of the 12.2 phase and NOT executed by plan 12.2-21: listing and type-checking only.
 * The first run is ledger row M5 of `12.2-MANUAL-PROOFS.md`. The free-space guard below refuses to start under 10 GiB,
 * so a run can never fill the disk and hang Docker.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const email = (tag: string) => `${prefix}-${tag}@rede-lab.local`;
const open = (text: string) => `“${text}”`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The one-scroll edit screen of the answers: the same route and save the first answer used. */
const EDIT_URL = `${hosts.lab}/completar-perfil?next=%2Fperfil`;

let before: Awaited<ReturnType<typeof snapshot>>;

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, 'the branches story runs once, on the phone');
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

/** The footer of the block of the branch(es) opened by the question titled `openerTitle`. */
function footerOf(page: Page, openerTitle: string): Locator {
  return page.getByRole('button', {
    name: new RegExp(`^Adicionar pergunta ao ramo: Se “${escapeRegExp(openerTitle)}”`),
  });
}

/** 'Adicionar pergunta ao ramo' of the block opened by `openerTitle`, then the question sheet to its save. */
async function addQuestionToBranch(
  page: Page,
  openerTitle: string,
  title: string,
  type: 'short_text' | 'yes_no',
): Promise<void> {
  await footerOf(page, openerTitle).click();
  const editor = page.getByRole('dialog', { name: 'Nova pergunta' });
  await editor.locator(`label[for="pf-type-${type}"]`).click();
  await editor.getByRole('textbox', { name: 'Pergunta', exact: true }).fill(title);
  await editor.getByRole('button', { name: 'Salvar pergunta' }).click();
  await expect(editor).toBeHidden();
  await expect(builderRow(page, title)).toBeVisible();
}

/** 'Criar ramo' from the sheet of the question titled `questionTitle`; `pick` ticks the answer that opens it. */
async function createBranchFrom(
  page: Page,
  questionTitle: string,
  pick: (sheet: Locator) => Promise<void>,
): Promise<void> {
  await builderRow(page, questionTitle).click();
  await page
    .getByRole('dialog', { name: 'Editar pergunta' })
    .getByRole('button', { name: 'Criar ramo' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Novo ramo' });
  await pick(sheet);
  await sheet.getByRole('button', { name: 'Salvar ramo' }).click();
  await expect(sheet).toBeHidden();
}

/**
 * How deep each branch block of the Lista sits, in document order: 1 for a block under a plain question, 2 for a
 * block inside a block, and so on. A block is any element whose direct child is a branch strip.
 */
async function branchDepths(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const isBlock = (element: Element) =>
      Array.from(element.children).some((child) => child.hasAttribute('data-branch-strip'));
    return Array.from(document.querySelectorAll('[data-branch-strip]')).map((strip) => {
      let depth = 0;
      for (let node = strip.parentElement; node; node = node.parentElement) {
        if (isBlock(node)) depth += 1;
      }
      return depth;
    });
  });
}

test('1. admin: builds the clinic branches through the builder, reads the Lista and the Fluxo, and previews the block', async ({
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
    stepId: stepOne.id,
  });
  const clinicName = `${prefix} Nome da clinica`;
  const insurance = `${prefix} A clinica atende convenio?`;
  const manyOperators = `${prefix} Atende mais de uma operadora?`;
  const operators = `${prefix} Quais operadoras?`;

  const admin = await newPhonePage(browser);
  try {
    await signInAdmin(admin.page);
    const { page } = admin;
    await openBuilder(page);

    // Level 1: 'Criar ramo' for the first option, then two questions added into it through the footer.
    await createBranchFrom(page, opener.title, async (sheet) => {
      await sheet.getByRole('checkbox', { name: 'Tenho uma clínica' }).check();
    });
    await addQuestionToBranch(page, opener.title, clinicName, 'short_text');
    await addQuestionToBranch(page, opener.title, insurance, 'yes_no');
    expect(await placementByTitle(clinicName)).toMatchObject({
      branchOpenerQuestionId: opener.id,
      branchValues: [opener.optionIds[0]],
    });

    // Level 2: the yes/no opens a nested branch on 'Sim' with one question, which is again a yes/no.
    await createBranchFrom(page, insurance, async (sheet) => {
      await sheet.getByRole('button', { name: 'Sim', exact: true }).click();
    });
    await addQuestionToBranch(page, insurance, manyOperators, 'yes_no');
    // Level 3: the last yes/no opens the deepest block.
    await createBranchFrom(page, manyOperators, async (sheet) => {
      await sheet.getByRole('button', { name: 'Sim', exact: true }).click();
    });
    await addQuestionToBranch(page, manyOperators, operators, 'short_text');
    const deepest = await placementByTitle(operators);
    expect(deepest?.branchValues).toEqual(['true']);

    // The Lista reads as three indented blocks, and the opener carries the pill.
    expect(await branchDepths(page)).toEqual([1, 2, 3]);
    await expect(builderRow(page, opener.title)).toContainText(/Abre \d+ perguntas?/);
    await expect(builderRow(page, insurance)).toContainText(/Abre 1 pergunta/);
    await expectNoHorizontalScroll(page, 'the Lista with three levels');

    // The Fluxo: the edges carry the answers, nothing scrolls sideways.
    await page.getByRole('button', { name: 'Fluxo', exact: true }).click();
    const flow = page.getByRole('region', { name: 'Fluxo do formulário' });
    await expect(flow).toBeVisible();
    const edges = flow.getByRole('button', { name: /^Se for/ });
    await expect(edges).toHaveCount(3);
    await expect(edges.first()).toContainText('Tenho uma clínica');
    await expect(edges.nth(1)).toContainText('Sim');
    await expect(edges.nth(2)).toContainText('Sim');
    await expectNoHorizontalScroll(page, 'the Fluxo with three levels');

    // A tap on a node opens the question editor, a tap on an edge opens the branch editor; focus comes back.
    const node = flow.getByRole('button', { name: `Editar pergunta: ${insurance}` });
    await node.click();
    const questionSheet = page.getByRole('dialog', { name: 'Editar pergunta' });
    await expect(questionSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(questionSheet).toBeHidden();
    await edges.first().click();
    const branchSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await expect(branchSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(branchSheet).toBeHidden();
    await page.getByRole('button', { name: 'Lista', exact: true }).click();

    // The preview: with no answer the member sees the opener and the plain question; ticking the opener shows the
    // whole block at once, and answering 'Sim' to the yes/no opens the nested block.
    await page.getByRole('button', { name: 'Ver como o membro vê' }).click();
    const preview = page.getByRole('dialog', { name: 'Como o membro vê' });
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 2 perguntas.'),
    ).toBeVisible();
    await expect(questionBlock(page, plain.id)).toBeVisible();
    await preview.getByRole('radio', { name: 'Tenho uma clínica' }).check();
    await expect(preview.getByText(clinicName)).toBeVisible();
    await expect(preview.getByText(insurance)).toBeVisible();
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 4 perguntas.'),
    ).toBeVisible();
    await preview.getByRole('button', { name: 'Sim', exact: true }).click();
    await expect(preview.getByText(manyOperators)).toBeVisible();
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 5 perguntas.'),
    ).toBeVisible();
    await preview.getByRole('button', { name: 'Recomeçar' }).click();
    await expect(
      preview.getByText('Com estas respostas, o membro vê 1 etapa e 2 perguntas.'),
    ).toBeVisible();
  } finally {
    await admin.context.close();
  }
});

test('2. admin: the Lista nests three levels, reorders blocks by branch arrows only, undoes and archives a branch, and keeps a question private under a private opener', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const form = await seedClinicTreeForm(prefix);

  const admin = await newPhonePage(browser);
  try {
    await signInAdmin(admin.page);
    const { page } = admin;
    await openBuilder(page);

    // Three levels, two runs of the same opener, and the opener pill.
    expect(await branchDepths(page)).toEqual([1, 2, 3, 1]);
    await expect(builderRow(page, form.opener.title)).toContainText(/Abre \d+ perguntas/);
    await expectNoHorizontalScroll(page, 'the Lista of the depth-3 form');

    // A branch arrow reorders two runs of one opener: the second run goes above the first.
    await page.getByRole('button', { name: 'Reordenar' }).click();
    await page.getByRole('button', { name: `Subir ramo ${open(form.names.works)}` }).click();
    await expect
      .poll(async () => {
        const titles = await activeTitles(prefix);
        return titles.indexOf(form.worksWhere.title) < titles.indexOf(form.clinicName.title);
      })
      .toBe(true);

    // A question arrow never changes a branch: the yes/no moves above the required question, in the same branch.
    await page.getByRole('button', { name: `Subir ${open(form.insurance.title)}` }).click();
    await expect
      .poll(async () => {
        const titles = await activeTitles(prefix);
        return titles.indexOf(form.insurance.title) < titles.indexOf(form.clinicName.title);
      })
      .toBe(true);
    expect(await placementByTitle(form.insurance.title)).toMatchObject({
      branchOpenerQuestionId: form.opener.id,
      branchValues: [form.opener.optionIds[0]],
    });
    await expect(
      page.getByRole('button', { name: `Subir ${open(form.insurance.title)}` }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Concluir' }).click();

    // A public question cannot be made public under a private opener: the switch is off, disabled, with the reason.
    await builderRow(page, form.clinicName.title).click();
    const editor = page.getByRole('dialog', { name: 'Editar pergunta' });
    const publicSwitch = editor.getByRole('switch', { name: 'Mostrar no perfil do membro' });
    await expect(publicSwitch).toBeDisabled();
    await expect(editor.getByText(/Esta pergunta está num ramo que depende de/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();

    // 'Desfazer ramo' reads the member impact first: the owner branch holds a required question, so members are
    // told they will have to answer it; keeping the branch changes nothing.
    await page.getByRole('button', { name: `Editar ramo: ${form.names.owns}` }).click();
    const ownsSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await ownsSheet.getByRole('button', { name: 'Desfazer ramo' }).click();
    const undoOwns = page.getByRole('dialog', { name: 'Desfazer este ramo?' });
    await expect(undoOwns).toContainText(/precisar respondê-las/);
    await undoOwns.getByRole('button', { name: 'Manter ramo' }).click();
    await expect(undoOwns).toBeHidden();
    expect((await placementByTitle(form.clinicName.title))?.branchOpenerQuestionId).toBe(
      form.opener.id,
    );
    await page.keyboard.press('Escape');
    await expect(ownsSheet).toBeHidden();

    // Undoing the second run (one optional question): no impact sentence, the question stays visible for everyone.
    await page.getByRole('button', { name: `Editar ramo: ${form.names.works}` }).click();
    const worksSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await worksSheet.getByRole('button', { name: 'Desfazer ramo' }).click();
    const undoWorks = page.getByRole('dialog', { name: 'Desfazer este ramo?' });
    await expect(undoWorks).toContainText('A pergunta dele continua no formulário');
    await undoWorks.getByRole('button', { name: 'Desfazer ramo' }).click();
    await expect(builderRow(page, form.worksWhere.title)).toBeVisible();
    await expect
      .poll(async () => (await placementByTitle(form.worksWhere.title))?.branchOpenerQuestionId)
      .toBeNull();

    // 'Arquivar ramo' moves the deepest block to Arquivadas; 'Reativar ramo' brings it back.
    await page.getByRole('button', { name: `Editar ramo: ${form.names.operators}` }).click();
    const archiveSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await archiveSheet.getByRole('button', { name: 'Arquivar ramo' }).click();
    await page
      .getByRole('dialog', { name: 'Arquivar este ramo?' })
      .getByRole('button', { name: 'Arquivar ramo' })
      .click();
    await expect(builderRow(page, form.operators.title)).toBeHidden();

    await openBuilder(page, 'arquivadas');
    const group = page.locator('[data-archived-group]');
    await expect(group).toContainText(form.operators.title);
    await group.getByRole('button', { name: `Reativar ramo: ${form.names.operators}` }).click();
    await expect(page.locator('[data-archived-group]')).toHaveCount(0);

    await openBuilder(page);
    await expect(builderRow(page, form.operators.title)).toBeVisible();
    expect((await placementByTitle(form.operators.title))?.branchOpenerQuestionId).toBe(
      form.manyOperators.id,
    );
  } finally {
    await admin.context.close();
  }
});

test('3. member: the branch blocks appear as one under one rail, the erase dialog lists every level in form order, and a second member never sees the block', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const form = await seedClinicTreeForm(prefix);
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
    await expect(page.getByText('Etapa 1 de 2', { exact: true })).toBeVisible();

    // Nothing of the branches shows before the opener is answered.
    const rails = page.locator('[data-revealed-branch]');
    await expect(rails).toHaveCount(0);
    await expect(questionBlock(page, form.clinicName.id)).toHaveCount(0);
    await questionBlock(page, form.plain.id).getByRole('textbox').fill('Resposta de teste');

    // The opener opens the whole block at once, under ONE rail, and focus stays on the opener.
    const owns = questionBlock(page, form.opener.id).getByRole('radio', {
      name: 'Tenho uma clínica',
    });
    await owns.check();
    await expect(rails).toHaveCount(1);
    const block = rails.first();
    await expect(block.locator(`[data-question="${form.clinicName.id}"]`)).toBeVisible();
    await expect(block.locator(`[data-question="${form.insurance.id}"]`)).toBeVisible();
    await expect(owns).toBeFocused();
    await expect(questionBlock(page, form.worksWhere.id)).toHaveCount(0);

    // The nested opener opens a block INSIDE the first one, and so does the third level.
    const sim = (id: string) => questionBlock(page, id).getByRole('button', { name: 'Sim' });
    await sim(form.insurance.id).click();
    await expect(page.locator('[data-revealed-branch] [data-revealed-branch]')).toHaveCount(1);
    await expect(questionBlock(page, form.manyOperators.id)).toBeVisible();
    await expect(sim(form.insurance.id)).toBeFocused();
    await sim(form.manyOperators.id).click();
    await expect(
      page.locator('[data-revealed-branch] [data-revealed-branch] [data-revealed-branch]'),
    ).toHaveCount(1);
    await expect(questionBlock(page, form.operators.id)).toBeVisible();
    await questionBlock(page, form.clinicName.id).getByRole('textbox').fill('Resposta de teste');
    await questionBlock(page, form.operators.id).getByRole('textbox').fill('Resposta de teste');

    // 'Avançar' saves step 1 with the answers of every level.
    await page.getByRole('button', { name: 'Avançar' }).click();
    await expect(page.getByText('Etapa 2 de 2', { exact: true })).toBeVisible();
    await expect
      .poll(() => storedAnswer(owner, form.opener.id))
      .toEqual({ optionId: form.opener.optionIds[0], otherText: null });
    expect(await storedAnswer(owner, form.insurance.id)).toBe(true);
    expect(await storedAnswer(owner, form.manyOperators.id)).toBe(true);
    expect(await storedAnswer(owner, form.operators.id)).toBe('Resposta de teste');

    // Changing the opener closes the three levels and asks before it erases.
    await page.getByRole('button', { name: 'Voltar' }).click();
    const learning = questionBlock(page, form.opener.id).getByRole('radio', {
      name: 'Estou aprendendo',
    });
    await learning.check();
    await expect(rails).toHaveCount(0);
    await page.getByRole('button', { name: 'Avançar' }).click();
    const erase = page.getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' });
    await expect(erase).toBeVisible();
    const list = erase.getByRole('list', { name: 'Perguntas que serão apagadas' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('listitem')).toContainText([
      form.clinicName.title,
      form.insurance.title,
      form.manyOperators.title,
      form.operators.title,
    ]);
    await expect(list).not.toContainText(form.plain.title);

    // 'Rever respostas' saves nothing.
    await erase.getByRole('button', { name: 'Rever respostas' }).click();
    await expect(erase).toBeHidden();
    await expect(learning).toBeChecked();
    expect(await storedAnswer(owner, form.opener.id)).toEqual({
      optionId: form.opener.optionIds[0],
      otherText: null,
    });
    expect(await storedAnswer(owner, form.clinicName.id)).toBe('Resposta de teste');

    // 'Apagar e continuar' deletes the four answers in the same save and moves on.
    await page.getByRole('button', { name: 'Avançar' }).click();
    await page
      .getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' })
      .getByRole('button', { name: 'Apagar e continuar' })
      .click();
    await expect(page.getByText('Etapa 2 de 2', { exact: true })).toBeVisible();
    await expect
      .poll(() => storedAnswer(owner, form.opener.id))
      .toEqual({ optionId: form.opener.optionIds[2], otherText: null });
    expect(await storedAnswer(owner, form.clinicName.id)).toBeUndefined();
    expect(await storedAnswer(owner, form.insurance.id)).toBeUndefined();
    expect(await storedAnswer(owner, form.manyOperators.id)).toBeUndefined();
    expect(await storedAnswer(owner, form.operators.id)).toBeUndefined();
  } finally {
    await first.context.close();
  }

  // The staff read the closed branch as 'Não se aplica'.
  const membershipId = await membershipIdFor(owner, LAB);
  const staff = await newPhonePage(browser);
  try {
    await signInAdmin(staff.page);
    await openMemberAsStaff(staff.page, membershipId);
    const answers = staff.page.locator('[data-member-answers="staff"]');
    await expect(answers).toContainText(form.clinicName.title);
    await expect(answers).toContainText('Não se aplica');
  } finally {
    await staff.context.close();
  }

  // A second member who answers another option never sees the block.
  const second = await newPhonePage(browser);
  try {
    const { page } = second;
    await signInIntoGate(page, learner);
    await questionBlock(page, form.plain.id).getByRole('textbox').fill('Resposta de teste');
    await questionBlock(page, form.opener.id)
      .getByRole('radio', { name: 'Estou aprendendo' })
      .check();
    await expect(page.locator('[data-revealed-branch]')).toHaveCount(0);
    await expect(questionBlock(page, form.clinicName.id)).toHaveCount(0);
    await expect(questionBlock(page, form.worksWhere.id)).toHaveCount(0);
    await page.getByRole('button', { name: 'Avançar' }).click();
    await expect(page.getByText('Etapa 2 de 2', { exact: true })).toBeVisible();
    expect(await storedAnswer(learner, form.clinicName.id)).toBeUndefined();
  } finally {
    await second.context.close();
  }
});

test('4a. at 320px the builder keeps every control on screen: three levels, 20 long options, a 60-character name, the Fluxo with 20 answers and Arquivadas', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const tree = await seedLongTreeForm(prefix, 'all');

  const admin = await newPhonePage(browser, 320);
  try {
    const { page } = admin;
    await signInAdmin(page);
    await openBuilder(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);

    // E3: the Lista with three levels, 120-character titles and a 60-character branch name.
    await expect(builderRow(page, tree.opener.title)).toBeVisible();
    expect(await branchDepths(page)).toEqual([1, 2, 3]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S1 320px Lista with three levels: the document scrolls sideways',
    ).toBeLessThanOrEqual(320);

    // E4: the question sheet of an opener with 20 options of 80 characters.
    await builderRow(page, tree.opener.title).click();
    const questionSheet = page.getByRole('dialog', { name: 'Editar pergunta' });
    await expectContained(questionSheet, 'S2 320px question sheet with 20 long options');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S2 320px question sheet: the page scrolls sideways',
    ).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await expect(questionSheet).toBeHidden();

    // E4: the branch sheet with a 60-character name, a 120-character opener title and 20 ticked answers.
    await page
      .getByRole('button', { name: /^Editar ramo:/ })
      .first()
      .click();
    const branchSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await expect(branchSheet.locator('[data-branch-values] input[type="checkbox"]')).toHaveCount(
      20,
    );
    await expectContained(branchSheet, 'S3 320px branch sheet with a 60-character name');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S3 320px branch sheet: the page scrolls sideways',
    ).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await expect(branchSheet).toBeHidden();

    // E10: the Fluxo with three levels, long titles and an edge that names 20 answers (four, then "e mais 16").
    await page.getByRole('button', { name: 'Fluxo', exact: true }).click();
    const flow = page.getByRole('region', { name: 'Fluxo do formulário' });
    await expect(flow).toBeVisible();
    await expect(flow.getByRole('button', { name: /^Se for/ }).first()).toContainText('e mais 16');
    await expectContained(flow, 'S4 320px Fluxo');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S4 320px Fluxo with 20 answers on an edge: the document scrolls sideways',
    ).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'Lista', exact: true }).click();

    // E11: Arquivadas with the deepest block archived (a 120-character title under a nested group).
    await page
      .getByRole('button', { name: /^Editar ramo:/ })
      .nth(2)
      .click();
    const archiveSheet = page.getByRole('dialog', { name: 'Editar ramo' });
    await archiveSheet.getByRole('button', { name: 'Arquivar ramo' }).click();
    await page
      .getByRole('dialog', { name: 'Arquivar este ramo?' })
      .getByRole('button', { name: 'Arquivar ramo' })
      .click();
    await openBuilder(page, 'arquivadas');
    const group = page.locator('[data-archived-group]');
    await expect(group).toBeVisible();
    await expect(group).toContainText(tree.chain[2]?.title ?? '');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S5 320px Arquivadas with an archived nested block: the document scrolls sideways',
    ).toBeLessThanOrEqual(320);
  } finally {
    await admin.context.close();
  }
});

test('4b. at 320px the member screens keep every control on screen: the nested block with long titles and the erase dialog with seven long titles', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const tree = await seedLongTreeForm(prefix, 'first');
  const eraser = email('eraser');
  await createAccount(eraser);
  // She has answered the opener with its first option, 'Sim' to both yes/no questions, and every other question.
  await answerFor(eraser, tree.opener.id, { optionId: tree.opener.optionIds[0], otherText: null });
  for (const question of tree.chain) {
    const isYesNo = question.id === tree.yesNoA.id || question.id === tree.yesNoB.id;
    await answerFor(eraser, question.id, isYesNo ? true : 'Resposta de teste');
  }

  const member = await newPhonePage(browser, 320);
  try {
    const { page } = member;
    await signInToLab(page, eraser);
    await gotoWhileRedirected(page, EDIT_URL);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);

    // E10: the nested block, three levels deep, with 120-character titles and 80-character option labels.
    await expect(
      page.locator('[data-revealed-branch] [data-revealed-branch] [data-revealed-branch]'),
    ).toHaveCount(1);
    await expect(questionBlock(page, tree.opener.id)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S6 320px member nested block: the document scrolls sideways',
    ).toBeLessThanOrEqual(320);

    // E11: the erase dialog lists the seven 120-character titles of the whole subtree.
    await questionBlock(page, tree.opener.id).getByRole('radio').nth(1).check();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const erase = page.getByRole('dialog', { name: 'Apagar respostas que deixaram de valer?' });
    await expect(erase).toBeVisible();
    await expect(
      erase.getByRole('list', { name: 'Perguntas que serão apagadas' }).getByRole('listitem'),
    ).toHaveCount(7);
    await expectContained(erase, 'S7 320px erase dialog with seven 120-character titles');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'S7 320px erase dialog: the page scrolls sideways',
    ).toBeLessThanOrEqual(320);
    await erase.getByRole('button', { name: 'Rever respostas' }).click();
    await expect(erase).toBeHidden();
    // Nothing was saved by looking.
    expect(await storedAnswer(eraser, tree.opener.id)).toEqual({
      optionId: tree.opener.optionIds[0],
      otherText: null,
    });
  } finally {
    await member.context.close();
  }
});
