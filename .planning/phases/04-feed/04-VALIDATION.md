---
phase: "04"
slug: "feed"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
validated: "2026-09-23"
automated: 9
manual_only: 5
escalated: 2
created: "2026-09-22"
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `04-RESEARCH.md` §Validation Architecture.
> The Per-Task Verification Map is filled by `/gsd-validate-phase` once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| **Config file** | per-package `vitest.config.ts`; `apps/web/playwright.config.ts` + `playwright.pwa.config.ts`; `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @tria/module-feed test` (new package) / `pnpm --filter @tria/api test` |
| **Full suite command** | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |
| **Estimated runtime** | ~1230 seconds full suite (Phase 3 baseline: 20m26s); quick run seconds-scale |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @tria/module-feed test && pnpm --filter @tria/api test`
- **After every plan wave:** Run `pnpm lint && pnpm turbo typecheck test && pnpm supabase test db && pnpm test:integration`
- **Before `/gsd-verify-work`:** Full `pnpm verify` must be green

### Feedback Latency Ceiling (tiered)

Phase 4 inherits Phase 3's tiered ceiling for the same reason: a large share of this phase's
user-observable behaviour — double-tap-to-like, the swipe carousel, infinite scroll,
pull-to-refresh, the comment sheet, the share sheet and the logged-out deep-link round trip —
is **only** observable in a browser, so a targeted Playwright spec is the *primary* signal for
those behaviours, not a slow substitute for a faster one. Every task's `<automated>` chain is
ordered fast-tier-first so `&&` short-circuits on the cheapest gate that can fail.

| Tier | What runs | Declared ceiling | Where it is the primary signal |
|------|-----------|------------------|--------------------------------|
| **T1 — inner loop** | `pnpm --filter <pkg> typecheck`, `lint`, `test`, `bash scripts/check-ui-literals.sh`, `test -z "$(git status --porcelain …)"`, targeted `grep -q` artifact gates | **≤ 60 s** | Every task. T1 is the first segment of every `<automated>` chain, so any type, lint, contract, drift or copy error reports inside 60 s without the later tiers running at all. |
| **T2 — behaviour gate** | `pnpm test:integration -- <filters>`, `pnpm supabase test db`, one or two **targeted** Playwright spec files (never the full e2e suite) | **≤ 5 min per task** | The browser-only and DB-only behaviours listed above, plus the `EXPLAIN` plan assertions and the `pg_stat_statements` query budget. If a single spec file exceeds 5 minutes, split the spec — do not relax the tier. |
| **T3 — phase exit gate** | `pnpm verify` | **≤ 25 min, run once** | The final plan's last task only. Phase 3's baseline run was 20m26s; ~1230 s is the expected cost and is budgeted, not an overrun. No other task may put `pnpm verify` in its `<automated>`. |

- **Nyquist reading:** sampling continuity is satisfied at T1 (every task, ≤60 s) and confirmed at
  T2. T3 is a gate, not a sample.

---

## Per-Task Verification Map

<!-- Filled by /gsd-validate-phase after planning; task IDs do not exist at plan-seed time. -->
<!-- Requirement → behavior → command rows are already derived in 04-RESEARCH.md §Validation Architecture → "Phase Requirements → Test Map"; map them onto task IDs there. -->

| Requirement | Plans | Behavior verified | Test Type | Automated Command | Status |
|-------------|-------|-------------------|-----------|-------------------|--------|
| FEED-01 | 04-04, 04-05, 04-09 | Criar publicação: texto + combinações de mídia, XOR galeria/vídeo, unfurl no servidor, anexos | integration + e2e | `npx vitest run tests/integration/feed.test.ts` (apps/api) · `feed-composer.spec.ts` | ✅ green |
| FEED-02 | 04-01, 04-06 | Ordem do mais novo ao mais antigo, paginação keyset, cursor adulterado degrada para página 1 | integration + e2e | `npx vitest run tests/integration/feed.test.ts` · `feed.spec.ts` | ✅ green |
| FEED-02 crit. 4 | 04-01 | Orçamento de statements por página — **guarda bidirecional** (teto + piso, B-WR-06 fechado) | integration | `npx vitest run tests/integration/feed-query-budget.test.ts` (apps/api) | ✅ green — 3/3 |
| FEED-03 | 04-09 | Editar ("editado") e soft-delete só das próprias publicações | integration + e2e | `npx vitest run tests/integration/feed.test.ts` · `feed-composer.spec.ts` | ✅ green |
| FEED-04 | 04-03, 04-06 | Curtir/descurtir idempotente com contagem reconciliada | pgTAP + e2e | `pnpm supabase test db` (090-feed.sql) · `feed.spec.ts` | ⚠️ parcial — ver Manual-Only (A-WR-08) |
| FEED-05 | 04-03, 04-07 | Resposta de um nível imposta pelo banco (FK composto + CHECK); ambos os probes recusados | pgTAP | `pnpm supabase test db` (090-feed.sql) | ✅ green |
| FEED-06 | 04-03, 04-07 | Curtir/descurtir comentários e respostas | integration + e2e | `npx vitest run tests/integration/feed.test.ts` · `feed-comments.spec.ts` | ✅ green |
| FEED-07 | 04-08 | Deep link, login e aterrissagem, 404 cross-tenant, copiar link no desktop | e2e | `feed-share.spec.ts` | ✅ green (metade nativa → Manual-Only) |
| FEED-08 | 04-01 | `author_user_id` genérico + política de postagem por tenant, virável sem migração | integration | `npx vitest run tests/integration/feed.test.ts` (caso 7) | ✅ green |
| MEDIA-04 | 04-05 | Guarda SSRF em nível de socket (range privado, literal de IP, redirect para privado, teto de corpo); cache por tenant | unit | `pnpm --filter @tria/module-feed test` (unfurl-guard.test.ts) | ⚠️ parcial — ver Manual-Only (A-WR-01/02/03) e override MEDIA-04 |
| MOD-03 | 04-01, 04-03 | 7 eventos tipados, flush após handler, uma vez só, nada no rollback | unit | `pnpm --filter @tria/module-feed test` (events.test.ts) — 9/9 | ✅ green |
| MOD-03 / D-19 | 04-10 | A remoção do `@tria/module-example` **tem guarda permanente**: tabela ausente, nenhuma relação `example%`, CHECK recusa a chave retirada, controle positivo (B-WR-11 fechado) | pgTAP | `pnpm supabase test db` (100-module-example-removal.sql) | ✅ green — 4/4 |
| UI-02 | 04-02, 04-06, 04-07 | 11 primitivas portadas; 6 superfícies desenhadas; interações do protótipo preservadas | e2e + unit | `feed.spec.ts` + `post-media.test.tsx`, `meta.test.ts`, `share.test.ts` | ✅ green (aprovação D-33 → Manual-Only, FECHADA em 2026-09-23) |
| — (smoke) | 04-10 | A testemunha de duas direções do flag de módulo da fase | e2e | `phase4-smoke.spec.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> **Todos os 12 entregues** — confirmado por varredura de disco em 2026-09-23 (`/gsd-validate-phase 04`).

