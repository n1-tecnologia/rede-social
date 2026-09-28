---
sketch: 003-phase-05-designed-screens
name: phase-05-designed-screens
phase: 5
question: "As cinco superfícies da Fase 5 que o protótipo não cobre — a régua de stories, o visualizador de story, o fluxo de publicar um story, o formulário de criar/editar/arquivar uma comunidade e o fluxo de fixar um story numa comunidade — lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant?"
screens:
  - inicio-regua-de-stories
  - regua-vazia-e-carregando
  - destaques-da-comunidade
  - visualizador-de-story
  - visualizador-zonas-de-toque
  - visualizador-autoplay-bloqueado-e-erro
  - visualizador-25-segmentos-320px
  - stories-publicar-pre-escolha
  - stories-publicar-pos-escolha
  - comunidades-nova
  - comunidades-editar-e-arquivar
  - comunidade-arquivada
  - stories-meus
  - pin-story-sheet
status: approved
approved: true
approved_by: Igor Vilas Boas
approved_at: 2026-09-23
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-05, design-review, D-33, UI-04, stories, communities]
---

# Sketch 003: Fase 5 — telas [designed] (portão de revisão D-33)

## Design Question

`reference/frontend-design/` cobre a lista de comunidades (`card-magazine`), a página de uma
comunidade (capa, descrição, a fileira de círculos "Destaques", posts) e o pager de reels — que é o
modelo de gesto do visualizador de story. **Não cobre** nenhuma das cinco superfícies abaixo, que
`05-UI-SPEC.md` marca `[designed]` e que D-66 enumera como genuinamente sem protótipo:

1. **A régua de stories** no `/inicio` (`StoriesStrip`, slot `order: 5`).
2. **O visualizador de story** (`StoryViewer`: pager, relógio, zonas de toque, sobreposição).
3. **O fluxo de publicar um story** (`/stories/publicar`).
4. **O formulário de criar / editar / arquivar uma comunidade** (`/comunidades/nova`,
   `/comunidades/[communityId]/editar`).
5. **O fluxo de fixar um story numa comunidade** (`/stories/meus` + `PinStorySheet`).

As cinco estão desenhadas num único arquivo HTML estático para que o time de design as aprove
**antes de serem codadas** (UI-04, D-33). Aprovado este pacote, os planos 05-04, 05-05, 05-06,
05-07 e 05-08 codam contra um desenho, não contra prosa.

## How to View

```
open .planning/sketches/003-phase-05-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem quadro incorporado: o arquivo abre offline e pode ser enviado por e-mail como
está. Manrope renderiza se estiver instalada na máquina (`@font-face` com `local()`); sem ela o
fallback do sistema renderiza com as mesmas medidas de tipo. A revisão aqui é de layout, cor,
hierarquia e texto — não de renderização de webfont.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`, exatamente como o cookie
  `rede_theme` faz no app.
- **Cor primária / Cor secundária** e os quatro presets — escrevem as cinco variáveis `--brand-*`
  do jeito que `brandStyleVars()` escreve no servidor, incluindo a derivação do par escuro e da
  tinta sobre a cor primária. O readout à direita mostra os quatro valores derivados.
- Os links de seção pulam para cada uma das cinco superfícies.

Todos os valores de cor vêm copiados de `packages/ui/src/styles/tokens.css`, incluindo
`--color-like` e a derivação de `--brand-gradient`. **A Fase 5 não acrescenta nenhum token, nenhuma
medida de espaçamento, nenhum tamanho de tipo e nenhum peso** — se algo no desenho parecer um valor
novo, é um defeito do desenho, não uma proposta.

## What is being asked of the design team

Duas mensagens, além da revisão visual. São as duas decisões que mais querem a assinatura de vocês.

### 1. PROTOTYPE.md — open question 1 está respondida: **sim** (D-68)

A pergunta era: *"Should the community highlights circles be the pinned-stories UI?"* A resposta é
**sim**. Os círculos **Destaques** que vocês desenharam na página de uma comunidade passam a ser a
fileira real de stories fixados — e **agora eles abrem o visualizador de story**. No protótipo eles
não abrem nada.

**A consequência específica a julgar:** um círculo que agora é interativo normalmente quer um alvo
de toque maior e um estado de pressionado que os 64px com borda neutra de 2px do protótipo não têm.
A regra do projeto é 44×44 mínimo para todo controle só-ícone (UI-D-07), e 64px já passa disso — mas
o círculo carrega um rótulo de 12px logo abaixo e fica dentro de uma fileira que rola na horizontal,
então a pergunta é se o alvo *efetivo* (o círculo, ou o círculo mais o rótulo) e o feedback de toque
estão certos. É exatamente isto que queremos ouvir de vocês, e é o tipo de coisa que custa uma linha
agora e um retrabalho depois.

