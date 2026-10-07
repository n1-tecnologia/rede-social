---
phase: quick-261007-gbk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/server/mail/templates/signup.ts
  - packages/core/server/mail/index.ts
  - packages/core/server/tenancy/mail-tenant.ts
  - packages/core/tests/mail-templates.test.ts
  - packages/core/tests/mail-link-host.test.ts
  - packages/core/server/tenancy/signup.ts
  - apps/api/src/routes/public.ts
  - supabase/config.toml
  - apps/api/tests/integration/signup.test.ts
  - apps/web/lib/mail-return-origin.ts
  - apps/web/lib/pending-confirmation.ts
  - apps/web/lib/pending-confirmation.test.ts
  - apps/web/lib/signup-confirmation.ts
  - apps/web/app/(auth)/esqueci-senha/actions.ts
  - apps/web/app/(auth)/verifique-seu-email/page.tsx
  - apps/web/app/(auth)/verifique-seu-email/actions.ts
  - apps/web/messages/pt-BR/verifyEmail.json
  - apps/web/app/(auth)/cadastro/[slug]/actions.ts
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/confirm/route.test.ts
  - apps/web/proxy.ts
  - apps/web/proxy.test.ts
  - apps/web/e2e/mail.ts
  - apps/web/e2e/signup.spec.ts
  - apps/web/e2e/admin-rules.spec.ts
  - docs/deploy/auth-mail.md
autonomous: true
requirements: [AUTH-01, AUTH-02, TENANT-06]
tags: [auth, signup, email-verification, gotrue, send-email-hook, mail-template, pt-BR]

must_haves:
  truths:
    - "A new sign-up through POST /v1/public/signup/:slug creates an UNCONFIRMED GoTrue identity plus its membership and both consent rows (still in the one admin-lane transaction, compensation intact), and that identity cannot sign in until it confirms: signInWithPassword answers email_not_confirmed for the right password and invalid_credentials for a wrong one (no existence oracle). Seeded, invited and admin-created users stay confirmed."
    - "After the form the person lands on /verifique-seu-email (never auto-signed-in, e-mail only in an HttpOnly cookie, never in a URL), and a pt-BR mail 'Confirme seu e-mail — {tenant}' wearing the tenant's logo/name/colours is delivered through GoTrue -> the existing Send Email Hook -> Mailpit/Resend, its CTA pointing back to the host the person used."
    - "Opening the mail link (/auth/confirm, type=signup) confirms the e-mail, signs the person in and lands on /inicio; a link that no longer exchanges lands on /verifique-seu-email?erro=link-invalido, where an e-mail can be typed to ask for a new one."
    - "Signing in with the right password on an unconfirmed account lands on /verifique-seu-email?erro=nao-confirmado with a resend button; a wrong password still shows the single generic credentials error. The 08.1 'já tem conta' join flow keeps working, and an unconfirmed identity reaching it is sent to the same verification screen."
    - "Resend never reveals whether an account exists: the answer is one constant sentence whatever GoTrue replied; a 60 s cookie cooldown (matching production auth.email.max_frequency) short-circuits repeat clicks with a distinct wait notice that discloses nothing about the account."
    - "Sign-up on a generic host (localhost:3000/cadastro/{slug}) still gets its confirmation mail: a hostless 'signup' mail for an identity with exactly one membership wears that tenant's brand instead of being refused (decision row 6a); every other hostless link rule (row 7) is unchanged."
    - "supabase/config.toml turns email confirmation on locally and for [remotes.production] (max_frequency 60s), and docs/deploy/auth-mail.md documents the flow, row 6a and the new failure modes."
  artifacts:
    - path: "packages/core/server/mail/templates/signup.ts"
      provides: "renderSignup: the tenant-branded pt-BR confirmation mail"
      contains: "renderSignup"
    - path: "packages/core/server/tenancy/mail-tenant.ts"
      provides: "row 6a of decideMailTenant (hostless signup, one membership)"
      contains: "6a"
    - path: "packages/core/server/tenancy/signup.ts"
      provides: "createUser with email_confirm false"
      contains: "email_confirm: false"
    - path: "supabase/config.toml"
      provides: "enable_confirmations = true (base) and the production override with max_frequency 60s"
      contains: "enable_confirmations = true"
    - path: "apps/web/lib/mail-return-origin.ts"
      provides: "mailReturnOrigin: the validated origin a GoTrue mail link may return to (extracted from the recovery action)"
      contains: "mailReturnOrigin"
    - path: "apps/web/lib/pending-confirmation.ts"
      provides: "strict HttpOnly cookie codec {email, sentAt?}, cooldown predicate, isEmailNotConfirmed"
      contains: "PENDING_CONFIRMATION_COOKIE"
    - path: "apps/web/lib/signup-confirmation.ts"
      provides: "sendSignupConfirmation: supabase.auth.resend type signup with the validated origin"
      contains: "sendSignupConfirmation"
    - path: "apps/web/app/(auth)/verifique-seu-email/page.tsx"
      provides: "the verification / resend screen"
      contains: "verifyEmail"
    - path: "apps/web/messages/pt-BR/verifyEmail.json"
      provides: "pt-BR copy of the verification screen"
      contains: "verifyEmail"
    - path: "docs/deploy/auth-mail.md"
      provides: "signup confirmation documentation"
      contains: "signup"
  key_links:
    - from: "packages/core/server/tenancy/signup.ts"
      to: "GoTrue (enable_confirmations = true)"
      via: "admin.createUser with email_confirm false leaves email_confirmed_at null and sends nothing"
    - from: "apps/web/lib/signup-confirmation.ts"
      to: "packages/core/server/mail/index.ts"
      via: "supabase.auth.resend type signup -> GoTrue -> POST /v1/hooks/auth/send-email -> render() case signup -> renderSignup"
    - from: "packages/core/server/mail/templates/signup.ts CTA"
      to: "apps/web/app/auth/confirm/route.ts"
      via: "buildActionLink(redirect_to, token_hash, 'signup') -> verifyOtp type signup -> redirect next=/inicio"
    - from: "apps/web/app/(auth)/entrar/actions.ts"
      to: "apps/web/app/(auth)/verifique-seu-email/page.tsx"
      via: "isEmailNotConfirmed(error) -> pending cookie -> redirect ?erro=nao-confirmado"
