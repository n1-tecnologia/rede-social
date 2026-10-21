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
  type EventItem,
  type EventsResponse,
  eventItemSchema,
  eventsResponseSchema,
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
  type StoreMapping,
  saveIntegrationResultSchema,
  storeMappingResponseSchema,
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

/**
 * `GET /v1/payments/gate/preview`: two exact integers, staff excluded from both: `count`, the members a
 * release would admit (effective access none), and `gatewayCut`, the members the gateway has cut, who
 * stay cut (D-489).
 */
export async function previewGate(): Promise<GatePreview> {
  const res = await send('/gate/preview', 'GET');
  return gatePreviewSchema.parse(await res.json());
}

/**
 * `PUT /v1/payments/gate { required, releaseExisting? }`: the flip and the release are one write; it
 * answers the switch, the rows released and the members the gateway left cut.
 */
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

/**
 * `GET /v1/payments/events` (09.1-10, D-503): the latest 50 settled deliveries in the neutral shape, never
 * paged and never searched. The schema is strict, so a payload, a header or a signature would fail to
 * parse here instead of reaching a component (T-09.1-65).
 */
export async function getEvents(): Promise<EventsResponse> {
  const res = await send('/events', 'GET');
  return eventsResponseSchema.parse(await res.json());
}

/**
 * `POST /v1/payments/events/{eventId}/grant` ("Liberar manualmente", D-503): the store's own grant for a
 * delivery that found no account. The answer is the updated event. 409 `no_membership` (still no account)
 * and `not_grantable`, and the bare 404, reach the caller as a `PaymentsApiError`.
 */
export async function grantEvent(id: string): Promise<EventItem> {
  const res = await send(`/events/${encodeURIComponent(id)}/grant`, 'POST');
  return eventItemSchema.parse(await res.json());
}

/**
 * Why a store-mapping call did not do its job (09.1-17, D-502, A-P12): the three field issues of the
 * product form's "Pagamento" block, the bare 404 and 403, a refusal the bootstrap knows (the caller
 * navigates) and everything else.
 */
export type StoreMappingReason =
  | 'id_required'
  | 'id_taken'
  | 'link_invalid'
  | 'not_found'
  | 'forbidden'
  | 'generic';

/**
 * The closed outcome of the three store-mapping calls. They NEVER throw: the product form maps each
 * reason to a field error or the shipped save toast, and `redirect` carries the path the server
 * action navigates to OUTSIDE its try/catch. `connected` is `null` when the answer carried none (an
 * empty 204).
 */
export type StoreMappingOutcome =
  | { ok: true; connected: boolean | null; mapping: StoreMapping | null }
  | { ok: false; reason: StoreMappingReason }
  | { ok: false; reason: 'redirect'; path: string };

/** The `details.payments` issues the form has a field for; every other issue reads as `generic`. */
const MAPPING_ISSUES: Partial<Record<string, StoreMappingReason>> = {
  gateway_product_id_required: 'id_required',
  product_id_required: 'id_required',
  gateway_product_taken: 'id_taken',
  link_invalid: 'link_invalid',
};

function mappingReasonOf(error: unknown): StoreMappingOutcome {
  if (error instanceof ApiClientError) {
    const path = bootstrapRedirectPath(error);
    if (path) return { ok: false, reason: 'redirect', path };
  }
  if (error instanceof PaymentsApiError) {
    const issue = MAPPING_ISSUES[error.issue ?? ''];
    if (issue) return { ok: false, reason: issue };
    if (error.status === 404) return { ok: false, reason: 'not_found' };
    if (error.status === 403 && error.code === 'FORBIDDEN')
      return { ok: false, reason: 'forbidden' };
  }
  // Shape only: never the product id, the gateway id, the link or the body (UI-D-532).
  console.error('payments.store_mapping_failed', {
    ...(error instanceof PaymentsApiError || error instanceof ApiClientError
      ? { status: error.status, code: error.code }
      : { error: error instanceof Error ? error.name : 'unknown' }),
  });
  return { ok: false, reason: 'generic' };
}

async function storeMappingCall(
  method: 'GET' | 'PUT' | 'DELETE',
  productId: string,
  body?: unknown,
): Promise<StoreMappingOutcome> {
  try {
    const res = await send(`/store-products/${encodeURIComponent(productId)}`, method, body);
    // A 204 carries no body: the mapping is gone and the connection is not known.
    if (res.status === 204) return { ok: true, connected: null, mapping: null };
    const parsed = storeMappingResponseSchema.parse(await res.json());
    return { ok: true, connected: parsed.connected, mapping: parsed.mapping };
  } catch (error) {
    return mappingReasonOf(error);
  }
}

/** The fields the product form writes: a mapping needs the gateway's id, the link is optional. */
export interface StoreMappingInput {
  externalProductId: string;
  checkoutUrl?: string | null;
}

/** `GET /v1/payments/store-products/{id}` (09.1-09): the saved mapping and whether the tenant is connected. */
export function getStoreMapping(productId: string): Promise<StoreMappingOutcome> {
  return storeMappingCall('GET', productId);
}

/**
 * `PUT /v1/payments/store-products/{id}` (A-P12): upserts the mapping, SEPARATE from and AFTER the
 * store save. The same body twice leaves the same row, so a retry is safe.
 */
export function putStoreMapping(
  productId: string,
  body: StoreMappingInput,
): Promise<StoreMappingOutcome> {
  return storeMappingCall('PUT', productId, body);
}

/** `DELETE /v1/payments/store-products/{id}`: removing a product that is not mapped answers the same. */
export function deleteStoreMapping(productId: string): Promise<StoreMappingOutcome> {
  return storeMappingCall('DELETE', productId);
}
