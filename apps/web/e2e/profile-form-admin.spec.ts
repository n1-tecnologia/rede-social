import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  activeTitles,
  answerCount,
  answerFor,
  BACKSTOP_WIDTHS,
  builderRow,
  clearForm,
  closeProfileForm,
  createAccount,
  enableProfileForm,
  expectNoHorizontalScroll,
  expectScreenFits,
  expectTouchTarget,
  gotoWhileRedirected,
  LAB,
  longTitle,
  newPhonePage,
  newRunPrefix,
  openBuilder,
  openUntilReady,
  PASSWORD,
  PHONE_PROJECT,
  PROFILE_FORM_NAMESPACE,
  questionByTitle,
  resetProfileForm,
  seedQuestion,
  signInToLab,
  snapshot,
} from './profile-form';

/**
 * 12-18, Task 2 (admin half): the builder in a browser, on the phone project, against the real API and
 * database, logged in as the seeded lab admin.
 *
 *   1  the Configurações row opens the builder; "Adicionar pergunta" creates a required short text after
 *      the impact dialog, then a choice question with "Outro" and a number question with limits
 *   2  "Reordenar" moves a row and the order members see follows
 *   3  an answered question shows the lock row and offers "Criar nova pergunta e arquivar esta";
 *      "Arquivar pergunta" moves it to "Arquivadas"; "Reativar" of a required one asks the impact
 *   4  "Exportar respostas (CSV)" downloads a file that starts with the byte-order mark and names the
 *      question titles; "Ver como o membro vê" opens the preview and saves nothing
 *   5  a support_tenant does not see the row, and a typed URL meets the not-found page
 *   6  the 320px and 390px backstops: the list, the editor sheet with 20 options, the dialogs, the
 *      archived list, with 120-character titles (E02, E03, E04, E05, E06)
 *
 * Every row carries the run prefix and goes away with `resetProfileForm` (`beforeAll` and `afterAll`);
 * the module row is put back exactly as found. The API keeps module flags in a 30 s cache, so the first
 * visit of the builder polls (`openBuilder`).
 *
 * Written under Igor's decision of 2026-10-30 (the disk could not hold a Next server and a browser) and
 * NOT executed by plan 12-18: the first run is recorded in `12-MANUAL-PROOFS.md` (row M8).
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const email = (tag: string) => `${prefix}-${tag}@rede-lab.local`;
const title = (tag: string) => `${prefix} ${tag}`;
const open = (text: string) => `“${text}”`;

/** A member with no answer: it makes a new required question affect someone, so the impact dialog opens. */
const pendingMember = email('pending');
const supportUser = email('support');

let before: Awaited<ReturnType<typeof snapshot>>;

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, 'the builder story runs once, on the phone');
});

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  await resetProfileForm(LAB, PROFILE_FORM_NAMESPACE);
  before = await snapshot(LAB, PROFILE_FORM_NAMESPACE);
  await enableProfileForm();
  await createAccount(pendingMember, 'member');
  await createAccount(supportUser, 'support_tenant');
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

/** The "Adicionar pergunta" sheet, found by its title (the impact dialog is a second dialog). */
const editor = (page: Page, name = 'Nova pergunta') => page.getByRole('dialog', { name });

