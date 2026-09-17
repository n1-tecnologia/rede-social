---
phase: 02-tenant-shell-branding-platform-panel
reviewed: 2026-09-17T05:32:13Z
depth: standard
files_reviewed: 62
files_reviewed_list:
  - apps/api/src/app.ts
  - apps/api/src/http/openapi.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/hooks.ts
  - apps/api/src/routes/me.ts
  - apps/api/src/routes/platform/branding.ts
  - apps/api/src/routes/platform/domains.ts
  - apps/api/src/routes/platform/index.ts
  - apps/api/src/routes/platform/tenants.ts
  - apps/api/src/routes/public.ts
  - apps/api/src/worker.ts
  - apps/web/app/(app)/actions.ts
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/(auth)/aceitar-convite/actions.ts
  - apps/web/app/(auth)/aceitar-convite/page.tsx
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/(auth)/layout.tsx
  - apps/web/app/(platform)/plataforma/actions.ts
  - apps/web/app/(platform)/plataforma/layout.tsx
  - apps/web/app/(platform)/plataforma/page.tsx
  - apps/web/app/(platform)/plataforma/tenants/[id]/admins/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/page.tsx
  - apps/web/app/(platform)/plataforma/tenants/[id]/layout.tsx
  - apps/web/app/(platform)/plataforma/tenants/[id]/marca/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/suspended/route.ts
  - apps/web/app/layout.tsx
  - apps/web/app/m/[slug]/manifest.webmanifest/route.ts
  - apps/web/app/serwist/[path]/route.ts
  - apps/web/app/sw.ts
  - apps/web/components/platform/AttachDomainForm.tsx
  - apps/web/components/platform/BrandingForm.tsx
  - apps/web/components/platform/DomainCard.tsx
  - apps/web/components/platform/FlashToast.tsx
  - apps/web/components/platform/LogoUpload.tsx
  - apps/web/components/platform/ModuleToggles.tsx
  - apps/web/components/platform/ResendInviteButton.tsx
  - apps/web/components/platform/StatusCard.tsx
  - apps/web/components/pwa/ServiceWorkerRegister.tsx
  - apps/web/i18n/messages.ts
  - apps/web/i18n/request.ts
  - apps/web/lib/api.ts
  - apps/web/lib/bootstrap.ts
  - apps/web/lib/branding-view.ts
  - apps/web/lib/host-brand.ts
  - apps/web/lib/manifest.ts
  - apps/web/lib/platform-domains.ts
  - apps/web/lib/platform.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/tenant-host.ts
  - apps/web/lib/upload.ts
  - apps/web/next.config.ts
  - apps/web/proxy.ts
  - packages/contracts/src/branding.ts
  - packages/contracts/src/domains.ts
  - packages/contracts/src/hosts.ts
  - packages/contracts/src/invites.ts
  - packages/contracts/src/platform.ts
  - packages/core/db/schema/tenant-domains.ts
  - packages/core/db/schema/tenant-invites.ts
  - packages/core/server/auth/require-auth.ts
  - packages/core/server/branding/derive-icons-job.ts
  - packages/core/server/branding/icons.ts
  - packages/core/server/branding/index.ts
  - packages/core/server/branding/upload.ts
  - packages/core/server/domains/auth-allow-list.ts
  - packages/core/server/domains/index.ts
  - packages/core/server/domains/types.ts
  - packages/core/server/domains/vercel.ts
  - packages/core/server/domains/verify-job.ts
  - packages/core/server/env.ts
  - packages/core/server/http/api-error.ts
  - packages/core/server/jobs/boss.ts
  - packages/core/server/mail/hook-schema.ts
  - packages/core/server/mail/index.ts
  - packages/core/server/mail/local.ts
  - packages/core/server/mail/resend.ts
  - packages/core/server/mail/templates/layout.ts
  - packages/core/server/mail/transport.ts
  - packages/core/server/modules/manifest.ts
  - packages/core/server/platform/branding.ts
  - packages/core/server/platform/domains.ts
  - packages/core/server/platform/invites.ts
  - packages/core/server/platform/modules.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/tenancy/accept-invite.ts
  - packages/core/server/tenancy/mail-tenant.ts
  - packages/core/server/tenancy/tenant-host.ts
  - packages/core/ui/ThemeToggle.tsx
  - packages/ui/src/overlays/Toast.tsx
  - scripts/check-static-routes.sh
  - scripts/check-ui-literals.sh
  - scripts/local-env.sh
  - scripts/supabase.sh
  - supabase/config.toml
  - supabase/migrations/20260916183650_tenant_invites_and_domain_verification.sql
  - supabase/migrations/20260917021738_branding_bucket.sql
