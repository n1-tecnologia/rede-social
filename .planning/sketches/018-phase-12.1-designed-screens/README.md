---
sketch: 018-phase-12.1-designed-screens
name: phase-12.1-designed-screens
phase: "12.1"
question: "As telas novas de etapas e perguntas condicionais do formulário de perfil — o construtor com cartões de etapa, a condição dentro da folha da pergunta, os selos de condicional e de 'abre perguntas', as listas de recusa, a prévia que segue etapas e condições, o formulário do membro em etapas com 'Avançar', o aviso antes de apagar respostas e a edição em uma só rolagem com os títulos — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - construtor-uma-etapa
  - construtor-etapas
  - construtor-etapa-vazia
  - construtor-limite-etapas
  - construtor-reordenar-etapas
  - construtor-etapas-320
  - etapa-nova
  - etapa-renomear
  - etapa-erros
  - etapa-nao-vazia
  - etapa-excluir-dialogo
  - editor-etapa-seletor
  - editor-etapa-recusada
  - editor-condicao-desligada
  - editor-condicao-sem-abridora
  - editor-condicao-simnao
  - editor-condicao-escolha
  - editor-condicao-erros
  - editor-condicao-obrigatoria
  - editor-condicao-bloqueada
  - editor-condicao-bloqueada-remover
  - editor-condicao-remocao-pendente
  - dialogo-remover-condicao-impacto
  - editor-320
  - linha-condicional
  - linha-abridora
  - construtor-reordenar-recusado
  - recusa-arquivar
  - recusa-excluir
  - recusa-tipo
  - recusa-opcao
  - recusa-lista-longa
  - recusa-reativar
  - editor-abridora-dependentes
  - editor-opcao-usada
  - previa-etapas
  - previa-condicao-aberta
  - previa-etapa-some
  - previa-recomecar
  - previa-uma-etapa
  - membro-etapa-1
  - membro-etapa-meio
  - membro-etapa-ultima
  - membro-pergunta-aparece
  - membro-etapa-pulada
  - membro-uma-etapa
  - membro-etapa-erros
  - membro-etapa-salvando
  - membro-etapa-offline
  - membro-etapa-falha
  - membro-formulario-mudou-etapa
  - membro-falta-em-outra-etapa
  - membro-etapa-320
  - membro-etapa-escuro
  - membro-apagar-dialogo
  - membro-apagar-dialogo-salvar
  - membro-apagar-lista-320
  - membro-apagar-dialogo-salvando
  - membro-apagar-dialogo-falha
  - membro-retorno-etapas
  - membro-retorno-uma-etapa
  - membro-edicao-etapas
  - membro-edicao-pergunta-aparece
  - membro-edicao-320
  - perfil-minhas-respostas-sem-ocultas
  - staff-nao-se-aplica
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-12.1, design-review, D-635, D-417, UI-04, profile-form, steps, conditions]
---

# Sketch 018: Fase 12.1 — Perguntas condicionais e etapas no formulário de perfil (portão de revisão D-635 / D-417 / UI-04)

## Design Question

A Fase 12.1 acrescenta duas coisas ao formulário de perfil da Fase 12: **etapas** (o formulário é dividido em
grupos que o membro responde um por vez) e **perguntas condicionais** (uma pergunta que só aparece quando uma
escolha ou um Sim ou Não anterior foi respondido de certo jeito). A maior parte da fase é modelo, portão em SQL
e API; a parte que aparece na tela tem os mesmos dois públicos da Fase 12 (o admin do tenant e o membro) em
telas que já existem. O protótipo do time de design **não** tem etapas, editor de condição nem passo a passo, e
o sketch 016 (Fase 12) também não, então as superfícies novas são **[designed]** e, pelas regras D-33, D-365,
D-417 e D-635, precisam ser desenhadas e revisadas **antes de codar**. São dez grupos:

1. o **construtor** do admin com cartões de etapa (UI-D-642..UI-D-646);
2. o **editor da condição** e o campo Etapa dentro da folha da pergunta (UI-D-647..UI-D-649);
3. os **indicadores da lista** do construtor: o selo de condicional e o “Abre N perguntas” (UI-D-650);
4. as **listas de recusa** de arquivar, excluir, trocar o tipo, tirar uma opção e reativar (UI-D-651);
5. a **prévia** do admin seguindo etapas e condições (UI-D-652);
6. o **formulário do membro em etapas**, no primeiro preenchimento (UI-D-653..UI-D-655);
7. o **aviso antes de apagar respostas** (UI-D-656);
8. o **retorno** do membro depois que o admin acrescenta uma pergunta obrigatória (UI-D-657);
9. a **edição pelo perfil** em uma só rolagem, com os títulos das etapas (UI-D-658);
10. os **leitores do perfil**: “Minhas respostas” sem as ocultas e o “Não se aplica” da equipe (UI-D-659).

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos,
raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a
marca do tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 12.1 não declara token, cor,
fonte, tamanho nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/018-phase-12.1-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre
offline. É um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou
referencia. Os tokens são os de `packages/ui/src/styles/tokens.css` e o CSS base é o do sketch 016; só a seção
`pf2-*` é da Fase 12.1.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro** e as marcas **Rede Social
(neutro)**, **Demo (roxo)**, **Lab (verde)** e **Amarelo claro (tinta escura)**, mais as duas cores livres.
Cada quadro leva o seu nome em `data-frame` e na etiqueta, na ordem da tabela “Screen Inventory” do UI-SPEC.
São **66 quadros**: os 64 estados do inventário do UI-SPEC e dois que este desenho acrescenta
(`membro-apagar-dialogo-salvando` e `membro-apagar-dialogo-falha`).

## O que se pede ao time de design

As seis perguntas do UI-SPEC (seção “Sketch gate”), repetidas na seção 11 da página:

- **(a)** O poço da etapa (contêiner tingido com cartões brancos dentro) lê como “um grupo de perguntas” sem
  virar uma parede de cartão dentro de cartão? Ver `construtor-etapas`, `construtor-etapas-320`.
- **(b)** O editor da condição (interruptor, select, caixas) é entendível numa leitura, e a frase do resumo na
  linha da lista é clara? Ver `editor-condicao-escolha`, `linha-condicional`.
- **(c)** “Etapa x de y” com a barra segmentada e o título da etapa lê como um stepper em 320px? Ver
  `membro-etapa-320`, `membro-etapa-meio`.
- **(d)** O diálogo de apagar respostas é claro e calmo o bastante, com uma lista de 5 títulos? Ver
  `membro-apagar-dialogo`, `membro-apagar-lista-320`.
- **(e)** A regra lateral da pergunta condicional ajuda ou só acrescenta ruído? Ver `membro-pergunta-aparece`,
  `membro-etapa-meio`.
- **(f)** “Voltar” e “Avançar” lado a lado mantêm os 44px em 320px? Ver `membro-etapa-320`.

## Os padrões da pesquisa que o product owner pode derrubar (PU-1..PU-16)

Esta fase foi pesquisada sem poder perguntar nada. Cada ponto que o CONTEXT deixou aberto recebeu um padrão
do pesquisador, registrado na tabela “To confirm with Igor” do UI-SPEC como **PU-1..PU-16**. **São padrões do
pesquisador, e o Igor pode derrubar qualquer um nesta revisão.** Os que mais mudam o desenho, ou o custo de
mudar depois, são:

- **PU-1 — o aviso antes de apagar respostas (D-626).** Padrão: um **diálogo de confirmação** em tom de perigo,
  só com títulos, com “Apagar e continuar” / “Apagar e salvar” / “Rever respostas” (UI-D-656; quadros
  `membro-apagar-dialogo`, `membro-apagar-dialogo-salvar`, `membro-apagar-lista-320`). A alternativa é um
  aviso em linha junto à abridora, mais suave, mas que pode passar despercebido por quem usa teclado ou leitor
  de tela ou já rolou a tela.
- **PU-2 — o rótulo do botão da última etapa.** Padrão: **“Concluir”** na última etapa de um caminho com mais
  de uma etapa, e “Salvar” no caminho de uma etapa e na edição (UI-D-654; quadros `membro-etapa-ultima`,
  `membro-uma-etapa`).