test('1. the row opens the builder, and "Adicionar pergunta" creates a required text, a choice with "Outro" and a number with limits', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const { context, page } = await newPhonePage(browser);
  try {
    await signInAdmin(page);

    // The row in Configurações opens the builder (polled: the module flag cache).
    await openUntilReady(page, `${hosts.lab}/configuracoes`, () =>
      page.getByRole('link', { name: 'Formulário de perfil' }),
    );
    await page.getByRole('link', { name: 'Formulário de perfil' }).click();
    await expect(page).toHaveURL(/\/configuracoes\/formulario-de-perfil$/);
    await expect(
      page.getByRole('heading', { name: 'Formulário de perfil', level: 1 }),
    ).toBeVisible();

    // A required short text: a member has not answered it, so the impact dialog asks first.
    const requiredTitle = title('01 Qual e o seu cargo');
    await page.getByRole('button', { name: 'Adicionar pergunta' }).first().click();
    await editor(page).locator('label[for="pf-type-short_text"]').click();
    await editor(page).getByRole('textbox', { name: 'Pergunta', exact: true }).fill(requiredTitle);
    await editor(page).getByRole('switch', { name: 'Obrigatória' }).click();
    await editor(page).getByRole('button', { name: 'Salvar pergunta' }).click();
    const impact = page.getByRole('dialog', { name: 'Adicionar pergunta obrigatória?' });
    await expect(impact).toBeVisible();
    await impact.getByRole('button', { name: 'Adicionar e exigir' }).click();
    await expect(page.getByText(/Pergunta adicionada\./)).toBeVisible();
    await expect(editor(page)).toBeHidden();
    await expect(builderRow(page, requiredTitle)).toBeVisible();
    expect(await questionByTitle(requiredTitle)).toMatchObject({
      type: 'short_text',
      required: true,
      archived: false,
    });

    // A choice question with "Outro": two options, then the switch.
    const choiceTitle = title('02 Area de atuacao');
    await page.getByRole('button', { name: 'Adicionar pergunta' }).first().click();
    await editor(page).locator('label[for="pf-type-single_choice"]').click();
    await editor(page).getByRole('textbox', { name: 'Pergunta', exact: true }).fill(choiceTitle);
    await editor(page).getByLabel('Opção 1', { exact: true }).fill('Ensino');
    await editor(page).getByLabel('Opção 2', { exact: true }).fill('Saude');
    await editor(page)
      .getByRole('switch', { name: /Incluir a opção/ })
      .click();
    await editor(page).getByRole('button', { name: 'Salvar pergunta' }).click();
    await expect(page.getByText('Pergunta adicionada.')).toBeVisible();
    await expect(builderRow(page, choiceTitle)).toBeVisible();
    const choice = await questionByTitle(choiceTitle);
    expect(choice).toMatchObject({ type: 'single_choice', required: false, allowOther: true });
    expect(choice?.options.map((option) => option.label)).toEqual(['Ensino', 'Saude']);

    // A number question with limits.
    const numberTitle = title('03 Anos de experiencia');
    await page.getByRole('button', { name: 'Adicionar pergunta' }).first().click();
    await editor(page).locator('label[for="pf-type-number"]').click();
    await editor(page).getByRole('textbox', { name: 'Pergunta', exact: true }).fill(numberTitle);
    await editor(page).locator('#pf-min').fill('1');
    await editor(page).locator('#pf-max').fill('10');
    await editor(page).getByRole('button', { name: 'Salvar pergunta' }).click();
    await expect(page.getByText('Pergunta adicionada.')).toBeVisible();
    await expect(builderRow(page, numberTitle)).toBeVisible();
    const number = await questionByTitle(numberTitle);
    expect(number).toMatchObject({ type: 'number' });
    expect(Number(number?.limits.min)).toBe(1);
    expect(Number(number?.limits.max)).toBe(10);

    // The three rows keep the order they were created in.
    expect(await activeTitles(prefix)).toEqual([requiredTitle, choiceTitle, numberTitle]);
  } finally {
    await context.close();
  }
});

