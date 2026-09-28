---
sketch: 004-phase-05.2-designed-screens
name: phase-05.2-designed-screens
phase: 05.2
question: "As sete superfícies da Fase 05.2 que o protótipo não cobre — as fileiras de círculos do início e da comunidade, a tela de gerenciar destaques, a folha de editar destaque (com capa e \"Adicionar stories\"), a folha de destaques nos modos lista e seleção única, a linha \"Destaque\" do composer e a pílula \"Destacar\" do visualizador — lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant?"
screens:
  - inicio-fileira-admin-nao-visto
  - inicio-fileira-membro-visto
  - inicio-disco-do-tenant-e-aneis
  - inicio-vazios-e-parciais
  - inicio-fileira-desktop
  - comunidade-fileira-admin
  - comunidade-fileira-membro
  - comunidade-arquivada-fileira
  - gerenciar-destaques-populada
  - gerenciar-destaques-vazia
  - gerenciar-novo-destaque-titulo
  - gerenciar-novo-destaque-erro-e-enviando
  - gerenciar-destaques-nome-longo-320px
  - gerenciar-destaques-comunidade-arquivada
  - editar-destaque-populado
  - editar-destaque-vazio-e-confirmar-excluir
  - editar-destaque-escolher-capa
  - editar-destaque-escolher-capa-sem-fotos
  - editar-destaque-adicionar-stories
  - editar-destaque-historico-vazio-e-arquivado
  - folha-destacar-story-lista
  - folha-destacar-story-carregando-e-vazia
  - folha-destaque-selecao-unica-sem-origem
  - folha-destaque-selecao-unica-origem-sem-destaque
  - folha-destaque-novo-destaque-composer
  - folha-destacar-story-nomes-longos-320px
  - seus-stories-indicador-menu-e-excluir
  - composer-destaque-nenhum
  - composer-destaque-lugar-e-titulo
  - composer-escolher-destaque
  - composer-destaque-nome-longo-320px-e-pendente
  - composer-recusa-comunidade-arquivada
  - visualizador-grupo-do-tenant-com-destacar
  - visualizador-grupo-de-destaque
  - visualizador-grupo-carregando
  - visualizador-grupo-erro
  - visualizador-destacar-aberto

status: approved
approved: true
approved_by: Igor Vilas Boas
approved_at: 2026-09-25
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-05.2, design-review, D-33, UI-04, highlights, stories]
---

# Sketch 004: Fase 05.2 — Destaques de stories (portão de revisão D-33)

## Design Question

A Fase 05.2 faz os stories funcionarem como os do Instagram: no início, **um círculo do tenant**
junta todos os stories ativos, seguido dos **destaques** (coleções com nome e capa); na comunidade,
a fileira passa a ser **os destaques daquela comunidade**; e o admin ganha uma superfície de
curadoria. O protótipo (`reference/frontend-design/`) só desenha o círculo de destaque em si
(64px, borda neutra, título embaixo). **Não cobre** nenhuma das sete superfícies abaixo, que
`05.2-UI-SPEC.md` manda desenhar e revisar antes de codar (Phase 2 **D-33**, **UI-04**):

1. **A fileira do início** — admin e membro, anel do tenant visto e não visto, destaque vazio e
   círculo "Gerenciar".
2. **A fileira da comunidade.**
3. **A tela de gerenciar destaques**, populada e vazia.
4. **A folha de editar destaque**, com os passos "Escolher capa" e "Adicionar stories".
5. **A folha de destaques** em modo lista e em modo seleção única, incluindo o passo "Novo
   destaque".
6. **A linha "Destaque" do composer** nos seus três valores.
7. **A pílula "Destacar" do visualizador.**

A pergunta de design: estas sete superfícies lêem como a linguagem que vocês já assinaram — ground
`#f5f7fb`, cards brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 e **uma** cor de
destaque que é a do tenant — em claro e escuro, sob qualquer marca?

## How to View

```
open .planning/sketches/004-phase-05.2-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem quadro incorporado: o arquivo abre offline e pode ser enviado por e-mail como
está. Manrope renderiza se estiver instalada na máquina; sem ela o fallback do sistema renderiza com
as mesmas medidas de tipo.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`, como o cookie `rede_theme`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde, Vermelho)
  — escrevem as cinco variáveis `--brand-*` como `brandStyleVars()` faz no servidor, incluindo o par
  escuro e a tinta sobre a cor primária. O readout mostra os valores derivados.
