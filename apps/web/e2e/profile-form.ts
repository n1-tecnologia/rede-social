import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import postgres from 'postgres';
import {
  closeAdmin,
  createFeedPostAs,
  createMember,
  deleteFeedPostsLike,
  deleteUserByEmail,
  setMemberDisplayName,
} from './admin';
import { hosts, login, withoutProfileNudge } from './fixtures';
import {
  expectNoHorizontalScroll,
  expectTapTarget,
  gotoWhileRedirected,
  LAB,
  openUntilReady,
  phoneContext,
} from './payments';

/**
 * Helpers of the Phase 12 profile-form e2e (plan 18): the module row and the data reset, the questions
 * and answers a spec stands up in one statement, the throwaway accounts, and the repeated steps of the
 * member and admin screens driven through the normal UI.
 *
 * The harness is NOT a lane (the `payments.ts` precedent): rows are written through a direct superuser
 * connection so a spec can stand up a state in one statement, while everything the member and the admin
 * do in the product goes through the screens. Every row a run writes is found again by the RUN PREFIX
 * (a question title, an e-mail local part, a post caption), never by tenant alone: the seeded tenants
 * hold the user's own manual test data, which a sweep must not touch (T-12-39).
 *
 * One row has no prefix and is handled by a recorded baseline instead: the tenant's `profile_form`
 * module row. It is NEVER enabled in the seed, so a run turns it on, remembers what it found in a file
 * in the OS temp folder at the first change, and puts it back exactly (a missing row is deleted again).
 * A run that was killed half way is repaired by the next run's `beforeAll`, which restores the module
 * before it does anything else: that is what keeps a required question from gating other specs' members.
 */

export {
  expectNoHorizontalScroll,
  expectTapTarget,
  gotoWhileRedirected,
  LAB,
  openUntilReady,
  phoneContext,
};

/** The namespace every Phase 12 spec puts at the start of what it writes. `resetProfileForm` sweeps all of it. */
export const PROFILE_FORM_NAMESPACE = 'e2epf-';

/** A fresh prefix for one run of one spec: the namespace plus a base-36 clock. */
export function newRunPrefix(): string {
  return `${PROFILE_FORM_NAMESPACE}${Date.now().toString(36)}`;
}

/** A password every throwaway account of these specs uses. */
export const PASSWORD = 'Segredo123';

/** The project that carries the story: the phone (the plan's "phone project"). */
export const PHONE_PROJECT = 'mobile-chromium';

/** The two narrow widths of the UI-SPEC backstop rows. */
export const BACKSTOP_WIDTHS = [320, 390] as const;

/** The seeded lab admin, the author of every post and question a run writes. */
const SEED_ADMIN = 'admin@rede-lab.local';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connections (call from `test.afterAll` so Playwright can exit). */
export async function closeProfileForm(): Promise<void> {
  await client?.end();
  client = null;
  await closeAdmin();
}

// ── The module row: remembered, changed, restored ──────────────────────────────────────────────────

type ModuleBaseline = { existed: boolean; enabled: boolean; settings: Record<string, unknown> };

const BASELINE_FILE = join(tmpdir(), 'rede-social-e2e-profile-form-baseline.json');