test('2. "Reordenar" moves a row and the order the member sees follows', async ({ browser }) => {
  await clearForm(LAB, prefix);
  const first = await seedQuestion({ title: title('10 Primeira') });
  const second = await seedQuestion({ title: title('11 Segunda') });
  const third = await seedQuestion({ title: title('12 Terceira') });

  const admin = await newPhonePage(browser);
  try {
    await signInAdmin(admin.page);
    await openBuilder(admin.page);
    await admin.page.getByRole('button', { name: 'Reordenar' }).click();
    // Edges are disabled: the first row cannot go up, the last cannot go down.
    await expect(
      admin.page.getByRole('button', { name: `Subir ${open(first.title)}` }),
    ).toBeDisabled();
    await expect(
      admin.page.getByRole('button', { name: `Descer ${open(third.title)}` }),
    ).toBeDisabled();
    await admin.page.getByRole('button', { name: `Descer ${open(first.title)}` }).click();
    await expect(admin.page.locator('[data-reorder-live]')).toContainText(
      `${open(first.title)} agora é a pergunta 2 de`,
    );
    await admin.page.getByRole('button', { name: 'Concluir' }).click();
    await expect.poll(() => activeTitles(prefix)).toEqual([second.title, first.title, third.title]);
  } finally {
    await admin.context.close();
  }

  // The member's screen follows the same order (an optional-only form opens in edit mode).
  const viewer = email('order');
  await createAccount(viewer, 'member');
  const member = await newPhonePage(browser);
  try {
    await signInToLab(member.page, viewer);
    await gotoWhileRedirected(member.page, `${hosts.lab}/completar-perfil`);
    await expect(member.page.locator('[data-question]')).toHaveCount(3);
    const blocks = await member.page.locator('[data-question]').allInnerTexts();
    const seen = [second.title, first.title, third.title]
      .map((text) => ({ text, at: blocks.findIndex((block) => block.includes(text)) }))
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.text);
    expect(seen).toEqual([second.title, first.title, third.title]);
    expect(blocks.findIndex((block) => block.includes(second.title))).toBe(0);
  } finally {
    await member.context.close();
  }
});

test('3. an answered question is locked; replace, archive and the impact of a required reactivation', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const answered = await seedQuestion({ title: title('20 Respondida') });
  await answerFor(pendingMember, answered.id, 'Uma resposta');
  const toArchive = await seedQuestion({ title: title('21 Para arquivar') });
  await answerFor(pendingMember, toArchive.id, 'Outra resposta');
  const archivedRequired = await seedQuestion({
    title: title('22 Obrigatoria antiga'),
    required: true,
    archived: true,
  });

  const { context, page } = await newPhonePage(browser);
  try {
    await signInAdmin(page);
    await openBuilder(page);

    // The lock row, and the way out: replace.
    await builderRow(page, answered.title).click();
    const sheet = editor(page, 'Editar pergunta');
    await expect(sheet).toContainText('Esta pergunta já tem 1 resposta');
    await sheet.getByRole('button', { name: 'Criar nova pergunta e arquivar esta' }).click();
    const replacement = editor(page, 'Substituir pergunta');
    await expect(replacement).toBeVisible();
    await expect(replacement).toContainText(`${open(answered.title)} será arquivada`);
    const replacementTitle = title('23 Substituta');
    await replacement.locator('label[for="pf-type-short_text"]').click();
    await replacement
      .getByRole('textbox', { name: 'Pergunta', exact: true })
      .fill(replacementTitle);
    await replacement.getByRole('button', { name: 'Salvar pergunta' }).click();
    await expect(page.getByText('Pergunta substituída.')).toBeVisible();
    expect((await questionByTitle(answered.title))?.archived).toBe(true);
    expect((await questionByTitle(replacementTitle))?.archived).toBe(false);
    // The old answer stays with the archived question.
    expect(await answerCount(answered.id)).toBe(1);

    // Archive: the answers stay, the question moves to "Arquivadas".
    await builderRow(page, toArchive.title).click();
    await editor(page, 'Editar pergunta')
      .getByRole('button', { name: 'Arquivar pergunta' })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Arquivar esta pergunta?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(page.getByText('Pergunta arquivada.')).toBeVisible();
    expect((await questionByTitle(toArchive.title))?.archived).toBe(true);
    expect(await answerCount(toArchive.id)).toBe(1);

    // Reactivating a REQUIRED question asks the impact first.
    await openBuilder(page, 'arquivadas');
    await expect(page.getByRole('heading', { name: toArchive.title })).toBeVisible();
    await page
      .getByRole('button', { name: `Reativar pergunta: ${archivedRequired.title}` })
      .click();
    const reactivate = page.getByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    await expect(reactivate).toBeVisible();
    await reactivate.getByRole('button', { name: 'Reativar e exigir' }).click();
    await expect(page.getByText('Pergunta reativada.')).toBeVisible();
    expect((await questionByTitle(archivedRequired.title))?.archived).toBe(false);
  } finally {
    await context.close();
  }
});

