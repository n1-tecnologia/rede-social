import { expect, test } from '@playwright/test';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  answerCount,
  clearForm,
  closeProfileForm,
  createAccount,
  createPost,
  disableProfileForm,
  enableProfileForm,
  gotoWhileRedirected,
  LAB,
  newPhonePage,
  newRunPrefix,
  PASSWORD,
  PHONE_PROJECT,
  PROFILE_FORM_NAMESPACE,
  questionBlock,
  resetProfileForm,
  type SeededQuestion,
  seedQuestion,
  setArchived,
  signInIntoGate,
  signInToLab,
  snapshot,
  storedAnswer,
} from './profile-form';

/**
 * 12-18, Task 1 (the tracer): the profile-form gate in a browser, on the phone project, against the real
 * API and the real database (the verification the web plans could only mock).
 *
 *   a required question with the module on  ->  a member who opens a deep link (`/post/{id}`) is taken to
 *   `/completar-perfil`  ->  she answers and lands on that same post  ->  a staff user is never taken
 *   there  ->  "Sair" signs out  ->  archiving the last required question, or turning the module off,
 *   lets the member in at the next load with her answers still in the table (D-589).
 *
 * The member signs in BEFORE the gate exists (the shared `login()` waits for `/inicio`), then the module
 * is turned on and the required question seeded, which is exactly what an admin does while members are
 * signed in. Members who must meet the gate at sign-in use `signInIntoGate`. Nothing here needs the
 * worker. The run touches only what carries its prefix; the module row goes back as it was found and no
 * required question survives (`resetProfileForm`, `beforeAll` and `afterAll`, T-12-39).
 *
 * Written under Igor's decision of 2026-10-30 (the disk could not hold a Next server and a browser) and
 * NOT executed by plan 12-18: the first run is the one recorded in `12-MANUAL-PROOFS.md` (row M8).
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ serviceWorkers: 'block' });

const prefix = newRunPrefix();
const email = (tag: string) => `${prefix}-${tag}@rede-lab.local`;
const titleOf = (tag: string) => `${prefix} ${tag}`;

const answeredMember = email('answered');
const hostileMember = email('hostile');
const leaverMember = email('leaver');
const heldMember = email('held');
const directMember = email('direct');
const supportUser = email('support');
const postCaption = `${prefix} destino do link`;

let postId = '';
let required: SeededQuestion;
let before: Awaited<ReturnType<typeof snapshot>>;

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, 'the gate story runs once, on the phone');
});

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  // Also repairs a killed run: the module goes back before anything else.
  await resetProfileForm(LAB, PROFILE_FORM_NAMESPACE);
  before = await snapshot(LAB, PROFILE_FORM_NAMESPACE);
  postId = await createPost(postCaption);
  for (const member of [answeredMember, hostileMember, leaverMember, heldMember, directMember]) {
    await createAccount(member, 'member');
  }
  await createAccount(supportUser, 'support_tenant');
});

test.afterAll(async ({ browserName: _browserName }, testInfo) => {
  if (testInfo.project.name !== PHONE_PROJECT) return;
  await resetProfileForm(LAB, PROFILE_FORM_NAMESPACE);
  // T-12-39: nothing is left behind and the module row is exactly what it was.
  expect(await snapshot(LAB, PROFILE_FORM_NAMESPACE)).toEqual(before);
  await closeProfileForm();
});

test('1. a deep link meets the form, the answer lands on the same post (tracer)', async ({
  browser,
}) => {
  const { context, page } = await newPhonePage(browser);
  try {
    // Signed in while nothing gates her.
    await signInToLab(page, answeredMember);

    // The admin turns the module on and requires an answer.
    await enableProfileForm();
    required = await seedQuestion({ title: titleOf('Qual e o seu cargo'), required: true });

    await gotoWhileRedirected(page, `${hosts.lab}/post/${postId}`);
    await expect(page).toHaveURL(/\/completar-perfil\?/, { timeout: 30_000 });
    // The destination travels in the URL as the validated `next`.
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/post/${postId}`);
    await expect(
      page.getByRole('heading', { name: 'Complete seu perfil', level: 1 }),
    ).toBeVisible();

    await page.getByLabel(required.title, { exact: true }).fill('Analista');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/post/${postId}$`), { timeout: 30_000 });
    await expect(page.getByText(postCaption)).toBeVisible();
    expect(await storedAnswer(answeredMember, required.id)).toBe('Analista');
  } finally {
    await context.close();
  }
});

test('2. a hostile next never leaves the site, and a complete member is not redirected', async ({
  browser,
}) => {
  const hostile = await newPhonePage(browser);
  try {
    await signInIntoGate(hostile.page, hostileMember);
    for (const bad of ['//evil.com', 'https://evil.com/x', '/\\evil.com']) {
      await hostile.page.goto(`${hosts.lab}/completar-perfil?next=${encodeURIComponent(bad)}`);
      await expect(
        hostile.page.getByRole('heading', { name: 'Complete seu perfil', level: 1 }),
      ).toBeVisible();
    }
    await hostile.page.getByLabel(required.title, { exact: true }).fill('Coordenadora');
    await hostile.page.getByRole('button', { name: 'Salvar', exact: true }).click();
    // The last hostile value was rejected where it is used: the member lands on /inicio of THIS origin.
    await expect(hostile.page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(new URL(hostile.page.url()).origin).toBe(new URL(hosts.lab).origin);
  } finally {
    await hostile.context.close();
  }

  // (6) A member whose answers are complete is never taken to the form, and the form in edit mode
  // refuses a hostile `next` for its "Cancelar" link too.
  const complete = await newPhonePage(browser);
  try {
    await signInToLab(complete.page, answeredMember);
    await expect(complete.page).toHaveURL(/\/inicio$/);
    await gotoWhileRedirected(complete.page, `${hosts.lab}/perfil`);
    await expect(complete.page).toHaveURL(/\/perfil$/);
    await complete.page.goto(
      `${hosts.lab}/completar-perfil?next=${encodeURIComponent('//evil.com')}`,
    );
    await expect(
      complete.page.getByRole('heading', { name: 'Minhas respostas', level: 1 }),
    ).toBeVisible();
    await expect(complete.page.getByRole('link', { name: 'Cancelar' })).toHaveAttribute(
      'href',
      '/perfil',
    );
  } finally {
    await complete.context.close();
  }
});

test('3. the staff are never taken to the form', async ({ browser }) => {
  for (const [who, password] of [
    [users.labAdmin, SEED_PASSWORD],
    [supportUser, PASSWORD],
  ] as const) {
    const { context, page } = await newPhonePage(browser);
    try {
      await login(page, who, password, hosts.lab);
      await gotoWhileRedirected(page, `${hosts.lab}/post/${postId}`);
      await expect(page).toHaveURL(new RegExp(`/post/${postId}$`));
      await expect(page.getByText(postCaption)).toBeVisible();
      // A staff user who types the form's URL goes on to /inicio, with no read of the form.
      await gotoWhileRedirected(page, `${hosts.lab}/completar-perfil`);
      await expect(page).toHaveURL(/\/inicio$/);
    } finally {
      await context.close();
    }
  }
});

test('4. "Sair" on the form signs the member out', async ({ browser }) => {
  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, leaverMember);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/entrar$/, { timeout: 30_000 });
    const session = (await context.cookies()).filter((cookie) => cookie.name.startsWith('sb-'));
    expect(session.length, 'the Supabase session cookies are gone after Sair').toBe(0);
    // Signed out for real: a protected page sends her to the sign-in, not to the form.
    await gotoWhileRedirected(page, `${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/entrar/);
  } finally {
    await context.close();
  }
});

test('5. a direct navigation under the gate goes back to the form, never to an error screen', async ({
  browser,
}) => {
  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, directMember);
    await gotoWhileRedirected(page, `${hosts.lab}/perfil`);
    await expect(page).toHaveURL(/\/completar-perfil\?/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/perfil');
    await expect(
      page.getByRole('heading', { name: 'Complete seu perfil', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Algo deu errado')).toHaveCount(0);
    await expect(questionBlock(page, required.id)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('6. archiving the last required question, or turning the module off, lets her in with her answers kept (D-589)', async ({
  browser,
}) => {
  const { context, page } = await newPhonePage(browser);
  try {
    await signInIntoGate(page, heldMember);

    const stored = await answerCount(required.id);
    expect(stored, 'the earlier members left their answers in the table').toBeGreaterThanOrEqual(2);

    // Archiving the last required question releases her at the next load.
    await setArchived(required.id, true);
    await gotoWhileRedirected(page, `${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await answerCount(required.id), 'archiving deletes no answer').toBe(stored);

    // Reactivating it gates her again (the question is required and she has not answered it).
    await setArchived(required.id, false);
    await gotoWhileRedirected(page, `${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/completar-perfil\?/, { timeout: 30_000 });

    // Turning the module off releases her too, still with every answer in the table.
    await disableProfileForm();
    await gotoWhileRedirected(page, `${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(await answerCount(required.id), 'turning the module off deletes no answer').toBe(stored);

    // And the form itself, typed by hand, says there is nothing to answer.
    await page.goto(`${hosts.lab}/completar-perfil`);
    await expect(page.getByText('Não há perguntas para responder')).toBeVisible();

    // The module back on, the question gone for good: nothing of the run keeps gating anyone.
    await enableProfileForm();
    await clearForm(LAB, prefix);
    await gotoWhileRedirected(page, `${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/inicio$/);
  } finally {
    await context.close();
  }
});
