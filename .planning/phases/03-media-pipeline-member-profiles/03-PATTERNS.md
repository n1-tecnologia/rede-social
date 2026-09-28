# Phase 3: Media Pipeline & Member Profiles - Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 31 new/modified files
**Analogs found:** 28 / 31

> Every analog path below is git-TRACKED source, verified with `git ls-files`. Nothing here points at a build output or an install mirror.
>
> **Headline for the planner:** RESEARCH §"Don't Hand-Roll" says the failure mode of this phase is *"we re-implemented the branding broker slightly differently and the two drifted"*. This map exists to prevent that. For almost every new file there is a Phase 2 file that already solved the same problem; the planner's action text should name the analog and the excerpt, not describe the pattern abstractly.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/server/media/keys.ts` | utility (pure) | transform | `packages/core/server/branding/upload.ts` | **exact** |
| `packages/core/server/media/limits.ts` | config (pure) | transform | `packages/core/server/branding/icons.ts` (const block) + `packages/contracts/src/branding.ts` | role-match |
| `packages/core/server/media/inspect.ts` | utility (pure) | transform | `packages/core/server/branding/icons.ts` (`inspectBrandingImage`) | **exact** |
| `packages/core/server/media/variants.ts` | utility (pure) | transform | `packages/core/server/branding/icons.ts` (`deriveIconSet`) | **exact** |
| `packages/core/server/media/storage.ts` | service (admin lane) | file-I/O | `packages/core/server/platform/branding.ts` | **exact** |
| `packages/core/server/media/service.ts` | service (tenant lane) | request-response | `packages/core/server/platform/branding.ts` + `packages/core/server/tenancy/membership-scope.ts` | role-match |
| `packages/core/server/media/derive-job.ts` | job handler | event-driven | `packages/core/server/branding/derive-icons-job.ts` | **exact** |
| `packages/core/server/media/sweep-job.ts` | job handler | batch | `packages/core/server/domains/verify-job.ts` (self-re-arm via `startAfter`) | role-match |
| `packages/core/server/media/video/types.ts` | contract/interface | — | `packages/core/server/domains/types.ts` | **exact** |
| `packages/core/server/media/video/mux.ts` | adapter (provider) | request-response | `packages/core/server/domains/vercel.ts` | **exact** |
| `packages/core/server/media/video/fake.ts` | adapter (local fake) | request-response | `packages/core/server/domains/fake.ts` | **exact** |
| `packages/core/server/media/video/index.ts` | config / DI barrel | — | `packages/core/server/domains/index.ts` | **exact** |
| `packages/core/server/media/video/event-job.ts` | job handler | event-driven | `packages/core/server/domains/verify-job.ts` | role-match |
| `packages/core/server/media/index.ts` | barrel + queue registration | — | `packages/core/server/branding/index.ts` / `domains/index.ts` | **exact** |
| `packages/core/server/profiles/service.ts` | service (tenant lane) | CRUD | `apps/api/src/routes/me.ts` (`withTenantTx` + `membershipOfRecord`) | role-match |
| `packages/core/server/profiles/search.ts` | utility (pure) | transform | `packages/core/server/branding/upload.ts` (pure-module posture) | partial |
| `packages/core/db/schema/media-assets.ts` | model | CRUD | `packages/core/db/schema/consent-records.ts` | **exact** |
| `packages/core/db/schema/media-provider-events.ts` | model | event-driven | `packages/core/db/schema/tenant-invites.ts` (RLS, **zero policies**) | **exact** |
| `packages/core/db/schema/member-profiles.ts` | model | CRUD | `packages/core/db/schema/consent-records.ts` | **exact** |
| `supabase/migrations/*_media_bucket.sql` | migration | config | `supabase/migrations/20260917021738_branding_bucket.sql` | **exact** |
| `supabase/config.toml` `[storage.buckets.media]` | config | — | `supabase/config.toml:126-135` (`[storage.buckets.branding]`) | **exact** |
| `supabase/tests/070-media-bucket.sql` | test (pgTAP) | — | `supabase/tests/060-branding-bucket.sql` | **exact** |
| `supabase/tests/020-tenant-isolation.sql` (extend) | test (pgTAP) | — | itself (existing file) | **exact** |
| `apps/api/src/routes/media.ts` | route (tenant lane) | request-response | `apps/api/src/routes/me.ts` + `apps/api/src/routes/platform/branding.ts` | role-match |
| `apps/api/src/routes/members.ts` | route (tenant lane) | CRUD | `apps/api/src/routes/me.ts` | role-match |
| `apps/api/src/routes/webhooks/mux.ts` | route (unauthenticated webhook) | event-driven | `apps/api/src/routes/hooks.ts` | **exact** |
| `apps/api/src/routes/me.ts` (modify `:118`) | route | request-response | itself | **exact** |
| `apps/api/src/worker.ts` (modify) | config | — | itself (`deriveIconsJob` line) | **exact** |
| `packages/contracts/src/media.ts` | contract (Zod) | — | `packages/contracts/src/branding.ts` | **exact** |
| `packages/contracts/src/profiles.ts` | contract (Zod) | — | `packages/contracts/src/branding.ts` | **exact** |
| `apps/web/components/media/UploadField.tsx` | component (client hook) | streaming | `apps/web/components/platform/LogoUpload.tsx` (`useSignedUpload`) | **exact** |
| `apps/web/lib/upload.ts` (extend: TUS branch) | utility (client) | streaming | itself — the docblock already reserves the Phase 3 branch | **exact** |
| `apps/web/components/media/MediaImage.tsx` | component | request-response | `apps/web/components/platform/LogoUpload.tsx` (`<img>` + biome-ignore) | partial |
| `apps/web/components/media/VideoPlayer.tsx` | component | streaming | — | **none** |
| `apps/web/app/(app)/perfil/page.tsx` (replace) | page (RSC) | request-response | itself + `reference/frontend-design/components/profile/ProfileHeader.tsx` | **exact** |
| `apps/web/app/(app)/perfil/editar/page.tsx` | page + form | CRUD | `reference/frontend-design/components/profile/EditProfileForm.tsx` + `apps/web/components/platform/BrandingForm.tsx` | role-match |
| `apps/web/app/(app)/membros/page.tsx` | page (list + search) | CRUD | `reference/frontend-design/components/profile/UserListItem.tsx` + `.../explore/SearchBar.tsx` | partial |
| `apps/web/messages/pt-BR/{media,profile,members}.json` | config | — | `apps/web/messages/pt-BR/app.json` | **exact** |

