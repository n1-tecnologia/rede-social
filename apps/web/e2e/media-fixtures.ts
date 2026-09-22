import { expect, type Page } from '@playwright/test';

/** What Playwright accepts as a file: a path on disk, or an in-memory payload. */
export type PickedFile = string | { name: string; mimeType: string; buffer: Buffer };

/**
 * Waits until `/perfil/editar` is really interactive.
 *
 * The check is React state, not markup: "Salvar alterações" is disabled until the form is dirty, so
 * a keystroke that flips it to enabled proves the client handlers are attached. Without this gate a
 * `setInputFiles` can land on server-rendered HTML, where nothing is listening and the pick is
 * silently lost.
 */
export async function waitForEditFormReady(page: Page): Promise<void> {
  const save = page.getByRole('button', { name: 'Salvar alterações' });
  const name = page.locator('#displayName');
  await expect(save).toBeDisabled();
  await name.press('x');
  await expect(save).toBeEnabled();
  await name.press('Backspace');
  await expect(save).toBeDisabled();
}

/**
 * Picks a photo on `/perfil/editar` the way the member does at this breakpoint: the phone taps
 * "Alterar foto" and answers the OS picker; the desktop hands the file to the drop zone.
 */
export async function pickPhoto(page: Page, file: PickedFile): Promise<void> {
  await waitForEditFormReady(page);

  const button = page.locator('[data-photo-field] button', { hasText: 'Alterar foto' });
  if (await button.isVisible()) {
    const opening = page.waitForEvent('filechooser');
    await button.click();
    await (await opening).setFiles(file);
    return;
  }

  // `md:` renders the dashed zone instead of the button (UI-SPEC §Edit profile step 1).
  await page.locator('#avatar-dropzone').setInputFiles(file);
}