- Os links de seção pulam para cada uma das sete superfícies.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`, incluindo
`--theme-border-secondary` (o anel tracejado), `--brand-on-primary` e a derivação de
`--brand-gradient` (o monograma). **A Fase 05.2 não acrescenta nenhum token, nenhuma medida de
espaçamento, nenhum tamanho de tipo e nenhum peso** — se algo no desenho parecer um valor novo, é
defeito do desenho, não proposta.

## What is being asked of the design team

Três mensagens, além da revisão visual. São as três decisões que mais pedem a assinatura de vocês,
e cada uma termina numa pergunta específica.

### 1. D-104 reverte D-78: **um círculo do tenant**, não um círculo por story

Na Fase 5 a régua do início tinha um círculo por story ativo (D-78). Agora ela tem **um único
círculo do tenant** que junta todos os stories ativos, com o **logo do tenant** e o **nome de
exibição** como rótulo — a mesma identidade que o cabeçalho do visualizador já mostra (D-104,
UI-D-60). Logos de tenant costumam ser **wordmarks largos**, não quadrados, então o disco é
`bg-bg-secondary` e o logo entra em `object-contain` dentro de uma **caixa centrada de 48×48 (8px de
respiro)** — inteiro, nunca recortado. Sem logo, o disco vira o monograma `--brand-gradient` com a
inicial, o mesmo do destaque sem capa.

**A decidir:** o respiro de 8px funciona para um wordmark largo (Superfície 1, quadro C, primeiro
disco) — ele fica legível a 48px de largura, ou pede outro tratamento (por exemplo, o símbolo do
logo em vez do wordmark)? E um logo quadrado com fundo branco (segundo disco) lê bem dentro do anel?

### 2. D-105 reverte D-79: **anel da marca enquanto há story não visto, neutro depois**

A Fase 5 decidiu não ter anel de visto/não visto (D-79). Agora o anel do círculo do tenant é
`border-brand` **enquanto qualquer story ativo não foi visto** por quem está olhando, e
`border-border` quando tudo foi visto (D-105, UI-D-61). O estado é do servidor, igual em todos os
aparelhos, e abrir o círculo retoma no primeiro story não visto. **Os círculos de destaque nunca
usam o anel da marca**: são arquivo, não novidade. Como o estado não pode depender só de cor
(WCAG 1.4.1), o nome acessível do círculo muda junto: "Abrir stories de {tenant}. Há stories
novos." / "Abrir stories de {tenant}".

**A decidir:** o anel da marca sozinho, mais a mudança do nome acessível, é sinal suficiente de
visto/não visto? Compare os quadros A e B da Superfície 1 e o close do quadro C, e passe pelos
quatro presets e pelo tema escuro — em especial o preset Vermelho, onde o anel da marca é a única
tinta vermelha da fileira.

### 3. O anel tracejado é a regra nova para **"só você vê"** (UI-D-63)

Um traço novo entra no vocabulário: `border-2 border-dashed border-border-secondary`, na mesma
geometria dos outros anéis. Ele marca **tudo o que só o admin vê**: o círculo **"Gerenciar"** no fim
de cada fileira, o **destaque vazio** (que o membro nunca recebe), o disco **"Novo destaque"** nas
folhas e o tile **"Enviar imagem"** do passo de capa. Anel sólido = o membro também vê; tracejado =
só você.

**A decidir:** o tracejado lê como "só o admin vê" de relance, na fileira do início (Superfície 1,
quadro A — role até o fim) e na da comunidade (Superfície 2, quadro A)? Ou ele lê como "carregando",
"desabilitado" ou "quebrado"?

## Decisions already fixed upstream

Já decididas em `05.2-CONTEXT.md` e `05.2-UI-SPEC.md` e **fora de revisão**. Estão listadas para
que o desenho seja lido com elas em mente, não para serem re-litigadas:

- **D-100** — um story pode estar em vários destaques ao mesmo tempo.
- **D-101** — a capa padrão é um frame de um dos stories; o admin pode escolher outro story ou
  enviar uma imagem. **Capas só de imagem**: em 2026-09-25, no planejamento e antes de existir código
  de capa, o desenvolvedor escolheu que só stories com foto fornecem capa automática ou escolhida; um
  destaque só de vídeos usa o monograma até receber uma capa enviada. A capa a partir do pôster de um
  vídeo fica para depois, como um ramo aditivo (uma variante `poster` no broker), sem mudança de
  schema.
- **D-102** — um destaque vazio é mantido, visível só para o admin.
- **D-103** — um destaque toca os stories por data de publicação, do mais antigo.
- **D-104** e **D-105** — as mensagens 1 e 2 acima (os revertimentos de D-78 e D-79 já estão
  decididos; o que se pede é a leitura visual).
- **D-106** — o círculo do tenant toca os stories ativos do mais antigo para o mais novo.
- **D-107** — no fim de um círculo, o visualizador passa ao próximo círculo da fileira; fecha
  depois do último.
- **D-108** — o "+ Seu story" continua sendo a porta de publicar, na frente do círculo do tenant.
- **D-109** — toda a curadoria fica atrás do círculo "Gerenciar": uma tela por lugar, arrastar para
  reordenar, "Novo destaque" e a folha de editar. Sem gesto de pressionar e segurar.
- **D-110** — uma única folha de destaques, alcançada por "Destacar" no visualizador, por "Seus
  stories" e por "Adicionar stories".
- **D-111..D-115** — a linha "Destaque" do composer, o pré-preenchimento vindo de uma comunidade,
  um destaque (ou nenhum) na publicação, criar destaque na mesma transação da publicação, e para
  onde o admin volta depois de publicar.
- **D-116** — os stories presos a comunidades viram destaques; o modelo antigo sai. Toda comunidade
  que tinha stories presos ganha um destaque chamado "Destaques" com exatamente esses stories.
- **UI-D-59..UI-D-80** — as decisões visuais de `05.2-UI-SPEC.md`: composição e ordem da fileira
  (UI-D-59), disco do tenant (UI-D-60), anéis (UI-D-61), capa e monograma (UI-D-62), anel tracejado
  (UI-D-63), fileira da comunidade (UI-D-64), navegação em grupos (UI-D-65), "Destacar" (UI-D-66),
  as duas folhas (UI-D-67, UI-D-68), a linha do composer e o portão de D-112 (UI-D-69), destino e
  toasts (UI-D-70), recusas (UI-D-71), tela de gerenciar e reordenação (UI-D-72, UI-D-73), folha de
  editar, capa e "Adicionar stories" (UI-D-74..UI-D-76), "Seus stories" (UI-D-77), confirms
  destrutivos (UI-D-78), vocabulário "destaque/destacar" (UI-D-79) e a tela de uma comunidade
  arquivada (UI-D-80).

## How to review

1. **Linguagem** — as sete superfícies lêem como o protótipo? Algo lê como "outro design system"?
2. **As três mensagens acima** — responda as três perguntas "A decidir".
3. **A fileira no lugar** — no quadro A da Superfície 1, a fileira do admin se lê da esquerda para a
   direita como "+ Seu story", o círculo do tenant, os destaques e os círculos tracejados? No quadro
   B, o membro vê só o tenant e os destaques com story, e no quadro D o membro sem nada não recebe
   nada?
4. **Curadoria como uma superfície só** — a alça de arrastar da tela de gerenciar, os botões de
   mover para cima/baixo da folha de editar e o confirm de excluir lêem como uma coisa só? A variante
   arquivada oferece só remoções?
5. **As duas folhas** — os `Switch` do modo lista lêem como gravações independentes e imediatas
   (sem "Salvar")? No modo seleção única, a comunidade de origem vem primeiro e "Nenhum" fica a um
   toque?
6. **Composer e visualizador** — a linha "Destaque" trunca só o valor em 320px? A pílula
   "Destacar" não acrescenta nenhuma tinta da marca ao visualizador?
7. **Escuro e marca** — troque o tema e passe pelos quatro presets: tudo que é da marca recolore, e
   cards, bordas, rótulos e texto de corpo continuam neutros?
8. **Texto** — cada string vem verbatim do §Copywriting Contract de `05.2-UI-SPEC.md`. Sinalize
   qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/stories.json`.