findings:
  critical: 1
  warning: 7
  info: 7
  total: 15
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-17T05:32:13Z
**Depth:** standard
**Files Reviewed:** 62 source files (tests, e2e specs, JSON catalogs, assets and docs were skimmed for intent only)
**Status:** issues_found

## Summary

Reviewed the Phase 2 surface: the platform lane (`/v1/platform/*` routes and the kernel services behind them), the custom-domain lifecycle (attach / poll / verify / primary / remove, Vercel and fake adapters, Supabase allow-list writer), the first-admin invite flow (create → send → resend → accept), branding uploads and the icon-derivation worker job, the Send Email Hook pipeline, the web BFF (`proxy.ts`, host resolution, server actions, manifest route, service worker) and the two migrations.

The tenant-isolation properties the phase exists for hold up under adversarial reading: every `tenant_domains` / `tenant_invites` read a route asks for is scoped by `tenant_id AND id`, every Storage key is built server-side from the path tenant id and asserted with `assertTenantKey` before any call, the host header can only DENY a session, the manifest is host-authoritative, the platform lane is confined to `withAdminTx` behind `requireSuperAdmin()`, and `resolveMailTenant` refuses a brand when membership and `redirect_to` disagree. No cross-tenant leak, injection, open redirect, or secret exposure was found.

The defects are in lifecycle robustness. The most serious is in `checkDomain`: a transient provider failure (Vercel 429/5xx/timeout) silently kills the poller for that host forever — neither the 10-minute re-check nor the 7-day expiry ever fires again (CR-01). Around the invite flow, `onConflictDoNothing` on the membership insert hides the V1 one-tenant-per-user constraint so an invite can be marked `sent` with no membership behind it (WR-02), and GoTrue's "email already exists" answer becomes an opaque 500 / permanent `last_error` on the domain (WR-03) or a false "already accepted" (WR-04). A verified host that once failed its side effects keeps `last_error` forever because the re-run path never clears it (WR-01). The rest are defence-in-depth and hardening items.

## Critical Issues

### CR-01: Domain poller dies permanently after any provider error (transient failures included)

**File:** `packages/core/server/platform/domains.ts:428-455`
**Severity:** BLOCKER
**Issue:** `checkDomain` catches every `domainProvider.verify` failure, records `lastCheckedAt`/`lastError` and returns `{ outcome: 'pending' }` — but this branch never calls `enqueueVerify`, and it also never evaluates `verifyDeadlineAt`. The only other re-arm path is `rearmDomainVerification` in `domains/verify-job.ts:57`, which runs only when `checkDomain` *throws* — and `checkDomain` deliberately swallows provider errors. So one Vercel 429, one 5xx, one 10 s timeout, or one Zod mismatch on the provider answer (`parse` throws `DomainProviderError('unavailable')`) leaves the host `pending` with no job in the queue: it is never re-checked, never verified automatically and never expires. D-34 ("re-checks every ~10 minutes", "marks expired after 7 days") is silently broken for that host until a super_admin happens to press "Verificar agora". The docblock (line 411) claims "`pending`: records/last_checked_at refreshed and the poller re-armed" — the error path does not honour that. Rate limiting is the *expected* failure mode of a poller against a third-party API, so this will happen in production.
**Fix:**
```ts
} catch (error) {
  const kind = error instanceof DomainProviderError ? error.kind : 'unavailable';
  const status = error instanceof DomainProviderError ? error.status : undefined;
  const now = new Date();
  const expired = row.verifyDeadlineAt !== null && row.verifyDeadlineAt.getTime() < now.getTime();
  const [updated] = await withAdminTx(async (tx) => {
    const rows = await tx
      .update(tenantDomains)
      .set({
        lastCheckedAt: now,
        lastError: status ? `${kind}:${status}` : kind,
        ...(expired ? { verificationStatus: 'expired' as const } : {}),
      })
      .where(and(eq(tenantDomains.id, domainId), isNull(tenantDomains.verifiedAt)))
      .returning();
    // Re-arm in the SAME transaction unless the deadline passed (the `short` policy dedupes).
    if (rows[0] && !expired) await enqueueVerify(tx, domainId);
    return rows;
  });
  log.warn({ /* … */ }, expired ? 'provider check failed; deadline passed' : 'provider check failed; poller re-armed');
  return { outcome: expired ? 'expired' : 'pending', domain: toTenantDomain(updated ?? row) };
}
```
Add an integration case in `platform-domains.test.ts` that makes the fake provider throw once and asserts a `kernel.domain-verify` job exists for the domain afterwards.

