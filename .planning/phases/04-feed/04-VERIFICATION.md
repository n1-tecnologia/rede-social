---
phase: 04-feed
verified: 2026-09-23T05:45:05Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 1
overrides:
  - requirement: MEDIA-04
    artifact: "feed_link_previews.image_asset_id / LinkPreviewCard.tsx:83"
    verdict: accepted
    kind: deliberate-narrowing
    accepted_by: "Igor Vilas Boas (product owner)"
    accepted_at: 2026-09-23T11:08:55Z
    source: "04-UAT.md teste 6 (/gsd-verify-work 4)"
    reason: "A imagem da previa de link nao e copiada para o Storage em V1 (WINDOWS 23) — titulo, description, site_name e provider ficam em cache, a imagem nao. Estreitamento deliberado e registrado, nao defeito. O cartao sai so-texto e a variante YouTube/Vimeo nao exibe miniatura nem selo de play."
    follow_up: "deferred-items.md item 6 — copiar a miniatura remota para o Storage numa fase futura"
covered_digest: "v1:sha256:2e35801f3e0af622a7fd84f27eb50fa3ada65eb9766d66f53370aa3dc8608338"
digest_refreshed: "2026-09-23"
digest_refreshed_reason: "Dois arquivos cobertos mudaram DEPOIS desta verificacao, ambos pelo passo Nyquist do proprio /gsd-verify-work 04 (commit cf3218d). Ver a nota de refresh no corpo. Nenhuma conclusao desta verificacao cai; a mudanca QUITA a divida B-WR-06 que esta propria verificacao registrou contra um criterio que ja marcara VERIFIED."
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/04-feed/04-01-PLAN.md"
  - ".planning/phases/04-feed/04-01-SUMMARY.md"
  - ".planning/phases/04-feed/04-02-PLAN.md"
  - ".planning/phases/04-feed/04-02-SUMMARY.md"
  - ".planning/phases/04-feed/04-03-PLAN.md"
  - ".planning/phases/04-feed/04-03-SUMMARY.md"
  - ".planning/phases/04-feed/04-04-PLAN.md"
  - ".planning/phases/04-feed/04-04-SUMMARY.md"
  - ".planning/phases/04-feed/04-05-PLAN.md"
  - ".planning/phases/04-feed/04-05-SUMMARY.md"
  - ".planning/phases/04-feed/04-06-PLAN.md"
  - ".planning/phases/04-feed/04-06-SUMMARY.md"
  - ".planning/phases/04-feed/04-07-PLAN.md"
  - ".planning/phases/04-feed/04-07-SUMMARY.md"
  - ".planning/phases/04-feed/04-08-PLAN.md"
  - ".planning/phases/04-feed/04-08-SUMMARY.md"
  - ".planning/phases/04-feed/04-09-PLAN.md"
  - ".planning/phases/04-feed/04-09-SUMMARY.md"
  - ".planning/phases/04-feed/04-10-PLAN.md"
  - ".planning/phases/04-feed/04-10-SUMMARY.md"
  - "apps/api/package.json"
  - "apps/api/src/app.ts"
  - "apps/api/src/modules/registry.ts"
  - "apps/api/src/routes/me.ts"
  - "apps/api/tests/integration/auth-middleware.test.ts"
  - "apps/api/tests/integration/feed-edit-delete.test.ts"
  - "apps/api/tests/integration/feed-interactions.test.ts"
  - "apps/api/tests/integration/feed-media.test.ts"
  - "apps/api/tests/integration/feed-query-budget.test.ts"
  - "apps/api/tests/integration/feed-unfurl.test.ts"
  - "apps/api/tests/integration/feed.test.ts"
  - "apps/api/tests/integration/isolation.test.ts"
  - "apps/api/tests/integration/jobs.test.ts"
  - "apps/api/tests/integration/media-playback.test.ts"
  - "apps/api/tests/integration/media.test.ts"
  - "apps/api/tests/integration/modules.test.ts"
  - "apps/api/tests/integration/mux-webhook.test.ts"
  - "apps/api/tests/integration/platform-tenants.test.ts"
  - "apps/api/tests/unit/mounts.test.ts"
  - "apps/api/tests/unit/registry.test.ts"
  - "apps/web/app/(app)/criar/ComposerForm.tsx"
  - "apps/web/app/(app)/criar/actions.ts"
  - "apps/web/app/(app)/criar/page.tsx"
  - "apps/web/app/(app)/inicio/feed-actions.ts"
  - "apps/web/app/(app)/post/[postId]/editar/page.tsx"
  - "apps/web/app/(app)/post/[postId]/loading.tsx"
  - "apps/web/app/(app)/post/[postId]/not-found.tsx"
  - "apps/web/app/(app)/post/[postId]/page.tsx"
  - "apps/web/app/(auth)/entrar/actions.ts"
  - "apps/web/app/globals.css"
  - "apps/web/components/feed/FeedSurface.tsx"
  - "apps/web/components/feed/PostDetail.tsx"
  - "apps/web/components/feed/useDeletePost.ts"
  - "apps/web/components/feed/useSharePost.ts"
  - "apps/web/components/media/MediaImage.tsx"
  - "apps/web/components/media/useSignedUpload.ts"
  - "apps/web/e2e/admin.ts"
  - "apps/web/e2e/feed-admin.ts"
  - "apps/web/e2e/feed-comments.spec.ts"
  - "apps/web/e2e/feed-composer.spec.ts"
  - "apps/web/e2e/feed-media.spec.ts"
  - "apps/web/e2e/feed-share.spec.ts"
  - "apps/web/e2e/feed.spec.ts"
  - "apps/web/e2e/fixtures.ts"
  - "apps/web/e2e/fixtures/README.md"
  - "apps/web/e2e/fixtures/post-a.jpg"
  - "apps/web/e2e/fixtures/post-b.jpg"
  - "apps/web/e2e/phase2-smoke.spec.ts"
  - "apps/web/e2e/phase4-smoke.spec.ts"
  - "apps/web/e2e/platform-domains.spec.ts"
  - "apps/web/e2e/platform-tenants.spec.ts"
  - "apps/web/e2e/shell.spec.ts"
  - "apps/web/e2e/tenant-fixtures.ts"
  - "apps/web/lib/continue-path.ts"
  - "apps/web/lib/feed-view.tsx"
  - "apps/web/lib/feed-write.ts"
  - "apps/web/lib/feed.ts"
  - "apps/web/lib/registry.tsx"
  - "apps/web/lib/tenant-host.ts"
  - "apps/web/messages/pt-BR/feed.json"
  - "apps/web/package.json"
  - "apps/web/proxy.ts"
  - "packages/boundary-fixture/package.json"
  - "packages/boundary-fixture/src/index.ts"
  - "packages/contracts/src/modules.ts"
  - "packages/contracts/tests/platform.test.ts"
  - "packages/core/docs/SCHEMA-CONVENTIONS.md"
  - "packages/core/server/platform/modules.ts"
  - "packages/core/server/platform/tenants.ts"
  - "packages/core/server/rbac/permissions.ts"
  - "packages/core/tests/app-shell.test.tsx"
  - "packages/core/tests/nav.test.ts"
  - "packages/core/ui/MediaImage.tsx"
  - "packages/core/ui/index.ts"
  - "packages/modules/feed/contracts/index.ts"
  - "packages/modules/feed/db/schema.ts"
  - "packages/modules/feed/module.ts"
  - "packages/modules/feed/package.json"
  - "packages/modules/feed/server/index.ts"
  - "packages/modules/feed/server/jobs.ts"
  - "packages/modules/feed/server/routes.ts"
  - "packages/modules/feed/server/service.ts"
  - "packages/modules/feed/server/unfurl/guard.ts"
  - "packages/modules/feed/server/unfurl/job.ts"
  - "packages/modules/feed/tests/events.test.ts"
  - "packages/modules/feed/tests/meta.test.ts"
  - "packages/modules/feed/tests/post-media.test.tsx"
  - "packages/modules/feed/tests/share.test.ts"
  - "packages/modules/feed/tests/unfurl-guard.test.ts"
  - "packages/modules/feed/tsconfig.json"
  - "packages/modules/feed/turbo.json"
  - "packages/modules/feed/ui/AttachmentRow.tsx"
  - "packages/modules/feed/ui/CommentInput.tsx"
  - "packages/modules/feed/ui/CommentItem.tsx"
  - "packages/modules/feed/ui/CommentSheet.tsx"
  - "packages/modules/feed/ui/CommentsList.tsx"
  - "packages/modules/feed/ui/ComposeFab.tsx"
  - "packages/modules/feed/ui/FeedList.tsx"
  - "packages/modules/feed/ui/LikeButton.tsx"
  - "packages/modules/feed/ui/LinkPreviewCard.tsx"
  - "packages/modules/feed/ui/PostActions.tsx"
  - "packages/modules/feed/ui/PostCaption.tsx"
  - "packages/modules/feed/ui/PostCard.tsx"
  - "packages/modules/feed/ui/PostHeader.tsx"
  - "packages/modules/feed/ui/PostMedia.tsx"
  - "packages/modules/feed/ui/PostMenu.tsx"
  - "packages/modules/feed/ui/index.ts"
  - "packages/modules/feed/ui/linkify.tsx"
  - "packages/modules/feed/ui/meta.ts"
  - "packages/modules/feed/ui/sharePost.ts"
  - "packages/modules/feed/vitest.config.ts"
  - "packages/ui/src/hooks/useInfiniteScroll.ts"
  - "packages/ui/src/index.ts"
  - "packages/ui/src/layout/InfiniteScroll.tsx"
  - "packages/ui/src/overlays/DoubleTapHeart.tsx"
  - "packages/ui/src/primitives/PageHeader.tsx"
  - "packages/ui/src/styles/tokens.css"
  - "packages/ui/tests/double-tap-heart.test.tsx"
  - "packages/ui/tests/infinite-scroll.test.tsx"
  - "packages/ui/tests/tokens.test.ts"
  - "scripts/check-static-routes.sh"
  - "scripts/seed.ts"
  - "supabase/migrations/20260922152230_feed_posts.sql"
  - "supabase/migrations/20260922162440_feed_interactions.sql"
  - "supabase/migrations/20260922162449_feed_counters.sql"
  - "supabase/migrations/20260922165218_feed_post_media.sql"
  - "supabase/migrations/20260923010104_feed_link_previews.sql"
  - "supabase/migrations/20260923035937_drop_example_module.sql"
  - "supabase/tests/010-rls-coverage.sql"
  - "supabase/tests/020-tenant-isolation.sql"
  - "supabase/tests/030-lanes.sql"
  - "supabase/tests/090-feed.sql"
  - "supabase/tests/100-module-example-removal.sql"