Fora do escopo desta revisão: o cabeçalho da página de uma comunidade, a lista de publicações e o
próprio círculo de destaque de 64px — todos `[proto]`, portados do protótipo sem redesenho. Aparecem
aqui como contexto ao redor das peças revisadas.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **toda tarefa que coda uma das sete superfícies fica bloqueada** — plano 04
Tarefas 1-2, plano 05 Tarefas 1-2, plano 06 Tarefas 1 e 3, plano 07 Tarefa 1, plano 08 Tarefas 2-3,
plano 09 Tarefas 1 e 3 e plano 10 Tarefa 2 — cada uma carregando um `precondition` que afirma
`^approved: true` neste arquivo e que para enquanto ele disser `false`. A revisão pode acontecer
enquanto a API da onda 1 está sendo construída.

`workflow.human_verify_mode` é `end-of-phase`, então isto não sobe como checkpoint no meio da
execução.

Registre o resultado **no frontmatter deste arquivo**:

- `status` — `approved` ou `changes-requested`
- `approved` — `true` ou `false`
- `approved_by` — quem revisou
- `approved_at` — a data
- `approval_kind` — `provisional` (product owner) ou `designer`
- `changes_requested` — a lista de deltas; se não estiver vazia, cada item vira uma seção
  "Design review deltas" em `05.2-UI-SPEC.md`

Seguindo o precedente de 02-04, 04-02 e 05-02, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. Ao aprovar, atualize também a coluna Winner da linha 004 em `../MANIFEST.md`.