## Pattern Assignments

### `packages/core/server/media/keys.ts` (pure utility, transform)

**Analog:** `packages/core/server/branding/upload.ts` — *the single most important analog in this phase.*

**Pure-module docblock + bucket constants** (lines 8-19) — copy the "no database, no env, no Storage client" declaration verbatim in spirit; it is what Biome's kernel-lane rule and the test suite rely on:

```ts
/**
 * Object-key and upload-id helpers for the public `branding` bucket (D-27, CLAUDE.md §4). Pure: no
 * database, no env, no Storage client — `platform/branding.ts` is the only caller that talks to
 * Storage, and it runs `assertTenantKey` before EVERY call (T-02-83/T-02-84).
 */
export const BRANDING_BUCKET = 'branding';
const BRANDING_PREFIX = '/branding/';
```

**Key builder** (lines 59-62) — the media version is `<tenant_id>/media/<assetId>/original.<ext>` and `.../w<width>.webp`:

```ts
/** `<tenant_id>/branding/<uuid>.<ext>` */
export function brandingObjectKey(tenantId: string, uuid: string, ext: string): string {
  return `${tenantId}${BRANDING_PREFIX}${uuid}.${ext}`;
}
```

**`assertTenantKey` — copy the body exactly** (lines 78-95). RESEARCH §Don't Hand-Roll: *"it already refuses `..`, `//`, `\` and empty suffixes — three traversal classes a new implementation will forget."*

```ts
export function assertTenantKey(key: string, tenantId: string): void {
  const prefix = `${tenantId}${BRANDING_PREFIX}`;
  if (
    !tenantId ||
    !key.startsWith(prefix) ||
    key.length === prefix.length ||
    key.includes('..') ||
    key.includes('//') ||
    key.includes('\\')
  ) {
    throw new Error(`branding key outside the tenant prefix: ${key}`);
  }
}
```

**Do NOT copy:** `svgLooksUnsafe` (lines 138-146) — RESEARCH §Anti-Patterns forbids SVG as a member photo; member avatars are jpeg/png/webp only.

---

### `packages/core/server/media/inspect.ts` + `variants.ts` (pure, transform)

**Analog:** `packages/core/server/branding/icons.ts`

**Decompression-bomb guard + typed refusal error** (lines 11-33) — the media version's reasons become `not_an_image | format_mismatch | too_large | heic_unsupported`:

```ts
/**
 * Every `sharp()` here carries `limitInputPixels` (T-02-80): a decompression bomb dies at the
 * decoder, and `inspectBrandingImage` refuses any side above `MAX_INPUT_SIDE` from the header alone.
 */
export const MAX_INPUT_SIDE = 4096;
export const MAX_INPUT_PIXELS = MAX_INPUT_SIDE * MAX_INPUT_SIDE;

export type BrandingImageReason = 'not_an_image' | 'format_mismatch' | 'svg_unsafe' | 'too_large';

export class BrandingImageError extends Error {
  readonly reason: BrandingImageReason;
  constructor(reason: BrandingImageReason, message?: string) {
    super(message ?? `branding image rejected: ${reason}`);
    this.name = 'BrandingImageError';
    this.reason = reason;
  }
}
```

**Declared-mime → decoded-format map** (lines 37-42) — the media version drops `image/svg+xml` and **adds an explicit `heif` refusal** (RESEARCH Pitfall 2: sharp parses HEIC metadata successfully and then dies on the pixels, so a format-name check is the only defence):

```ts
const MIME_TO_FORMAT: Record<string, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/jpeg': 'jpeg',
};
```

**Header-only inspection contract** (lines 45-52):

```ts
/**
 * Header-only inspection: the format must match the declared mime, the dimensions must be sane and
 * an SVG must pass the textual safety scan. Throws `BrandingImageError` with the `details.upload`
 * reason the API answers (T-02-81, T-02-82).
 */
export async function inspectBrandingImage(buf: Buffer, declaredMime: string): Promise<BrandingImageInfo> {
```

---

### `packages/core/server/media/storage.ts` + `service.ts` (service, file-I/O + request-response)

**Analog:** `packages/core/server/platform/branding.ts` — the only Phase 2 file that talks to Storage.

**Invariant docblock** (lines 43-60) — reproduce this list adapted to the tenant lane; it is the contract the tests assert:

```ts
/**
 * Invariants (pinned by `platform-branding.test.ts`):
 *  - every object key is built server-side from the validated path tenant id and asserted with
 *    `assertTenantKey` before ANY Storage call (T-02-83/T-02-84) — the key, never the upload id's
 *    uuid alone, decides which prefix is touched;
 *  - the request path decodes the image HEADER only and enqueues; derivation (resize, composite,
 *    ICO, five uploads) runs in the worker (T-02-80, prohibition);
 *  - a file whose bytes are not an image of the declared format never becomes a logo: the object
 *    is removed and the request refused (T-02-81/T-02-82);
 */
```

**`start` — size gate → build key → assert → sign** (lines 150-197). The media version substitutes `ctx.tenantId` (membership of record) for the path tenant id, and branches to the Mux adapter when `kind === 'video'`:

```ts
  if (body.size > BRANDING_MAX_BYTES) {
    throw new ApiError(413, 'VALIDATION_FAILED', { size: 'too_large', maxBytes: BRANDING_MAX_BYTES });
  }
  const ext = mimeToExtension[body.mime];
  const uploadId = buildUploadId(body.kind, ext);
  const parsed = parseUploadId(uploadId);
  if (!parsed) throw new Error('buildUploadId produced an unparsable id');
  const key = brandingObjectKey(tenantId, parsed.uuid, ext);
  assertTenantKey(key, tenantId);

  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) { /* log … */ throw new ApiError(500, 'INTERNAL'); }
  return { uploadId, signedUrl: data.signedUrl, path: key, maxBytes: BRANDING_MAX_BYTES, expiresInSeconds: BRANDING_UPLOAD_TTL_S };
```

**`complete` — the exact validation ORDER to copy** (lines 209-247): `info()` → size → contentType → header decode → `reject()` removes the object → 400. RESEARCH §Anti-Patterns names this order explicitly as the template.

```ts
  const reject = async (reason: string): Promise<never> => {
    await removeQuietly(key, tenantId, actor, 'platform.branding.upload_remove_failed');
    log.warn({ event: 'platform.branding.upload_rejected', userId: actor.userId, tenantId, key, reason }, 'branding upload rejected');
    throw new ApiError(400, 'VALIDATION_FAILED', { upload: reason });
  };

  const info = await bucket().info(key);
  if (info.error || !info.data) throw new ApiError(404, 'NOT_FOUND', { upload: 'object_missing' });
  if (typeof info.data.size === 'number' && info.data.size > BRANDING_MAX_BYTES) await reject('too_large');
  if (info.data.contentType && info.data.contentType !== parsed.mime) await reject('format_mismatch');
  // … download, header decode, reject on BrandingImageError …
```

**The cross-tenant 404 trick this phase generalises** (docblock at lines 200-206) — *"tenant B completing A's id looks under B's prefix and finds nothing"*. RESEARCH Pattern 1 turns exactly this into the serving endpoint's zero-DB-read isolation proof.

**One transaction: write + `enqueueInTx`** (lines ~250-266) — the media `complete` does the same with `kernel.media-derive-variants`:

```ts
  const iconVersion = await withAdminTx(async (tx) => {
    const row = await loadTenant(tx, tenantId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    // … update …
    await enqueueDerivation(tx, tenantId, { iconVersion: next.iconVersion, attempt: 0 });
    return next.iconVersion;
  });
```

> **Lane difference — the one genuinely new part.** `platform/branding.ts` uses `withAdminTx` + `PlatformActor`. The media service is **tenant lane**: `withTenantTx(ctx, …)` + `membershipOfRecord(ctx)` (see `apps/api/src/routes/me.ts:92-99`). It still imports `supabaseAdmin` for Storage, which is why R-14 fixes it in `packages/core/server/media/*` — Biome (`biome.json:50-56`) confines `@rede-social/core/server/supabase-admin` to the kernel.

---

### `packages/core/server/media/derive-job.ts` (job handler, event-driven)

**Analog:** `packages/core/server/branding/derive-icons-job.ts` — copy the whole file's shape.

**Job docblock — the import-direction rule matters** (lines 11-23):

```ts
/**
 * `kernel.branding-derive-icons` (D-28) — icon derivation is CPU work … and runs in the api image
 * under `ROLE=worker` only; `apps/api/src/worker.ts` lists it next to `domainVerifyJob`, and the
 * queue registers itself in `branding/index.ts`. …
 * Never throws: a malformed payload is logged and dropped; an unexpected error is logged and, while
 * `attempt < BRANDING_DERIVE_MAX_ATTEMPTS`, one deferred job is re-armed through the platform lane.
 * Import direction is service -> job only: `platform/branding.ts` takes the queue name from
 * `./index`, never from this file, so there is no cycle.
 */
```

**Handler skeleton — safeParse-or-drop, timed, re-arm with attempt counter** (lines 29-90):

```ts
export const deriveIconsJob: JobDefinition<DeriveIconsPayload> = {
  name: BRANDING_DERIVE_ICONS_QUEUE,
  handler: async (payload) => {
    const parsed = deriveIconsPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error({ event: '…bad_payload', issues: parsed.error.issues.length }, '… malformed payload; dropped');
      return;
    }
    const { tenantId, attempt } = parsed.data;
    const t0 = Date.now();
    try {
      const result = await deriveTenantIcons(tenantId, { actor: { userId: SYSTEM_ACTOR } });
      log.info({ event: '…done', tenantId, outcome: result.outcome, ms: Date.now() - t0 }, '… ran');
    } catch (error) {
      log.error({ event: '…failed', tenantId, attempt, err: … }, '… failed unexpectedly');
      if (attempt >= BRANDING_DERIVE_MAX_ATTEMPTS) { /* give up, log */ return; }
      try { await requeueIconDerivation(tenantId, attempt + 1); } catch { /* log rearm_failed */ }
    }
  },
};
```