Nota: o anel tem dois sentidos e uma só geometria (UI-D-27). Na régua do `/inicio` o anel é **da
marca** — a fileira quer dizer *ao vivo, toque*. Em Destaques o anel é **neutro** (`border-border`,
o valor do protótipo) — aquela fileira é o arquivo editorial da comunidade. Nenhum anel carrega
estado de visto/não visto (D-79).

### 2. O visualizador **não tem curtir por batida dupla**, de propósito (UI-D-31)

No visualizador **um toque avança o story**. Se mantivéssemos o gesto de curtir por batida dupla, a
primeira batida já teria avançado — o membro perderia o story *e* falharia em curtir. A alternativa
é segurar todo avanço por uma janela de desambiguação de ~250–300 ms, que é perceptível justamente
no gesto pelo qual o visualizador existe. Então:

- `DoubleTapHeart` **não é montado** no visualizador. O componente continua existindo e continua
  sendo usado no feed, onde o cartão não navega ao toque — a gramática segue honesta porque as duas
  superfícies dão significados diferentes ao toque.
- Curtir passa a ser um botão explícito de 44×44 (`Heart` 20, traço 1.5) na linha de ações da
  sobreposição, ao lado do comentar, cada um seguido da sua contagem 12/700 branca.
- Não existe controle de envio/partilha no visualizador (UI-D-32) — não está em STORY-05.

Esta é a única decisão de UX da fase que muda um gesto que os membros já conhecem de outros apps.
Se vocês discordarem, é aqui que precisa voltar — não no code review.

## Decisions already fixed upstream

Já decididas em `05-CONTEXT.md` / `05-UI-SPEC.md` e **fora de revisão**. Estão listadas para que o
desenho seja lido com elas em mente, não para serem re-litigadas:

- **D-67** — a página de uma comunidade é capa + nome + descrição, **sem crédito humano**. O avatar
  sobreposto do dono, a linha "por {nome}" e o `VerifiedBadge` do protótipo não são portados: a
  comunidade é da organização, e D-52 já põe um rosto em cada publicação dentro dela.
- **D-68** — a fileira de círculos fica **logo abaixo do cabeçalho, acima da primeira publicação** —
  a posição exata do protótipo. Sem página com abas.
- **D-69 / UI-D-35** — a capa é **opcional**, e a comunidade sem capa renderiza o bloco
  `--brand-gradient` (no cartão da lista, com o nome em `--brand-on-primary` e sem véu preto; na
  página, um bloco de `h-36` **sem texto nenhum**, porque ali o nome já vem abaixo da capa).
- **D-75** — o cartão da lista mostra **só os quatro campos de COMM-03**: capa, nome, descrição,
  contagem de publicações. O selo de atividade ("3 novos posts") e a contagem de membros do
  protótipo estão **ambos descartados**.
- **D-78** — **um círculo por story ativo**, do mais novo para o mais antigo. Sem agrupamento por
  publicador: em V1 há um único publicador, e agrupar colapsaria a régua em exatamente um círculo
  para sempre, o que se lê como bug.
- **D-79** — **sem anel de visto/não visto** em V1. A ordem do mais novo para o mais antigo é o que
  diz ao membro o que é novo.
- **D-80** — o admin publica pelo **círculo "+" na frente da régua ("Seu story")**, visível só para
  ele. É a posição que todo usuário já conhece.
- **D-81** — um story **não é editável depois de publicado**. A legenda faz parte do passo de
  publicar; um story errado é excluído e republicado.
- **D-84** — **"Seus stories" é a casa do fixar/desafixar e do excluir**, em vez de espalhar a ação
  de fixar entre o visualizador e a tela de publicar.
- **UI-D-26** — a régua vazia de um **membro** renderiza **nada** (nenhum nó, nenhuma altura
  reservada) e a coluna do `/inicio` fecha; para o **admin** sobra o círculo "Seu story" sozinho,
  porque ele é a única porta de publicação.

## Open values to confirm

Dois números que o desenho assume e que vocês podem corrigir sem custo nenhum agora:

1. **`STORY_DURATION_MS = 5000`** — a duração de uma imagem no visualizador. É a constante do
   **próprio time de design**: ela está declarada em `reference/frontend-design/lib/constants.ts` e
   o protótipo nunca chegou a usá-la (A-6). Cinco segundos por imagem é o que o desenho pressupõe;
   se a intenção era outra, é um número.
2. **A ordem de empilhamento do `/inicio`** (UI-D-25 / A-7): **bloco de boas-vindas → aviso de
   perfil → régua de stories → feed**. O aviso fica primeiro porque é a única coisa da tela que
   expira por ação do próprio membro; a régua fica acima do feed porque é a coisa mais datada —
   some em 24 h. A alternativa é a régua acima do aviso, e também é um número (`order`).

## How to review

1. **Linguagem** — as cinco superfícies lêem como o protótipo? Ground `#f5f7fb` com cards brancos,
   raios de 12px, alvos de 44px, a mesma escala de tipo 12/14/16/24. Algo lê como "outro design
   system"?
2. **A régua no lugar** — a régua está desenhada dentro do `/inicio` inteiro, não isolada, de
   propósito: ela cabe entre o aviso de perfil e o feed sem disputar com o bloco de boas-vindas?
   E o vazio do membro realmente some, em vez de deixar um buraco?
3. **O visualizador** — é a **única tela do produto sem nenhum elemento da marca**, deliberadamente:
   aqui o conteúdo do tenant *é* a marca. As trilhas de 2px continuam legíveis com 25 segmentos numa
   tela de 320px (há um quadro para isso)? A divisão das zonas de toque (terço da esquerda / dois
   terços da direita) bate com onde o polegar cai de verdade?
4. **Publicar** — o estado preto pós-escolha lê como uma prévia do story que o membro vai ver? Os
   estados de processando e recusado são alcançáveis a partir dele, em vez de becos sem saída?
5. **Formulário de comunidade** — o seletor de capa mostra a prévia do gradiente enquanto está
   vazio, para que "ainda sem capa" e "sem capa de propósito" pareçam ao admin exatamente o que vão
   parecer ao membro. Isso funciona, ou parece um estado de erro?
6. **Fixar** — os `Switch` por linha lêem como fatos independentes e imediatos, e não como um
   formulário esperando um "Salvar"? (Não existe "Salvar" nesta folha, de propósito: cada fixação é
   a sua própria linha no banco e o seu próprio pedido.)
7. **Escuro e marca** — troque o tema e passe pelos quatro presets: tudo que é da marca recolore e
   cards, bordas, contagens, nomes e texto de corpo continuam neutros? O bloco de capa ausente é o
   **único** preenchimento da marca da fase inteira.
8. **Texto** — cada string vem verbatim do §Copywriting Contract de `05-UI-SPEC.md`. Sinalize
   qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/communities.json` ou `stories.json`.

Fora do escopo desta revisão: o cartão da lista de comunidades, o cabeçalho da página de uma
comunidade, a fileira Destaques em si e a lista de publicações dentro de uma comunidade — todos
`[proto]`, portados do protótipo sem redesenho. Aparecem aqui apenas como contexto ao redor das
peças que estão sendo revisadas.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **seis tarefas ficam bloqueadas** — 05-04 Tarefa 2, 05-05 Tarefas 1 e 3, 05-06
Tarefa 1 e 05-08 Tarefas 1 e 3 — cada uma carregando um elemento `precondition` que afirma
`grep -q '^approved: true'` contra este arquivo e que para enquanto ele ainda ler `false`; a cadeia
`automated` de verificação da Tarefa 2 do 05-04 reafirma o mesmo fato como seu primeiro segmento.
Como 05-04 destrava a onda 3 e 05-05..05-08 descendem dela, a Fase 5 para na onda 3 por desenho até
que alguém rode esta revisão.

`workflow.human_verify_mode` é `end-of-phase`, então isto não sobe como checkpoint no meio da
execução: ele chega em `/gsd-verify-work 5`.

Registre o resultado **no frontmatter deste arquivo**:

- `status` — `approved` ou `changes-requested`
- `approved` — `true` ou `false`
- `approved_by` — quem revisou
- `approved_at` — a data
- `approval_kind` — `provisional` (product owner) ou `designer`
- `changes_requested` — a lista de deltas; se não estiver vazia, cada item vira uma seção
  "Design review deltas" em `05-UI-SPEC.md`

Seguindo o precedente de 02-04 e 04-02, **uma aprovação provisória do product owner já desbloqueia a
codificação**; deltas posteriores do designer são um passe de polimento, não um bloqueio.