function readBaselines(): Record<string, ModuleBaseline> {
  if (!existsSync(BASELINE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, ModuleBaseline>;
  } catch {
    return {};
  }
}

function writeBaselines(baselines: Record<string, ModuleBaseline>): void {
  if (Object.keys(baselines).length === 0) {
    rmSync(BASELINE_FILE, { force: true });
    return;
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(baselines));
}

/** The module row as it stands now: absent, or on / off. Acceptance compares it before and after a run. */
export async function moduleState(
  tenantSlug: string = LAB,
): Promise<{ existed: boolean; enabled: boolean }> {
  const rows = await sql()<{ enabled: boolean }[]>`
    select tm.enabled
      from public.tenant_modules tm
      join public.tenants t on t.id = tm.tenant_id
     where t.slug = ${tenantSlug} and tm.module_key = 'profile_form'`;
  const row = rows[0];
  return row ? { existed: true, enabled: row.enabled } : { existed: false, enabled: false };
}

async function writeModule(tenantSlug: string, enabled: boolean): Promise<void> {
  const baselines = readBaselines();
  if (!(tenantSlug in baselines)) {
    const rows = await sql()<{ enabled: boolean; settings: Record<string, unknown> }[]>`
      select tm.enabled, tm.settings
        from public.tenant_modules tm
        join public.tenants t on t.id = tm.tenant_id
       where t.slug = ${tenantSlug} and tm.module_key = 'profile_form'`;
    const row = rows[0];
    // Written before the change so a crash between the two still leaves the way back.
    baselines[tenantSlug] = row
      ? { existed: true, enabled: row.enabled, settings: row.settings }
      : { existed: false, enabled: false, settings: {} };
    writeBaselines(baselines);
  }
  await sql()`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    select t.id, 'profile_form', ${enabled} from public.tenants t where t.slug = ${tenantSlug}
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
}

/**
 * Turns the `profile_form` module of `tenantSlug` ON, remembering what the row was before so
 * `resetProfileForm` can put it back. The member's gate and bootstrap block read the row live; the
 * API's admin routes and the bootstrap permissions sit behind a 30 s module-flag cache, which is why
 * `openBuilder` polls instead of asserting at once.
 */
export async function enableProfileForm(tenantSlug: string = LAB): Promise<void> {
  await writeModule(tenantSlug, true);
}

/** The module row present but OFF (the "turning the module off releases the member" case). */
export async function disableProfileForm(tenantSlug: string = LAB): Promise<void> {
  await writeModule(tenantSlug, false);
}

/** Puts the module row back as found (a row the run created is deleted again). Safe to call twice. */
export async function restoreProfileForm(tenantSlug: string = LAB): Promise<void> {
  const baselines = readBaselines();
  const before = baselines[tenantSlug];
  if (!before) return;
  if (before.existed) {
    await sql()`
      update public.tenant_modules tm
         set enabled = ${before.enabled}, settings = ${sql().json(before.settings as never)},
             updated_at = now()
        from public.tenants t
       where t.id = tm.tenant_id and t.slug = ${tenantSlug} and tm.module_key = 'profile_form'`;
  } else {
    await sql()`
      delete from public.tenant_modules tm
       using public.tenants t
       where t.id = tm.tenant_id and t.slug = ${tenantSlug} and tm.module_key = 'profile_form'`;
  }
  delete baselines[tenantSlug];
  writeBaselines(baselines);
}

// ── The sweep ──────────────────────────────────────────────────────────────────────────────────────

/** Deletes the answers, then the questions, whose question title starts with `prefix`. The module is untouched. */
export async function clearForm(tenantSlug: string, prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await sql()`
    delete from public.profile_form_answers a
     using public.profile_form_questions q, public.tenants t
     where q.id = a.question_id and q.tenant_id = a.tenant_id and t.id = a.tenant_id
       and t.slug = ${tenantSlug} and q.title like ${like}`;
  await sql()`
    delete from public.profile_form_questions q
     using public.tenants t
     where t.id = q.tenant_id and t.slug = ${tenantSlug} and q.title like ${like}`;
}

/**
 * Removes everything a run wrote on `tenantSlug`, found by `prefix`, and puts the module row back.
 * Call it first in `beforeAll` (it also repairs an aborted run: the module goes back before anything
 * else) and last in `afterAll`. Order: the module row first (so nothing deleted below leaves a gated
 * tenant), then the answers and questions, the posts and the throwaway identities. Safe to call twice.
 */
export async function resetProfileForm(
  tenantSlug: string = LAB,
  prefix: string = PROFILE_FORM_NAMESPACE,
): Promise<void> {
  await restoreProfileForm(tenantSlug);
  await clearForm(tenantSlug, prefix);
  await deleteFeedPostsLike(prefix);
  const accounts = await sql()<{ email: string }[]>`
    select email from auth.users where email like ${`${prefix}%`}`;
  for (const account of accounts) await deleteUserByEmail(account.email);
}

/**
 * What a run must leave exactly as it found it: the module row, and the count of run-prefixed questions,
 * answers, posts and accounts (the last four are zero after a clean sweep).
 */
export async function snapshot(
  tenantSlug: string = LAB,
  prefix: string = PROFILE_FORM_NAMESPACE,
): Promise<{
  module: { existed: boolean; enabled: boolean };
  questions: number;
  answers: number;
  posts: number;
  accounts: number;
}> {
  const like = `${prefix}%`;
  const [questions] = await sql()<{ n: number }[]>`
    select count(*)::int as n
      from public.profile_form_questions q join public.tenants t on t.id = q.tenant_id
     where t.slug = ${tenantSlug} and q.title like ${like}`;
  const [answers] = await sql()<{ n: number }[]>`
    select count(*)::int as n
      from public.profile_form_answers a
      join public.profile_form_questions q on q.id = a.question_id
      join public.tenants t on t.id = a.tenant_id
     where t.slug = ${tenantSlug} and q.title like ${like}`;
  const [posts] = await sql()<{ n: number }[]>`
    select count(*)::int as n
      from public.feed_posts p join public.tenants t on t.id = p.tenant_id
     where t.slug = ${tenantSlug} and p.caption like ${like}`;
  const [accounts] = await sql()<{ n: number }[]>`
    select count(*)::int as n from auth.users where email like ${like}`;
  return {
    module: await moduleState(tenantSlug),
    questions: questions?.n ?? 0,
    answers: answers?.n ?? 0,
    posts: posts?.n ?? 0,
    accounts: accounts?.n ?? 0,
  };
}

// ── Rows a spec stands up in one statement ─────────────────────────────────────────────────────────

export type ProfileFormType =
  | 'short_text'
  | 'long_text'
  | 'dropdown'
  | 'multiple_choice'
  | 'single_choice'
  | 'number'
  | 'date'
  | 'phone'
  | 'email'
  | 'link'
  | 'yes_no'
  | 'acceptance'
  | 'rating';

const CHOICE_TYPES: readonly ProfileFormType[] = ['dropdown', 'multiple_choice', 'single_choice'];

export type SeedQuestion = {
  /** Must start with the run prefix: that is how the sweep finds it. */
  title: string;
  type?: ProfileFormType;
  required?: boolean;
  helpText?: string;
  /** Option labels; a choice type gets two when none are given. */
  options?: string[];
  allowOther?: boolean;
  showOnProfile?: boolean;
  limits?: { min?: number | string; max?: number | string };
  archived?: boolean;
  tenantSlug?: string;
};

export type SeededQuestion = {
  id: string;
  title: string;
  /** Option ids in the order given, so a spec can write a choice answer straight into the table. */
  optionIds: string[];
};

/** One profile-form question through the superuser connection (RLS off). The title must carry the run prefix. */
export async function seedQuestion(input: SeedQuestion): Promise<SeededQuestion> {
  if (!input.title.startsWith(PROFILE_FORM_NAMESPACE)) {
    throw new Error(`seedQuestion: "${input.title}" does not start with ${PROFILE_FORM_NAMESPACE}`);
  }
  const tenantSlug = input.tenantSlug ?? LAB;
  const type = input.type ?? 'short_text';
  const isChoice = CHOICE_TYPES.includes(type);
  const labels = input.options ?? (isChoice ? ['Opção A', 'Opção B'] : []);
  const options = labels.map((label) => ({ id: crypto.randomUUID(), label }));
  const [row] = await sql()<{ id: string }[]>`
    insert into public.profile_form_questions
      (tenant_id, type, title, help_text, required, position, options, limits, allow_other,
       show_on_profile, archived_at, created_by_user_id)
    select t.id, ${type}, ${input.title}, ${input.helpText ?? null}, ${input.required ?? false},
           coalesce((select max(q.position) + 1 from public.profile_form_questions q
                      where q.tenant_id = t.id and q.archived_at is null), 0),
           ${sql().json(options as never)}, ${sql().json((input.limits ?? {}) as never)},
           ${input.allowOther ?? false}, ${input.showOnProfile ?? false},
           ${input.archived ? new Date() : null},
           (select u.id from public.users u where u.email = ${SEED_ADMIN})
      from public.tenants t where t.slug = ${tenantSlug}
    returning id::text as id`;
  if (!row) throw new Error(`seedQuestion: tenant ${tenantSlug} not found`);
  return { id: row.id, title: input.title, optionIds: options.map((option) => option.id) };
}

/** Archives (or reactivates) a question the way the screens do: only the instant moves. */
export async function setArchived(questionId: string, archived: boolean): Promise<void> {
  await sql()`
    update public.profile_form_questions
       set archived_at = ${archived ? new Date() : null}, updated_at = now()
     where id = ${questionId}::uuid`;
}

/** Flips the required flag of a question. */
export async function setRequired(questionId: string, required: boolean): Promise<void> {
  await sql()`
    update public.profile_form_questions
       set required = ${required}, updated_at = now()
     where id = ${questionId}::uuid`;
}

/** One answer of the member `email` to a question, as the table stores it (`value` is the bare JSON value). */
export async function answerFor(
  email: string,
  questionId: string,
  value: unknown,
  tenantSlug: string = LAB,
): Promise<void> {
  await sql()`
    insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
    select m.tenant_id, ${questionId}::uuid, m.id, m.user_id, ${sql().json(value as never)}
      from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where u.email = ${email} and t.slug = ${tenantSlug} and m.deleted_at is null
    on conflict (tenant_id, membership_id, question_id)
    do update set value = excluded.value, updated_at = now()`;
}

/** The stored value of an answer, or `undefined` when the member has none for that question. */
export async function storedAnswer(
  email: string,
  questionId: string,
  tenantSlug: string = LAB,
): Promise<unknown> {
  const rows = await sql()<{ value: unknown }[]>`
    select a.value
      from public.profile_form_answers a
      join public.users u on u.id = a.user_id
      join public.tenants t on t.id = a.tenant_id
     where u.email = ${email} and t.slug = ${tenantSlug} and a.question_id = ${questionId}::uuid`;
  return rows[0]?.value;
}

/** How many answers a question holds, across members. */
export async function answerCount(questionId: string): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers where question_id = ${questionId}::uuid`;
  return row?.n ?? 0;
}

/** The stored fields of the question titled `title` in the lab, or `null`. */
export async function questionByTitle(
  title: string,
  tenantSlug: string = LAB,
): Promise<{
  id: string;
  type: string;
  required: boolean;
  showOnProfile: boolean;
  allowOther: boolean;
  limits: { min?: number | string; max?: number | string };
  options: { id: string; label: string }[];
  archived: boolean;
} | null> {
  const rows = await sql()<
    {
      id: string;
      type: string;
      required: boolean;
      show_on_profile: boolean;
      allow_other: boolean;
      limits: { min?: number | string; max?: number | string };
      options: { id: string; label: string }[];
      archived_at: Date | null;
    }[]
  >`
    select q.id::text as id, q.type, q.required, q.show_on_profile, q.allow_other, q.limits,
           q.options, q.archived_at
      from public.profile_form_questions q join public.tenants t on t.id = q.tenant_id
     where t.slug = ${tenantSlug} and q.title = ${title}
     limit 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    required: row.required,
    showOnProfile: row.show_on_profile,
    allowOther: row.allow_other,
    limits: row.limits,
    options: row.options,
    archived: row.archived_at !== null,
  };
}

/** The titles of the ACTIVE questions that start with `prefix`, in the order members see them. */
export async function activeTitles(prefix: string, tenantSlug: string = LAB): Promise<string[]> {
  const rows = await sql()<{ title: string }[]>`
    select q.title
      from public.profile_form_questions q join public.tenants t on t.id = q.tenant_id
     where t.slug = ${tenantSlug} and q.archived_at is null and q.title like ${`${prefix}%`}
     order by q.position, q.created_at, q.id`;
  return rows.map((row) => row.title);
}

/** The instant a member pressed "Agora não" on the new-questions notice, or `null`. */
export async function noticeDismissedAt(
  email: string,
  tenantSlug: string = LAB,
): Promise<Date | null> {
  const rows = await sql()<{ at: Date | null }[]>`
    select mp.profile_form_notice_dismissed_at as at
      from public.member_profiles mp
      join public.memberships m on m.id = mp.membership_id
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where u.email = ${email} and t.slug = ${tenantSlug}`;
  return rows[0]?.at ?? null;
}

/** A post by the seeded lab admin, the destination of a deep link. The caption must carry the run prefix. */
export async function createPost(caption: string, tenantSlug: string = LAB): Promise<string> {
  if (!caption.startsWith(PROFILE_FORM_NAMESPACE)) {
    throw new Error(`createPost: "${caption}" does not start with ${PROFILE_FORM_NAMESPACE}`);
  }
  return createFeedPostAs(SEED_ADMIN, tenantSlug, caption);
}

/** A throwaway account of the lab (the e-mail local part must start with the run prefix). */
export async function createAccount(
  email: string,
  role: 'member' | 'support_tenant' | 'admin_tenant' = 'member',
  displayName?: string,
): Promise<void> {
  if (!email.startsWith(PROFILE_FORM_NAMESPACE)) {
    throw new Error(`createAccount: "${email}" does not start with ${PROFILE_FORM_NAMESPACE}`);
  }
  await createMember(email, PASSWORD, LAB, role);
  if (displayName) await setMemberDisplayName(email, LAB, displayName);
}

/** A title of exactly `length` characters that starts with `prefix` and mixes words with one unbroken run. */
export function longTitle(prefix: string, tag: string, length = 120): string {
  const head = `${prefix} ${tag} `;
  const filler = 'Pergunta comprida sem pontuacao nenhuma '.repeat(6);
  return `${head}${filler}`.slice(0, length).trimEnd().padEnd(length, 'x');
}

// ── Browser steps ──────────────────────────────────────────────────────────────────────────────────

/** A fresh phone context and its page (the iPhone 14 preset, service workers blocked). `width` narrows it. */
export async function newPhonePage(
  browser: Browser,
  width?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await phoneContext(browser, width);
  return { context, page: await context.newPage() };
}

/** Signs `email` in on the lab host while NOTHING gates it (the usual `/entrar` form, landing on `/inicio`). */
export async function signInToLab(page: Page, email: string): Promise<void> {
  await login(page, email, PASSWORD, hosts.lab);
}

/**
 * Signs a member in who OWES a required answer: the sign-in lands on `/completar-perfil` instead of
 * `/inicio`, so the shared `login()` (which waits for `/inicio`) does not fit. Same form, same fields.
 */
export async function signInIntoGate(page: Page, email: string): Promise<void> {
  await withoutProfileNudge(page);
  await page.goto(`${hosts.lab}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/completar-perfil/, { timeout: 30_000 });
}