**Log-only system actor** (lines 26-27) — the media jobs need the same:

```ts
/** Log-only actor id — nothing writes it to a `created_by` column. */
export const SYSTEM_ACTOR = 'system:branding-derive-icons';
```

---

### `packages/core/server/media/sweep-job.ts` (job handler, batch)

**Analog:** `packages/core/server/domains/verify-job.ts` + `packages/core/server/jobs/boss.ts:148-151`

R-07 requires a **self-re-arming deferred job**, not `boss.schedule()`. The mechanism is documented in `boss.ts` (`enqueueInTx` docblock, final paragraph):

```ts
/**
 * `startAfter` (seconds, an ISO string or a Date — pg-boss 12 accepts all three) defers the job:
 * deferred jobs are how the kernel's domain poller (`kernel.domain-verify`, 02-09) paces itself at
 * its ~10-minute cadence without a scheduler, re-arming one deferred job per host under `short`.
 */
export async function enqueueInTx(
  tx: Tx, name: string, payload: object,
  opts: { singletonKey?: string; startAfter?: number | string | Date } = {},
): Promise<string | null>
```

Also copy from `domains/types.ts:86-96` the "cadence + deadline as named constants" pattern:

```ts
/** Poll cadence while a host is pending (seconds) — far below any provider rate limit. */
export const DOMAIN_VERIFY_INTERVAL_S = 600;
/** How long a host may stay pending before the poller marks it `expired` (7 days). */
export const DOMAIN_VERIFY_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;
```

---

### `packages/core/server/media/video/{types,mux,fake,index}.ts` (provider adapter)

**Analog:** `packages/core/server/domains/types.ts` + `domains/index.ts` + `domains/fake.ts` — the repo's provider-adapter precedent, cited by CONTEXT §Reusable Assets and R-14.

**Interface + seam docblock** (`types.ts:3-9, 33-41`):

```ts
/**
 * Custom-domain adapter contracts (TENANT-07, D-34/D-36). This file knows no database and no env:
 * it is the seam between the platform lane …, the kernel poller … and the two implementations of
 * each contract — `fake` / `local` for every non-production environment and `vercel` / `supabase`
 * for the hosted ones (`domains/index.ts` selects by the kernel env).
 */
export interface DomainProvider {
  readonly name: 'fake' | 'vercel';
  addDomain(host: string): Promise<DomainCheck>;
  …
}
```
→ `VideoProvider { readonly name: 'fake' | 'mux'; createDirectUpload(...); getAsset(...); deleteAsset(...); signPlayback(...) }`

**The error-shape rule — copy the reasoning, it is a security rule** (`types.ts:44-66`):

```ts
/**
 * The ONLY error shape an adapter raises. The message carries the kind and the HTTP status and
 * nothing else — never a response body, a header or the host (T-02-51: a provider answer may echo
 * the bearer token or another customer's data, and this message ends up in logs and `last_error`).
 */
export class DomainProviderError extends Error {
  readonly kind: DomainProviderErrorKind;
  readonly status: number | undefined;
  constructor(kind: DomainProviderErrorKind, status?: number) { … }
}
```

**Env-selected singleton + fail-safe default + queue registration** (`index.ts:12-58`) — the media video barrel is a near-line-for-line copy:

```ts
/**
 * Env-selected singletons (T-02-59: the fail-safe defaults are the local implementations; a real
 * selection without its credentials already failed at import in `env.ts` — `assertProductionEnv`).
 * Configuration is read ONLY through the kernel `env` module, never through the raw Node environment …
 */
function requireEnv(name: 'VERCEL_TOKEN' | …): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required by the selected adapter (see assertProductionEnv)`);
  return value;
}

export const domainProvider: DomainProvider =
  env.DOMAIN_PROVIDER === 'vercel'
    ? createVercelDomainProvider({ token: requireEnv('VERCEL_TOKEN'), … })
    : createFakeDomainProvider();

// `kernel.domain-verify` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). …
registerJobQueues([DOMAIN_VERIFY_QUEUE]);
```

→ `env.VIDEO_PROVIDER === 'mux' ? createMuxVideoProvider({ tokenId: requireEnv('MUX_TOKEN_ID'), … }) : createFakeVideoProvider()` and `registerJobQueues([MEDIA_DERIVE_QUEUE, MEDIA_SWEEP_QUEUE, MEDIA_MUX_EVENT_QUEUE])`.

---

### `apps/api/src/routes/webhooks/mux.ts` (route, event-driven, UNAUTHENTICATED)

**Analog:** `apps/api/src/routes/hooks.ts` — the repo's signed-inbound-webhook precedent (CONTEXT §Integration Points names it).

**Plain `.post`, not an OpenAPI route; raw body before any parsing** (lines 12-34):

```ts
/**
 * The Standard Webhooks signature IS this route's authentication: no bearer, no membership, no host
 * rule. It is a plain `.post`, deliberately NOT an OpenAPI route definition — the endpoint is
 * GoTrue's contract, must stay out of `openapi.json`, and no zod-openapi body parsing may run before
 * the signature was verified over the RAW body (RESEARCH Pitfall 7).
 * … Logs carry `webhookId`, `actionType`, `requestId` and a masked recipient; never the token …
 */