- [x] `packages/modules/feed/vitest.config.ts` + `package.json` test script — the new package has no test runner yet
- [x] `packages/modules/feed/tests/unfurl-guard.test.ts` — local `node:http` fixture servers (no internet); covers MEDIA-04 private-IP, IP-literal, redirect-to-private and body-cap refusals
- [x] `packages/modules/feed/tests/events.test.ts` — after-commit emission, once-only, none-on-rollback; covers MOD-03
- [x] `apps/api/tests/integration/feed.test.ts` — create/edit/soft-delete, gallery XOR video, like idempotency, comment depth mapping; covers FEED-01/03/04/05/06
- [x] `apps/api/tests/integration/feed-query-budget.test.ts` — `pg_stat_statements` `sum(calls)` delta filtered by `query ~ 'feed_(posts|comments|likes|...)'`; covers FEED-02 criterion 4
- [x] `supabase/tests/0xx-feed.sql` — reply-depth negative (FK + CHECK refusals), counter reconciliation, `EXPLAIN` index-scan assertions
- [x] `supabase/tests/020-tenant-isolation.sql` — substitute feed tables for `example_items`, keeping the positive control per case (**must land before the D-19 `@tria/module-example` removal**, or the exit gate silently weakens)
- [x] `supabase/tests/030-lanes.sql` — substitute a feed table for `example_items`
- [x] `apps/web/e2e/feed.spec.ts`, `feed-composer.spec.ts`, `feed-share.spec.ts` — mobile project; set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05 precedent)
- [x] `apps/web/e2e/phase4-smoke.spec.ts` — the per-phase smoke, extending 02-16's feed-tab witness with a real feed slot
- [x] `scripts/seed.ts` — seeded posts of each media shape plus comments, replies and likes, in **both** demo tenants with identical-looking content (SCHEMA-CONVENTIONS §(j))
- [x] Port `InfiniteScroll` into `@tria/ui` taking the IntersectionObserver root from `useScrollContainer()` — the one prototype primitive not yet ported, needed by Phases 5 and 7 too

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native share sheet on a real device | FEED-07 | `navigator.share()` opens an OS-level sheet Playwright cannot enter; only the desktop copy-link fallback is automatable | As a member on a real iPhone (Safari) and a real Android (Chrome), tap share on a post, confirm the OS sheet opens with the `/post/[id]` link; on desktop confirm "Copiar link" writes to the clipboard |
| Double-tap-to-like and swipe carousel feel on a real phone | FEED-04, UI-02 | Playwright can dispatch the events but cannot prove the gesture/animation reads correctly under a real touch digitiser | On a real phone, double-tap a post image (heart animates, likes once — not twice), swipe the gallery through all slides and back, confirm dots track |
| Package approval for `open-graph-scraper@6.12.0` and `undici` | MEDIA-04 | Supply-chain approval is a human decision; `undici` is flagged SUS (release-cadence artefact, not a supply-chain signal) | One blocking `checkpoint:human-verify` before the first install, per the 02-02 / 03-06 precedent. Recommend pinning `undici@7.29.1` (the version exercised in the research probes), not `^7` |

