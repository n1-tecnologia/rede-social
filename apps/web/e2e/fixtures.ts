import { expect, type Page } from '@playwright/test';
import { PROFILE_NUDGE_KEY } from '../lib/profile-nudge';
import { e2eHosts } from './hosts';

/** Seed password (scripts/seed.ts). Passed on the command line, never stored. */
export const SEED_PASSWORD: string = (() => {
  const value = process.env.SEED_PASSWORD;
  if (!value) {
    throw new Error(
      'SEED_PASSWORD is required for the e2e suite (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

/** Seeded users (01-01). */
export const users = {
  demoMember: 'member@rede-demo.local',
  demoAdmin: 'admin@rede-demo.local',
  labMember: 'member@rede-lab.local',
  labAdmin: 'admin@rede-lab.local',
} as const;

/**
 * The feed posts `scripts/seed.ts` writes for BOTH seed tenants (04-01). The captions are identical
 * on the two sides on purpose — that is what makes "a lab member never sees the demo post" an honest
 * assertion about tenancy rather than about copy — so an e2e that asserts a caption must ALSO assert
 * which tenant it is on. `newest` is the second entry, one minute after `oldest`, so it heads the
 * feed.
 *
 * Mirrored here rather than imported: `scripts/seed.ts` is a top-level-await script that requires
 * `SEED_PASSWORD` and opens a database connection at import time. This is the same convention
 * `members.spec.ts`'s `SEEDED` block uses for the seeded member names.
 */
export const seededFeed = {
  oldest: 'Bem-vindos! Esta é a primeira publicação da comunidade.',
  newest: 'Encontro de sábado confirmado. Levem água e um caderno.',
  demoAuthor: 'Admin Rede Demo',
  labAuthor: 'Admin Rede Lab',
} as const;

/**
 * 04-06's paging and meta-row fixtures, identical in both tenants. Mirrored from `scripts/seed.ts`
 * for the same reason `seededFeed` is: the seed is a top-level-await script that requires
 * `SEED_PASSWORD` and opens a database connection at import time.
 *
 * `total` is what one tenant's MERGED feed holds after `pnpm db:seed` — and since 05-03 the merged
 * feed is the whole tenant, community posts included (D-73), so the six posts the seed publishes
 * inside communities are part of this number. `pageSize` is `FEED_PAGE_SIZE`, so the sentinel has
 * FOUR pages to walk (10 + 10 + 10 + 3).
 */
export const seededFeedPaging = {
  pageSize: 10,
  /**
   * The DEMO tenant's post count: 9 tenant-wide fixtures, 18 fillers and 6 inside communities
   * (the lab tenant has 32 — one fewer, because only the demo tenant has the 40-character member
   * whose post the header-truncation case needs).
   */
  total: 33,
  /** The post whose `edited_at` is set: its meta row carries the marker (UI-D-15). */
  editedCaption: 'Programacao do mes, ja com a correcao dos horarios.',
  /** Exactly 40 characters (UI-SPEC E03 long-text backstop) — a demo-tenant member. */
  longDisplayName: 'Ana Carolina Albuquerque de Vasconcellos',
  /** The post the 40-character member authored, so the header truncation has a real card. */
  longNameCaption: 'Passando para dizer oi para a comunidade.',
  /** The first filler caption; the newest of the eighteen, so it lands on page 1. */
  firstFiller: 'Aviso 1 da comunidade: mais uma novidade para o mural.',
  /** The second filler: page 2, and the post the failed-like case toggles. */
  secondFiller: 'Aviso 2 da comunidade: mais uma novidade para o mural.',
} as const;

/**
 * 05-03's merged-feed fixtures (COMM-04, D-71/D-72), mirrored from `scripts/seed.ts` for the same
 * reason `seededFeed` is.
 *
 * `inCommunity` is the newest of the six posts the seed publishes INSIDE a community (four minutes
 * back, so it lands on page 1 of the merged feed), and `communityName` is the container it names —
 * which is also the string the D-71 "em {Comunidade}" label interpolates.
 */
export const seededCommunityFeed = {
  inCommunity: 'Pauta da reuniao de diretoria desta semana.',
  communityName: 'Avisos da diretoria',
  /** The second community of the seed's activity order — the picker's second row. */
  otherCommunityName: 'Eventos e encontros',
  /**
   * The FIXED id of `inCommunity` in the demo tenant (`SEED_COMMUNITY_POST_IDS`), so the edit
   * screen is reachable by direct URL. The card deliberately carries no `/post/{id}` link — the
   * post page is reached through the overflow menu — and a spec that scraped one would be asserting
   * a navigation affordance rather than the row it is actually about.
   */
  inCommunityPostId: '0d000000-0000-4000-8000-0000000000d1',
} as const;

/**
 * 04-07's comment fixtures, identical in both tenants (SCHEMA-CONVENTIONS §(j)), mirrored from
 * `scripts/seed.ts` for the same reason `seededFeed` is.
 *
 * `removedAuthorPost` is the SECOND seeded caption — the 04-03 thread stays on the first post so
 * the fixtures `feed.spec.ts` and the integration suite already name keep their exact counts. On
 * that second post the seed writes three rows and the three are the whole UI-D-24 argument: a root
 * whose author's membership was soft-deleted, a LIVE member's reply under it (the one an inner join
 * would have orphaned), and a live-author root beside it as the positive control.
 */
export const seededComments = {
  /** The post carrying the UI-D-24 thread: the second seeded caption. */
  removedAuthorPost: 'Encontro de sábado confirmado. Levem água e um caderno.',
  /** Written by the member whose membership carries a `deleted_at`. */
  removedAuthorBody: 'Escrevi isto antes de sair da comunidade.',
  /** The live member's reply beneath it — still listed, with its own author intact. */
  removedAuthorReplyBody: 'Obrigado pelo recado, seguimos com o combinado.',
  /** A live author's root on the SAME page: the control that keeps "removed" from being a constant. */
  liveRootBody: 'Estou por aqui e continuo na comunidade.',
  /** The 04-03 thread, on the FIRST seeded post. */
  firstPost: 'Bem-vindos! Esta é a primeira publicação da comunidade.',
  firstPostRootBody: 'Que bom ver a comunidade comecando!',
  firstPostReplyBody: 'Tambem vou estar la no sabado.',
} as const;

/**
 * 04-04's media fixtures, identical in both tenants (SCHEMA-CONVENTIONS §(j)). The captions are what
 * `scripts/seed.ts` writes; the filename is the 94-character one UI-SPEC E07's long-text row needs.
 */
export const seededFeedMedia = {
  textOnlyCaption: 'Bem-vindos! Esta é a primeira publicação da comunidade.',
  galleryCaption: 'Fotos do ultimo encontro da comunidade.',
  videoCaption: 'Um recado rapido em video para todo mundo.',
  attachmentCaption: 'Segue o calendario do semestre em PDF.',
  attachmentFilename:
    'calendario-completo-do-semestre-com-todas-as-atividades-e-os-encontros-da-nossa-comunidade.pdf',
} as const;

/**
 * Distinct origins (D-20/D-21). Chromium resolves `*.localhost` to loopback without /etc/hosts.
 * One source with the Playwright config (07-12): `./hosts.ts` `e2eHosts()`, same four defaults.
 */
export const hosts = e2eHosts();

/** Specs that need the local generic/lab/platform hosts call `test.skip(isRemote, 'local stack only')`. */
export const isRemote = Boolean(process.env.PLAYWRIGHT_BASE_URL);

/** Absolute origin of the tenant under test (for contexts created with `browser.newContext()`). */
export const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? hosts.demo;

/**
 * Keeps the "Complete seu perfil" popup out of a spec about something else. Since 2026-10-02 the
 * D-02 nudge is a modal that rises over Início when a member who owes a photo or a bio arrives (a
 * tab's first Início, and again after each sign-in), which is most seeded and throwaway accounts:
 * it would cover what such a spec taps on Início and hide the BottomNav it reads. This makes the
 * popup's visit marker unreadable on every page of the context, the one state in which the app
 * never raises it (blocked storage, `lib/profile-nudge.ts`). Nothing else changes: every other key,
 * and localStorage, read as before.
 *
 * It lives on `page.context()`. `login()` installs it; a spec that signs in by hand, or that opens
 * another context (`browser.newContext()`, a saved storage state), calls it itself before it taps
 * anything on Início.
 */
export async function withoutProfileNudge(page: Page): Promise<void> {
  await page.context().addInitScript((key: string) => {
    const scope = window as typeof window & { __withoutProfileNudge?: boolean };
    if (scope.__withoutProfileNudge) return;
    scope.__withoutProfileNudge = true;
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(this: Storage, name: string): string | null {
      if (name === key && this === window.sessionStorage) {
        throw new DOMException('the profile popup is off in this spec', 'SecurityError');
      }
      return read.call(this, name);
    };
  }, PROFILE_NUDGE_KEY);
}

/**
 * Fills the `/entrar` form and waits for the landing path (`/inicio` by default). The "Complete seu
 * perfil" popup stays out of the run (`withoutProfileNudge`) unless `profileNudge` asks for it:
 * only the PROF-01 specs do.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  origin?: string,
  expectedPath = '/inicio',
  { profileNudge = false }: { profileNudge?: boolean } = {},
): Promise<void> {
  if (!profileNudge) await withoutProfileNudge(page);
  await page.goto(`${origin ?? ''}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace(/\//g, '\\/')}$`));
}

/**
 * "Sair" lives on `/configuracoes` (D-42): opens the settings page on `origin`, clicks the main-column
 * button (the desktop rail carries a second "Sair", so the locator is scoped to `main`) and waits for
 * `/entrar`. Device-local sign-out (D-08).
 */
export async function signOut(page: Page, origin = ''): Promise<void> {
  await page.goto(`${origin}/configuracoes`);
  await page.locator('main').getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
}
