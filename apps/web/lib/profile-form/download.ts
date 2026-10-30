/**
 * Starts the browser's download of the answers CSV (12-17, D-595, UI-D-579; T-12-37).
 *
 * A plain navigation to the attachment would hide a failure (the browser shows its own error page or
 * nothing), so the file is fetched with `fetch`, turned into an object URL and saved through a
 * temporary anchor. The URL is revoked right after the click. **The bytes live only between the fetch
 * and the click**: they are never written to a storage API or a cache, never put in a URL beyond the
 * short-lived object URL, and never logged. The result carries a status, never a byte.
 */

export type DownloadResult = { ok: true } | { ok: false; status: number | null };

const FALLBACK_NAME = 'respostas-perfil.csv';

/**
 * The file name of a `Content-Disposition` header (`attachment; filename="x.csv"`), or the fallback when
 * the header is missing or unusable. Only a plain `.csv` base name is accepted, so a path or a header
 * trick cannot choose where or how the file is saved.
 */
export function filenameFromDisposition(header: string | null): string {
  if (!header) return FALLBACK_NAME;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const raw = match?.[1]?.trim();
  if (!raw) return FALLBACK_NAME;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // An undecodable value keeps the raw text; the check below decides.
  }
  return /^[\w.-]+\.csv$/i.test(name) ? name : FALLBACK_NAME;
}

export async function startCsvDownload(url: string): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    return { ok: false, status: null };
  }
  if (!res.ok) return { ok: false, status: res.status };

  let objectUrl: string;
  try {
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);
  } catch {
    return { ok: false, status: null };
  }

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filenameFromDisposition(res.headers.get('content-disposition'));
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return { ok: true };
}
