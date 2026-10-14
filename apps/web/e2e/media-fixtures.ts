import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

/** What Playwright accepts as a file: a path on disk, or an in-memory payload. */
export type PickedFile = string | { name: string; mimeType: string; buffer: Buffer };

/**
 * A landscape PNG built in memory (08.2-12 E11 media; 08.3-12 E08 populated): three vertical bands,
 * so a centre crop keeps the middle one. No image fixture of the repo is landscape, and a stored one
 * would be one more binary to keep; `node:zlib` has both the deflate and the CRC the format needs.
 */
export function landscapePng(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    const band =
      x < width / 3 ? [40, 40, 40] : x < (2 * width) / 3 ? [124, 58, 237] : [230, 230, 230];
    row.set(band, 1 + x * 3);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