decision_coverage:
  honored: 12
  total: 12
  not_honored: []
deferred: # Itens endereçados por outra fase do roadmap — não são gaps acionáveis aqui
  - truth: "Transcodificação Mux real e reprodução HLS em aparelho real (o provider `fake` é o único que já rodou)"
    addressed_in: "Phase 01.1 (Cloud Provisioning & First Release — adiada por falta de contas)"
    evidence: "ROADMAP Phase 01.1 + docs/DEPLOY.md; WINDOWS 12/14/15 (herança da Fase 3)"
human_verification:
  - test: "Abrir `.planning/sketches/002-phase-04-designed-screens/index.html` no navegador, em claro e escuro e com pelo menos duas marcas de tenant, e percorrer os 5 pontos do `<human-check>` de 04-02 (linguagem do protótipo em `/criar` e `/post/[id]/editar`; FAB móvel x botão de cabeçalho no desktop; os quatro estados do cartão de prévia, com a variante YouTube/Vimeo lendo como 'abre externamente'; a linha de anexo com nome de 90 caracteres; as duas mensagens para o time de design no README)"
    expected: "Aprovação (ou aprovação provisória do product owner, precedente 02-04) registrada no frontmatter do README do sketch: `status`, `approved`, `approved_by`, `approved_at`, `approval_kind`, `changes_requested`"
    why_human: "Portão D-33 / UI-04: é um julgamento de design sobre pixels, não uma asserção programável. WINDOWS 19 e 28 — 04-04, 04-05 e 04-09 codificaram contra o desenho por decisão explícita do orquestrador, com a aprovação carregada para a UAT da fase."
  - test: "Num iPhone real (Safari) e num Android real (Chrome), autenticado como membro de `rede-demo`, abrir uma publicação e tocar o controle de compartilhar; depois enviar o link para si mesmo, abri-lo deslogado e confirmar o retorno à publicação após o login"
    expected: "A folha de compartilhamento do SO abre carregando o link `/post/{id}` no host próprio do tenant; o link aberto deslogado passa pelo login e aterrissa na publicação"
    why_human: "`navigator.share()` abre uma superfície de nível de SO em que o Playwright não entra (WINDOWS 26). A metade desktop — copiar link e toast — ESTÁ automatizada em `apps/web/e2e/feed-share.spec.ts`."
  - test: "Nos mesmos aparelhos, dar um toque duplo na imagem de uma publicação e depois deslizar a galeria por todos os slides e voltar"
    expected: "O coração anima e a contagem sobe exatamente um (nunca dois); os pontos do carrossel acompanham o slide ativo"
    why_human: "O Playwright despacha os eventos mas não prova como o gesto e a animação se comportam sob um digitalizador de toque real. Ver também o achado A-WR-08 abaixo: o toque duplo numa publicação JÁ curtida hoje descurte."
  - test: "Publicar uma publicação com vídeo a partir de um celular e acompanhar o cartão até a reprodução"
    expected: "O cartão mostra o estado de processamento e depois reproduz"
    why_human: "Transcodificação real e HLS em aparelho real estão bloqueados na Fase 01.1 adiada (nenhuma conta Mux existe). Registrar como BLOQUEADO, nunca como aprovado — herança da Fase 3, WINDOWS 12/14/15."
  - test: "Renderizar a linha de meta de uma publicação com contagem de curtidas acima de 999 num viewport de 320px"
    expected: "A abreviação (ex.: `1,2 mil`) cabe na linha sem estourar"
    why_human: "WINDOWS 24: `supabase/tests/090-feed.sql` reconcilia `like_count` contra as linhas vivas de `feed_likes`, então o seed não consegue produzir uma contagem de quatro dígitos sem 1000+ usuários em `auth.users`. A abreviação está fixada como STRING por `packages/modules/feed/tests/meta.test.ts`, nunca como pixels."
  - test: "Decisão de produto: o cartão de prévia de link nunca guarda imagem — `feed_link_previews.image_asset_id` é nulo por decisão em V1, então o cartão renderiza somente texto e a variante YouTube/Vimeo não exibe miniatura nem o selo de play que o UI-D-12 especificou"
    expected: "Ou aceitar o desvio registrando um `override` neste frontmatter, ou abrir trabalho de acompanhamento para copiar a miniatura remota para o Storage"
    why_human: "MEDIA-04 pede `title/description/image` em cache; título e descrição estão em cache, a imagem não. É um estreitamento deliberado e registrado (WINDOWS 23), não um defeito — mas exige uma decisão humana e não pode ser absorvido silenciosamente numa aprovação."