- **PU-3 — o título da etapa padrão.** Padrão: **“Informações gerais”**, renomeável. É o único padrão
  **caro de mudar depois do lançamento**, porque a migração grava esse texto em todo tenant que já existe;
  antes do lançamento é só trocar o literal na migração.
- **PU-5 — mover pergunta entre etapas.** Padrão: um select **“Etapa”** na folha da pergunta; a pergunta vai
  para o fim da etapa de destino e as setas de ordenar só atuam dentro da etapa (UI-D-646, UI-D-647).
- **PU-6 — “Minhas respostas” com etapas.** Padrão: continua **plana**, na ordem do formulário; perguntas
  condicionais ocultas ficam de fora, e a equipe vê “Não se aplica” (UI-D-659).
- **PU-7 — o foco quando uma pergunta condicional aparece.** Padrão: o **foco fica na abridora** e há um
  único anúncio educado (UI-D-655), porque mover o foco enquanto o membro ainda escolhe é um problema de
  WCAG 3.2.2.
- **PU-16 — rodar este sketch ou dispensar o portão.** Padrão: **rodar**. É esta revisão.

Os demais (PU-4, PU-8..PU-15) estão no UI-SPEC e podem ser derrubados do mesmo jeito.

### Os dois estados do diálogo de apagar que o UI-SPEC deixou em aberto

O UI-SPEC não decidiu o que o diálogo mostra enquanto o salvamento confirmado roda, nem depois de uma falha.
Este desenho propõe uma suposição para cada um; aprovar o sketch confirma as duas:

- **Carregando** (`membro-apagar-dialogo-salvando`): o diálogo fica aberto, os dois botões ficam desabilitados,
  o de confirmar lê “Salvando…” e o diálogo não se dispensa.
- **Falha** (`membro-apagar-dialogo-falha`): depois de “Apagar e continuar” falhar, o diálogo fecha e o
  formulário mostra o aviso já entregue, “Não foi possível salvar agora…”; a abridora continua mudada e nada
  foi apagado.

## Achados do próprio desenho, para a revisão fechar

Os mesmos nove achados da seção 11 da página (`index.html`), carregados aqui para a revisão fechar:

1. **F-1 — carregamento do diálogo de apagar (E7).** O UI-SPEC deixou sem decisão o que o diálogo mostra
   enquanto o salvamento confirmado roda. A suposição é a descrita acima. Quadro `membro-apagar-dialogo-salvando`.
2. **F-2 — falha do diálogo de apagar (E7).** Também sem decisão (Pergunta Aberta 4 da pesquisa). A suposição é
   a descrita acima. Quadro `membro-apagar-dialogo-falha`.
3. **F-3 — ordem dos avisos.** O UI-D-653 põe os avisos depois do cartão e antes dos botões; a Fase 12 os punha
   acima do cartão. O desenho segue o UI-D-653 (avisos de salvamento, offline e “formulário mudou” entre o
   cartão e os botões), com a faixa de retorno acima do progresso, como na Fase 12. A revisão confirma.
4. **F-4 — regra lateral em toda a etapa.** O UI-D-655 põe a regra lateral em toda pergunta condicional.
   Numa etapa só de acompanhamentos (a da clínica) todas as perguntas ficam com a regra; o desenho do capítulo
   “Screen contracts” do UI-SPEC mostra uma sem. O desenho segue o texto do UI-D-655.
5. **F-5 — rota da edição.** O plano diz `/perfil/editar`; o UI-D-658 diz `/completar-perfil?next=%2Fperfil`.
   O desenho usa a do UI-SPEC.
6. **F-6 — o select da abridora aberto.** No produto é o seletor nativo do aparelho (com optgroup por etapa);
   o painel desenhado em `editor-condicao-escolha` só mostra o agrupamento.
7. **F-7 — ícones, fonte e quebras.** Os glifos são redesenhos fiéis ao conjunto `lucide-react` (layers,
   corner-down-right, split, arrow-left, arrow-right, trash-2, pencil, rotate-ccw, list-checks), não os
   arquivos reais. A Manrope é usada quando instalada no computador de quem abre; sem ela as quebras de linha
   em 320px podem diferir um pouco: conferir com a fonte real.
