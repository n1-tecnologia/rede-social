import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Request, test } from '@playwright/test';
import { closeAdmin, resetMemberProfile } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import { pickPhoto } from './media-fixtures';
import { ensureWorker } from './worker';

/**
 * MEDIA-01 / MEDIA-02 (plan 03-04) on the phone project: the photo really leaves the browser for
 * Supabase Storage — plain PUT under 6 MiB, TUS above it — and a photo the picker never offered is
 * re-encoded on the way out without the member being told anything about formats.
 *
 * Fixtures (`e2e/fixtures/`, see its README for the generator):
 *   `iphone.heic` — the SAME iPhone-originated capture `packages/core/tests/fixtures/` carries; it is
 *                   copied rather than sourced twice, so the client and server cases cannot drift.
 *   `large.jpg`   — 6.98 MiB at 2048 px: ABOVE the 6 MiB resumable threshold and BELOW the 8 MiB
 *                   avatar cap, so it survives normalisation untouched and must travel over TUS.
 *   `huge.jpg`    — 11.68 MiB at 2048 px: above the cap, so the browser re-encode is what rescues it.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const HEIC = `${FIXTURES}iphone.heic`;
const LARGE = `${FIXTURES}large.jpg`;
const HUGE = `${FIXTURES}huge.jpg`;

const SEEDED = { displayName: 'Membro TRIA Demo', bio: null } as const;

/**
 * The photo field's OWN alert. Scoped on purpose: Next renders a permanent empty
 * `role="alert"` route announcer, so an unscoped `getByRole('alert')` always resolves.
 */
function photoAlert(page: Page) {
  return page.locator('[data-photo-field]').getByRole('alert');
}

/** Every request the page made, so "the bytes never transit our servers" is an assertion, not a claim. */
function recordRequests(page: Page) {
  const seen: { url: string; method: string; body: number }[] = [];
  page.on('request', (request: Request) => {
    let body = 0;
    try {
      body = request.postDataBuffer()?.length ?? 0;
    } catch {
      body = -1; // a streamed body Playwright will not buffer — still not ours, see the assertions
    }
    seen.push({ url: request.url(), method: request.method(), body });
  });
  return seen;
}

test.describe('MEDIA-01 — the photo path', () => {
  let stopWorker: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    // Variant derivation (`kernel.media-derive-variants`) runs in the worker role, not in the API.
    stopWorker = await ensureWorker();
  });

  test.afterEach(async () => {
    await resetMemberProfile(users.demoMember, {
      displayName: SEEDED.displayName,
      bio: SEEDED.bio,
      avatarAssetId: null,
    });
  });

  test.afterAll(async () => {
    await stopWorker?.();
    await closeAdmin();
  });

  test('a photo from the phone is re-encoded silently — no format word ever reaches the member', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    // Whether the browser under test can decode this capture at all decides which half of the
    // contract is observable HERE: Safari/iOS decodes it and the re-encode is invisible; Chromium
    // has no decoder for it, so the prepare-failed copy is the correct answer. Both halves must
    // never mention a format — that is the assertion this case exists for (R-12). The real-device
    // silent-success check stays 03-08's UAT (RESEARCH A1).
    const decodes = await page.evaluate(async (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/heic' }));
      return await new Promise<boolean>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = url;
      });
    }, readFileSync(HEIC).toString('base64'));

    await pickPhoto(page, HEIC);

    if (decodes) {
      await expect(page.getByRole('status')).toHaveText('Foto atualizada.');
      await expect(photoAlert(page)).toHaveCount(0);
    } else {
      await expect(photoAlert(page)).toHaveText(
        'Não foi possível preparar esta imagem. Tente outra foto.',
      );
    }

    // In EITHER branch: the member is never shown the format's name, nor a "wrong format" refusal.
    await expect(page.locator('body')).not.toContainText(/heic/i);
    await expect(page.locator('body')).not.toContainText('Formato não suportado');
  });

  test('a 7 MiB photo travels over TUS in 6 MiB chunks, and no byte passes through our servers', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const requests = recordRequests(page);
    await page.goto('/perfil/editar');

    await pickPhoto(page, LARGE);
    await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 30_000 });

    const resumable = requests.filter((r) => r.url.includes('/storage/v1/upload/resumable'));
    expect(resumable.length).toBeGreaterThan(0);

    // The API is never called from the browser at all (every call goes through the Next BFF), and
    // nothing the browser POSTs to the Next origin carries a file: a server action payload is
    // `{ kind, purpose, mime, size }`, kilobytes at most (CLAUDE.md §4, Cloud Run's 32 MiB cap).
    expect(requests.filter((r) => r.url.includes('localhost:8787'))).toHaveLength(0);
    const fat = requests.filter((r) => !r.url.includes('/storage/v1/') && r.body > 512 * 1024);
    expect(fat).toHaveLength(0);
  });

  test('a photo above the cap is rescued by the re-encode instead of being refused', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    await pickPhoto(page, HUGE);
    await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 30_000 });
    await expect(photoAlert(page)).toHaveCount(0);
  });

  test('a disallowed type is refused at pick time, before any upload is started', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const requests = recordRequests(page);
    await page.goto('/perfil/editar');

    await pickPhoto(page, {
      name: 'anim.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });

    await expect(photoAlert(page)).toHaveText('Formato não suportado. Use JPEG, PNG ou WebP.');
    expect(requests.filter((r) => r.url.includes('/storage/v1/'))).toHaveLength(0);
  });

  test('"Cancelar envio" aborts the transfer and leaves the member free to pick again', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil/editar');

    // Slow the transfer down (localhost finishes a 7 MiB TUS upload in about a second) so the
    // progress state — and the control that cancels it — are observable at all.
    await page.route('**/storage/v1/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue().catch(() => {
        // The cancel aborts the request in flight; continuing an aborted route is a no-op.
      });
    });

    await pickPhoto(page, LARGE);
    const cancel = page.getByRole('button', { name: 'Cancelar envio' });
    await expect(cancel).toBeVisible();
    await cancel.click();

    await expect(cancel).toBeHidden();
    await expect(photoAlert(page)).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.unroute('**/storage/v1/**');

    // The zone accepts the next photo immediately — a cancelled upload strands nothing.
    await pickPhoto(page, LARGE);
    await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 30_000 });
  });
});