## Warnings

### WR-01: `last_error` on a verified host is never cleared once the side effects succeed

**File:** `packages/core/server/platform/domains.ts:364-401, 425-429`
**Severity:** WARNING
**Issue:** `ensureVerifiedSideEffects` writes `last_error = 'allow_list' | 'invite'` on failure but nothing ever resets it: the `already_verified` branch of `checkDomain` (line 425) re-runs the side effects and answers the row unchanged, and `lastError: null` is only written in the `verified` (line 472) and `pending` (line 522) branches, which a verified row can never reach again. Consequence: after one transient allow-list or GoTrue failure the panel shows the error line and keeps offering "Verificar agora" forever (`toDomainCardView` sets `showVerify` from `verified && lastError !== null`), even though the retry succeeded. The docblock promises the panel that this is "recoverable" — it is not observably so.
**Fix:** Make `ensureVerifiedSideEffects` return whether both steps succeeded, and in the `already_verified` branch clear the column on success:
```ts
const ok = await ensureVerifiedSideEffects(row, actor); // returns boolean
if (ok && row.lastError !== null) {
  await withAdminTx((tx) =>
    tx.update(tenantDomains).set({ lastError: null }).where(eq(tenantDomains.id, domainId)),
  );
}
```
(Also do this at the end of the `verified` branch, since the `lastError: null` written at line 472 precedes the side effects and can be overwritten by `recordError` a moment later.)

### WR-02: Membership insert `onConflictDoNothing` hides the one-tenant-per-user conflict, producing a `sent` invite with no membership

**File:** `packages/core/server/platform/invites.ts:165-175, 423-435`
**Severity:** WARNING
**Issue:** `memberships` carries `memberships_one_tenant_per_user_v1` (unique on `user_id`, `packages/core/db/schema/memberships.ts:36`). Both send paths insert the `invited` membership with `.onConflictDoNothing()` — the comment says "a re-sent invite keeps its row", but the same clause also swallows the case where the invited identity already belongs to ANOTHER tenant (GoTrue `generateLink({type:'invite'})` happily re-invites an unconfirmed user regardless of our memberships). The invite row is then flipped to `sent`/`user_id` set, the branded mail goes out, and the admin who clicks it lands with a session whose `membership_for_user` resolves the *other* tenant: `requireAuth` answers `TENANT_HOST_MISMATCH`, `/aceitar-convite` can never succeed, and the panel shows "Convite enviado" indefinitely with no diagnostic.
**Fix:** Insert with `onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })` so only the intended (same tenant, same user) replay is tolerated, and treat any other unique violation as a refusal:
```ts
const inserted = await tx.insert(memberships)
  .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
  .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
  .returning({ id: memberships.id });
```
Wrap it so a `23505` on `memberships_one_tenant_per_user_v1` reverts the claim and surfaces `409 INVITE_STATE_INVALID { reason: 'user_in_other_tenant' }` (add the reason to `INVITE_STATE_REASONS`).

### WR-03: `sendPendingInvites` turns GoTrue's "email already registered" into an opaque 500 and a permanent `last_error = 'invite'`

**File:** `packages/core/server/platform/invites.ts:136-160` (and `platform/domains.ts:381-396`)
**Severity:** WARNING
**Issue:** `inviteUserByEmail` fails with `email_exists` whenever `adminEmail` already has an auth identity (a member of another tenant, a super_admin, a previously deleted-and-recreated user). `sendPendingInvites` treats every GoTrue error identically: revert the claim, log, throw `500 INTERNAL`. From the domain-verify job this becomes `last_error = 'invite'` on the host; from the panel's "Reenviar convite" (pending path, line 340) it is a generic toast. The super_admin has no way to learn that the address is the problem, and `createTenant` accepted the address without any check, so the tenant is provisioned with an invite that can never be delivered. `resendInvite` already has `isConfirmedEmail()` for exactly this shape (line 262) — the first-send path does not use it.
**Fix:** In the `invited.error` branch, before the generic 500:
```ts
if (invited.error && isConfirmedEmail(invited.error)) {
  await withAdminTx((tx) => tx.update(tenantInvites)
    .set({ status: 'expired', sentAt: null })   // or a new 'refused' status
    .where(eq(tenantInvites.id, invite.id)));
  throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'email_in_use' });
}
```
and let `ensureVerifiedSideEffects` record a distinguishable `last_error` (`invite:email_in_use`). Consider validating `adminEmail` against `auth.users` (via `supabaseAdmin.auth.admin`) at `createTenant` time so the refusal happens where it can be corrected.

### WR-04: `resendInvite` reports `already_accepted` for an admin who exchanged the link but never accepted