8. **F-8 — dados de exemplo.** Só o texto do cliente do primeiro formulário é dele. Títulos de etapa e de
   pergunta além dele, e as 20 opções de 80 caracteres, são exemplos de desenho; nenhum valor de resposta de
   membro real aparece.
9. **F-9 — frase de “etapa de”.** A frase do UI-SPEC para a abridora que tenta mudar de etapa repete o espaço
   `{dependent}` depois de “na etapa de”: lê “etapa de ‘Nome da clínica’”. O desenho copia como está (quadro
   `editor-etapa-recusada`); a revisão decide se esse segundo espaço leva o título da etapa.

## Decisions already fixed upstream

Já decididas em `12.1-CONTEXT.md` (D-620..D-636) e `12.1-UI-SPEC.md` (UI-D-642..UI-D-664) e **fora de
revisão**: só pergunta de escolha ou de Sim ou Não abre outras (D-620); a condição mora na pergunta que
aparece (D-621); um só nível de condição (D-622); a abridora vem antes da condicional (D-623); o que deixa de
valer é apagado no salvamento, inclusive nas arquivadas (D-624, D-636); pergunta com respostas não ganha nem
muda condição (D-625); o aviso antes de apagar existe (D-626, só a forma é revisável, PU-1); toda pergunta
pertence a uma etapa (D-627); etapa sem pergunta visível é pulada (D-628); “Avançar” valida e salva (D-629);
a edição pelo perfil é uma só rolagem (D-630); a conclusão continua calculada e nunca gravada (D-631); a
abridora não arquiva, não muda de tipo e não perde opção usada (D-632); os limites de 30 perguntas e 10 etapas
(D-633, UI-D-664); a contagem do diálogo de impacto só vê quem enxerga a pergunta (D-634); e este portão
(D-635). Este desenho é um artefato de revisão e nunca vira dependência do código.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** (o Amarelo claro mostra a
   tinta escura derivada).
2. **Construtor** — uma etapa, três etapas, etapa vazia, limite de 10, reordenar, 320px, a folha de etapa
   (criar, renomear, erros, não vazia, excluir).
3. **Folha da pergunta** — o seletor de etapa, a condição em cada modo (Sim ou Não, escolha com várias opções,
   erros, obrigatória, bloqueada), remover a condição com impacto, e 320px.
4. **Lista e recusas** — os selos, o “Abre N perguntas”, o toast de reordenar recusado e as cinco listas de
   recusa (inclusive a de 5 e “e mais N”).
5. **Prévia** — etapas, condição aberta, etapa que some, recomeçar, uma etapa.
6. **Membro** — primeiro preenchimento (primeira, meio, última, pergunta que aparece, etapa pulada, uma etapa,
   erros, salvando, offline, falha, formulário mudou, falta em outra etapa, 320px, escuro), o diálogo de apagar
   (os três mais os dois estados acrescentados), o retorno, a edição em uma rolagem e os leitores do perfil.
7. **As perguntas (a) a (f), os padrões PU-1..PU-16 e os nove achados F-1..F-9** da seção 11.

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-417, D-635). Para aprovar, cole no frontmatter deste
arquivo, no lugar dos valores pendentes:

```
    status: approved
    approved: true
    approved_by: <seu nome>
    approved_at: <AAAA-MM-DD>
    approval_kind: provisional
```

(Os cinco valores vão no frontmatter do topo, sem o recuo de quatro espaços mostrado aqui. O recuo existe
para que o exemplo não seja lido como se o portão já estivesse aberto: as tarefas procuram o texto de
aprovação no começo de uma linha.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. **Enquanto este arquivo disser
`approved: false`, as tarefas de interface web dos planos 14 a 18 ficam bloqueadas**; os planos de servidor,
de SQL, de contrato e de biblioteca pura não esperam por esta revisão. Uma aprovação provisória do product
owner já desbloqueia a codificação; deltas posteriores do designer são um passe de polimento.

Se o Igor dispensar o portão (PU-16), ele registra a dispensa como decisão em `12.1-CONTEXT.md` e os planos 14
a 18 tiram a guarda; a parte mínima que ele ainda deveria olhar são os quadros `membro-pergunta-aparece` e
`membro-apagar-dialogo`. A coluna Winner de `../MANIFEST.md` só muda se o usuário pedir.
