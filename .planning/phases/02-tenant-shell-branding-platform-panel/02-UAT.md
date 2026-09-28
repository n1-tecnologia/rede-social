---
status: partial
phase: 02-tenant-shell-branding-platform-panel
source: [02-VERIFICATION.md]
started: 2026-09-17T15:02:52Z
updated: 2026-09-21T14:18:15Z
---

## Current Test

[testing paused — 4 items outstanding]

## Tests

### 1. Design-team review of the platform-panel screens (SC3, UI-04, D-33): walk `.planning/sketches/001-phase-02-designed-screens/index.html` and the coded screens (/plataforma list, /plataforma/novo, tenant tabs Marca/Módulos/Domínios/Admins/Status, /aceitar-convite, /convite-expirado, /comunidade-indisponivel, /~offline, InstallHint) with the design team, light and dark.
expected: The design team records its approval (reviewer + date) in `.planning/sketches/001-phase-02-designed-screens/README.md`, replacing or endorsing the product owner's provisional approval of 2026-09-16; any deltas are captured for a follow-up.
result: pass

### 2. Real-device standalone install (SC4, PWA-01): on a real iPhone (Safari → Compartilhar → 'Adicionar à Tela de Início') and a real Android phone (Chrome install prompt) open a tenant host over HTTPS (hosted environment from Phase 01.1), install and launch from the home screen; in the inspector read `document.documentElement.dataset.displayMode`.
expected: Launches without browser chrome, shows the tenant's name and derived icon (maskable, not cropped), status bar / theme-color in the tenant primary (#7c3aed on rede-demo), and `data-display-mode === 'standalone'`.
result: blocked
blocked_by: prior-phase
reason: "Phase 01.1 never executed (3 plans, 0 summaries) — no hosted HTTPS tenant host to install from"

### 3. Hosted custom-domain flow (SC2, TENANT-07): with `DOMAIN_PROVIDER=vercel` and `AUTH_ALLOW_LIST=supabase` (02-USER-SETUP.md credentials), attach a real customer host from the Domínios tab, create the shown DNS records, press 'Verificar agora' or wait for the poller; then force one provider failure (e.g. revoke the Vercel token for ten minutes) and confirm the host is re-checked after the token is restored.
expected: The host appears under Vercel project domains, the Supabase auth `uri_allow_list` gains `https://<host>/auth/confirm**`, by-host answers 404 before and 200 after verification, `https://<host>/entrar` renders the tenant brand, the first-admin invite mail arrives through Resend; after the forced failure the Domínios card shows `last_error` (kind:status) and a `kernel.domain-verify` job is waiting, and the host verifies on the next run without pressing the button.
result: blocked
blocked_by: prior-phase
reason: "Phase 01.1 never executed; 02-USER-SETUP.md credentials (VERCEL_TOKEN, VERCEL_PROJECT_ID, SUPABASE_PAT) all unticked — DOMAIN_PROVIDER=vercel not provisioned"

### 4. Hosted branded auth mail (SC4, TENANT-06): after Phase 01.1 wires `[remotes.<env>.auth.hook.send_email]` to the Cloud Run API and `MAIL_TRANSPORT=resend`, request a password recovery on a seed tenant host and an invite for a new tenant.
expected: Both mails arrive through Resend with From name = tenant display name, subject 'Redefina sua senha — {tenant}' / 'Convite para administrar {tenant}', the tenant logo as <img>, the CTA in the persisted primary colour and the 'Enviado pela plataforma Rede Social' footer.
result: blocked
blocked_by: prior-phase
reason: "Phase 01.1 never executed — Send Email Hook not wired to Cloud Run and MAIL_TRANSPORT=resend not configured"

### 5. First green CI run: push a PR to the GitHub remote (Phase 01.1) and read `.github/workflows/ci.yml`'s `checks` job.
expected: The 24 steps run in the documented order mirroring `pnpm verify` (lint with the literal guard, build, check:static-routes, boundaries, lane guard, pgTAP, integration, dev-server e2e on three projects, production-build e2e:pwa) and on a forced failure both Playwright report folders are uploaded.
result: blocked
blocked_by: prior-phase
reason: "No git remote configured in this repository — cannot push a PR to GitHub Actions"

### 6. Visual fidelity — branded login and member shell (SC1/SC3, 02-07/02-08): open http://rede-demo.localhost:3000/entrar (purple, seed logo, 'Comunidade: Rede Demo'), http://rede-lab.localhost:3000/entrar (teal) and http://localhost:3000/entrar (neutral platform wordmark); log in on a 390 px phone viewport and at 1280 px.
expected: Phone: TopBar with logo + name, floating glass BottomNav (Início · Exemplo · Perfil on demo; Início · Perfil on lab) that shrinks on downward scroll; desktop: 240 px rail with logo, centred 680 px column, no TopBar/BottomNav; flipping 'Tema escuro' in /configuracoes and reloading shows no light flash; a 40-character display name truncates in the TopBar and clamps to two lines in the rail; geometry matches reference/frontend-design.
result: pass

