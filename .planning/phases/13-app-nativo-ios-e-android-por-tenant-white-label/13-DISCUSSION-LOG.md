# Phase 13: App nativo iOS e Android por tenant (white-label) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-03
**Phase:** 13-app-nativo-ios-e-android-por-tenant-white-label
**Areas discussed:** Como o app é construído; Contas das lojas e quem gera o app; Entrar, links de e-mail e excluir conta; O que o celular dá a mais, e a compra

All four areas were selected. Questions and answers were in pt-BR.

---

## Como o app é construído

### What weighs more: reaching the stores fast or a 100% native feel?

| Option | Description | Selected |
|--------|-------------|----------|
| Os dois, em etapas (Recomendado) | Stage 1: native shell opening the web screens with native push, camera, share, links. Stage 2: native screens only where the shell hurts (feed, Reels, chat) | ✓ |
| Chegar rápido: só o casco | The app is the web inside a shell with phone extras; lowest cost; App Review risk for repackaged sites | |
| 100% nativo desde o início | Rebuild the ~79 pages in React Native/Expo; best experience, several phases of screens | |

**User's choice:** Os dois, em etapas.

### Where does Phase 13 end?

| Option | Description | Selected |
|--------|-------------|----------|
| 13 = etapa 1; etapa 2 é outra fase (Recomendado) | Closes with the shell published and working for a pilot tenant | ✓ |
| 13 já inclui as telas nativas | Much larger phase; screens chosen before seeing the app run | |

**User's choice:** 13 = stage 1; stage 2 is another phase.

### Does the first published version already open for admin and support?

| Option | Description | Selected |
|--------|-------------|----------|
| Tudo desde a primeira (Recomendado) | Member, admin and support in one app, admin screens by permission | ✓ |
| Só membro na primeira, admin depois | Smaller first review surface; admin routes blocked for a while | |

**User's choice:** Tudo desde a primeira.
**Notes:** More questions on this area were declined; the shell technology, the "Atualize o app" screen and the homologation environments went to the researcher and planner.

---

## Contas das lojas e quem gera o app

### Whose App Store / Play Store account does each app use?

| Option | Description | Selected |
|--------|-------------|----------|
| Conta de cada tenant (Recomendado) | Tenant creates its own accounts and invites the platform with a publishing role; store shows the tenant as publisher | ✓ |
| Uma conta só, da plataforma | Simplest to run; platform as publisher; risk of series rejection | |
| Plataforma no piloto, tenant em produção | Tests on the platform account, public app on the tenant's, transferable between accounts | |

**User's choice:** Conta de cada tenant.
**Notes:** Igor was told the Apple rules 4.2.6 and 4.3 are from the assistant's knowledge and the research confirms them.

### How are the keys entered and the app generated?

| Option | Description | Selected |
|--------|-------------|----------|
| Chaves na tela, gerar por comando (Recomendado) | "App" tab in the panel, write-only and sealed; generation by command/workflow | ✓ |
| Chaves e botão na tela | Also a "Gerar app" button with build progress; much more scope | |
| Tudo por script e CI | Keys in GitHub/Secret Manager; manual work per tenant | |

**User's choice:** Chaves na tela, gerar por comando.

### One Firebase project or one per tenant?

| Option | Description | Selected |
|--------|-------------|----------|
| Um da plataforma para todos (Recomendado) | One project, one app per tenant, one sender key in Secret Manager; isolation stays in each tenant's database | ✓ |
| Um Firebase por tenant | Full isolation of delivery; manual setup per tenant | |

**User's choice:** Um da plataforma para todos.

### Who prepares the store listing?

| Option | Description | Selected |
|--------|-------------|----------|
| Plataforma monta com modelo (Recomendado) | Name, icon, splash, standard pt-BR text, reviewer account; tenant checks and gives the privacy-policy URL | ✓ |
| Tenant entrega tudo pronto | Tenant sends texts, images and policy | |

**User's choice:** Plataforma monta com modelo.
**Notes:** More questions on this area were declined; the application id naming and the order of the publishing steps went to the planner.

---

## Entrar, links de e-mail e excluir conta

### What happens to what the member published when the account is deleted?

| Option | Description | Selected |
|--------|-------------|----------|
| Anonimizar (Recomendado) | Personal data removed; posts and comments stay as "Membro removido" | ✓ |
| Apagar tudo do membro | Also posts, comments and likes; replies orphaned, counts change | |

**User's choice:** Anonimizar.

### Immediate or with a grace period; app only or web too?

| Option | Description | Selected |
|--------|-------------|----------|
| Prazo de 14 dias, no app e no web (Recomendado) | Deactivated at once, anonymised after 14 days, signing in cancels; same screen in both | ✓ |
| Na hora, no app e no web | Confirm with the password, no way back | |
| Na hora ou prazo, só no app | The web stays as it is | |

**User's choice:** Prazo de 14 dias, no app e no web.

### Do e-mail and share links open the app when installed?

| Option | Description | Selected |
|--------|-------------|----------|
| Abrem o app quando instalado (Recomendado) | Universal Links and App Links; two verification files served per tenant domain; browser when not installed | ✓ |
| Continuam no navegador | Nothing new in the web; the member reopens the app and signs in again | |

**User's choice:** Abrem o app quando instalado.
**Notes:** Sign-up in the app, forgot password and session follow the web exactly (the app opens the same pages); recorded as D-608 rather than asked.

---

## O que o celular dá a mais, e a compra

### Which phone extras go beyond the baseline (push, camera and library, native share, branded offline screen, pull to refresh)?

| Option | Description | Selected |
|--------|-------------|----------|
| Face ID / digital ao reabrir | Member-controlled lock in Perfil | ✓ |
| Número de não lidas no ícone | Icon badge from the API's unread counter | ✓ |
| Ler o último feed sem internet | Offline last feed; partly promotes V2-PLAT-03 | ✓ |

**User's choice:** All three.

### Plan B if a store rejects the external purchase link

| Option | Description | Selected |
|--------|-------------|----------|
| Chave por loja e tenant (Recomendado) | Link on in both stores by default; a per-tenant, per-platform switch hides price, button and link, leaving a neutral padlock | ✓ |
| Já nasce escondido no iPhone | Avoid the first Apple rejection; Android keeps the link | |
| Sem plano B agora | Decide on the spot while the phase waits | |

**User's choice:** Chave por loja e tenant.
**Notes:** The research checks what holds today in Brazil on both stores.

### When is the notification permission asked?

| Option | Description | Selected |
|--------|-------------|----------|
| Tela explicativa depois do 1º login (Recomendado) | Branded screen with "Ativar" / "Agora não"; only "Ativar" fires the system prompt | ✓ |
| Só pelo botão em Perfil | As in the web today; nothing asked until the member taps | |

**User's choice:** Tela explicativa depois do 1º login.

---

## Claude's Discretion

- The shell technology and the bridge to the web pages; the minimum-version "Atualize o app" behaviour; the application id and bundle id; slug versus host baked at build; the pilot tenant and environments; the shape of the `push_subscriptions` migration and the native transport; duplicate pushes for a device with both the PWA and the app; how the build and release command runs and the layout of the "App" tab.

## Deferred Ideas

- Stage 2 native screens (feed, Reels, chat) as their own phase.
- A "Gerar app" button with build progress in the panel.
- One Firebase project per tenant.
- The platform panel inside the app.
- In-app purchase, if a store refuses the redirect for good.
- Automatic rebuild when a tenant's branding changes.
