---
status: testing
phase: 04-feed
source: [04-VERIFICATION.md]
started: 2026-09-23T06:10:00Z
updated: 2026-09-23T06:10:00Z
---

## Current Test

number: 1
name: Portão de design D-33 / UI-04 — aprovar o sketch 002
expected: |
  Aprovação (ou aprovação provisória do product owner, precedente 02-04) registrada no
  frontmatter do README do sketch: `status`, `approved`, `approved_by`, `approved_at`,
  `approval_kind`, `changes_requested`.
awaiting: user response

## Tests

### 1. Portão de design D-33 / UI-04 — aprovar o sketch 002
expected: Abrir `.planning/sketches/002-phase-04-designed-screens/index.html` no navegador, em claro e escuro e com pelo menos duas marcas de tenant, e percorrer os 5 pontos do `<human-check>` do 04-02 (linguagem do protótipo em `/criar` e `/post/[id]/editar`; FAB móvel x botão de cabeçalho no desktop; os quatro estados do cartão de prévia, com a variante YouTube/Vimeo lendo como "abre externamente"; a linha de anexo com nome de 90 caracteres; as duas mensagens para o time de design no README). Aprovação registrada no frontmatter do README.
why_human: Portão D-33 / UI-04 — é julgamento de design sobre pixels, não asserção programável. WINDOWS 19 e 28. Os planos 04-04, 04-05 e 04-09 codificaram essas seis telas contra o desenho por decisão explícita do orquestrador, com a aprovação carregada para cá.
result: [pending]

### 2. Folha de compartilhamento nativa do SO em aparelho real
expected: Num iPhone real (Safari) e num Android real (Chrome), autenticado como membro de `tria-demo`, abrir uma publicação e tocar o controle de compartilhar; a folha do SO abre carregando o link `/post/{id}` no host próprio do tenant. Enviar o link para si mesmo, abri-lo deslogado, e confirmar o retorno à publicação depois do login.
why_human: `navigator.share()` abre uma superfície de nível de SO em que o Playwright não entra (WINDOWS 26). A metade desktop — copiar link e toast — ESTÁ automatizada em `apps/web/e2e/feed-share.spec.ts` e passa.
result: [pending]

### 3. Toque duplo e swipe da galeria em hardware real
expected: Nos mesmos aparelhos, dar um toque duplo na imagem de uma publicação: o coração anima e a contagem sobe exatamente um, nunca dois. Deslizar a galeria por todos os slides e voltar: os pontos do carrossel acompanham o slide ativo.
why_human: O Playwright despacha os eventos mas não prova como gesto e animação se comportam sob um digitalizador de toque real.
note: O code review encontrou A-WR-08 — hoje o toque duplo numa publicação JÁ curtida a DESCURTE, animando um coração cheio. Vale testar justamente esse caso.
result: [pending]

### 4. Publicar vídeo do celular e acompanhar até a reprodução
expected: O cartão mostra o estado de processamento e depois reproduz.
why_human: Transcodificação real e HLS em aparelho real dependem da Fase 01.1, que está adiada.
result: blocked
blocked_by: third-party
reason: "Nenhuma conta Mux existe — docs/DEPLOY.md:205 registra o runbook de provisionamento da Fase 01.1 como NOT DONE, e o provider `fake` é a única implementação que já rodou. Herança da Fase 3 (WINDOWS 12/14/15), onde os mesmos testes já estão bloqueados."

### 5. Abreviação de contagem acima de 999 em viewport de 320px
expected: A abreviação (ex.: `1,2 mil`) cabe na linha de meta sem estourar, num viewport de 320px.
why_human: WINDOWS 24 — `supabase/tests/090-feed.sql` reconcilia `like_count` contra as linhas vivas de `feed_likes`, que são únicas por `(user_id, post_id)` com `user_id -> auth.users`. O seed não consegue produzir contagem de quatro dígitos sem 1000+ usuários. A abreviação está fixada como STRING por `packages/modules/feed/tests/meta.test.ts`, nunca como pixels.
result: [pending]

### 6. Decisão de produto — o cartão de prévia de link nunca guarda imagem
expected: Decidir entre (a) aceitar o desvio, registrando um `override` no frontmatter do `04-VERIFICATION.md`, ou (b) abrir trabalho de acompanhamento para copiar a miniatura remota para o Storage.
why_human: MEDIA-04 pede `title/description/image` em cache. Título, descrição, site_name e provider estão em cache; a imagem não — `feed_link_previews.image_asset_id` é nulo por decisão em V1 (WINDOWS 23), então o cartão sai só com texto e a variante YouTube/Vimeo não exibe miniatura nem o selo de play que o próprio UI-D-12 especificou. É estreitamento deliberado e registrado, não defeito — mas o verificador se recusou a absorvê-lo no score sem decisão humana, e essa recusa está certa.
context: A coluna, o FK e o ramo de render em `LinkPreviewCard.tsx:83` existem e estão ligados; nenhuma linha jamais os preenche. Artefato classificado ⚠️ HOLLOW. MEDIA-04 é o único dos 11 requisitos da fase marcado PARTIAL — os outros 10 estão SATISFIED.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 1

## Gaps