/** The wrapper of one question on the member screen (`data-question`), the root every control is found under. */
export function questionBlock(page: Page, questionId: string): Locator {
  return page.locator(`[data-question="${questionId}"]`);
}

/**
 * Opens the builder (`/configuracoes/formulario-de-perfil`, optionally a tab) until it answers. The API's
 * module-flag cache keeps a module turned on a moment ago at 404 for up to 30 s, so the goto is repeated.
 */
export async function openBuilder(page: Page, aba?: 'arquivadas'): Promise<void> {
  const url = `${hosts.lab}/configuracoes/formulario-de-perfil${aba ? `?aba=${aba}` : ''}`;
  await openUntilReady(page, url, () =>
    page.getByRole('heading', { name: 'Formulário de perfil', level: 1 }),
  );
}

/**
 * Opens `/membros/{membershipId}` as a staff user until the "Respostas do formulário" block is on screen.
 *
 * The staff read (`GET /v1/members/{id}/profile-answers`) is authorised by the composed permission
 * `profile_form.read`, which comes from the API's 30 s module-flag cache; the member's public read and the
 * gate read the row live. A spec writes the row with direct SQL, which cannot invalidate that cache, so
 * when another spec of the same run loaded the cache BEFORE the module went on (the gate spec signs a
 * member in first), the staff read answers its bare 404 until the entry expires and the screen shows the
 * base profile with no block and no error row. Repeating the goto absorbs the lag, like `openBuilder`.
 */
export async function openMemberAsStaff(page: Page, membershipId: string): Promise<void> {
  await openUntilReady(page, `${hosts.lab}/membros/${membershipId}`, () =>
    page.locator('[data-member-answers="staff"]'),
  );
}

/** The row of the builder's list for a question title (the whole row is one button). */
export function builderRow(page: Page, title: string): Locator {
  return page.getByRole('button', { name: `Editar pergunta: ${title}` });
}

/**
 * The control answers a tap over at least 44px (the shipped `min-h-11` boxes measure it directly; the
 * `hitArea` buttons extend a smaller visible box, which `expectTapTarget` probes with `elementFromPoint`).
 */
export async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}: not on screen`).toBeVisible();
  const box = await locator.boundingBox();
  if (box !== null && Math.round(box.height) >= 44) return;
  await expectTapTarget(locator);
}

/** No sideways scroll and every named control at least 44px, for the screen the page is on right now. */
export async function expectScreenFits(
  page: Page,
  label: string,
  controls: Record<string, Locator>,
): Promise<void> {
  await expectNoHorizontalScroll(page, label);
  for (const [name, locator] of Object.entries(controls)) {
    await expectTouchTarget(locator, `${label} / ${name}`);
  }
}
