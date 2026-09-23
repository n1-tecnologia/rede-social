---
sketch: 002-phase-04-designed-screens
name: phase-04-designed-screens
phase: 4
question: "As seis superfícies da Fase 4 que o protótipo não cobre — o composer, a tela de edição, o FAB e o CTA desktop, o cartão de prévia de link, a linha de anexo e o menu '…' da publicação — lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant?"
screens:
  - criar
  - criar-preenchido
  - criar-video
  - criar-desktop
  - editar
  - entrada-fab-e-cta-desktop
  - link-preview-card
  - attachment-row
  - menu-da-publicacao-e-confirmacoes
status: approved
approved: true
approved_by: Igor Vilas Boas (product owner)
approved_at: 2026-09-23
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-04, design-review, D-33, UI-04, composer, feed]
---

# Sketch 002: Fase 4 — telas [designed] (portão de revisão D-33)

## Design Question

`reference/frontend-design/` cobre o cartão de publicação, a lista de comentários e as primitivas.
**Não cobre** o composer nem nada ao redor dele. As seis superfícies marcadas `[designed]` em
`04-UI-SPEC.md` estão desenhadas aqui num único arquivo HTML estático para que o time de design as
aprove **antes de serem codadas** (UI-04, D-33): `/criar`, `/post/[id]/editar`, o FAB do celular e o
CTA equivalente no desktop, o `LinkPreviewCard`, o `AttachmentRow` e o menu "…" da publicação com
suas três confirmações.

Aprovado este pacote, os planos 04-04 (linha de anexo), 04-05 (cartão de prévia) e 04-09 (composer,
edição, FAB, menu) codam contra um desenho, não contra prosa.

## How to View

```
open .planning/sketches/002-phase-04-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota e —
diferente do sketch 001 — **sem webfont remota**: o arquivo pode ser aberto offline e enviado por
e-mail como está. Manrope renderiza se estiver instalada na máquina (`@font-face` com `local()`);
sem ela o fallback do sistema renderiza com as mesmas medidas de tipo. A revisão aqui é de layout,
cor, hierarquia e texto — não de renderização de webfont.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`, exatamente como o cookie
  `tria_theme` faz no app.
- **Cor primária / Cor secundária** e os presets — escrevem as cinco variáveis `--brand-*` do jeito
  que `brandStyleVars()` escreve no servidor, incluindo a derivação do par escuro e do texto
  sobre a cor primária. O readout à direita mostra os quatro valores derivados.
- Os links de seção pulam para cada tela.

Todos os valores de cor vêm copiados de `packages/ui/src/styles/tokens.css`, incluindo o único token
novo da fase, `--color-like: #ef4444`.

## What is being asked of the design team

Duas mensagens, além da revisão visual:

1. **PROTOTYPE.md open question 2 está respondida: "drop titles and type chips" (D-51).** O segundo
   modelo do protótipo — `CommunityTopic`, com `title` e a pílula Discussão / Trend / Exclusivo /
   Vídeo — **não é portado**. Existe **um** modelo de publicação (autor, legenda, mídia, comunidade
   opcional) e **um** `PostCard` que o renderiza no feed, na página da publicação e, na Fase 5,
   dentro de uma comunidade. Consequências que aparecem nos desenhos: o composer não tem campo de
   título, o cartão não tem pílula de tipo, e o maior tipo dentro de um cartão passa a ser a legenda
   de 16px. Se o time de design discordar, é aqui que isso precisa voltar — reverter depois custa
   uma coluna nova, um ramo no cartão e um vocabulário de chips por tenant.
2. **PROTOTYPE.md open question 3 — os designs do composer — é exatamente o que este pacote está
   pedindo para revisar.** Não existe desenho do time para `/criar`; o que está aqui foi desenhado a
   partir de `04-UI-SPEC.md` na linguagem do protótipo. Qualquer delta do time entra em
   `changes_requested` neste README e vira uma seção "Design review deltas" no UI-SPEC.

## Decisions already fixed upstream

Estas já foram decididas em `04-CONTEXT.md` / `04-UI-SPEC.md` e **não estão em revisão** — estão
listadas para que o desenho seja lido com elas em mente:

- **D-51** — sem título e sem pílula de tipo na publicação (ver acima).
- **D-53** — uma publicação leva **fotos ou um vídeo, nunca os dois**, mais opcionalmente uma prévia
  de link e anexos. Daí o segundo seletor desabilitado com a linha "Uma publicação leva fotos ou um
  vídeo — não os dois.".
- **D-57** — o composer é uma **rota de tela cheia** (`/criar`, `/post/[id]/editar`), nunca um bottom
  sheet: escolher várias fotos, esperar um upload e anexar um PDF não cabem numa camada que o admin
  descarta sem querer.
- **UI-D-11** — **não existe cartão de prévia pendente e não existe esqueleto de prévia**. Enquanto a
  prévia não resolve, a publicação mostra a URL crua auto-linkada dentro da legenda. No composer o
  admin vê uma linha inerte "Prévia do link" só para saber que o link foi reconhecido e para ter o
  "Remover prévia".
- **UI-D-12** — YouTube e Vimeo usam o **mesmo cartão**, com miniatura e selo de play de 56px, e
  abrem externamente. Nenhum quadro de terceiros é embutido nesta fase.
- **UI-D-17** — **não há FAB no desktop**. O "Criar publicação" é um `Button variant="brand"` na
  linha de cabeçalho do widget do feed.
- **UI-D-08** — o coração curtido usa o token novo `--color-like`, que **não** é a cor da marca (um
  coração roxo ou verde perde uma affordance lida universalmente) e **não** é `--color-danger`.
- **UI-D-07** — todo controle só-ícone é 44×44, acima dos 36px do protótipo.

## How to review

1. **Linguagem** — `/criar` e `/post/[id]/editar` lêem como o protótipo? Ground `#f5f7fb` com cards
   brancos, raios de 12px, alvos de 44px, a mesma escala de tipo de 12/14/16/24. Algo lê como "outro
   design system"?
2. **Âncora visual** — em cada tela do composer o único preenchimento com a marca é o botão fixo do
   cabeçalho ("Publicar" / "Salvar alterações"); a barra de progresso de 4px é o segundo uso. O olho
   cai onde deveria?
3. **FAB e CTA** — o FAB de 56px passa longe da BottomNav flutuante e nunca encosta no título de
   boas-vindas? No desktop, a ausência de controle flutuante incomoda? E o feed vazio do admin, onde
   o CTA está na tela e o FAB some?
4. **Prévia do link** — os quatro estados (com imagem, só corpo, só título, YouTube/Vimeo) são
   distinguíveis entre si e nenhum deles é um quadro vazio? A variante de vídeo lê como "abre fora",
   não como um player embutido?
5. **Anexo** — com um nome de 90 caracteres a linha ainda mostra a linha de tipo/tamanho e o
   controle de download? O estado pendente (spinner no lugar do glifo) é suficiente como feedback?
6. **Escuro e marca** — troque o tema e passe pelos quatro presets de marca: tudo que é da marca
   recolore e cards, bordas, contagens e texto de corpo continuam neutros?
7. **Texto** — cada string vem verbatim do Copywriting Contract de `04-UI-SPEC.md`. Sinalize qualquer
   palavra a mudar; ela cai em `apps/web/messages/pt-BR/feed.json`.

Fora do escopo desta revisão: o cartão de publicação, a folha de comentários e a lista de
comentários — todos `[proto]`, portados do protótipo sem redesenho. Aparecem aqui apenas como
contexto ao redor das peças que estão sendo revisadas.

## Review outcome

**Aprovado provisoriamente pelo product owner em 2026-09-23** (`/gsd-verify-work 4`, teste 1 de
`04-UAT.md`). Nenhuma mudança pedida — `changes_requested: []`, e por isso nenhuma seção "Design
review deltas" foi acrescentada a `04-UI-SPEC.md`.

Resposta verbatim do product owner ao checkpoint:

> pass

Seguindo o precedente de 02-04, **uma aprovação provisória do product owner já desbloqueia a
codificação**; deltas posteriores do designer são um passe de polimento, não um bloqueio. As seis
telas já foram codificadas contra este desenho em 04-04, 04-05 e 04-09 por decisão explícita do
orquestrador, com a aprovação carregada para este portão.