**File:** `packages/core/server/platform/invites.ts:351-355`
**Severity:** WARNING
**Issue:** `/auth/confirm` runs `verifyOtp({ type: 'invite' })` (`apps/web/app/auth/confirm/route.ts:60`), which *confirms* the GoTrue user before the password is set or the consents are recorded. If the admin abandons `/aceitar-convite` at that point, the invite row stays `sent` and the membership `invited`, but the identity is now confirmed. A later "Reenviar convite" calls `generateLink({ type: 'invite' })`, GoTrue answers `email_exists`, and `isConfirmedEmail` maps it to `409 { reason: 'already_accepted' }` — which is false: nothing was accepted, and the panel now tells the super_admin the onboarding is done. The only recovery is the admin guessing to use "Esqueci minha senha".
**Fix:** Decide from our own state, not GoTrue's: when `generateLink` answers `email_exists` and the invite row is still `sent`/`expired` with an `invited` membership, mint a `recovery` (or `magiclink`) link for the same `redirectTo` instead and send the invite template with it — `/auth/confirm` already accepts both types and `next=/aceitar-convite` still lands on the accept screen:
```ts
if (isConfirmedEmail(generated.error)) {
  const fallback = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery', email: invite.email, options: { redirectTo },
  });
  // use fallback.data.properties.hashed_token with actionType 'recovery'
}
```
Only answer `already_accepted` when `invite.status === 'accepted'` or the membership is `active`.

### WR-05: Bootstrap membership query is not scoped by tenant (defence-in-depth layer 2 missing)

**File:** `apps/api/src/routes/me.ts:96-100`
**Severity:** WARNING
**Issue:** Inside `withTenantTx` the membership row is selected with `where(eq(memberships.userId, ctx.userId))` only. Today the V1 unique index `memberships_one_tenant_per_user_v1` and RLS make this return the right row, but CLAUDE.md's tenant-scoping rule is three independent layers ("one missing `where` leaks tenants") and the schema is explicitly "born ready for V2 multi-tenant membership" — the first V2 migration that drops that index turns this into "whichever membership Postgres returns first", with RLS as the only remaining guard. The tenant id is already in `ctx`.
**Fix:**
```ts
.where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId), isNull(memberships.deletedAt)))
```

### WR-06: Host lookup in the request path has no timeout — an unresponsive API stalls every page on every host

**File:** `apps/web/lib/tenant-host.ts:85-88`
**Severity:** WARNING
**Issue:** `resolveHostTenant` runs in `proxy.ts` for every request and in every layout's `generateMetadata`. The `fetch` to `/v1/public/tenants/by-host` has no `signal`; the negative/error cache is only populated *after* the call settles. When Cloud Run is cold, throttled or hanging, every uncached host (and every host whose 60 s entry just expired) blocks the whole web tier until Node's default socket timeout, and the fail-open to `generic` never triggers. The API-side companions (`vercel.ts`, `auth-allow-list.ts`) all use `AbortSignal.timeout(10_000)`; this hop should too, with a much tighter budget since it is on the interactive path.
**Fix:**
```ts
const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2_000) });
```
Keep the `catch` → `TTL_ERROR_MS` behaviour so a timeout is cached for 10 s.

### WR-07: `useSignedUpload` has no error boundary — a rejected server action leaves the zone stuck in `progress`

**File:** `apps/web/components/platform/LogoUpload.tsx:60-108`
**Severity:** WARNING
**Issue:** `onFile` awaits `actions.start(...)`, `uploadToSignedUrl(...)` and `actions.complete(...)` without `try/catch/finally`. A server-action call that *rejects* (network drop mid-request, a 5xx from the Next function, an unexpected throw inside the action) leaves `busy.current = true` and `state = 'progress'` permanently: every subsequent drop is ignored by the `if (busy.current) return;` guard, the bar stays at its last percent, and the only recovery is a full reload. `BrandingForm` has the same exposure but is guarded by `useTransition`; this hook is not.
**Fix:** Wrap the body:
```ts
const onFile = async (file: File) => {
  if (busy.current) return;
  try {
    /* existing body */
  } catch (error) {
    console.error('platform.branding.upload_failed', { error: String(error) });
    fail(t('errors.generic'));
  }
};
```
(`fail` already resets `busy`, `state` and `progress`.)

## Info

### IN-01: Replaced branding objects and abandoned signed uploads are never removed from the bucket