---

# Fase 4: Feed — Relatório de Verificação

**Phase Goal:** `admin_tenant` publica posts ricos a partir de um celular e os membros os consomem e interagem com eles no feed da marca; esta fase fixa as convenções de conteúdo (formato de curtidas/comentários, respostas de um nível, paginação keyset, eventos de domínio após commit, deep links de compartilhamento) que todo módulo posterior copia.
**Verified:** 2026-09-23T05:45:05Z
**Status:** human_needed
**Re-verification:** Não — verificação inicial (nenhum `04-VERIFICATION.md` anterior existia)

---

## Nota de procedimento — modo MVP e formato do goal

A Fase 4 está marcada `Mode: mvp` no ROADMAP. A guarda de formato do modo MVP exige que o goal da
fase seja uma User Story (`As a …, I want to …, so that ….`). O goal da Fase 4 **não** está nesse
formato:

```
$ gsd_run query user-story.validate --story "<goal da Fase 4>"
{ "valid": false, "errors": [ "Story must start with \"As a [user role],\"…", … ], "slots": null }
```

As três verificações anteriores deste projeto (`01-VERIFICATION.md`, `02-`, `03-`) rodaram sob a
mesma condição — todas as nove fases do ROADMAP carregam `Mode: mvp` e nenhuma tem goal em formato
de User Story — e todas verificaram normalmente. Recusar aqui quebraria o fluxo e contrariaria o
precedente do próprio projeto, então a verificação prosseguiu **goal-backward contra os quatro
Success Criteria do ROADMAP**, que é o contrato real. A discrepância fica registrada como item
informativo: se o time quiser a seção "User Flow Coverage" do modo MVP nas próximas fases, o
caminho é `/gsd mvp-phase <N>` para reescrever os goals como User Story.

---

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion do ROADMAP) | Status | Evidência |
|---|--------------------------------------|--------|-----------|
| 1 | `admin_tenant` cria uma publicação do celular com texto + imagens (carrossel), um vídeo (HLS), prévia de link ou embed YouTube/Vimeo desenrolado no servidor no momento da criação com guarda SSRF e cacheado na publicação, e anexos; edita (marcado "editado") e apaga em soft-delete | ✓ VERIFIED | Composer real (`apps/web/app/(app)/criar/ComposerForm.tsx`, 818 linhas) + `createPostAction`; `POST/PATCH/DELETE /v1/feed/posts` em `packages/modules/feed/server/routes.ts:315/319/323`; `edited_at = now()` no `update` de `service.ts:756` e rótulo "editado" em `PostCard.tsx:182`; `deleted_at = now()` em `softDeletePost` (`service.ts:825`); carrossel snap + dots em `PostMedia.tsx:193-212`; vídeo via `VideoPlayer` (Mux HLS) injetado em `feed-view.tsx:141`; anexos via `AttachmentRow.tsx`; unfurl no servidor com guarda SSRF em nível de socket e cache por tenant (abaixo). E2E: `feed-composer.spec.ts` (publica duas imagens pelo seletor de arquivos real, edita, apaga), `feed-media.spec.ts` (carrossel, vídeo, PDF) |
| 2 | Membro vê as publicações do tenant do mais novo ao mais antigo, com cursor, scroll infinito e pull-to-refresh; curte/descurte (toggle idempotente, incl. toque duplo) e vê a contagem, comenta, responde um nível (resposta mais profunda recusada por constraint de banco), curte/descurte comentários e respostas, com as interações portadas de PostCard / CommentSheet do protótipo | ✓ VERIFIED | Índices keyset `(tenant_id, created_at desc nulls first, id desc nulls first)` em `db/schema.ts`; envelope `encodeCursor`/`decodeCursor` do kernel em `service.ts:247/270`; `InfiniteScroll` + `PullToRefresh` montados em `FeedList.tsx:482/511`; idempotência arbitrada pelos índices parciais `feed_likes_post_uq` / `feed_likes_comment_uq` — **probe executado** (ver Behavioral Spot-Checks); um nível de resposta pelo FK composto `feed_comments_parent_fk` + `feed_comments_parent_shape_chk` — **os dois probes executados e recusados pelo banco**; `PostCard`/`CommentSheet`/`CommentsList`/`CommentItem`/`CommentInput`/`PostActions`/`LikeButton`/`PostCaption`/`PostHeader` existem em `reference/frontend-design/components/{feed,comments}/` e são portas reais (3.399 linhas em `packages/modules/feed/ui/`). E2E: `feed.spec.ts` (ordem, paginação por sentinela, pull-to-refresh, toque e toque duplo), `feed-comments.spec.ts` (raiz, resposta, curtir resposta, sem afordância de resposta numa resposta) |
| 3 | Membro compartilha pela folha nativa (copiar link no desktop); o deep link interno aberto deslogado passa pelo login e aterrissa na publicação; membro de outro tenant recebe 404 | ✓ VERIFIED | `sharePost` + `useSharePost` com a tabela de quatro resultados (`shared`/`dismissed`/`copied`/`failed`); URL composta **no servidor** a partir do host primário verificado (`primaryHostOrigin()` em `registry.tsx:127`), nunca no navegador; `lib/continue-path.ts` (`CONTINUE_COOKIE`, `isContinuablePath` restrito a `^/post/[^/]+$`, `safeContinuePath` validado no USO em `entrar/actions.ts:38`), gravado por `proxy.ts:218`; `/post/[postId]/page.tsx` colapsa "outro tenant", "id desconhecido" e "apagada" num único `notFound()`. E2E: `feed-share.spec.ts` casos 1–5, incluindo a igualdade byte a byte das duas telas de not-found |
| 4 | Ações de publicação, curtida e comentário emitem eventos de domínio tipados no barramento do kernel após o commit, recebidos por um subscriber de teste; posts/comunidades/stories carregam `author_user_id` genérico e uma política de postagem por tenant; as páginas do feed executam um número limitado de queries (sem N+1, cursores keyset) checado no CI | ✓ VERIFIED | **Teste executado nesta verificação: 9/9 verdes** (ver Behavioral Spot-Checks) — `packages/modules/feed/tests/events.test.ts` prova fila-após-commit, entrega-uma-vez e nada-no-rollback com o barramento real; sete eventos tipados em `contracts/index.ts:638-645` e subscritos em `module.ts:33-84`; `flushEventsAfterHandler` montado em `apps/api/src/app.ts:24`, descartando a fila quando `c.error` está setado; `author_user_id -> users.id` em `feed_posts` e `feed_comments`, sem coluna com sabor de papel; política por tenant real — `feedSettingsSchema.postingPolicy` (`contracts/index.ts:405`) composta em `permissionsFor()` (`apps/api/src/modules/registry.ts:99-105`) com `safeParse` que cai para `admins_only`, e o teste de integração 7 vira o valor e torna o MESMO membro autor; orçamento de queries em `apps/api/tests/integration/feed-query-budget.test.ts`, rodado no CI por `pnpm test:integration` (`.github/workflows/ci.yml:94`, espelhado em `package.json` → `verify`) |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