test('4. the export downloads a BOM-prefixed CSV that names the questions, and the preview saves nothing', async ({
  browser,
}) => {
  await clearForm(LAB, prefix);
  const exported = await seedQuestion({ title: title('30 Cargo exportado') });
  await answerFor(pendingMember, exported.id, 'Analista');
  const previewed = await seedQuestion({
    title: title('31 Visivel na previa'),
    type: 'single_choice',
    options: ['Ensino', 'Saude'],
  });

  const { context, page } = await newPhonePage(browser);
  try {
    await signInAdmin(page);
    await openBuilder(page);

    // The preview: the real member form, no "Salvar", nothing saved.
    const answersBefore = await answerCount(exported.id);
    await page.getByRole('button', { name: 'Ver como o membro vê' }).click();
    const preview = page.getByRole('dialog', { name: 'Como o membro vê' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Prévia: nada do que você preencher aqui é salvo.');
    await expect(preview.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(0);
    await preview.getByRole('textbox').first().fill('Texto que nao vai a lugar nenhum');
    await preview.getByRole('radio', { name: 'Ensino' }).check();
    await preview.getByRole('button', { name: 'Fechar' }).click();
    await expect(preview).toBeHidden();
    expect(await answerCount(exported.id)).toBe(answersBefore);
    expect(await answerCount(previewed.id)).toBe(0);

    // The export: confirmation, then the download.
    await page.getByRole('button', { name: 'Exportar respostas (CSV)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Exportar respostas?' });
    await expect(dialog).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Exportar', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^respostas-perfil-\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = readFileSync(await download.path());
    // EF BB BF: the byte-order mark Excel reads as UTF-8.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const header = bytes.toString('utf8').replace(/^﻿/, '').split('\r\n')[0] ?? '';
    expect(header).toContain(exported.title);
    expect(header).toContain(previewed.title);
    await expect(page.getByText('Arquivo gerado. O download começou.')).toBeVisible();

    // The export is on the moderation history.
    await gotoWhileRedirected(page, `${hosts.lab}/configuracoes/moderacao`);
    await expect(
      page.getByText(/exportou as respostas do formulário de perfil/).first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('5. a support user does not see the row, and a typed URL meets the not-found page', async ({
  browser,
}) => {
  const { context, page } = await newPhonePage(browser);
  try {
    await login(page, supportUser, PASSWORD, hosts.lab);
    await gotoWhileRedirected(page, `${hosts.lab}/configuracoes`);
    await expect(page).toHaveURL(/\/configuracoes$/);
    await expect(page.getByRole('link', { name: 'Formulário de perfil' })).toHaveCount(0);

    const response = await page.goto(`${hosts.lab}/configuracoes/formulario-de-perfil`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Formulário de perfil', level: 1 })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

for (const width of BACKSTOP_WIDTHS) {
  test(`6. at ${width}px the list, the editor sheet, the dialogs and the archived list keep every control on screen`, async ({
    browser,
  }) => {
    await clearForm(LAB, prefix);
    const tag = `w${width}`;
    const help = `${'Texto de apoio comprido. '.repeat(10)}${'u'.repeat(50)}`.slice(0, 300);
    const options = Array.from({ length: 20 }, (_, index) =>
      `Opcao ${String(index + 1).padStart(2, '0')} ${'a'.repeat(80)}`.slice(0, 80),
    );
    const longChoice = await seedQuestion({
      title: longTitle(prefix, `${tag}a`),
      type: 'single_choice',
      options,
      allowOther: true,
      helpText: help,
      showOnProfile: true,
    });
    const answeredLong = await seedQuestion({
      title: longTitle(prefix, `${tag}b`),
      type: 'short_text',
      required: true,
    });
    await answerFor(pendingMember, answeredLong.id, 'x'.repeat(100));
    const archivedLong = await seedQuestion({
      title: longTitle(prefix, `${tag}c`),
      type: 'short_text',
      archived: true,
    });

    const { context, page } = await newPhonePage(browser, width);
    try {
      await signInAdmin(page);
      await openBuilder(page);
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);

      // E02: the list, a 120-character title, the actions row.
      await expectScreenFits(page, `E02 ${width}px list`, {
        'Adicionar pergunta': page.getByRole('button', { name: 'Adicionar pergunta' }).first(),
        Reordenar: page.getByRole('button', { name: 'Reordenar' }),
        'first row': builderRow(page, longChoice.title),
        Exportar: page.getByRole('button', { name: 'Exportar respostas (CSV)' }),
      });

      // E03 + E04: the editor sheet with 20 options of 80 characters.
      await builderRow(page, longChoice.title).click();
      const sheet = editor(page, 'Editar pergunta');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel('Opção 20', { exact: true })).toBeVisible();
      await expectScreenFits(page, `E03/E04 ${width}px editor sheet`, {
        'Salvar pergunta': sheet.getByRole('button', { name: 'Salvar pergunta' }),
        'Opção 1 desce': sheet.getByRole('button', { name: 'Descer opção 1', exact: true }),
        'Opção 1 remove': sheet.getByRole('button', { name: 'Remover opção 1', exact: true }),
        'Adicionar opção': sheet.getByRole('button', { name: 'Adicionar opção' }),
      });

      // E06: the discard dialog (a dirty sheet asked to close), then the sheet closes without saving.
      await sheet
        .getByRole('textbox', { name: 'Pergunta', exact: true })
        .fill(`${longChoice.title}!`);
      await page.keyboard.press('Escape');
      const discard = page.getByRole('dialog', { name: 'Descartar as alterações?' });
      await expect(discard).toBeVisible();
      await expectScreenFits(page, `E06 ${width}px discard dialog`, {
        Descartar: discard.getByRole('button', { name: 'Descartar' }),
        'Continuar editando': discard.getByRole('button', { name: 'Continuar editando' }),
      });
      await discard.getByRole('button', { name: 'Descartar' }).click();
      await expect(sheet).toBeHidden();

      // E06: the archive dialog of an answered question with a 120-character title.
      await builderRow(page, answeredLong.title).click();
      await editor(page, 'Editar pergunta')
        .getByRole('button', { name: 'Arquivar pergunta' })
        .click();
      const archive = page.getByRole('dialog', { name: 'Arquivar esta pergunta?' });
      await expect(archive).toBeVisible();
      await expectScreenFits(page, `E06 ${width}px archive dialog`, {
        Arquivar: archive.getByRole('button', { name: 'Arquivar', exact: true }),
      });
      await archive.getByRole('button', { name: 'Cancelar' }).click();
      await page.keyboard.press('Escape');

      // E06: the export dialog.
      await page.getByRole('button', { name: 'Exportar respostas (CSV)' }).click();
      const exportDialog = page.getByRole('dialog', { name: 'Exportar respostas?' });
      await expect(exportDialog).toBeVisible();
      await expectScreenFits(page, `E06 ${width}px export dialog`, {
        Exportar: exportDialog.getByRole('button', { name: 'Exportar', exact: true }),
        Cancelar: exportDialog.getByRole('button', { name: 'Cancelar' }),
      });
      await exportDialog.getByRole('button', { name: 'Cancelar' }).click();

      // The archived list.
      await openBuilder(page, 'arquivadas');
      await expectScreenFits(page, `${width}px archived list`, {
        Reativar: page.getByRole('button', { name: `Reativar pergunta: ${archivedLong.title}` }),
      });
      await expectTouchTarget(
        page.getByRole('button', { name: `Reativar pergunta: ${archivedLong.title}` }),
        'Reativar',
      );
      await expectNoHorizontalScroll(page, `${width}px archived list, final`);
    } finally {
      await context.close();
    }
  });
}