export const hookRoutes = createOpenApiApp().post('/auth/send-email', async (c) => {
  const log = c.get('logger');
  const requestId = c.get('requestId');
  const raw = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  for (const name of HOOK_HEADER_NAMES) headers[name] = c.req.header(name);
  const webhookId = headers['webhook-id'] ?? 'missing';
  c.header('Cache-Control', 'no-store');
```

**Typed error branches → status, never through `app.onError`** (lines 36-68):

```ts
  } catch (err) {
    if (err instanceof HookSignatureError) {
      log.warn({ event: 'mail.signature_rejected', webhookId, requestId }, err.message);
      return c.json({ error: { http_code: 401, message: 'invalid signature' } }, 401);
    }
    …
  }
```

**Media-specific deltas (R-03):** `await mux.webhooks.unwrap(raw, headers, MUX_WEBHOOK_SECRET)` replaces `verifyHookRequest`; idempotency is `insert into media_provider_events (id)` where a `23505` ⇒ 200-and-stop; then `enqueueInTx(tx, MEDIA_MUX_EVENT_QUEUE, …, { singletonKey: event.id })` and a fast 2xx. Response shape is Mux's (plain 2xx), not GoTrue's error object.

---

### `apps/api/src/routes/{media,members}.ts` (route, tenant lane)

**Analog:** `apps/api/src/routes/me.ts` for the lane; `apps/api/src/routes/platform/branding.ts` for OpenAPI route/envelope ergonomics.

**Tenant-lane app + `requireAuth` + envelope helper** (`me.ts:23-37`):

```ts
const me = createOpenApiApp();
me.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
```

**The three-layer read — copy the comment, it is the convention marker** (`me.ts:79-99`):

```ts
      const ctx = c.get('ctx');
      const data = await withTenantTx(ctx, async (tx) => {
        …
        // layer 2 of the tenant scoping (CLAUDE.md): tenant_id + user_id + deleted_at is null — never user_id alone (WR-05)
        const [membership] = await tx
          .select({ role: memberships.role, status: memberships.status })
          .from(memberships)
          .where(membershipOfRecord(ctx))
          .limit(1);
        return { tenant, user, membership };
      });
```

`membershipOfRecord` (`packages/core/server/tenancy/membership-scope.ts:1-30`) explicitly instructs reuse: *"Reuse it in every tenant-lane read of `memberships` (profile, members directory, …) — never scope by `user_id` alone."*

**Per-response documented refusal codes** (`platform/branding.ts:51-90`) — the media routes need the same density, since D-09 makes every refusal a stable machine code:

```ts
  responses: {
    201: { description: 'A signed Storage URL (valid 2 h) for `<tenant_id>/branding/<uuid>.<ext>` …', content: { 'application/json': { schema: brandingUploadSchema } } },
    400: envelope('VALIDATION_FAILED — kind not logo/icon, mime outside png/svg+xml/webp/jpeg, size not a positive integer'),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    413: envelope('VALIDATION_FAILED { size: "too_large", maxBytes } — above 2 MiB'),
  },
```

---

### `apps/api/src/routes/me.ts` — modification at line 118

Replace the hardcoded profile with a join on `member_profiles` (R-08). **The contract shape must not change** (RESEARCH Pitfall 9). Current code:

```ts
        membership: {
          tenantId: tenant.id,
          role: membership.role,
          status: membership.status,
          profile: { displayName: user.name, avatarUrl: null, bio: null },
        },
```

`avatarUrl` becomes the stable serving URL `/v1/media/{assetId}/w128` (R-05/R-06), not a signed URL.

---

### `packages/core/db/schema/{media-assets,member-profiles}.ts` (model, CRUD)

**Analog:** `packages/core/db/schema/consent-records.ts` — a tenant table with exactly one scoped `select` policy.

**Policy + index conventions to copy verbatim** (lines 47-62):

```ts
  (t) => [
    uniqueIndex('consent_records_tenant_user_kind_version_uq').on(t.tenantId, t.userId, t.kind, t.textVersion),
    index('consent_records_tenant_user_idx').on(t.tenantId, t.userId),
    check('consent_records_kind_chk', sql`${t.kind} in ('tenant_rules','platform_terms')`),
    pgPolicy('consent_records_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();
```

**Policy-intent docblock** (lines 19-27) — every new table needs its own version of this paragraph; SCHEMA-CONVENTIONS and `supabase/tests/010` both depend on the intent being stated:

```ts
/**
 * APPEND-ONLY BY CONSTRUCTION (threat T-04-02): exactly ONE policy, for `select`, and only for the
 * owner inside their own tenant. There is deliberately no insert/update/delete policy — writes happen
 * in the admin lane at sign-up, so no tenant session can forge, edit or erase a recorded consent.
 */
```

**Media-specific deltas:** `member_profiles` needs a **tenant-wide** select policy (`tenant_id = app.tenant_id()`, not `and user_id = app.user_id()`) because PROF-02/PROF-03 read other members; writes stay admin-lane. Index ordering rule — `tenant_id` first — is stated in `tenant-invites.ts:48`: *"Convention (01-08): tenant_id is the first column of every index on a tenant table."*

---

### `packages/core/db/schema/media-provider-events.ts` (model, event-driven)

**Analog:** `packages/core/db/schema/tenant-invites.ts` — the **RLS-enabled, zero-policy** precedent that R-15 tells the planner to mirror.

```ts
/**
 * RLS is enabled with **no policy at all**, deliberately — the same shape as `platform_admins`
 * (01-03). … a tenant lane (`authenticated`) has no business seeing [this], and with the
 * schema-wide SELECT grant from 20260912031029 a policy is the only thing that could expose the
 * table (T-02-08). Adding a policy for `authenticated` here … is always a bug (SCHEMA-CONVENTIONS (i));
 * `supabase/tests/010` and `040` pin the zero-policy count and `020` proves a lane reads nothing.
 */
```

**Planner action:** the new table (and the `media` bucket's `storage.objects`, R-15) must be added by name to `supabase/tests/010-rls-coverage.sql`'s exemption list, exactly as `tenant_invites` was.

---

### `supabase/config.toml` + `supabase/migrations/*_media_bucket.sql` + `supabase/tests/070-media-bucket.sql`

**Analog:** `supabase/config.toml:126-135`, `supabase/migrations/20260917021738_branding_bucket.sql`, `supabase/tests/060-branding-bucket.sql`.

**Config block + the "two files must agree" comment** (`config.toml:126-135`):

```toml
# Tenant brand assets (02-13, D-27/D-28): the browser PUTs a logo/icon straight to an API-minted signed
# URL at `<tenant_id>/branding/<uuid>.<ext>`; … This block seeds LOCAL stacks
# only — hosted projects get the same row from supabase/migrations/*_branding_bucket.sql.
[storage.buckets.branding]
public = true
file_size_limit = "2MiB"
allowed_mime_types = ["image/png", "image/svg+xml", "image/webp", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon"]
```
→ `[storage.buckets.media]` with `public = false`, `file_size_limit = "50MiB"`, and a jpeg/png/webp (+video passthrough if any) allow-list — **no `image/svg+xml`** (RESEARCH §Anti-Patterns).

**pgTAP bucket test** (`060-branding-bucket.sql:1-40`) — copy structure, invert the `public` assertion, and add R-15's zero-policy count:

```sql
begin;
-- 060-branding-bucket.sql — … Locally the row comes from `[storage.buckets.branding]` in
-- supabase/config.toml …; everywhere else from `*_branding_bucket.sql`, an idempotent upsert
-- applied by `supabase db push`. Both must agree on every value below, because the API's 413
-- threshold (`BRANDING_MAX_BYTES`) and the accepted upload mimes are pinned to them.
select plan(5);

select is((select count(*)::int from storage.buckets where id = 'branding'), 1, 'D-27: the branding bucket exists …');
select is((select public from storage.buckets where id = 'branding'), true, 'D-27: the branding bucket is public …');
select is((select file_size_limit from storage.buckets where id = 'branding'), 2097152::bigint, 'D-27: the bucket caps files at 2 MiB …');
```

---

### `apps/web/components/media/UploadField.tsx` + `apps/web/lib/upload.ts`

**Analog:** `apps/web/components/platform/LogoUpload.tsx` (the `useSignedUpload` hook, lines 25-128) and `apps/web/lib/upload.ts`.

**`apps/web/lib/upload.ts` explicitly reserves this phase's extension** (lines 7-16) — the planner should extend the file rather than create a parallel one:

```ts
/**
 * Client-safe signed-upload helper (02-14, D-27, CLAUDE.md §4): the browser PUTs the bytes straight
 * to the API-minted signed Storage URL — never through the API or the Next server. The 2 MiB
 * branding cap keeps every upload under the 6 MB plain-PUT threshold, so there is no TUS here;
 * Phase 3 adds the resumable TUS branch (6 MB chunks, `x-signature`) behind the same
 * `uploadToSignedUrl` signature for the private media bucket.
 *
 * `classifyFile` is UX only (T-02-111): Storage enforces size/mime at PUT time and the API's
 * `complete` re-validates the object; the panel never treats a client check as proof.
 */
```

**XHR-for-progress + no auth header** (lines 56-64) — the TUS branch sits beside this, same return type:

```ts
/**
 * PUTs `file` to `signedUrl` with `XMLHttpRequest` (fetch has no upload progress): `content-type`
 * + `x-upsert: false`, no auth header of any kind — the signed token travels inside the URL
 * (RESEARCH A10). 2xx → ok; 413 → `too_large`; any other status, network error or timeout →
 * `transfer`; `signal` aborts the request → `aborted`.
 */
export type UploadOutcome = { ok: true } | { ok: false; reason: 'transfer' | 'too_large' | 'aborted' };
```

**The hook's state machine, one-in-flight guard and WR-07 catch** (`LogoUpload.tsx:25-128`):

```ts
/**
 * The signed-upload flow shared by the logo and the square-icon zones (02-14, D-27, CLAUDE.md §4):
 * `classifyFile` (UX gate — no request on a wrong type/size) → `start` → browser PUT straight to
 * Storage with progress → `complete` → `onCompleted(view)` + toast. One in-flight upload per zone;
 * every failure path — including a REJECTED server action or a thrown transfer — returns the zone to
 * idle with the pt-BR generic message (UI-SPEC "Error state — upload", WR-07); the raw error goes to
 * the console only, never to the user (T-02-147).
 */
  const busy = useRef(false);
  const fail = (message: string) => { setError(message); setState('idle'); setProgress(0); busy.current = false; };
  …
      setState('processing');
      const completed = await actions.complete(tenantId, started.upload.uploadId);
      if (!completed.ok) {
        const message = { not_an_image: t('errors.notAnImage'), format_mismatch: t('errors.formatMismatch'),
          svg_unsafe: t('errors.svgUnsafe'), too_large: t('errors.size'),
          object_missing: t('errors.objectMissing'), generic: t('errors.generic') }[completed.code];
        return fail(message);
      }
    } catch (error) {
      // A rejected action / thrown transfer (WR-07): `fail` resets busy, state and progress. …
      console.error('platform.branding.upload_failed', { kind, error: String(error) });
      fail(t('errors.generic'));
    }
```

**Media deltas:** the code→message map gains `heic_unsupported`, `quota`, `duration`; the generalised hook is parameterised by `{ kind, purpose }` instead of `'logo' | 'icon'`; R-12's browser HEIC re-encode runs **before** `classifyFile`.

---

### `apps/web/app/(app)/perfil/page.tsx` (page, RSC) — replace

**Analog:** itself (the stub already carries the right imports and layout) + `reference/frontend-design/components/profile/ProfileHeader.tsx` for the visual layout (D-45: strip follow/message/handle/website/stats).

**Keep from the stub:** the platform-host redirect, the parallel bootstrap fetch, the `Avatar`/`PageHeader` usage and the settings row markup:

```tsx
export default async function ProfilePage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [t, { user, membership }] = await Promise.all([getTranslations('app'), requireBootstrap()]);
  …
        <Avatar size="xl" src={membership.profile.avatarUrl} alt={membership.profile.displayName} />
```

R-09 confirms the avatar fallback is free: `packages/ui/src/primitives/Avatar.tsx:38-42` already renders a neutral `User` icon when `src` is falsy.

**Row markup to reuse for the new "Editar perfil" and "Membros" rows** (lines 41-48):

```tsx
      <Link href="/configuracoes" className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-text transition-colors hover:bg-bg-hover md:rounded-xl md:border md:bg-card">
        <SettingsIcon aria-hidden size={20} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm">{t('profile.settings')}</span>
        <ChevronIcon aria-hidden size={18} className="shrink-0 text-text-tertiary" />
      </Link>
```

---

### `apps/api/src/worker.ts` — modification

**Analog:** itself. Add the three media jobs to the explicit kernel list (lines 32-36):

```ts
  const jobs: AnyJobDefinition[] = [
    domainVerifyJob,
    deriveIconsJob,
    ...Object.values(MODULE_REGISTRY).flatMap((manifest) => manifest?.jobs ?? []),
  ];
```

The docblock (lines 17-20) states the rule the planner must honour: *"Kernel jobs are listed here explicitly and register their queue names inside the kernel (`packages/core/server/domains/index.ts`, `…/branding/index.ts`); module jobs come from the registry."*

---

### `apps/api/src/app.ts` — modification

Mount the two new tenant-lane routers and the webhook alongside the existing five (lines 45-52):

```ts
  .route('/v1/health', healthRoutes)
  .route('/v1/public', publicRoutes)
  .route('/v1/hooks', hookRoutes)
  .route('/v1/me', meRoutes)
  .route('/v1/platform', platformRoutes)
```

---

### `packages/contracts/src/{media,profiles}.ts` (contract, Zod)

**Analog:** `packages/contracts/src/branding.ts`

**The bundle-purity docblock is load-bearing** (lines 3-13) — client components import contracts directly, so these modules must stay free of node imports:

```ts
/**
 * Tenant brand contract (TENANT-02, D-25/D-26/D-28/D-41).
 *
 * Pure module — no node imports — so client components may import it through
 * `@rede-social/contracts/branding` without pulling `legal.ts` (`node:fs`) into the bundle.
 */
```

**Fixed-key object over array, with the reason stated** (lines 33-42) — R-06's `variants` payload is the reverse case (an array **is** wanted, for `srcset`), so the planner should state that inversion explicitly:

```ts
/**
 * The derived icon set (D-28). A fixed-key object, never an array: consumers must not depend on
 * ordering (edge TENANT-02/ordering).
 */
export const brandIconUrlsSchema = z.object({ i192: z.string(), … });
```

**`.strict()` on anything crossing a trust boundary** (lines 45-56):

```ts
/**
 * The public brand facts carried by `GET /v1/public/tenants/by-host` (T-02-04) … Strict — nothing
 * beyond brand facts may leak into the public answer.
 */
export const hostBrandingSchema = z.object({ … }).strict();
```
→ PROF-02's other-member payload is the direct parallel: photo, displayName, bio and **nothing else** (D-45), `.strict()`.

---

## Shared Patterns

### Tenant scoping (three layers)
**Source:** `packages/core/server/tenancy/membership-scope.ts:1-30`
**Apply to:** every tenant-lane service and route in this phase — `media/service.ts`, `profiles/service.ts`, `routes/media.ts`, `routes/members.ts`.

```ts
/**
 * The ONE where-clause for "the caller's membership in the tenant of record" (WR-05).
 * Layer 2 of CLAUDE.md's three-layer tenant scoping: layer 1 is `app.membership_for_user()` in
 * `requireAuth` (it picked `ctx.tenantId`), layer 3 is RLS (`tenant_id = app.tenant_id()`).
 * Reuse it in every tenant-lane read of `memberships` (profile, members directory, …) — never scope
 * by `user_id` alone ("one missing `where` leaks tenants").
 */
export function membershipOfRecord(ctx: { tenantId: string; userId: string }): SQL {
  const clause = and(
    eq(memberships.tenantId, ctx.tenantId),
    eq(memberships.userId, ctx.userId),
    isNull(memberships.deletedAt),
  );
  if (!clause) throw new Error('membershipOfRecord: empty clause');
  return clause;
}
```

### Storage key assertion
**Source:** `packages/core/server/branding/upload.ts:78-95` (full body quoted above)
**Apply to:** every function in `media/storage.ts`, without exception. Rule from `platform/branding.ts:50-52`: *"every object key is built server-side from the validated … tenant id and asserted with `assertTenantKey` before ANY Storage call (T-02-83/T-02-84) — the key, never the upload id's uuid alone, decides which prefix is touched."*

### Enqueue inside the caller's transaction
**Source:** `packages/core/server/jobs/boss.ts:130-170`
**Apply to:** `media/service.ts` (`complete` → derive), `webhooks/mux.ts` (event row + job), `sweep-job.ts` (re-arm).

```ts
export async function enqueueInTx(
  tx: Tx, name: string, payload: object,
  opts: { singletonKey?: string; startAfter?: number | string | Date } = {},
): Promise<string | null> {
  const boss = await startedBoss();
  const rows = (await tx.execute(sql`select current_role as role`)) as unknown as { role: string }[];
  const callerRole = rows[0]?.role;
  await tx.execute(sql`set local role api_user`);
  const id = await boss.send(name, payload, { db: fromDrizzle(tx, sql), ...opts });
  if (callerRole && callerRole !== 'api_user') await tx.execute(sql`set local role ${sql.identifier(callerRole)}`);
  return id;
}
```

Two behaviours the planner must not re-derive: `singletonKey` idempotency works **only** because every queue is created with `QUEUE_POLICY = 'short'`; and there is deliberately **no try/finally** around the role restore.

### Error envelope + stable refusal codes (D-09)
**Source:** `packages/core/server/http/api-error.ts` via `packages/core/server/platform/branding.ts:150-154, 220-224`
**Apply to:** every media and profile refusal.

```ts
throw new ApiError(413, 'VALIDATION_FAILED', { size: 'too_large', maxBytes: BRANDING_MAX_BYTES });
throw new ApiError(404, 'NOT_FOUND', { upload: 'object_missing' });
throw new ApiError(400, 'VALIDATION_FAILED', { upload: reason });
```

New Phase 3 codes (from RESEARCH): `{ media: 'heic_unsupported' }`, `{ quota: 'exceeded' }`, `{ bio: 'too_long' }`, `{ duration: 'too_long' }`. Cross-tenant is always `404 NOT_FOUND`, never `403` (SCHEMA-CONVENTIONS §(j)).

### Structured logging
**Source:** `packages/core/server/platform/branding.ts:163-196` and `branding/derive-icons-job.ts:33-87`
**Apply to:** every service and job.

```ts
log.info({ event: 'platform.branding.upload_start', userId: actor.userId, tenantId, kind, mime, size, key }, 'branding upload started');
log.error({ event: 'branding.derive_icons_job.failed', tenantId, attempt, err: error instanceof Error ? error.message : String(error) }, '… failed unexpectedly');
```

Namespaced `event` string, `{ tenantId, userId, requestId }`, `ms: Date.now() - t0` on jobs, and **never** a provider response body in the message (`domains/types.ts:44-49`).

### pt-BR strings only
**Source:** `apps/web/messages/pt-BR/app.json` + `scripts/check-ui-literals.sh`
**Apply to:** every new web file. `useTranslations('platformBranding')` / `getTranslations('app')` is the access pattern; a hard-coded pt-BR string fails the lint gate. New namespaces: `media`, `profile`, `members`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/web/components/media/VideoPlayer.tsx` | component | streaming | No video playback exists anywhere in the repo. Build from RESEARCH §Code Example 6 (`<MuxPlayer playbackId tokens={{ playback, thumbnail, storyboard }} />`) plus the "processando" placeholder; the closest local habit to borrow is the `LogoUpload` `biome-ignore lint/performance/noImgElement` posture for a non-`next/image` media element. |
| `apps/web/app/(app)/membros/page.tsx` | page (list + search) | CRUD | No paginated, searchable list screen exists in the tenant lane. The platform panel's `TenantTable.tsx` / `TenantToolbar.tsx` are the nearest *structural* cousins but they are desktop admin tables, not a mobile-first member list. Prototype-less ⇒ D-33 UI-SPEC + mockup review; port `reference/frontend-design/components/profile/UserListItem.tsx` (drop the follow button) and `.../explore/SearchBar.tsx`. |
| `packages/core/server/profiles/search.ts` | utility (pure) | transform | No keyset-cursor or accent-folding code exists yet. This phase **establishes** the convention Phase 4's feed inherits (R-11). Build from RESEARCH §Code Example 7 (the proven `app.imm_unaccent` + GIN-trigram SQL); only the pure-module posture comes from `branding/upload.ts`. |

## Metadata

**Analog search scope:** `packages/core/server/{branding,platform,domains,jobs,tenancy}`, `packages/core/db/schema`, `packages/contracts/src`, `apps/api/src/{routes,worker.ts,app.ts}`, `apps/web/{app/(app),components/platform,lib}`, `supabase/{config.toml,migrations,tests}`, `reference/frontend-design/components/{profile,explore}`
**Files scanned:** ~80 listed, 14 read in full or in targeted ranges
**Pattern extraction date:** 2026-09-21