Nenhuma verdade ficou ⚠️ PRESENT_BEHAVIOR_UNVERIFIED: as duas que dependem de comportamento em
tempo de execução — a ordem "após o commit" do barramento e as invariantes declarativas de banco —
foram exercidas por teste nomeado verde e por probes diretos contra o Postgres local, não por
presença de símbolo.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Transcodificação Mux real e reprodução HLS em aparelho real | Phase 01.1 (Cloud Provisioning, adiada por falta de contas) | ROADMAP §Phase 01.1 + `docs/DEPLOY.md`; WINDOWS 12/14/15 — herança da Fase 3, o provider `fake` é o único que já rodou |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/modules/feed/**` (43 arquivos) | O módulo autocontido: schema, contratos, server, jobs, UI | ✓ VERIFIED | 411 linhas de schema (5 tabelas com RLS), 1.446 de service, 358 de rotas, 648 de contratos, 3.399 de UI; `packages/modules/` contém **só** `feed` |
| `supabase/migrations/*_feed_*.sql` (5) | As cinco tabelas + gatilhos de contador | ✓ VERIFIED | `feed_posts`, `feed_interactions`, `feed_counters`, `feed_post_media`, `feed_link_previews` aplicadas — as 5 tabelas e os 2 gatilhos (`feed_likes_count`, `feed_comments_count`) confirmados no banco local |
| `supabase/migrations/20260923035937_drop_example_module.sql` | A remoção forward-only de D-19 | ✓ VERIFIED | `to_regclass('public.example_items')` é NULL e `tenant_modules` tem 0 linhas com `module_key='example'` no banco local; `grep -rn module-example` sobre `apps packages supabase scripts .github` não retorna nada |
| `supabase/tests/090-feed.sql` + substituições em 010/020/030 | pgTAP do feed antes da remoção do módulo de exemplo | ✓ VERIFIED | `090-feed.sql` existe; `020-tenant-isolation.sql` cita `feed_` 52 vezes, `010` 9, `030` 6, e **nenhum** dos três cita `example` |
| `apps/api/tests/integration/feed*.test.ts` (6) | Cobertura de API do feed | ✓ VERIFIED | `feed`, `feed-edit-delete`, `feed-interactions`, `feed-media`, `feed-unfurl`, `feed-query-budget` |
| `apps/web/e2e/feed*.spec.ts` + `phase4-smoke.spec.ts` | Cobertura de navegador | ✓ VERIFIED | 5 specs de feed + a testemunha de fase nos dois sentidos da flag do módulo |
| `apps/web/app/(app)/criar/**`, `post/[postId]/**` | Composer, edição, página da publicação | ✓ VERIFIED | Todos presentes e substantivos; `/post/[postId]` fora da lista de rotas estáticas |
| `feed_link_previews.image_asset_id` | Slot de imagem cacheada (MEDIA-04) | ⚠️ HOLLOW | A coluna, o FK e o ramo de render em `LinkPreviewCard.tsx:83` existem e estão ligados, mas **nenhuma linha semeada ou de runtime jamais o preenche** — nulo por decisão em V1 (WINDOWS 23). Consequência: o cartão YouTube/Vimeo sai só com texto, sem a miniatura e sem o selo de play que o UI-D-12 especificou |

**Falsos negativos do `verify.artifacts`** (3, todos verificados à mão e descartados):
`supabase/migrations/*_feed_counters.sql` e `*_drop_example_module.sql` existem — o verbo não expande
glob; `phase4-smoke.spec.ts` "Missing pattern: phase4" é sensibilidade a maiúsculas (o arquivo diz
`Phase 4`); `deletePostAction` existe e está ligado, só mora em `inicio/feed-actions.ts:200` em vez
de `criar/actions.ts` como o plano 04-09 declarou (deriva de localização, não capacidade ausente).

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Todos os 10 planos | — | `gsd_run query verify.key-links` | ✓ 39/40 WIRED | O único "não ligado" é o mesmo falso negativo de glob (`*_drop_example_module.sql`), verificado à mão |
| `apps/web/lib/registry.tsx:116` (`feedHome`) | `apps/web/lib/feed.ts` (`loadFeed`) → `GET /v1/feed` | `Promise.all` no renderer do home slot | ✓ WIRED | Dados reais: `page.items.map(postCardView…)`; `initialItems` cai para `[]` só quando a carga falha, e `initialError` distingue os dois casos |
| `apps/web/app/(app)/inicio/feed-actions.ts` | `packages/modules/feed/server/routes.ts` | server actions `'use server'` → `apiFetch` | ✓ WIRED | 13 actions exportadas cobrindo listar/curtir/comentar/responder/editar/apagar |
| `apps/api/src/modules/registry.ts` | `@rede-social/module-feed/module` | `MODULE_REGISTRY.feed` + `subscribe()` + `registerJobQueues()` | ✓ WIRED | Único ponto de composição; remover um módulo é uma linha — demonstrado por 04-10 |
| `packages/modules/feed/server/service.ts` (`createPost`) | `feed_link_previews` + fila `FEED_UNFURL_QUEUE` | `upsertLinkPreview` dentro da mesma transação | ✓ WIRED | `on conflict (tenant_id, url_hash) do nothing` com enfileiramento só na linha realmente criada |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `FeedList` / `FeedSurface` | `initialItems`, `cursor` | `loadFeed()` → `GET /v1/feed` (uma statement hidratada) | Sim | ✓ FLOWING |
| `PostDetail` | `post`, `comments.initialItems` | `loadPost()` + `loadPostComments()` | Sim | ✓ FLOWING |
| `LikeButton` / contadores | `like_count`, `comment_count` | Colunas de propriedade de gatilho (`feed_likes_count`, `feed_comments_count`), relidas na mesma transação | Sim | ✓ FLOWING |
| `LinkPreviewCard` | `title`, `description`, `provider`, `hostname` | `feed_link_previews` projetado só em `status='resolved'` | Sim | ✓ FLOWING |
| `LinkPreviewCard` | `imageAssetId` | `feed_link_previews.image_asset_id` | **Não** — sempre nulo em V1 | ⚠️ STATIC (WINDOWS 23) |
| `PostMedia` (vídeo) | `VideoPlayer` | `media_assets` + Mux | Sim, mas só contra o provider `fake` | ⚠️ STATIC (WINDOWS 12/14/15, herança da Fase 3) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Eventos de domínio: enfileira após o commit, entrega uma vez, nada no rollback | `pnpm --filter @rede-social/module-feed exec vitest run tests/events.test.ts` | `Test Files 1 passed · Tests 9 passed` | ✓ PASS |
| Suíte inteira do módulo feed (eventos, guarda SSRF, meta, media, share) | `pnpm --filter @rede-social/module-feed test` | `Test Files 5 passed (5) · Tests 99 passed (99)` | ✓ PASS |
| Resposta a uma resposta recusada pelo banco | `insert … parent_id = <resposta de depth 1>` no Postgres local | `ERROR: violates foreign key constraint "feed_comments_parent_fk"` (23503) | ✓ PASS |
| Mentir sobre a profundidade (`depth = 2`) recusado pelo banco | `insert … depth 2, parent_depth 1` | `ERROR: violates check constraint "feed_comments_parent_shape_chk"` (23514) | ✓ PASS |
| Curtida idempotente arbitrada pelo índice, não por código | `insert … on conflict do nothing` de uma curtida existente | `INSERT 0 0`, contagem antes = depois = 16 | ✓ PASS |
| As 5 tabelas do feed existem e `pg_stat_statements` está carregada | `\dt public.feed_*` + `pg_extension` | 5 tabelas, extensão presente | ✓ PASS |
| O regex do orçamento de queries realmente casa statements vivas (resolve a preocupação de vacuidade do B-WR-06 **neste ambiente**) | `select sum(calls), count(*) from pg_stat_statements where query ~ 'feed_(posts\|post_media\|comments\|likes\|link_previews)'` | `calls = 438`, `stmts = 34` | ✓ PASS |
| Módulo de referência removido do banco | `to_regclass('public.example_items')` + contagem em `tenant_modules` | `NULL` e `0` | ✓ PASS |
| Cobertura de decisões do CONTEXT.md | `gsd_run query check.decision-coverage-verify` | `12/12 honored`, `not_honored: []` | ✓ PASS |

O gate de saída completo (`pnpm verify`, verde, 21m51s, exit 0) é fato de execução fornecido pelo
orquestrador e **não foi reexecutado** — a regra de rodar a suíte completa no máximo uma vez por
verificação foi respeitada.

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| — | — | Nenhum `scripts/*/tests/probe-*.sh` existe neste repositório e nenhum plano/SUMMARY da Fase 4 declara um | ? SKIP (sem probes no projeto) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FEED-01 | 04-04, 04-05, 04-09 | Criar publicação com texto + combinações de mídia, unfurl no servidor, anexos | ✓ SATISFIED | Composer + `POST /v1/feed/posts` + `feed_post_media` com XOR galeria/vídeo declarativo + `AttachmentRow` + `feed-composer.spec.ts` |
| FEED-02 | 04-01, 04-06 | Feed do mais novo ao mais antigo com paginação por cursor | ✓ SATISFIED | Índices keyset `.desc().nullsFirst()`, `over-fetch limit+1`, `decodeCursor` total (cursor adulterado degrada para a página 1) |
| FEED-03 | 04-09 | Editar ("editado") e soft-delete das próprias publicações | ✓ SATISFIED | `edited_at`/`deleted_at` com predicado `author_user_id = ctx.userId`; `PostMenu` + `feed-composer.spec.ts` |
| FEED-04 | 04-03, 04-06 | Curtir/descurtir idempotente com contagem | ✓ SATISFIED | Índices parciais únicos como árbitro (probe executado), contadores de gatilho, `DoubleTapHeart` |
| FEED-05 | 04-03, 04-07 | Comentar e responder, um nível, por constraint de banco | ✓ SATISFIED | FK composto `(parent_id, parent_depth) -> (id, depth)` + CHECK de forma; **ambos os probes recusados pelo Postgres** |
| FEED-06 | 04-03, 04-07 | Curtir/descurtir comentários e respostas | ✓ SATISFIED | `feed_likes.comment_id` + `feed_likes_comment_uq`; rotas `POST/DELETE /v1/feed/comments/{id}/like`; `feed-comments.spec.ts` |
| FEED-07 | 04-08 | Compartilhar com deep link; login e aterrissagem; 404 cross-tenant | ✓ SATISFIED (metade nativa → humano) | `sharePost`, `continue-path.ts`, colapso de not-found; a folha nativa de SO é manual |
| FEED-08 | 04-01 | `author_id` genérico + política de postagem por tenant | ✓ SATISFIED | `author_user_id -> users.id`; `postingPolicy` composta em `permissionsFor()`; teste de integração 7 vira a política sem migração |
| MEDIA-04 | 04-05 | Unfurl no servidor com guarda SSRF, cacheando **title/description/image** | ⚠️ PARTIAL | Guarda SSRF em nível de socket (o conector vê cada hop e cada literal de IP), cache por tenant com `unique(tenant_id, url_hash)`, título/descrição/site_name/provider cacheados; **a imagem nunca é cacheada** (`image_asset_id` nulo por decisão, WINDOWS 23). Ver item 6 de human_verification |
| MOD-03 | 04-01, 04-03 | Eventos de domínio entre módulos | ✓ SATISFIED | 7 eventos tipados, barramento do kernel, flush após handler, 9/9 testes verdes nesta verificação; 04-10 removeu um módulo inteiro sem tocar noutro |
| UI-02 | 04-02, 04-06, 04-07 | Telas portadas para o pacote do módulo, mantendo as interações do protótipo | ✓ SATISFIED (aprovação de design → humano) | As 11 primitivas do protótipo portadas; as 6 superfícies SEM protótipo desenhadas sob o sketch 002, cuja aprovação D-33 está pendente |

**Requisitos órfãos:** nenhum. A união dos `requirements:` dos 10 planos é exatamente
`{FEED-01..08, MEDIA-04, MOD-03, UI-02}`, idêntica ao mapeamento "Phase 4" do `REQUIREMENTS.md`.

### Decision Coverage

Todas as 12 decisões rastreáveis do `04-CONTEXT.md` estão honradas pelos artefatos entregues
(`honored: 12 / total: 12`, `not_honored: []`). Gate não bloqueante, registrado para detectar deriva
ao longo do tempo.

### Anti-Patterns Found

Varredura própria sobre os **152 arquivos de implementação** alterados pela fase
(`git diff --name-only 09185d3^..HEAD`, menos planejamento, lockfile, `reference/` e snapshots do
drizzle-kit):

| Categoria | Ocorrências | Severidade |
|-----------|-------------|-----------|
| Marcadores de dívida (`TBD` / `FIXME` / `XXX`) | **0** | — |
| `TODO` / `HACK` / `PLACEHOLDER` | **0** | — |
| Frases de stub ("not yet implemented", "coming soon", "em construção", "placeholder") | **0** | — |
| Testes desabilitados (`it.skip`, `describe.skip`, `test.todo`, `test.fixme`, `xit`) | **0** | — |

O gate de marcador de dívida está **limpo**: nada nesta fase é inauditável por um marcador pendente.

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|-----------|-----------|--------|---------|----------|-----------------|---------|
| `packages/modules/feed/tests/events.test.ts` | MOD-03 | 9 | 0 | Não | Comportamental (fila → flush → recebido uma vez; nada no rollback) | ✓ Sólido |
| `packages/modules/feed/tests/unfurl-guard.test.ts` | MEDIA-04 | (parte de 99) | 0 | Não — servidores `node:http` locais, sem internet | Valor (recusas por range privado, literal de IP, redirect para privado, teto de corpo) | ✓ Sólido |
| `apps/api/tests/integration/feed-query-budget.test.ts` | FEED-02, crit. 4 | 3 | 0 | Não | Valor, mas com **guarda de direção única** — ver B-WR-06 abaixo | ⚠️ Enfraquecido |
| `supabase/tests/090-feed.sql` | FEED-04/05/06 | 35 asserções | 0 | Não | `throws_ok` com SQLSTATE nomeado + asserções de `EXPLAIN` | ✓ Sólido |
| `apps/web/e2e/feed*.spec.ts` (5 arquivos) | FEED-01..07, UI-02 | 25 testes | 0 | Não | Comportamental de ponta a ponta | ✓ Sólido |

**Testes desabilitados sobre requisitos:** 0 → nenhum blocker.
**Padrões circulares detectados:** 0 → nenhum blocker.
**Asserções insuficientes:** 1 (`feed-query-budget.test.ts`) → ⚠️ WARNING, detalhado abaixo.

### Achados carregados do `04-REVIEW.md` (advisory, não re-derivados)

O code review consolidado rodou imediatamente antes desta verificação sobre 130 arquivos e se declara
**advisory — não bloqueia a conclusão da fase**. Nenhum dos seus três blockers confirmados falsifica
um Success Criterion; todos são registrados aqui para que a conclusão não os absorva em silêncio.

| ID | Arquivo | Achado | Contradiz um SC? | Severidade aqui |
|----|---------|--------|------------------|-----------------|
| A-CR-02 | `packages/modules/feed/ui/PostCaption.tsx:27-33` | O código faz o oposto do seu próprio comentário: trunca e **depois** linkifica, então uma URL cortada vira um `<a href>` real para um domínio registrável DIFERENTE, que muda quando o leitor toca "… mais" — **confirmado à mão nesta verificação**, o comentário "Truncate FIRST, then link" está logo acima da linha que o viola | Não. O `PostCard` portado renderiza e interage como o critério 2 pede; isto é um defeito de correção dentro dele | ⚠️ WARNING alto — em V1 só `admin_tenant` publica, o que limita o alcance; em V2 (postagem de membros) vira primitiva de phishing |
| C-CR-01 | `apps/web/lib/registry.tsx:296-299` | `Promise.allSettled` engole o `redirect()` deliberadamente colocado fora do try/catch de `loadFeed` — o digest `NEXT_REDIRECT` vira `rejected` e o membro fica em `/inicio` lendo "Algo deu errado" em vez de ir para `/entrar` | Não. A janela viva é a corrida entre a chamada de bootstrap e a do feed; `requireBootstrap()` cobre o caso comum | ⚠️ WARNING — correção de uma linha (`unstable_rethrow`) |
| B-CR-01 | `apps/api/tests/integration/media.test.ts:149-172` | `removeTenantMediaObjects` apaga todo objeto sob `<tenant>/media/` sem exclusão, enquanto o delete de linhas ao lado carrega a guarda de 04-04 — só a metade das linhas foi implementada | Não — é infraestrutura de teste, não caminho de produto | ⚠️ WARNING — provável causa-raiz da instabilidade e2e entre specs já registrada em `deferred-items.md` (itens 2, 4, 5) e em WINDOWS 20/21 |
| A-WR-09 | `packages/ui/src/hooks/useInfiniteScroll.ts` | `scrollRoot.current` é resolvido durante o render, onde é sempre `null` na primeira montagem, e mutação de ref não reexecuta o efeito — o observer de produção sai com `root: null` em vez do scrollport da shell; o teste esconde isso passando uma ref pré-preenchida | Não — o critério 2 exige que o scroll infinito funcione, e `feed.spec.ts` prova que funciona em navegador real | ⚠️ WARNING |
| A-WR-08 | `packages/modules/feed/ui/PostMedia.tsx` + `DoubleTapHeart` | Toque duplo numa publicação **já curtida** descurte, animando um coração cheio | Parcialmente — o critério 2 diz "toggle idempotente, incl. toque duplo"; o e2e cobre "curte exatamente uma vez", não o caso já-curtido | ⚠️ WARNING + entra no item 3 de human_verification |
| A-WR-01/02/03 | `packages/modules/feed/server/unfurl/guard.ts` | A deny-list IPv6 omite `ff00::/8`, `2002::/16` (6to4), `2001::/32` (Teredo) e `::/96`; os redirects são ilimitados (`redirect: 'follow'` = 20 hops) onde o `CLAUDE.md` especifica **≤3** | Não — o guarda de nível de socket inspeciona **cada hop**, então redirects ilimitados são preocupação de amplificação/DoS, não de bypass SSRF | ⚠️ WARNING — `maxRedirections: 3` no Agent é uma linha |
| B-WR-06 | `apps/api/tests/integration/feed-query-budget.test.ts` | Os três orçamentos usam `toBeLessThanOrEqual`, então uma medição que pare de casar passa em 0 | Não. **Verificado nesta verificação:** o regex casa 34 formas de statement com 438 chamadas no buffer vivo, e `pg_stat_statements` está carregada — a medição não é vácua neste ambiente. O critério 4 fica ✓ VERIFIED, com a forma da asserção como dívida | ⚠️ WARNING — acrescentar um piso (`toBeGreaterThan(0)`) torna a guarda bidirecional |
| B-WR-11 | `supabase/tests/**` | Nada no pgTAP afirma que a remoção de 04-10 realmente aconteceu | Não — confirmado por probe direto no banco nesta verificação | ℹ️ INFO |
| C-WR-01 | `apps/web/proxy.ts:218-223` | `rede_continue` é escrito sem `secure`, contrariando a política do próprio repositório em `lib/supabase/cookie-options.ts`; `TENANT_SLUG_COOKIE` tem a mesma lacuna | Não | ⚠️ WARNING |

Caminho de fechamento recomendado pelo próprio review: `/gsd-code-review 04 --fix`, e
`/gsd-secure-phase 04` (a fase ainda não tem `SECURITY.md` e `workflow.security_enforcement` está
ligado).

### Higiene do ledger

`WINDOWS.md` linha 9 (`@rede-social/module-example` — "must be deleted with its table and registry entry in
Phase 4") ainda está com `status: open`, embora a remoção tenha sido confirmada em três frentes
nesta verificação (grep do código-fonte, `to_regclass` no banco, `tenant_modules` vazio). É higiene
de registro, não trabalho pendente — a linha deveria ser marcada `fixed` apontando para 04-10.

### Human Verification Required

Seis itens. Nenhum deles é uma falha: cinco estão fora da fronteira da automação de navegador ou
bloqueados na fase de nuvem adiada, e o sexto é uma decisão de produto que não pode ser aprovada em
silêncio.

#### 1. Aprovação de design D-33 / UI-04 do sketch 002

**Test:** Abrir `.planning/sketches/002-phase-04-designed-screens/index.html`, em claro e escuro e
com pelo menos duas marcas de tenant, e percorrer os 5 pontos do `<human-check>` de 04-02.
**Expected:** Resultado registrado no frontmatter do README do sketch (`status`, `approved`,
`approved_by`, `approved_at`, `approval_kind`, `changes_requested`).
**Why human:** É julgamento de design sobre pixels. WINDOWS 19 e 28 — 04-04, 04-05 e 04-09
codificaram contra o desenho por instrução explícita do orquestrador, com a aprovação carregada
para a UAT. Pelo precedente 02-04, uma aprovação provisória do product owner destrava; deltas
posteriores do designer são polimento, não blocker.

#### 2. Folha de compartilhamento nativa em aparelho real

**Test:** iPhone real (Safari) e Android real (Chrome), como membro de `rede-demo`: abrir uma
publicação, tocar compartilhar; enviar o link para si, abrir deslogado.
**Expected:** A folha do SO abre com o link `/post/{id}` no host próprio do tenant; o link aberto
deslogado passa pelo login e aterrissa na publicação.
**Why human:** `navigator.share()` abre superfície de nível de SO. WINDOWS 26. A metade desktop
(copiar + toast) **está** automatizada.

#### 3. Toque duplo e carrossel em hardware real

**Test:** Nos mesmos aparelhos, toque duplo na imagem; depois deslizar a galeria por todos os slides
e voltar. Incluir explicitamente o caso de uma publicação **já curtida** (achado A-WR-08).
**Expected:** O coração anima e a contagem sobe exatamente um, nunca dois; os pontos acompanham.
**Why human:** O Playwright despacha os eventos mas não prova o gesto sob um digitalizador real.

#### 4. Transcodificação Mux real e HLS em aparelho

**Test:** Publicar do celular uma publicação com vídeo e acompanhar o cartão até a reprodução.
**Expected:** Estado de processamento, depois reprodução.
**Why human:** **Registrar como BLOQUEADO, nunca como aprovado.** Nenhuma conta Mux existe; o
provider `fake` é o único que já rodou. Herança da Fase 3 (WINDOWS 12/14/15), fechada pelo runbook
da Fase 01.1 em `docs/DEPLOY.md`.

#### 5. Abreviação de contagem acima de 999 em pixels

**Test:** Renderizar a linha de meta com `like_count > 999` num viewport de 320px.
**Expected:** A abreviação cabe sem estourar a linha.
**Why human:** WINDOWS 24 — `090-feed.sql` reconcilia `like_count` contra as linhas vivas de
`feed_likes`, então o seed não produz quatro dígitos sem 1000+ usuários em `auth.users`. A
abreviação está fixada como string por `meta.test.ts`, nunca como pixels.

#### 6. Decisão de produto: MEDIA-04 sem imagem em cache

**Test:** Decidir se V1 sai sem miniatura de prévia de link.
**Expected:** Ou aceitar o desvio registrando um `override` neste frontmatter, ou abrir trabalho de
acompanhamento para copiar a miniatura remota para o Storage.
**Why human:** MEDIA-04 pede `title/description/image` em cache; os dois primeiros estão, a imagem
não. É estreitamento deliberado e registrado (WINDOWS 23) com razão declarada — não injetar bytes
remotos numa página de marca —, mas exige decisão humana. Efeito colateral: o cartão YouTube/Vimeo
sai só com texto, sem a miniatura nem o selo de play que o próprio UI-D-12 especificou.

**Se este desvio for intencional**, acrescente ao frontmatter deste arquivo:

```yaml
overrides:
  - must_have: "MEDIA-04 — link unfurling caches title/description/image on the post"
    reason: "image_asset_id fica nulo em V1 por decisão (WINDOWS 23): copiar a miniatura remota para o Storage é o trabalho que a preencheria, e hot-linkar um host remoto numa página de marca foi recusado. Título, descrição, site_name e provider são cacheados."
    accepted_by: "{seu nome}"
    accepted_at: "{timestamp ISO}"
```

### Sobre a leitura adversarial dos quatro critérios

O orquestrador pediu ceticismo explícito em cinco pontos. As conclusões honestas:

1. **"Unfurled server-side at create time" (crit. 1).** Dentro da transação de `createPost` o
   candidato é escolhido, validado pela política SSRF, a linha de cache é criada e o job é
   enfileirado — e um rollback leva o job junto. O fetch de saída roda no worker, e a resposta de
   criação carrega prévia nula (`toLinkPreview` projeta só em `status='resolved'`). **Veredito:
   satisfeito**, não parcial: o unfurl é do servidor, é iniciado no momento da criação, e a
   alternativa — um fetch de saída para um host que uma legenda nomeou, dentro de uma request do
   Cloud Run — é justamente o que a arquitetura do projeto proíbe.
2. **"YouTube/Vimeo embed" (crit. 1).** O ramo oEmbed **existe e roda** (`unfurlOembed`,
   `providerFor` casando por sufixo de domínio registrável, `provider` e `provider_video_id`
   persistidos). O que não existe é iframe — UI-D-12 decidiu "no iframe ships in this phase" com
   razão declarada (nenhuma CSP em `apps/web` hoje), e **o próprio ROADMAP nomeia a entrega como
   "the no-iframe preview card"** na lista de planos da Fase 4. O critério diz "a link preview **or**
   YouTube/Vimeo embed": a metade da prévia de link está entregue. **Veredito: critério 1 satisfeito**;
   o estreitamento real é da imagem em cache, cobrado contra MEDIA-04 (item 6 acima), não contra o SC.
3. **"Prototype's ported PostCard / CommentSheet" (crit. 2).** Verificado à mão: `PostCard`,
   `PostHeader`, `PostCaption`, `PostActions`, `LikeButton`, `PostImage`, `InfiniteScroll`,
   `CommentSheet`, `CommentsList`, `CommentItem` e `CommentInput` **existem todos** em
   `reference/frontend-design/components/{feed,comments}/` e são portas reais. As seis superfícies do
   sketch 002 são `/criar`, `/post/[id]/editar`, o FAB + CTA desktop, o `LinkPreviewCard`, o
   `AttachmentRow` e o menu "…" — **nenhuma delas é o PostCard ou o CommentSheet**. A aprovação
   pendente atinge o critério 1 e UI-02, não a cláusula de portabilidade do critério 2.
4. **"Bounded query count checked in CI" (crit. 4).** O teste roda no CI por
   `pnpm test:integration` (`ci.yml:94`), e a fraqueza do B-WR-06 é real — `toBeLessThanOrEqual`
   sozinho passa em 0. Mas medi o aparato diretamente: o regex casa 34 formas de statement com 438
   chamadas no buffer vivo e a extensão está carregada, então a medição não é vácua hoje.
   **Veredito: verificado**, com a forma da asserção registrada como dívida (falta o piso).
5. **"Per-tenant posting policy" (crit. 4).** Existe de verdade e não é só o `author_user_id`
   genérico: `feedSettingsSchema.postingPolicy` (`'admins_only' | 'members' | …`) é lida em
   `permissionsFor()` com `safeParse` que cai para o valor seguro, alimenta ao mesmo tempo o guarda
   de rota (`requirePermission('feed.post.create')`) e o array `permissions` do bootstrap — então a
   visibilidade do composer nunca discorda do que a API permite —, e o teste de integração 7 vira o
   valor com `update tenant_modules set settings = settings || '{"postingPolicy":"members"}'` e vê o
   MESMO membro virar autor. **Veredito: verificado**, é de fato um flip de permissão.

### Gaps Summary

**Nenhum gap bloqueia o goal da fase.** As quatro verdades observáveis do ROADMAP estão verificadas
contra o código, contra o banco local e contra testes executados nesta verificação — não contra as
afirmações dos SUMMARYs. Os 11 IDs de requisito estão contabilizados, sem órfãos; 10 estão
satisfeitos e MEDIA-04 está parcial por um estreitamento deliberado e registrado.

O que impede o status `passed` é exclusivamente a fila de verificação humana: a aprovação de design
D-33 do sketch 002 (contra a qual três planos codificaram por decisão registrada), a folha nativa de
compartilhamento e os gestos em hardware real, a transcodificação Mux real bloqueada na fase de nuvem
adiada, a abreviação acima de 999 em pixels, e a decisão de produto sobre a imagem de prévia não
cacheada.

Os nove achados carregados do `04-REVIEW.md` são warnings, não blockers: nenhum falsifica um Success
Criterion, e o próprio review se declara advisory. Dois deles merecem atenção antes da Fase 5 porque
as convenções desta fase são copiadas pelos módulos seguintes: **A-CR-02** (a legenda truncada
produz um `href` para outro domínio — hoje limitado porque só o admin publica, amanhã uma primitiva
de phishing quando membros postarem) e **B-CR-01** (a varredura de objetos do `media.test.ts`, causa
provável da instabilidade e2e entre specs já registrada três vezes em `deferred-items.md`).

---

_Verified: 2026-09-23T05:45:05Z_
_Verifier: Claude (gsd-verifier)_

---

## Refresh de digest — 2026-09-23

Esta verificação ficou `stale` **durante** o `/gsd-verify-work 04` que a consumiu, não por deriva de
uma mudança não verificada. O passo `verify:post → validate-phase` do mesmo workflow tocou um
arquivo coberto, o que por construção invalida o `covered_digest`.

**Exatamente dois arquivos não-planning mudaram** entre o commit desta verificação (`6cb87a6`) e o
refresh, medidos com `git diff --name-only 6cb87a6..HEAD`:

| Arquivo | Em `covered_files` antes? | Mudança | Por quê |
|---------|---------------------------|---------|---------|
| `apps/api/tests/integration/feed-query-budget.test.ts` | Sim — **é o que tornou o digest stale** | Piso `toBeGreaterThan(0)` ao lado de cada teto existente, nos três orçamentos | Fecha B-WR-06, a dívida que **esta própria verificação** registrou na Test Quality Audit ao marcar `feed-query-budget.test.ts` como ⚠️ Enfraquecido |
| `supabase/tests/100-module-example-removal.sql` | Não — novo | Arquivo novo, 4 asserções | Fecha B-WR-11, também registrado aqui: nada no pgTAP afirmava que a remoção de 04-10 tinha acontecido. **Acrescentado a `covered_files` neste refresh** |

**Nenhuma conclusão desta verificação cai.** As duas mudanças são só de teste — nenhum arquivo de
implementação foi tocado — e ambas *endurecem* asserções que esta verificação já havia examinado e
explicitamente registrado como dívida. O critério 4 de FEED-02 estava `✓ VERIFIED, com a forma da
asserção como dívida`; a dívida agora está paga. O veredito de 4/4 must-haves e o mapeamento dos 11
requisitos permanecem como escritos, com MEDIA-04 em PARTIAL sob o `override` registrado no
frontmatter.

**Decidido pelo product owner** (Igor Vilas Boas) em 2026-09-23, apresentado com os dois arquivos
nomeados e a alternativa de re-rodar o `gsd-verifier` inteiro oferecida e recusada.

- digest anterior: `v1:sha256:21cc3f60…fa5e8c` (154 arquivos menos o pgTAP novo)
- digest novo: `v1:sha256:2e35801f…608338` (154 arquivos), via `gsd-tools query verification fingerprint .planning/phases/04-feed <arquivos>`
- nota: a primeira tentativa de refresh omitiu o argumento de phase-dir, então o CLI consumiu
  `.planning/REQUIREMENTS.md` como phase dir e produziu um digest sobre 153 arquivos
  (`f565d0c1…`). Pego e corrigido antes do commit final, conferindo o CLI contra
  `computeCoveredDigest` diretamente — os dois agora concordam
- `status`: `human_needed` → `passed` — os 5 itens de verificação humana foram respondidos em
  `04-UAT.md`; o sexto continua `blocked` na Fase 01.1 (Mux), sem conta provisionada
