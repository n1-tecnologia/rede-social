---
sketch: 005-phase-05.3-designed-screens
name: phase-05.3-designed-screens
phase: 05.3
question: "As seis superfícies de Reels que o protótipo e o print não desenham — a fileira de trilhas com \"Todos\" e as comunidades (incluindo a fileira que transborda e a fileira escondida), o trilho com o botão de compartilhar, a legenda recolhida com \"… mais\" e expandida sobre o véu mais escuro, os estados pausado e de autoplay bloqueado, o vazio e os erros, e a coluna 9:16 do desktop com os botões ↑/↓ — lêem como a própria linguagem do protótipo, sobre vídeo, no celular e no desktop, sob qualquer marca de tenant?"
screens:
  - trilhas-todos-e-duas-comunidades
  - trilhas-transbordando-60-caracteres-320px
  - trilhas-escondidas-uma-trilha-so
  - trilho-contagens-compactas
  - trilho-curtido-quadro-claro
  - trilho-zero-curtidas-autor-sem-foto
  - legenda-recolhida-mais-quadro-claro
  - legenda-expandida-veu-320px
  - legenda-sem-comunidade
  - legenda-vazia
  - pausado
  - autoplay-bloqueado-paisagem-contain
  - carregando-buffering
  - vazio-membro
  - vazio-autor
  - vazio-autor-segunda-marca
  - erro-ao-carregar-a-lista
  - erro-de-um-video-320px
  - toast-proxima-pagina
  - desktop-coluna-populada
  - desktop-vazio-autor

status: approved
approved: true
approved_by: Igor Vilas Boas
approved_at: 2026-09-26
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-05.3, design-review, D-33, UI-04, reels]
---

# Sketch 005: Fase 05.3 — Reels (portão de revisão D-33)

## Design Question

A Fase 05.3 cria a aba **Reels**: as publicações de vídeo prontas do tenant, em tela cheia, num
pager vertical — deslizar para cima/baixo troca o vídeo, para os lados troca a trilha, começa mudo,
um trilho à direita com avatar, curtir, comentar e compartilhar, e o autor, o chip da comunidade e a
legenda embaixo. Reels é uma **vista sobre o feed**: cada página é uma publicação que já existe.

O print do time de design (`.planning/phases/05.3-reels/reels-design.png`) e a página do protótipo
cobrem o pager, os véus, o avatar/curtir/comentar do trilho, o botão de som, os ticks da direita e a
BottomNav flutuante. **Não cobrem** as seis superfícies abaixo, que `05.3-UI-SPEC.md` manda desenhar
e revisar antes de codar (Phase 2 **D-33**, **UI-04**):

1. **A fileira de trilhas** com "Todos" e as comunidades — a que cabe, a que transborda (sete
   trilhas, um nome de 60 caracteres, 320px) e a escondida (uma trilha só).
2. **O trilho com o botão de compartilhar** acrescentado por último.
3. **A legenda** recolhida com "… mais" e expandida sobre o véu mais escuro.
4. **O estado pausado e o de autoplay bloqueado.**
5. **O vazio e os erros** (lista, um vídeo, próxima página).
6. **A coluna 9:16 do desktop** com os botões ↑/↓ ao lado.

A pergunta de design: estas seis superfícies lêem como a linguagem que vocês já assinaram — os
alvos de 44px, a escala 12/14/16/24 com pesos 400/700, texto branco sobre os véus do visualizador de
stories, e **uma** cor de destaque que é a do tenant e que fica fora do vídeo — no celular e no
desktop, sob qualquer marca?

## How to View

```
open .planning/sketches/005-phase-05.3-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota, sem quadro incorporado e sem vídeo real: os vídeos são gradientes que simulam o
conteúdo. O arquivo abre offline e pode ser enviado por e-mail como está. Manrope renderiza se
estiver instalada na máquina; sem ela o fallback do sistema renderiza com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna o tema do membro. **O palco de Reels é sempre escuro**
  (UI-D-98); o tema só muda a página, o DesktopRail e o toast, que ficam fora do escopo escuro.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde, Vermelho)
  — escrevem as cinco variáveis `--brand-*` como `brandStyleVars()` faz no servidor, incluindo o par
  escuro. O quadro C da Superfície 5 fica fixo numa **segunda marca** (roxo) para comparar lado a lado.
- Os links de seção pulam para cada uma das seis superfícies. As abas de trilha e o botão de som
  respondem a clique.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`, incluindo o `--theme-glass-bar`
