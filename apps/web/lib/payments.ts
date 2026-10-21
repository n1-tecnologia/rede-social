import {
  type AccessItemState,
  type AccessPage,
  type AccessProduct,
  type AccessProductBody,
  type AccessProductPatch,
  type AccessResult,
  accessPageSchema,
  accessProductSchema,
  accessResultSchema,
  type GateBody,
  type GatePreview,
  type GateResult,
  gatePreviewSchema,
  gateResultSchema,
  PAYMENTS_ISSUE_SET,
  type PaymentsIssue,
  type PaymentsOverview,
  paymentsOverviewSchema,
  type RemoveAccessProductResult,
  removeAccessProductResultSchema,
  type SaveIntegrationBody,
  type SaveIntegrationResult,
  saveIntegrationResultSchema,
} from '@rede-social/module-payments/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The Pagamentos admin web client (09.1-13, D-491, D-501, D-502, PAY-04, PAY-08, PAY-19, PAY-20,
 * PAY-31): typed functions over `apiFetch('/v1/payments/…')`. SERVER-ONLY like `lib/store.ts`: every
 * call carries the session's Bearer and the tenant host, so the browser never talks to the API and
 * never holds a token.
 *
 * The API is the authority (09.1-09): each route sits behind `requireModule('payments')` and
 * `requirePermission('payments.manage')`, and re-enforces the invariants the screen only mirrors
 * (`gate_requires_setup`, `last_access_product`, `gateway_product_taken`). This client renders the
 * server's state and sends the admin's intent; it decides nothing about who has access.
 *
 * **Errors.** A refusal the bootstrap knows (401, blocked, suspended…) is re-thrown as an
 * `ApiClientError` so the caller can navigate with `bootstrapRedirectPath`; every other refusal is a
 * `PaymentsApiError` carrying the HTTP status, the envelope code and the lifted `details.payments`
 * issue, and NOTHING else. In particular no request body ever reaches an error or a log line: the
 * webhook token is write-only (D-486, T-09.1-60).
 */

/** A refusal of a payments route: the status, the envelope code and the lifted issue, nothing more. */
export class PaymentsApiError extends Error {
  constructor(
    public readonly status: number,
    /** The envelope's stable code (`FORBIDDEN`, `CONFLICT`, `MODULE_DISABLED`…). */
    public readonly code: string,
    /** `details.payments` when it is one of the closed `PAYMENTS_ISSUES`, else `null`. */
    public readonly issue: PaymentsIssue | null,
  ) {
    super(`payments ${status} ${code}${issue ? ` ${issue}` : ''}`);
    this.name = 'PaymentsApiError';
  }
}

/** Reads the envelope without ever throwing on a non-JSON body. */
async function failure(res: Response): Promise<ApiClientError | PaymentsApiError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code: every caller's refusal handling is the same.
  }
  const known = new ApiClientError(res.status, code, details);
  if (bootstrapRedirectPath(known) !== null) return known;
  const issue = details?.payments;
  return new PaymentsApiError(
    res.status,
    code,
    typeof issue === 'string' && PAYMENTS_ISSUE_SET.has(issue) ? (issue as PaymentsIssue) : null,
  );
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  const res = await apiFetch(`/v1/payments${path}`, {
    method,
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await failure(res);
  return res;
}

/** `GET /v1/payments/overview`: the integration, the access products and the gate in one read. */
export async function getOverview(): Promise<PaymentsOverview> {
  const res = await send('/overview', 'GET');
  return paymentsOverviewSchema.parse(await res.json());
}

/** `PUT /v1/payments/integration { token }`: write-only, the answer is `{ connected: true }`. */
export async function saveIntegration(body: SaveIntegrationBody): Promise<SaveIntegrationResult> {
  const res = await send('/integration', 'PUT', body);
  return saveIntegrationResultSchema.parse(await res.json());
}

/** `POST /v1/payments/access-products`. */
export async function createAccessProduct(body: AccessProductBody): Promise<AccessProduct> {
  const res = await send('/access-products', 'POST', body);
  return accessProductSchema.parse(await res.json());
}

/** `PATCH /v1/payments/access-products/{id}`: only the keys that changed. */
export async function updateAccessProduct(
  id: string,
  patch: AccessProductPatch,
): Promise<AccessProduct> {
  const res = await send(`/access-products/${encodeURIComponent(id)}`, 'PATCH', patch);
  return accessProductSchema.parse(await res.json());
}

/** `DELETE /v1/payments/access-products/{id}`: 409 `last_access_product` while the gate is on. */
export async function removeAccessProduct(id: string): Promise<RemoveAccessProductResult> {
  const res = await send(`/access-products/${encodeURIComponent(id)}`, 'DELETE');
  return removeAccessProductResultSchema.parse(await res.json());
}

/** `GET /v1/payments/gate/preview`: members of the tenant, staff excluded, with no usable access. */
export async function previewGate(): Promise<GatePreview> {
  const res = await send('/gate/preview', 'GET');
  return gatePreviewSchema.parse(await res.json());
}

/** `PUT /v1/payments/gate { required, releaseExisting? }`: the flip and the release are one write. */
export async function setGate(body: GateBody): Promise<GateResult> {
  const res = await send('/gate', 'PUT', body);
  return gateResultSchema.parse(await res.json());
}

/** The query of `GET /v1/payments/accesses` as the web sends it: only what the screen has. */
export interface AccessQuery {
  q?: string | undefined;
  status?: AccessItemState | undefined;
  cursor?: string | undefined;
}

/**
 * `GET /v1/payments/accesses` (09.1-10, D-504): one row per e-mail, the state computed in SQL, a keyset
 * page of the API's default size. `cursor` is opaque and forwarded untouched. The query string carries a
 * search term, so it is never logged by this client.
 */
export async function getAccesses(query: AccessQuery): Promise<AccessPage> {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.status) search.set('status', query.status);
  if (query.cursor) search.set('cursor', query.cursor);
  const qs = search.toString();
  const res = await send(qs ? `/accesses?${qs}` : '/accesses', 'GET');
  return accessPageSchema.parse(await res.json());
}

/** The four e-mail actions of the Acessos tab (D-489, D-504). */
export type AccessActionKind = 'release' | 'block' | 'unblock' | 'remove-release';

/**
 * `POST /v1/payments/accesses/{release|block|unblock|remove-release} { email }`: the address travels in the
 * body, never a path segment. The answer is the updated row, or `{ access: null }` when no row remains.
 * 409 `blocked` (a release under a block), 400 `email_invalid` and the bare 404 reach the caller as a
 * `PaymentsApiError`.
 */
export async function postAccess(kind: AccessActionKind, email: string): Promise<AccessResult> {
  const res = await send(`/accesses/${kind}`, 'POST', { email });
  return accessResultSchema.parse(await res.json());
}