**File:** `packages/core/server/platform/branding.ts:143-198, 252-268`
**Issue:** `completeBrandingUpload` records the new `logoUrl`/`iconUrl` but never deletes the previous object (only `removeIconOverride` does); `startBrandingUpload` mints a signed URL with no record, so an upload that is PUT but never completed is invisible to any cleanup. The public bucket accumulates orphans per re-upload, all publicly readable under the tenant prefix.
**Fix:** In the `complete` transaction, capture the previous key via `objectKeyFromPublicUrl(current.logoUrl | current.iconUrl, tenantId, storageOrigin())` and `removeQuietly` it after commit; consider a periodic worker sweep of `<tenant>/branding/*.{png,svg,webp,jpg}` not referenced by the row.

### IN-02: `svgLooksUnsafe` is a substring blocklist and can be bypassed

**File:** `packages/core/server/branding/upload.ts:138-146`
**Issue:** The scan is lower-cased substring/regex matching. Entity-encoded payloads (`java&#115;cript:`, `&#60;script`), `href` values split across whitespace/newlines, `<use href="data:image/svg+xml;base64,…">` (only `data:text` is refused) and CSS `url(...)`/`@import` inside `<style>` all pass. Exposure is low because the logo is only ever rendered through `<img>` (no script execution) and the raw object lives on the Storage origin, but the comment sells it as a safety scan.
**Fix:** Either parse with a real XML parser and allow-list elements/attributes (e.g. `dompurify` with the SVG profile in the worker, or reject anything whose parse tree contains `script`, `foreignObject`, `style`, event attributes or non-fragment `href`s), or rasterise the logo to PNG in the worker and store the SVG only as the derivation source.

### IN-03: Tenant favicon is declared `type: 'image/png'` but is an `.ico`

**File:** `apps/web/app/layout.tsx:35`
**Issue:** `iconsFor()` returns `favicon = branding.faviconUrl` (the derived `favicon.ico`, `image/x-icon`) for tenants, but the `<link rel="icon">` is emitted with `type: 'image/png'`. Browsers sniff so it renders, but the hint is wrong and some UAs skip mistyped icon links.
**Fix:** Derive the type from the URL (`.ico` → `image/x-icon`, else `image/png`) or omit `type`.

### IN-04: Send Email Hook reads the whole request body before verifying the signature

**File:** `apps/api/src/routes/hooks.ts:29`
**Issue:** `await c.req.text()` buffers an arbitrarily large body from an unauthenticated caller before any header check. Cloud Run caps HTTP/1 bodies at 32 MiB, but a burst of near-cap posts still costs memory for nothing. GoTrue payloads are a few KB.
**Fix:** Mount Hono's `bodyLimit({ maxSize: 64 * 1024 })` on this route, and check the three `webhook-*` headers exist before reading the body.

### IN-05: `X-Client-IP` is trusted from any direct API caller

**File:** `apps/api/src/routes/me.ts:142`, `apps/api/src/routes/public.ts:126`
**Issue:** The docblock says the header is "set by the web server action from Vercel's `x-real-ip` (trusted hop only)", but the API is publicly reachable and nothing distinguishes the BFF hop from a browser calling Cloud Run directly with its own Bearer. The value is only stored as consent evidence (`consent_records.ip`), so the impact is forged audit data, not access.
**Fix:** Either require a shared BFF header/secret before honouring `X-Client-IP`, or fall back to the Cloud Run `X-Forwarded-For` first hop and log both.

### IN-06: Open transactions held across network I/O and sleeps

**File:** `packages/core/server/platform/domains.ts:102-108`, `packages/core/server/platform/invites.ts:58-65`
**Issue:** `withAllowListLock` keeps a `withAdminTx` transaction (and its advisory lock) open across two Supabase Management API calls (up to 2 × 10 s timeouts); `waitForMirroredUser` sleeps up to ~300 ms inside the membership transaction. Both pin a pooled `api_user` backend on the transaction pooler for the duration. Volume is low (super_admin actions) and the lock is the intended serialisation, so this is a note, not a bug.
**Fix:** For the allow-list, take `pg_advisory_lock` on a dedicated short-lived connection/tx and release after the HTTP calls, or move the read-modify-write into the worker with a `singletonKey`. For `waitForMirroredUser`, poll outside the transaction and open it once the row exists.

### IN-07: `FlashToast` strips every query parameter, not just `toast`

**File:** `apps/web/components/platform/FlashToast.tsx:27`
**Issue:** `router.replace(pathname)` drops any other search params present on the tenant page (none today, but the list page already uses `q`/`status`/`limit` and the component is mounted from a layout).
**Fix:** Clone `searchParams`, `delete('toast')`, and replace with `${pathname}?${params}` when non-empty.

---

_Reviewed: 2026-09-17T05:32:13Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