escuro da BottomNav sobre o vídeo. **A Fase 05.3 não acrescenta nenhum token, nenhuma medida de
espaçamento, nenhum tamanho de tipo e nenhum peso** — sobre o vídeo só entram `black`/`white` com
alfa. Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta.

## What is being asked of the design team

Seis mensagens, além da revisão visual. Cada uma termina numa pergunta.

### 1. As trilhas são comunidades, com "Todos" primeiro (D-117, D-118)

O print tem três abas: uma de recomendação e duas de tag. Aqui as trilhas passam a ser **"Todos"**
(todos os vídeos que Reels pode mostrar) seguido de **uma trilha por comunidade** ativa com pelo
menos um vídeo pronto, na ordem da lista de Comunidades (D-119). O rótulo de recomendação do print
**não é usado**: ele prometeria uma personalização que não existe. Tags pediriam um campo novo no
composer e uma lista de tags por tenant. O chip "Energia de Rainha" do print já é uma comunidade —
por isso chip e trilha vêm da mesma fonte. Com uma trilha só, a fileira some (D-120).

**A decidir:** a fileira de sete trilhas em 320px (Superfície 1, quadro B), rolando e truncando o
nome longo em 160px, ainda lê como a fileira do print? A fileira escondida (quadro C), só com o som
no canto, parece intencional ou parece que faltou algo?

### 2. "Compartilhar" entra por último no trilho (D-130)

O print tem avatar, curtir e comentar. O trilho ganha o **compartilhar do feed** (`Send`), **abaixo
de comentar e sem contagem** — o mesmo compartilhar do card. A contagem zero não desenha nada, mas a
vaga de 20px fica, para o trilho não pular na primeira curtida.

**A decidir:** quatro itens empilhados (Superfície 2) ainda têm o peso do print? O compartilhar sem
número lê como uma ação, ou parece que falta a contagem?

### 3. A legenda expande sobre um véu mais escuro, sem pausar (D-131)

Recolhida: duas linhas e **"… mais"** sobre um fade. Expandida: a legenda rola dentro de uma caixa de
até 40vh, aparece **"menos"**, e um véu `bg-black/50` cobre o vídeo inteiro por baixo dos overlays —
**o vídeo continua tocando**.

**A decidir:** o véu de 50% (Superfície 3, quadro B) escurece o suficiente para ler sem parecer um
modal? Continuar tocando por baixo do véu é o comportamento certo?

### 4. Um selo só para pausado e para autoplay bloqueado (UI-D-86)

O mesmo selo de 56px com `Play`, seja a pausa de quem assiste, seja o navegador que não deixou tocar
sozinho (Modo Pouca Energia). Quem assiste nunca precisa diagnosticar a causa.

**A decidir:** um selo idêntico para as duas causas (Superfície 4, quadros A e B) está bom, ou o
bloqueio pede uma dica diferente?

### 5. A coluna 9:16 do desktop, com ↑/↓ fora dela (D-132)

No desktop, o DesktopRail fica, o palco é preto e o vídeo é uma coluna 9:16 centrada; tudo dentro da
coluna é o desenho do celular. Os botões **↑/↓** ficam **fora** da borda direita, a 24px.

**A decidir:** os ↑/↓ fora da coluna (Superfície 6, quadro A) são achados de relance? Eles deveriam
ficar dentro da coluna, junto do trilho?

### 6. Legibilidade sobre um quadro claro (UI Considerations E06, backstop)

Vídeo real às vezes é céu, parede branca, praia. Os quadros "claros" (Superfície 1 quadro B,
Superfície 2 quadro B, Superfície 3 quadros A e B) colocam as trilhas inativas em `white/70`, a
legenda e as contagens sobre um céu pálido, só com os véus do topo e da base e a sombra de texto.

**A decidir:** tudo continua legível? Se não, o que escurece: o véu, a sombra ou o `white/70`?
(Isto é julgado de novo no aparelho, na UAT de telefone.)

## Decisions already fixed upstream

Já decididas em `05.3-CONTEXT.md` e `05.3-UI-SPEC.md` e **fora de revisão**. Estão listadas para
que o desenho seja lido com elas em mente, não para serem re-litigadas:

- **D-117..D-120** — trilhas por comunidade, "Todos" primeiro, só comunidades ativas com vídeo
  pronto na ordem de Comunidades, fileira escondida com uma trilha só (mensagem 1).
- **D-121 / D-122** — Reels é um módulo próprio (`reels`), ligado por padrão, e depende de `feed`.
- **D-123** — a aba se chama "Reels", ícone de filme, entre Comunidades e Eventos; fica mesmo sem
  vídeos (e mostra o vazio).
- **D-124** — um vídeo do feed não ganha caminho para Reels; nada no player do card muda.
- **D-125** — o vídeo repete até quem assiste deslizar; Reels nunca avança sozinho.
- **D-126** — começa mudo em toda visita; ligado, o som fica ligado até sair de Reels.
- **D-127 / D-128** — toque simples pausa e retoma; toque duplo curte (nunca descurte). A janela do
  toque duplo é a de **300 ms**, lida do `DoubleTapHeart` já entregue (`DOUBLE_TAP_WINDOW_MS`), e não
  os ~250 ms citados em D-128: o produto fica com uma janela só.
- **D-129** — avatar e nome abrem o perfil; o chip abre a comunidade; sem comunidade, sem chip.
- **D-130..D-132** — mensagens 2, 3 e 5 acima (o que se pede é a leitura visual).
- **UI-D-81..UI-D-99** — as decisões visuais de `05.3-UI-SPEC.md`: media chrome sem TopBar e
  BottomNav escura (UI-D-81), palco e pager (UI-D-82), encaixe por proporção (UI-D-83), trilhas
  (UI-D-84), som (UI-D-85), toque, pausa e bloqueio (UI-D-86), trilho (UI-D-87), legenda (UI-D-88),
  ticks em janela de 7 (UI-D-89), folha de comentários (UI-D-90), compartilhar (UI-D-91), carregando
  e paginação (UI-D-92), erros (UI-D-93), vazio (UI-D-94), coluna do desktop (UI-D-95), a aba
  (UI-D-96), acessibilidade (UI-D-97), tema do palco (UI-D-98) e vocabulário (UI-D-99).

## How to review

1. Abra `index.html` no navegador e compare com `.planning/phases/05.3-reels/reels-design.png`.
2. **Troque as marcas** (pelo menos duas) e o tema: sobre o vídeo nada muda de cor; só a aba ativa
   da BottomNav, a linha ativa do DesktopRail e o botão "Criar publicação" recolorem.
3. **Linguagem** — as seis superfícies lêem como o print e o protótipo? Algo lê como "outro design
   system"?
4. **As seis mensagens acima** — responda as seis perguntas "A decidir".
5. **Texto** — cada string vem verbatim do §Copywriting Contract de `05.3-UI-SPEC.md`. Sinalize
   qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/reels.json` (ou no `feed.json`,
   para as chaves reusadas).

Fora do escopo desta revisão: o pager, os véus, o avatar/curtir/comentar do trilho, o botão de som,
os ticks e a BottomNav flutuante — todos `[proto]/[print]`, portados sem redesenho. Aparecem aqui
como contexto ao redor das peças revisadas. A folha de comentários é a do feed, sem mudança.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **toda tarefa que coda uma superfície de Reels sem protótipo fica bloqueada** —
plano 05 Tarefas 1-2, plano 06 Tarefas 1-2, plano 07 Tarefa 1 e plano 08 Tarefas 1-2 — cada uma
carregando um `precondition` que afirma `^approved: true` neste arquivo e que para enquanto ele
disser `false`. A revisão pode acontecer enquanto a API da onda 1 está sendo construída.

**O registro é uma edição do usuário, não do agente.** Para aprovar, cole no frontmatter deste
arquivo, substituindo os valores pendentes:

- `status: approved`
- `approved: true`
- `approved_by: <seu nome>`
- `approved_at: <AAAA-MM-DD>`
- `approval_kind: provisional`

(Estas linhas ficam aqui como lista de propósito: o portão dos planos 05-08 procura `approved: true`
no início de uma linha, e só a linha do frontmatter pode satisfazê-lo.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e `status:
changes-requested`); o desenho é revisado e a revisão se repete. Cada item vira uma seção "Design
review deltas" em `05.3-UI-SPEC.md`.

Seguindo o precedente dos sketches 001-004, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 005 em `../MANIFEST.md` só é atualizada se você pedir.