---

<objective>
Add real e-mail verification to member sign-up. Today `signupMember` creates an autoconfirmed identity and the web action signs the person in at once (Phase 1 D-04, "no e-mail confirmation in the pilot"). By the user's explicit request of 2026-10-07 this plan supersedes that clause of D-04 only; D-04's detail-less 409 for an existing e-mail stays exactly as is.

Purpose: nobody can hold a community seat with an address they do not own, and the confirmation mail is the tenant's own branded pt-BR message sent through the Send Email Hook that already brands recovery and invite mail.

Output: an unconfirmed-on-create signup, a branded `signup` mail template, a `/verifique-seu-email` screen with a constant-answer, cooldown-aware resend, unconfirmed-login handling, config for local and production, tests at unit/integration/e2e level, and updated auth-mail documentation.

Design decisions made at planning time (from reading the code, not assumed):
- Membership and both consent rows are STILL written at sign-up, not at confirmation: the hook brands a link mail from the identity's membership (decision rows 2/6a), the consent evidence belongs to the moment the person ticked the boxes, and the single transaction with `deleteUser` compensation stays untouched. An unconfirmed identity has no session, so the membership cannot be used; it only exists as a row.
- GoTrue sends NOTHING on `admin.createUser`, so the web tier triggers the mail with `supabase.auth.resend({ type: 'signup' })` using the same validated-origin rule as the recovery action. GoTrue's resend handler does not look at `[auth] enable_signup = false` (read from supabase/auth `internal/api/resend.go`), so the CR-02 lock on the public sign-up endpoint is untouched.
- A hostless `signup` mail (generic host, Vercel preview that is a registered/dev host, or GoTrue's `site_url` fallback) would be refused by decision row 7, because the new identity "belongs somewhere". Row 6a fixes exactly that case: hostless + action type `signup` + exactly one membership brands that tenant. Everything else in rows 1-9 is unchanged.
- Task 1 deliberately proves the riskiest wiring first and end to end (config -> GoTrue -> hook -> template -> Mailpit -> verifyOtp -> sign-in) before any web code is written.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@packages/core/server/tenancy/signup.ts
@packages/core/server/tenancy/mail-tenant.ts
@packages/core/server/mail/index.ts
@packages/core/server/mail/templates/recovery.ts
@packages/core/server/mail/templates/neutral.ts
@apps/web/app/(auth)/cadastro/[slug]/actions.ts
@apps/web/app/(auth)/esqueci-senha/actions.ts
@apps/web/app/(auth)/esqueci-senha/page.tsx
@apps/web/app/(auth)/entrar/actions.ts
@apps/web/app/auth/confirm/route.ts
@apps/web/lib/join-draft.ts
@apps/web/e2e/mail.ts
@docs/deploy/auth-mail.md

Project rules that bind this plan: tenant isolation is non-negotiable; every pt-BR string lives in a next-intl catalog (`scripts/check-ui-literals.sh` runs inside `pnpm lint`); Biome lint; Vitest; `redirect()` is never called inside try/catch (Next 16). Commit messages carry NO Co-Authored-By trailer (public repo, user memory rule). Run package gates with `pnpm --filter <pkg> exec vitest run <file>` (not through turbo; `test:integration -- <file>` does not filter, and turbo's cache fills the disk, so use `TURBO_CACHE=local:r` for any turbo run). Local stack facts: Supabase is running; Mailpit at http://127.0.0.1:54324; GoTrue currently reports `mailer_autoconfirm: true`; the API is NOT running (the integration suite serves the hook itself on 0.0.0.0:8787). `pnpm supabase stop && pnpm supabase start` keeps the database; do not `db reset`.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Signup mail template, hook row 6a, unconfirmed createUser, config, and the end-to-end GoTrue -> hook -> Mailpit proof</name>
  <files>packages/core/server/mail/templates/signup.ts, packages/core/server/mail/index.ts, packages/core/server/tenancy/mail-tenant.ts, packages/core/tests/mail-templates.test.ts, packages/core/tests/mail-link-host.test.ts, packages/core/server/tenancy/signup.ts, apps/api/src/routes/public.ts, supabase/config.toml, apps/api/tests/integration/signup.test.ts</files>
  <read_first>
    - packages/core/server/mail/templates/recovery.ts (the template shape to copy) and packages/core/server/mail/templates/layout.ts (renderLayout, MailBrand)
    - packages/core/server/mail/index.ts (the render() switch and buildActionLink import)
    - packages/core/server/tenancy/mail-tenant.ts (decideMailTenant rows 1-9 and the file comment table)
    - packages/core/tests/mail-templates.test.ts and packages/core/tests/mail-link-host.test.ts (test style, `demo` brand, `facts()` builder)
    - packages/core/server/tenancy/signup.ts and apps/api/src/routes/public.ts (the sign-up route and its OpenAPI description)
    - apps/api/tests/integration/signup.test.ts (helpers `adminSql`, `api`, `signup`, `body`, `uniqueEmail`, `emails`; last existing case is 10) and apps/api/tests/integration/invites.test.ts lines 335-360 (a Mailpit search/read helper to copy)
    - supabase/config.toml lines 255-280 (the [auth.email] block) and 490-520 (the [remotes.production] blocks)
  </read_first>
  <behavior>
    - renderSignup({ brand, link }): subject is exactly "Confirme seu e-mail — Rede Demo" for the demo brand; html contains the heading, the CTA label "Confirmar e-mail" and the link; text contains the link; a hostile display name stays escaped (renderLayout already guarantees it).
    - decideMailTenant row 6a: no host tenant + action type signup + onlyMembershipTenantId set -> { kind: 'tenant', via: 'membership' } for that tenant; the same with two memberships (onlyMembershipTenantId null, belongsSomewhere true) -> still refused redirect_host_not_tenant; hostless magiclink with one membership -> still refused (row 7 intact); a host tenant H where the identity has no membership + signup -> still refused redirect_host_not_member (row 5 intact); a platform admin -> still neutral (row 1 first).
    - Integration (live stack): after POST /v1/public/signup/rede-demo the auth row has email_confirmed_at null; signInWithPassword with the right password errors with code email_not_confirmed; with a wrong password it errors with code invalid_credentials (pins the no-oracle order: GoTrue checks the password before the confirmation state).
    - Integration: POST {SUPABASE_URL}/auth/v1/resend?redirect_to=<encoded http://rede-demo.localhost:3000/auth/confirm?next=/inicio> with the publishable key and body { type: 'signup', email } delivers ONE Mailpit message to that address, From name "Rede Demo", subject "Confirme seu e-mail — Rede Demo", whose confirm link starts with http://rede-demo.localhost:3000/auth/confirm?next=/inicio and carries type=signup and a token_hash; verifyOtp({ type: 'signup', token_hash }) on a publishable-key client returns a session, auth.users.email_confirmed_at is then set, and signInWithPassword succeeds.
    - Integration: the same resend with redirect_to=http://localhost:3000/auth/confirm?next=/inicio (a hostless redirect, the generic-host case) still delivers the Rede Demo branded mail (row 6a), not a refusal.
  </behavior>
  <action>
    Write the failing unit tests first (mail-templates.test.ts: a renderSignup case beside the recovery and invite cases; mail-link-host.test.ts: the five row 6a cases listed in behavior, plus renaming nothing that exists), run them red, then implement.

    1. Create packages/core/server/mail/templates/signup.ts exporting renderSignup({ brand, link }) built with renderLayout exactly like recovery.ts: subject "Confirme seu e-mail — {displayName}" (em dash, same as the neutral copy so nothing visible changes for the subject), heading "Confirme seu e-mail", two paragraphs ("Falta só um passo para ativar sua conta em {displayName}." and "Clique no botão abaixo para confirmar seu endereço de e-mail e entrar na comunidade."), CTA "Confirmar e-mail" to the link, closing "Se você não criou esta conta, ignore este e-mail. O link expira em breve." Plain strings with accents verbatim; no HTML of its own.
    2. In packages/core/server/mail/index.ts add a `signup` case to render() that builds the link with buildActionLink(redirect_to, token_hash, 'signup') and calls renderSignup; extend the doc comment above render() ("recovery, invite and signup have dedicated templates"). Leave neutral.ts untouched: its signup copy stays as an unreachable safety net and its own test keeps passing.
    3. In packages/core/server/tenancy/mail-tenant.ts add row 6a to decideMailTenant between the `host !== null` block and row 7: when facts.actionType is 'signup' and facts.onlyMembershipTenantId is not null, return the tenant decision with via 'membership'. Add a row "6a" line to the file's comment table explaining why: the identity is brand new and unconfirmed, so its only membership IS the community it signed up on, and a hostless link (generic host, GoTrue site_url fallback) would otherwise be refused by row 7 and strand the person. No change to resolveMailTenant: the hostless branch already fills onlyMembershipTenantId.
    4. In packages/core/server/tenancy/signup.ts set the createUser confirmation flag to false (the key stays email_confirm). Rewrite the doc comment of signupMember: step (c) now creates an UNCONFIRMED identity (GoTrue sends no mail on admin create; the web tier triggers the signup mail through GoTrue's resend so it passes the Send Email Hook), step (d) still runs at sign-up because the hook brands by membership and consent evidence belongs to the moment of acceptance, and "The API never returns tokens: the person signs in only after confirming the e-mail". Behavior, error mapping, compensation and the 409 path are unchanged. In apps/api/src/routes/public.ts change the 201 description from "autoconfirmed" to say the member is created with an unconfirmed e-mail and joined to the tenant.
    5. In supabase/config.toml set `enable_confirmations = true` in the base [auth.email] block with a comment: admin-created, invited and seeded users are unaffected (they pass email_confirm true or are confirmed by their link), only the sign-up path creates unconfirmed identities, and `max_frequency` stays "1s" locally so e2e resends are not throttled. In `[remotes.production.auth.email]` add `enable_confirmations = true` and `max_frequency = "60s"` beside the existing otp_expiry (a remote table inherits the base values, so production would otherwise get the local 1 s). Do NOT add a confirmation-template block: the free-plan template push quirk documented at the bottom of the file would reject the whole auth push. The homolog remote is not defined in this file yet; the deploy-hml preflight already demands one, so note in the config comment that it must repeat the same two keys.
    6. Append integration cases to apps/api/tests/integration/signup.test.ts after case 10, numbered 11 to 13, covering the three Integration behaviors above. Use a publishable-key supabase-js client (persistSession false) for sign-in and verifyOtp, `fetch` for the GoTrue resend call, and a small local Mailpit helper (MAILPIT_URL default http://127.0.0.1:54324; search `to:` then read the message; poll up to 20 s) copied in spirit from invites.test.ts. Each case signs up its OWN fresh address (GoTrue's max_frequency would throttle a second resend for the same user) and registers it in the existing `emails` array so afterAll deletes it. These cases need the hook listener the suite's global-setup already starts on 0.0.0.0:8787 and the restarted auth container.
    7. RESTART the local auth container so the config applies: run `pnpm supabase stop && pnpm supabase start`, then confirm `curl -s -H "apikey: x" http://127.0.0.1:54321/auth/v1/settings` shows "mailer_autoconfirm":false. If `pnpm supabase start` complains about SEND_EMAIL_HOOK_SECRETS, use the scripts/supabase.sh wrapper the docs describe (`pnpm supabase` already is that wrapper).
    8. If the integration run hits GoTrue's over_email_send_rate_limit (local `[auth.rate_limit] email_sent = 2`), raise that single local key to a number comfortably above the e2e volume (for example 1000), restart the stack once more, and keep the change with a one-line comment; do not touch it otherwise.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/mail-templates.test.ts tests/mail-link-host.test.ts && curl -s -H "apikey: x" http://127.0.0.1:54321/auth/v1/settings | grep -q '"mailer_autoconfirm":false' && pnpm --filter @rede-social/api exec vitest run tests/integration/signup.test.ts tests/integration/send-email-hook.test.ts tests/integration/gotrue-signup-disabled.test.ts && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api lint</automated>
  </verify>
  <done>A POST to /v1/public/signup/rede-demo leaves email_confirmed_at null with the membership and two consent rows present; right-password sign-in answers email_not_confirmed and wrong-password sign-in answers invalid_credentials; GoTrue's resend delivers the branded "Confirme seu e-mail — Rede Demo" mail through the hook for both the tenant-host and the hostless redirect; verifyOtp type signup confirms and signing in then works; the existing send-email-hook and signup cases and the CR-02 public-signup-disabled case still pass; grep -c "email_confirm: false" packages/core/server/tenancy/signup.ts prints 1; config.toml carries enable_confirmations = true in the base and in the production override.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Web flow - verification screen, resend, unconfirmed login, confirm fallback</name>
  <files>apps/web/lib/mail-return-origin.ts, apps/web/app/(auth)/esqueci-senha/actions.ts, apps/web/lib/pending-confirmation.ts, apps/web/lib/pending-confirmation.test.ts, apps/web/lib/signup-confirmation.ts, apps/web/app/(auth)/verifique-seu-email/page.tsx, apps/web/app/(auth)/verifique-seu-email/actions.ts, apps/web/messages/pt-BR/verifyEmail.json, apps/web/app/(auth)/cadastro/[slug]/actions.ts, apps/web/app/(auth)/entrar/actions.ts, apps/web/app/auth/confirm/route.ts, apps/web/app/auth/confirm/route.test.ts, apps/web/proxy.ts, apps/web/proxy.test.ts</files>
  <read_first>
    - apps/web/app/(auth)/esqueci-senha/actions.ts (recoveryOrigin: the host-poisoning guard to extract, and the constant-answer pattern) and apps/web/app/(auth)/esqueci-senha/page.tsx (page structure, one alert-or-status paragraph, AuthInput, SubmitButton, LinkButton)
    - apps/web/lib/join-draft.ts and apps/web/lib/join-draft.test.ts (the HttpOnly cookie codec to mirror, strict zod, sessionCookieOptions)
    - apps/web/app/(auth)/cadastro/[slug]/actions.ts (signup and joinFromSignup) and apps/web/app/(auth)/entrar/actions.ts (login)
    - apps/web/app/auth/confirm/route.ts and route.test.ts (the destination() helper and the failed-link cases)
    - apps/web/proxy.ts lines 20-45 (PUBLIC list) and apps/web/proxy.test.ts lines 160-185 (PUBLIC entries test)
    - apps/web/messages/pt-BR/forgot.json and login.json (catalog shape; one root key equal to the file name segment)
  </read_first>
  <behavior>
    - pending-confirmation codec: round-trips { email } and { email, sentAt }; refuses (null) garbage, empty, over-long, non-JSON, a non-object, an invalid e-mail, a negative or non-integer sentAt, and ANY extra key (a password above all); the encoded value never contains a password if one is smuggled into the input.
    - withinResendCooldown(pending, nowMs): true only when sentAt exists and nowMs - sentAt is under 60 000 ms; false for a missing sentAt, exactly 60 000 ms, or a sentAt in the far past; a sentAt in the future counts as within the cooldown (clock skew never opens the gate).
    - isEmailNotConfirmed({ code, message }): true for code email_not_confirmed and for the message "Email not confirmed" in any case; false for invalid_credentials, other codes, empty and undefined.
    - /auth/confirm: a failed signup-type exchange lands on /verifique-seu-email?erro=link-invalido; recovery and invite fallbacks are unchanged; a successful signup exchange lands on next.
    - proxy: /verifique-seu-email is a public path (200, no redirect to /entrar) on a tenant host.
  </behavior>
  <action>
    Write the failing unit tests first (pending-confirmation.test.ts, the new route.test.ts case, the proxy.test.ts case), run them red, then implement. All user-facing strings go into the new catalog; no literal pt-BR in TSX.

    1. Extract the host guard. Create apps/web/lib/mail-return-origin.ts exporting `mailReturnOrigin(refusedEvent: string): Promise<string | null>` containing the body and the full explanatory comment of the current recoveryOrigin in esqueci-senha/actions.ts, unchanged in behavior (x-forwarded-host before host, host must equal what the proxy classified, honoured only for tenant, platform or dev-only localhost / *.localhost hosts, https forced on production builds), except that the console.warn event name is the parameter. Then make esqueci-senha/actions.ts import it and call it with 'forgot.origin_refused' and delete the local copy plus the imports that become unused. The recovery e2e (recovery.spec.ts, including the WR-09 unserved-host case) must still pass untouched.
    2. Create apps/web/lib/pending-confirmation.ts modelled on join-draft.ts: cookie name 'pending_confirmation', one hour, HttpOnly SameSite=Lax via sessionCookieOptions, schema { email: z.email(), sentAt: non-negative integer optional } strict, exports PENDING_CONFIRMATION_COOKIE, PENDING_CONFIRMATION_MAX_AGE_S, RESEND_COOLDOWN_MS (60 000, the production auth.email.max_frequency set in Task 1), encodePendingConfirmation, decodePendingConfirmation, withinResendCooldown, isEmailNotConfirmed, and the server-only writePendingConfirmation / readPendingConfirmation / clearPendingConfirmation. Document why the e-mail is in a cookie and never a URL (same reasoning as T-08.1-12) and that forging it gains nothing (it only names the address a resend is requested for, which GoTrue's public resend already accepts from anyone).
    3. Create apps/web/lib/signup-confirmation.ts exporting `sendSignupConfirmation(email): Promise<void>`: obtains the origin from mailReturnOrigin('signup_confirmation.origin_refused'); when null it logs nothing more and returns; otherwise calls createClient() then supabase.auth.resend with type 'signup', the e-mail, and emailRedirectTo `${origin}/auth/confirm?next=/inicio` (the same shape the recovery link uses, which the local and production redirect allow-lists already admit). It never inspects or surfaces GoTrue's result beyond a console.warn of the error code and status (never the e-mail, token or link), because any difference in the answer would be an enumeration oracle (T-gbk-02).
    4. Create the screen apps/web/app/(auth)/verifique-seu-email/page.tsx (server component, same layout conventions as esqueci-senha/page.tsx) and actions.ts with `resendConfirmation(formData)` ('use server'). Page: reads searchParams { erro, reenviado, aguarde } and the pending cookie. Title "Verifique seu e-mail". With a cookie: a sentence naming the address (read from the cookie) telling the person to open the link, plus the spam hint, and a form holding only the resend SubmitButton. Without a cookie: the help sentence and a form with an e-mail AuthInput (reuse login.email for the placeholder) plus the SubmitButton. Always a ghost LinkButton back to /entrar. Render at most ONE paragraph among: the alert for erro=link-invalido, erro=nao-confirmado or erro=email, else the status for reenviado=1 (the constant sentence), else the status for aguarde=1 (wait notice); unknown values render nothing. Action: address = the cookie's e-mail, else the typed one validated with forgotSchema (invalid -> redirect to ?erro=email); if the cookie exists and withinResendCooldown(cookie, Date.now()) redirect to ?aguarde=1 without calling GoTrue; otherwise await sendSignupConfirmation(address), write the cookie with sentAt = Date.now(), and redirect to ?reenviado=1. Exactly one outcome per branch, redirect() outside any try/catch, and the answer after a send is the same whether or not the address has an account (T-gbk-02).
    5. Create apps/web/messages/pt-BR/verifyEmail.json (single root key verifyEmail) with: title, sentTo (with {email}), spamHint, help, resend, pending, resent ("Se houver uma conta aguardando confirmação para este e-mail, enviamos um novo link."), wait ("Aguarde um minuto antes de pedir outro e-mail."), invalidLink ("Este link expirou ou já foi usado. Se você já confirmou, entre com sua senha; senão, peça um novo e-mail."), notConfirmed ("Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou peça um novo."), invalidEmail, backToLogin. Check apps/web/i18n/messages.test.ts still passes (no duplicate leaf paths across files).
    6. Change the sign-up action in cadastro/[slug]/actions.ts: keep every step up to and including the 409 / 404 / not-ok handling untouched (the 08.1 join draft flow must behave identically). After a successful API response replace the signInWithPassword block with: write the pending cookie for body.email with sentAt = Date.now(), await sendSignupConfirmation(body.email), redirect('/verifique-seu-email'). Update the function's doc comment (no auto sign-in; confirmation required) and remove the now-unused createClient import only if nothing else in the file uses it (joinFromSignup still does). In joinFromSignup, when signInWithPassword fails and isEmailNotConfirmed(error) is true, write the pending cookie for the draft's e-mail (no sentAt) and redirect to '/verifique-seu-email?erro=nao-confirmado' before the existing wrong-password redirect; every other failure keeps `erro=senha`.
    7. Change login in entrar/actions.ts: when signInWithPassword errors and isEmailNotConfirmed(error), write the pending cookie for the typed e-mail (no sentAt) and redirect to '/verifique-seu-email?erro=nao-confirmado'; any other error keeps the single generic '/entrar?erro=credenciais' (the suspended-host short-circuit above it is unchanged). This is safe only because GoTrue verifies the password first; Task 1's invalid_credentials assertion pins that.
    8. In auth/confirm/route.ts, after the invite branch and before the recovery fallback, send a failed link whose type is 'signup' to '/verifique-seu-email?erro=link-invalido'; update the route's doc comment. Add the matching case to route.test.ts (a failed signup exchange, plus a signup exchange that succeeds landing on next).
    9. In proxy.ts add /^\/verifique-seu-email(?:\/|$)/ to PUBLIC and a case to proxy.test.ts in the PUBLIC entries block (200, no location header, on a tenant host).
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/pending-confirmation.test.ts app/auth/confirm/route.test.ts proxy.test.ts i18n/messages.test.ts lib/join-draft.test.ts && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh</automated>
  </verify>
  <done>The codec, cooldown and not-confirmed predicates, the confirm-route fallback and the proxy public path are covered by green unit tests; typecheck, Biome and the UI-literal check pass; grep -c "supabase.auth.signInWithPassword" "apps/web/app/(auth)/cadastro/[slug]/actions.ts" prints 1 (only joinFromSignup signs in now); grep -c "mailReturnOrigin" "apps/web/app/(auth)/esqueci-senha/actions.ts" prints at least 2 (import plus call) and recovery.spec.ts still passes in Task 3's run.</done>
</task>

<task type="auto">
  <name>Task 3: E2E coverage for the new flow and the auth-mail documentation</name>
  <files>apps/web/e2e/mail.ts, apps/web/e2e/signup.spec.ts, apps/web/e2e/admin-rules.spec.ts, docs/deploy/auth-mail.md</files>
  <read_first>
    - apps/web/e2e/signup.spec.ts (all 8 cases; cases 1, 2 and 6 sign up through the UI and expect /inicio)
    - apps/web/e2e/recovery.spec.ts lines 55-140 (clearMailbox, waitForRecoveryMail, the confirm-link round trip, isRemote skips)
    - apps/web/e2e/mail.ts (waitForRecoveryMail, latestMailMessage, clearMailbox)
    - apps/web/e2e/admin-rules.spec.ts lines 195-225 (the visitor sign-up that expects /inicio)
    - apps/web/e2e/multi-tenant-identity.spec.ts lines 52-70 (the 409 -> já tem conta path that must keep passing)
    - docs/deploy/auth-mail.md (the decision table, the failure-modes table, the hosted-values section)
  </read_first>
  <action>
    1. apps/web/e2e/mail.ts: add and export `waitForSignupMail(email, timeoutMs?)` that returns the newest message's /auth/confirm link by delegating to the existing link-polling helper (the helper is generic despite its name; do not rename it, other specs import it). Keep Mailpit-only behavior consistent with the file.
    2. apps/web/e2e/signup.spec.ts, rewrite the cases that assumed auto sign-in, keeping their numbering and intent:
       - Case 1: after the consented submit expect the URL to end in /verifique-seu-email, the h1 "Verifique seu e-mail", the typed address visible, and no "@" in the URL. Then `test.skip(isRemote, ...)` (remote runs cannot read Mailpit), `clearMailbox` is not needed because the address is unique; read latestMailMessage(email) and assert fromName "Rede Demo" and subject "Confirme seu e-mail — Rede Demo"; assert the link starts with `${hosts.demo}/auth/confirm` and contains type=signup; `page.goto(link)` and expect /inicio, the "Início" h1, the shell brand named "Rede Demo", and the profile-page name assertions the case already makes.
       - Case 2: sign up, confirm through the mail link, Sair, then the existing login round trip.
       - Case 6 (generic host, already local-only): sign up on `${hosts.generic}/cadastro/rede-demo`, expect the verification page on the generic host, read the mail and assert its link starts with `${hosts.generic}/auth/confirm` (this is the row 6a proof in a browser), confirm it, land on /inicio, then keep the existing sign-out and tenant_slug cookie assertions.
       - Cases 3, 4, 5, 7, 8 stay as they are (3 is the 409 join-draft guard).
       - New case 9 (unconfirmed login, local only): sign up, do NOT confirm; open /entrar and sign in with the right password -> URL /verifique-seu-email?erro=nao-confirmado, one alert with the not-confirmed copy; sign in with a WRONG password -> /entrar?erro=credenciais with the generic message (no oracle); then via the login path (cookie without sentAt) `clearMailbox`, wait about 1.2 s (local max_frequency is 1 s), click "Reenviar e-mail", expect the single status paragraph with the constant resent sentence and a fresh mail whose link confirms the account and lands on /inicio.
       - New case 10 (cooldown + constant answer, local only): right after a sign-up, click "Reenviar e-mail" on the verification page and expect ?aguarde=1 with the wait notice and NO new mail (the cookie cooldown). Then with a fresh browser context (no cookie) open /verifique-seu-email, type an address that has no account, submit, and expect exactly the same resent status sentence as for a real one (no enumeration).
       - New case 11 (dead link): goto `/auth/confirm?token_hash=bogus&type=signup&next=https://evil.example` and expect /verifique-seu-email?erro=link-invalido on the same host, the invalid-link alert, and the e-mail form; the external next never leaves the app.
       All new selectors use role and text from the catalog; reuse fillSignup, uniqueEmail and the afterAll cleanup.
    3. apps/web/e2e/admin-rules.spec.ts: the visitor sign-up now ends on the verification page, so expect the URL to end in /verifique-seu-email instead of /inicio; the consent-version assertion that follows stays (the API wrote both consent rows at sign-up time, which is the point of that test).
    4. docs/deploy/auth-mail.md: (a) in "What ships" add that sign-up confirmation mail is a first-class template (`signup`, "Confirme seu e-mail — {tenant}") and add row 6a to the decision table with its rationale; (b) add a "Sign-up confirmation" section: the flow (unconfirmed createUser, membership and consents at sign-up, web triggers GoTrue resend with the validated origin, /auth/confirm type=signup signs in, /verifique-seu-email resend with the 60 s cookie cooldown and constant answer), that unconfirmed accounts cannot sign in and are listed as members by admins until they confirm, that a recovery link also confirms an unconfirmed owner (the squatting escape hatch), and that supersedes the Phase 1 D-04 autoconfirm; (c) in the hosted values section add the `enable_confirmations = true` / `max_frequency = "60s"` pair for every `[remotes.<env>.auth.email]` table (homolog must repeat them when its remote table is created) and that the tenant host must be in `additional_redirect_urls` like for recovery; (d) in the failure-modes table add: no confirmation mail on a Vercel Preview or other unregistered host (`signup_confirmation.origin_refused` in the web logs, same rule as recovery), an unconfirmed identity trying to join a second community (the hook refuses a signup mail on a host where it has no membership; the person confirms from the first community's mail or uses Esqueci a senha, whose link also confirms), and local `over_email_send_rate_limit` if it appears.
    5. Run the specs against the local stack. Prerequisites: stack restarted in Task 1; `pnpm db:seed` data present; the API must be running for the web (API_URL) and the hook (:8787), as recovery.spec.ts already requires: start `pnpm --filter @rede-social/api dev` if nothing answers on 8787. If a seeded-state failure appears in unrelated specs, report it as pre-existing FRONT-PENDENCIAS drift (STATE.md notes the e2e stage already fails on it) rather than fixing it here.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec playwright test signup.spec.ts admin-rules.spec.ts recovery.spec.ts multi-tenant-identity.spec.ts --project=mobile-chromium && pnpm --filter @rede-social/web lint</automated>
  </verify>
  <done>signup.spec.ts cases 1-11 and admin-rules.spec.ts pass on mobile-chromium against the local stack; recovery.spec.ts and the 409 join-draft cases in multi-tenant-identity.spec.ts still pass; docs/deploy/auth-mail.md documents row 6a, the confirmation flow, the production keys and the new failure modes; grep -c "6a" docs/deploy/auth-mail.md is at least 1.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> web server action | form fields (name, e-mail, password, typed resend e-mail) and Host / X-Forwarded-Host headers are untrusted |
| web -> GoTrue (publishable key) | public resend endpoint, reachable by anyone holding the browser key regardless of this plan |
| GoTrue -> API hook | Standard Webhooks signature authenticates it; payload fields other than server rows are not trusted for branding |
| mail link -> /auth/confirm | one-time token_hash and a `next` path arrive from an inbox, untrusted |
| unconfirmed identity -> tenant data | an `active` membership row exists before the person can authenticate |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gbk-01 | Information Disclosure | resend + unconfirmed login (account enumeration) | high | mitigate | resendConfirmation always redirects to the same constant status after a send and never inspects GoTrue's result (errors incl. 429 swallowed, logged by code only); login reveals "not confirmed" only after GoTrue verified the password (integration case pins invalid_credentials for a wrong password); the cooldown notice depends only on the user's own cookie |
| T-gbk-02 | Tampering | confirmation link origin (host-header poisoning) | high | mitigate | sendSignupConfirmation reuses the extracted mailReturnOrigin guard (tenant / platform / dev-local hosts only, must equal the proxy's classification, https forced in production); GoTrue's redirect allow-list is the second independent guard; open-redirect guard on `next` in /auth/confirm unchanged and re-asserted by e2e case 11 |
| T-gbk-03 | Denial of Service | mail bombing a victim through resend | medium | mitigate | 60 s cookie cooldown per browser plus GoTrue max_frequency 60 s per user in production config; residual abuse equals what the public GoTrue resend endpoint already allows, so this plan adds no new exposure |
| T-gbk-04 | Spoofing | e-mail squatting by someone who signs up with another person's address | medium | accept | the squatter cannot confirm or sign in; the real owner recovers through Esqueci a senha, whose link also confirms the e-mail, then joins; documented in auth-mail.md |
| T-gbk-05 | Elevation of Privilege / Information Disclosure | unconfirmed identity holds an `active` membership; hostless signup mail branding (row 6a) | medium | mitigate | no session exists until confirmation so the membership is inert; row 6a applies only to action type signup with exactly one membership (two memberships stay refused by row 7), is keyed on server rows never on user_metadata, and the mail goes only to the address owner; pgTAP/RLS untouched. Admin member lists show unconfirmed members until they confirm: accepted and listed as a follow-up |
| T-gbk-06 | Information Disclosure | pending_confirmation cookie holds the e-mail | low | mitigate | HttpOnly, SameSite=Lax, Secure on production builds, one hour, strict schema (any extra key invalidates it), e-mail never placed in a URL or log line |
| T-gbk-07 | Tampering | CR-02: GoTrue's own public sign-up must stay closed | high | mitigate | enable_signup stays false; resend does not reopen it (verified in source and re-run via gotrue-signup-disabled.test.ts in Task 1's verify) |
| T-gbk-08 | Repudiation | consent evidence for people who never confirm | low | accept | consent rows record the moment of acceptance with ip and user agent as before; an unconfirmed account's rows remain as evidence and cascade-delete with the identity |

No new package dependency is added, so no package-legitimacy checkpoint applies.
</threat_model>

<verification>
After all three tasks, with the stack restarted and the API running:
1. `pnpm --filter @rede-social/core exec vitest run` and `pnpm --filter @rede-social/web exec vitest run` green.
2. `pnpm --filter @rede-social/api exec vitest run tests/integration/signup.test.ts tests/integration/send-email-hook.test.ts tests/integration/gotrue-signup-disabled.test.ts` green.
3. `pnpm lint` green (Biome plus the UI-literal check) and `pnpm turbo typecheck` with `TURBO_CACHE=local:r` green.
4. `pnpm --filter @rede-social/web exec playwright test signup.spec.ts admin-rules.spec.ts recovery.spec.ts multi-tenant-identity.spec.ts --project=mobile-chromium` green.
5. Manual spot check in Mailpit (http://127.0.0.1:54324): the confirmation mail wears the tenant name, logo and primary colour.
Not run here, by design: the full `pnpm verify` (its e2e stage already fails on pre-existing FRONT-PENDENCIAS spec drift per STATE.md) and any production or homolog deploy.
</verification>

<success_criteria>
- Sign-up no longer signs anyone in: it ends on /verifique-seu-email, and the tenant-branded pt-BR confirmation mail arrives through the Send Email Hook with a link back to the host used.
- The link confirms and signs in; dead links, unconfirmed logins and the 08.1 join path all route to a screen that can resend, with a constant answer and a 60 s cooldown.
- Generic-host sign-up still receives its mail (row 6a); no other hook decision row changed.
- Local and production auth config require confirmation; docs/deploy/auth-mail.md describes it.
- Seeded, invited and admin-created users, the 409 join-draft flow, recovery and CR-02 behave exactly as before.
</success_criteria>

<output>
Create `.planning/quick/261007-gbk-verifica-o-de-e-mail-no-cadastro-com-tem/261007-gbk-SUMMARY.md` when done.
</output>

## Risks

- Unconfirmed members are visible to tenant admins in the member list (and counted) until they confirm; not filtered here (follow-up candidate: show a "e-mail não confirmado" badge or hide them).
- A sign-up on a host this deployment does not serve as tenant/platform (a Vercel Preview alias) cannot get its mail (`signup_confirmation.origin_refused`), the same rule recovery already has; production sign-up must happen on registered tenant domains whose host is in the hosted `additional_redirect_urls`.
- An unconfirmed identity from community A that tries to join community B gets no resend from B (hook row 5 refuses a signup mail where it has no membership); the escape hatches are A's original mail or Esqueci a senha. Documented, not engineered around.
- Production receives the new auth settings only on the next `supabase config push` (deploy-api.yml); nothing is deployed by this plan, and the production database/app deploy order must keep the push after the web release that ships /verifique-seu-email.

## Coverage audit (quick task, no ROADMAP phase)

| Source item (request) | Covered by |
|---|---|
| enable_confirmations on, local + remotes.production | Task 1 step 5 |
| signup mail through the existing Send Email Hook, tenant-branded pt-BR, in templates | Task 1 steps 1-3, integration case 12-13 |
| API POST /v1/public/signup/:slug unconfirmed | Task 1 step 4, integration case 11 |
| server action: no auto sign-in, "verifique seu e-mail" screen with resend | Task 2 steps 3-6 |
| /auth/confirm type=signup + sensible failure fallback | Task 2 step 8 |
| login of an unconfirmed account | Task 2 step 7, e2e case 9 |
| 409 join-draft flow keeps working | Task 2 step 6 (untouched branch), e2e case 3 retained |
| resend does not leak existence, cooldown / max_frequency | Task 2 steps 2-4, config 60s (Task 1), e2e case 10 |
| membership/consents at sign-up time (justified) | Objective design decisions, Task 1 step 4 |
| seeds / fixtures stay confirmed | all use admin createUser with email_confirm true (checked); Task 1 settings probe |
| unit / integration / e2e tests | Tasks 1, 2, 3 |
| docs/deploy/auth-mail.md | Task 3 step 4 |
| Deferred / out of scope | filtering unconfirmed members from admin lists; per-tenant toggle of confirmation |