| **Toque duplo numa publicação JÁ curtida** (A-WR-08) | FEED-04 | **Escalado como defeito de implementação, não lacuna de teste.** `PostMedia.tsx` + `DoubleTapHeart` hoje DESCURTEM ao toque duplo numa publicação já curtida, animando um coração cheio. Um teste escrito contra o código atual fica VERMELHO, então o auditor Nyquist não podia fechá-lo (contrato: nunca modificar arquivos de implementação). O e2e cobre "curte exatamente uma vez", nunca o caso já-curtido | Corrigir primeiro via `/gsd-code-review 04 --fix`, depois acrescentar o caso já-curtido a `feed.spec.ts`. O teste 3 do UAT foi aprovado pelo product owner em 2026-09-23, mas A-WR-08 foi confirmado por leitura do código e **permanece de pé** |
| **Deny-list IPv6 e teto de redirects do unfurl** (A-WR-01/02/03) | MEDIA-04 | **Escalado como defeito de implementação.** `guard.ts` omite `ff00::/8`, `2002::/16` (6to4), `2001::/32` (Teredo) e `::/96`, e usa `redirect: 'follow'` (20 hops) onde o `CLAUDE.md` especifica **≤3**. Nenhum teste afirma essas recusas; escrever um agora fica vermelho. Não é bypass de SSRF — o guarda de socket inspecciona cada hop — mas é amplificação/DoS | `maxRedirections: 3` no Agent e as quatro faixas na deny-list são mudanças de uma linha cada; depois estender `unfurl-guard.test.ts` com um caso por faixa e um de cadeia de redirects |

---

## Validation Audit 2026-09-23

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved | 2 |
| Escalated | 2 |

**Resolvidos (verdes, verificados de forma independente pelo orquestrador, não só relatados):**

- **B-WR-06 / FEED-02 crit. 4** — `apps/api/tests/integration/feed-query-budget.test.ts`: os três
  orçamentos ganharam piso (`toBeGreaterThan(0)`) ao lado do teto, então uma medição vazia agora
  fica vermelha em vez de passar em 0. `npx vitest run tests/integration/feed-query-budget.test.ts`
  → **Test Files 1 passed, Tests 3 passed**. Prova de mutação do auditor: trocar o regex por uma
  tabela inexistente deixa os 3 vermelhos (antes passariam).
- **B-WR-11 / MOD-03 / D-19** — `supabase/tests/100-module-example-removal.sql` (novo, 4 asserções):
  tabela ausente, nenhuma relação `example%`, `23514` na chave retirada, e controle positivo com
  `'feed'`. `pnpm supabase test db` → **Files=11, Tests=195, Result: PASS** (a suíte subiu de 191).

**Escalados:** os dois acima na tabela Manual-Only. Ambos são defeitos de implementação, de modo que
um teste escrito contra o código de hoje seria vermelho — registrá-los como dívida honesta é
preferível a enfraquecer a asserção até passar. É por isso que `nyquist_compliant` continua `false`.

**Advertência de ambiente (gap 1):** o piso exige `pg_stat_statements` carregada em qualquer runner
que rode a suíte de integração. Verdade localmente e no job `supabase start` do CI; se um runner
futuro perder a extensão, os três testes ficam vermelhos — que é o comportamento pretendido.
---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — os 12 itens entregues
- [x] No watch-mode flags
- [x] Every task's `<automated>` chain is ordered T1 → T2 (→ T3 only in the final plan's last task)
- [x] T1 primary signal < 60s on every task; T2 < 5 min per task; T3 run once, ≤ 25 min
- [x] Feed isolation cases land in `020-tenant-isolation.sql` **before** `@tria/module-example` is removed (D-19) — e agora `100-module-example-removal.sql` impede a ressurreição
- [ ] `nyquist_compliant: true` set in frontmatter — **NÃO**: 2 gaps escalados como defeitos de implementação (A-WR-08, A-WR-01/02/03). Fase é PARCIAL por decisão registrada, não por descuido

**Approval:** validado em 2026-09-23 via `/gsd-validate-phase 04` — PARCIAL (9 automatizados, 5 manual-only dos quais 2 escalados).