### 7. Platform panel screens versus the D-33 mockup (02-12/02-14/02-15/02-16/02-20): signed in as the seeded super_admin on http://rede-social.localhost:3000, compare `#tenant-list`, `#platform-shell-mobile`, `#new-tenant` (BrandPreview mini-shells; type `#f5f7fb` as primary; type a seeded member's e-mail as adminEmail → field error under #adminEmail, values kept), `#tenant-page-marca` (upload a PNG logo with a worker running → 4 px progress bar → 'Gerando ícones…' → four thumbs + 'Versão n'; then stop the API mid-upload → zone returns to idle with the generic pt-BR error and a second drop works), `#tenant-page-dominios` (DNS table / stacked blocks, confirm dialogs; a host with last_error shows the cause and 'Verificar agora'), `#tenant-page-modulos`, `#tenant-page-admins` (a refused invite shows the danger pill 'Convite recusado — o e-mail já está em uso' and the reason toast on resend), `#tenant-page-status`; light and dark; the rail 'Tema' row sits above 'Sair'.
expected: Each screen matches its mockup section; neutral tokens only on the platform host; without a worker the icons card stops polling after ~60 s with 'Os ícones ainda estão sendo gerados…' instead of spinning forever; a .gif or > 2 MB file shows the pt-BR error with no `/branding/uploads` request.
result: pass

### 8. Branded mails in Mailpit (02-06/02-10/02-19): open http://127.0.0.1:54324 after `pnpm verify:smoke` and read the newest 'Redefina sua senha — Rede Demo' and 'Convite para administrar {name}' messages, HTML and plain-text tabs; also the WR-04 fallback mail (resend for an admin who exchanged the link but never accepted) whose link carries `type=recovery&next=/aceitar-convite`.
expected: Purple (demo) / tenant-primary accent and CTA, the tenant logo or the accented display name as text when there is no logo, 'Enviado pela plataforma Rede Social' footer, plain-text alternative with the same /auth/confirm link; the recovery-type invite link opens /aceitar-convite, not /redefinir-senha; rendering in Gmail/Apple Mail is not exercised locally.
result: pass

### 9. Accept-invite and expired-invite screens (02-10): follow an invite link from Mailpit on the tenant host; then reuse the consumed link.
expected: /aceitar-convite is branded (main --brand-primary = tenant primary), heading 'Você foi convidado(a) a administrar {tenant}' (two centred lines for a long name on the phone), password field with eye + three-segment meter, two 44 px consent rows, one brand CTA; the consumed link lands on /convite-expirado with one outline 'Voltar para login'.
result: pass

### 10. Offline page and install hint (02-11): airplane mode → navigate to /inicio on a production build (`pnpm --filter @rede-social/web e2e:pwa` server on :3100); mount `<InstallHint open />` in a scratch page.
expected: /~offline matches mockup `#offline` (WifiOff icon, 'Você está offline', outline 'Tentar novamente'); InstallHint matches `#install-hint` ('Adicione à Tela de Início', 'Entendi' / 'Agora não').
result: pass

### 11. Missing-catalog-key behaviour (02-04, PWA-03): under `next dev` render a page with a deliberately missing key; under `next build && next start` render the same page.
expected: Dev/test: the render throws (next-intl onError); production: the dotted key renders visibly, never an empty string.
result: pass

### 12. Prioritisation of the post-gap-closure code review (02-REVIEW.md incremental #3, 1 warning + 8 info): WR-01 (a transient DB failure after a successful GoTrue invite call turns our own identity into a terminal 'email_in_use' refusal — no self-service recovery), IN-01 (an existing member of the SAME tenant invited as admin is refused with the misleading 'email_in_use'), IN-03 (a lapsed recovery-type resend link lands on the password-recovery screen instead of /convite-expirado), IN-04 (`no_verified_primary` on resend surfaces as the generic 'Tente novamente'), IN-05 (`detail.invites[0]` is the oldest row, not the newest), IN-06/IN-07/IN-08 (upload try-scope, test coupling, 23505 race guard covered only synthetically).
expected: Product owner confirms the 02-17 SUMMARY decision (IN-* deferred to Phase 8 hardening) and decides whether the new WR-01 ships as a Phase 2 follow-up or joins the Phase 8 list; none contradicts a Phase 2 must-have truth on its normal path.
result: pass

### 13. Judgment-tier prohibitions of the four gap-closure plans (13 items, `verification: judgment`, listed in the Prohibitions section below): confirm the LLM-judge verdicts at the end-of-phase checkpoint.
expected: Each prohibition is acknowledged as honored (the verifier's non-authoritative reading found no violation) or reopened with a concrete counter-example.
result: pass

## Summary

total: 13
passed: 9
issues: 0
pending: 0
skipped: 0
blocked: 4

## Gaps
