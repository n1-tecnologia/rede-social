/**
 * `POST /api/csp-report` (08-08, D-346, T-08-43): the sink the Content Security Policy names in
 * `report-uri`. Production ships `Content-Security-Policy-Report-Only` first, so this is how a
 * violation on a real device becomes visible before the 08-12 flip to `enforce`: one bounded
 * `csp.violation` line per report in the Vercel logs (DEPLOY.md "Content Security Policy (Phase 8)").
 *
 * Unauthenticated by design (the sign-in page reports too; `proxy.ts` lists it as public), so it
 * treats every byte as hostile:
 * - only `application/csp-report` (the `report-uri` format) and `application/reports+json` (the
 *   Reporting API format) are read; anything else is 415;
 * - at most 16 KB is read, from the stream, whatever `content-length` claims; more is 413;
 * - the parse is defensive (bad JSON or an unknown shape logs nothing) and at most five reports of
 *   one request are logged;
 * - the log line carries only the effective directive (a `[a-z-]` token), the blocked HOST (never a
 *   path or query, which can hold tokens) or a CSP keyword such as `inline`, and the document PATH
 *   (no query, no host), each length-capped;
 * - the answer is always an empty 204: nothing from the body is ever reflected.
 */

export const dynamic = 'force-dynamic';

const MAX_BYTES = 16 * 1024;
const MAX_REPORTS = 5;
const ACCEPTED = new Set(['application/csp-report', 'application/reports+json']);

type Violation = { directive: string; blocked: string; path: string };

/** Reads the body up to `MAX_BYTES`; null when it is larger. */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `script-src-elem` and friends; anything else becomes `unknown`. */
function cleanDirective(value: string): string {
  const token = value.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return /^[a-z-]{1,40}$/.test(token) ? token : 'unknown';
}

/** The blocked resource's host only, or the CSP keyword (`inline`, `eval`, `data`, `blob`, ...). */
function cleanBlocked(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z-]{1,20}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    if (
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'wss:' ||
      url.protocol === 'ws:'
    ) {
      return url.host.slice(0, 100);
    }
    return url.protocol.replace(/:$/, '').slice(0, 20);
  } catch {
    return 'unknown';
  }
}

/** The document's path only (no host, query or fragment), with anything unprintable dropped. */
function cleanPath(value: string): string {
  try {
    return new URL(value).pathname.replace(/[^\x21-\x7e]/g, '').slice(0, 200) || '/';
  } catch {
    return 'unknown';
  }
}

function toViolation(report: Record<string, unknown>, legacy: boolean): Violation {
  if (legacy) {
    return {
      directive: cleanDirective(
        str(report['effective-directive']) || str(report['violated-directive']),
      ),
      blocked: cleanBlocked(str(report['blocked-uri'])),
      path: cleanPath(str(report['document-uri'])),
    };
  }
  return {
    directive: cleanDirective(str(report.effectiveDirective)),
    blocked: cleanBlocked(str(report.blockedURL)),
    path: cleanPath(str(report.documentURL)),
  };
}

/** Both report formats, defensively; an unknown shape yields nothing. */
function violationsOf(contentType: string, payload: unknown): Violation[] {
  if (contentType === 'application/csp-report') {
    const report = asRecord(asRecord(payload)?.['csp-report']);
    return report ? [toViolation(report, true)] : [];
  }
  if (!Array.isArray(payload)) return [];
  const out: Violation[] = [];
  for (const entry of payload.slice(0, MAX_REPORTS)) {
    const record = asRecord(entry);
    const body = asRecord(record?.body);
    if (record?.type === 'csp-violation' && body) out.push(toViolation(body, false));
  }
  return out;
}

export async function POST(request: Request): Promise<Response> {
  const contentType =
    (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ACCEPTED.has(contentType)) return new Response(null, { status: 415 });

  const text = await readCapped(request);
  if (text === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }

  for (const violation of violationsOf(contentType, payload).slice(0, MAX_REPORTS)) {
    console.warn('csp.violation', violation);
  }
  return new Response(null, { status: 204 });
}
