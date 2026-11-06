---
sketch: 019-phase-12.2-designed-screens
name: phase-12.2-designed-screens
phase: "12.2"
question: "As telas novas de ramos condicionais do formulário de perfil — os blocos de ramo recuados no construtor, a folha do ramo e o campo 'Ramo' da pergunta, 'Criar ramo', 'Desfazer ramo' e 'Arquivar ramo', as listas de recusa agrupadas por ramo, o Fluxo em árvore vertical, e o bloco de perguntas que abre de uma vez no formulário do membro — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px, e deixam o admin responder 'quem vê esta pergunta?' de relance?"
screens:
  - lista-ramo-simples
  - lista-ramo-etapas
  - lista-ramo-aninhado
  - lista-ramo-vazio
  - lista-ramo-varios
  - lista-limite-ramos
  - lista-ramo-320
  - lista-ramo-escuro
  - lista-reordenar-ramo
  - lista-reordenar-ramo-anunciado
  - editor-ramo-seletor
  - editor-ramo-bloqueado
  - editor-ramo-privado
  - editor-ramo-ocultos
  - editor-ramos-da-pergunta
  - editor-ramos-nenhum
  - editor-ramos-salvar-antes
  - editor-ramos-profundidade
  - editor-ramos-limite
  - editor-ramo-320
  - ramo-novo
  - ramo-novo-simnao
  - ramo-editar
  - ramo-editar-trocar-pergunta
  - ramo-erros
  - ramo-bloqueado
  - ramo-nome-longo-320
  - ramo-descartar-dialogo
  - ramo-desfazer-dialogo
  - ramo-desfazer-impacto
  - ramo-arquivar-dialogo
  - ramo-arquivar-recusa
  - ramo-privacidade-recusa
  - recusa-arquivar-ramos
  - recusa-tipo-ramos
  - recusa-opcao-ramos
  - recusa-lista-longa-ramos
  - recusa-privacidade-abridora
  - arquivadas-ramo
  - arquivadas-reativar-ramo-impacto
  - arquivadas-reativar-recusa
  - fluxo-seletor
  - fluxo-seletor-desligado
  - fluxo-simples
  - fluxo-aninhado
  - fluxo-etapas
  - fluxo-varios-ramos
  - fluxo-ramo-vazio
  - fluxo-longo
  - fluxo-toque-pergunta
  - fluxo-toque-ramo
  - fluxo-320
  - fluxo-escuro
  - fluxo-desktop
  - previa-ramo-abre-bloco
  - previa-ramo-aninhado
  - membro-ramo-aparece
  - membro-ramo-aninhado
  - membro-ramo-fecha
  - membro-ramo-outra-etapa
  - membro-etapa-some-por-ramo
  - membro-ramo-320
  - membro-ramo-escuro
  - membro-apagar-ramo
  - membro-apagar-ramo-320
  - staff-nao-se-aplica-ramo
status: approved
approved: true
approved_by: "Igor (recorded by Claude on Igor's instruction)"
approved_at: 2026-11-06
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-12.2, design-review, D-650, D-417, UI-04, profile-form, branches, flow]
---

# Sketch 019: Fase 12.2 — Ramos condicionais no formulário de perfil, com várias perguntas por ramo (portão de revisão D-650 / D-417 / UI-04)

## Design Question

A Fase 12.2 troca a condição de uma pergunta da Fase 12.1 por um objeto próprio, o **ramo**: um grupo de
perguntas que só aparece para quem respondeu de certo jeito a **uma** pergunta que decide (a “abridora”). Um
ramo pode ter várias perguntas, ter um nome opcional que só o admin vê, atravessar etapas e conter outro ramo
(até três níveis). A maior parte da fase é modelo, portão em SQL e API; a parte que aparece na tela tem os mesmos
dois públicos das Fases 12 e 12.1 (o admin do tenant e o membro) em telas que já existem. O protótipo do time de
design **não** tem ramo, folha do ramo nem Fluxo, e os sketches 016 (Fase 12) e 018 (Fase 12.1) também não, então
as superfícies novas são **[designed]** e, pelas regras D-33, D-365, D-417 e D-650, precisam ser desenhadas e
revisadas **antes de codar**. São treze grupos:

1. a **lista do construtor com blocos de ramo** recuados sob a abridora (UI-D-666, UI-D-667, UI-D-683);
2. a **reordenação** em que o bloco da abridora anda junto (UI-D-668);
3. a **folha da pergunta** com o campo **Ramo** ao lado de **Etapa** e o bloco “Ramos desta pergunta” (UI-D-669,
   UI-D-670, UI-D-675);
4. a **folha do ramo**, em modo de criar e de editar (UI-D-671);
5. **Desfazer ramo** e **Arquivar ramo** (UI-D-672);
6. as **listas de recusa** agrupadas por ramo (UI-D-673);
7. a aba **Arquivadas** com ramos (UI-D-674);
8. o seletor **Lista | Fluxo** (UI-D-665);
9. o **Fluxo**, a árvore vertical somente de leitura (UI-D-676, UI-D-677);
10. a **prévia** do admin seguindo ramos (UI-D-678);
11. o **bloco de perguntas do membro** que abre e fecha de uma vez (UI-D-679);
12. o **aviso antes de apagar respostas** sobre uma árvore (UI-D-680);
13. o **leitor da equipe** com “Não se aplica” (UI-D-681).

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos,
raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a
marca do tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px, e deixa o admin responder “quem vê esta
pergunta?” de relance? A Fase 12.2 não declara token, cor, fonte, tamanho nem dependência nova; o desenho só
combina as primitivas já entregues.

## How to View

```
open .planning/sketches/019-phase-12.2-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre
offline. É um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou
referencia. Os tokens são os de `packages/ui/src/styles/tokens.css` e o CSS base é o do sketch 018; só a
seção dos ramos e do Fluxo é da Fase 12.2.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro** e as marcas **Rede Social
(neutro)**, **Demo (roxo)**, **Lab (verde)** e **Amarelo claro (tinta escura)**, mais as duas cores livres.
Cada quadro leva o seu nome em `data-frame` e na etiqueta, na ordem da tabela “Screen Inventory” do UI-SPEC.
São **66 quadros**, exatamente os 66 estados do inventário do UI-SPEC, e a lista `screens:` do topo deste
arquivo é igual aos quadros desenhados.

## O que se pede ao time de design

As seis perguntas do UI-SPEC (seção “Sketch gate”), repetidas na última seção da página:

- **(a)** O trilho mais a faixa do ramo leem como “estas perguntas pertencem àquela resposta”, em três níveis,
  em 320px? Ver `lista-ramo-aninhado`, `lista-ramo-320`.
- **(b)** O Fluxo (árvore por ramo, a aresta carrega as respostas, a etapa vira uma pílula) responde “quem vê
  esta pergunta?” de relance, e o teto de 4 respostas numa aresta basta? Ver `fluxo-aninhado`, `fluxo-longo`.
- **(c)** O trilho único e compartilhado do bloco do membro é mais claro que um trilho por pergunta? Ver
  `membro-ramo-aparece`, `membro-ramo-aninhado`.
- **(d)** “Criar ramo” morar só na folha da pergunta é encontrado, ou a linha da lista precisa de um botão
  próprio (PU-3)? Ver `editor-ramos-da-pergunta`, `editor-ramos-nenhum`.
- **(e)** O select “Ramo” é entendível ao lado de “Etapa”? Ver `editor-ramo-seletor`, `editor-ramo-ocultos`.
- **(f)** A recusa agrupada por ramo é calma o bastante com 5 títulos? Ver `recusa-arquivar-ramos`,
  `recusa-lista-longa-ramos`.

## Os padrões da pesquisa que o product owner pode derrubar (PU-1..PU-12)

Esta fase foi pesquisada sem poder perguntar nada. Cada ponto que o CONTEXT deixou aberto recebeu um padrão
do pesquisador, registrado na tabela “To confirm with Igor” do UI-SPEC como **PU-1..PU-12**. **São padrões do
pesquisador, e o Igor pode derrubar qualquer um nesta revisão.** Os que mais mudam o desenho, ou o custo de
mudar depois, são:

- **PU-1 — WR-06: pergunta pública sob uma abridora privada.** Padrão: **recusar** (UI-D-675). A chave
  “Mostrar no perfil do membro” fica desligada e desabilitada com o motivo, o select “Ramo” deixa de fora os
  ramos que dependem de uma abridora privada, e tornar privada uma abridora é recusado enquanto uma pergunta
  pública pendura nela. A razão é que, sem isso, a simples presença da resposta pública revelaria a resposta
  privada. Quadros `editor-ramo-privado`, `editor-ramo-ocultos`, `ramo-privacidade-recusa`,
  `recusa-privacidade-abridora`. A alternativa é “aceitar com aviso” (troca a recusa por uma nota; o vazamento
  fica) ou “esconder do bloco público”.
- **PU-2 — a forma do Fluxo.** Padrão: uma árvore **por ramo**, com a etapa como pílula em cada nó (UI-D-676),
  porque as perguntas de um ramo podem estar em etapas diferentes (D-643). A alternativa é uma árvore por etapa,
  que deixa de poder ser recuada por ramo. Quadros `fluxo-aninhado`, `fluxo-etapas`.
- **PU-3 — onde mora “Criar ramo”.** Padrão: **só na folha da pergunta**, no bloco “Ramos desta pergunta”
  (UI-D-670); a linha da lista continua um toque = uma folha. A alternativa é um botão em toda abridora.
- **PU-4 — vários ramos por abridora.** Padrão: **sim**, e os conjuntos de respostas podem se sobrepor (uma
  pergunta pertence a um só ramo, então não há conflito). Quadros `lista-ramo-varios`, `fluxo-varios-ramos`.
  A alternativa é um ramo por abridora, que obriga o caso da clínica a usar duas abridoras.
- **PU-9 — a lista do aviso de apagar.** Padrão: **lista plana**, até 5 títulos e “e mais N”, sem agrupar por
  ramo, porque o membro nunca viu ramos (UI-D-680). Quadros `membro-apagar-ramo`, `membro-apagar-ramo-320`.
- **PU-10 — o tom de “Desfazer ramo” e “Arquivar ramo”.** Padrão: diálogos em **tom da marca**, não de perigo,
  porque os dois são reversíveis (UI-D-672). O mesmo vale para o diálogo “Descartar as alterações?” da folha do
  ramo, desenhado em tom da marca porque o perigo é reservado pelo UI-SPEC a uma lista fechada de ações.
  Quadros `ramo-desfazer-dialogo`, `ramo-arquivar-dialogo`, `ramo-descartar-dialogo`.

Os demais (PU-5..PU-8, PU-11, PU-12) estão no UI-SPEC e podem ser derrubados do mesmo jeito.

### Quatro decisões de produto que a pesquisa deixou em aberto

Estas não são padrões de desenho, são regras do produto que o código vai seguir ao pé da letra. Aprovar o sketch
as confirma; o Igor pode mudar qualquer uma.

1. **“Desfazer ramo” num ramo aninhado deixa as perguntas dele visíveis para todos os membros**, mesmo que o
   ramo desfeito esteja dentro de outro ramo: as perguntas escapam da condição do ramo de fora (a leitura literal
   do D-653; a alternativa é “visíveis para quem vê a abridora”). Se houver perguntas obrigatórias que os membros
   ainda não responderam, o diálogo diz quantos membros vão precisar responder (`ramo-desfazer-impacto`).
2. **As colunas de condição da Fase 12.1 ficam intocadas depois da conversão.** A migração cria os ramos a
   partir das condições existentes, mas não apaga nem zera as colunas antigas; elas deixam de ser lidas.
3. **O ramo não tem posição guardada.** A ordem de ramos irmãos de uma mesma abridora segue a criação, e um ramo
   vazio acompanha a ordem de criação entre os irmãos (UI-D-666, UI-D-668).
4. **Uma pergunta reativada cujo ramo foi desfeito volta sem condição**, visível para todos, em vez de voltar
   para um ramo que já não existe (UI-D-674).

## Achados do próprio desenho, para a revisão fechar

Os mesmos achados que fecham a página (`index.html`), carregados aqui para a revisão fechar:

1. **F-A — a pílula “Abre N perguntas” com zero perguntas** (`lista-ramo-vazio`). O UI-SPEC não diz o que a
   pílula da abridora mostra quando o único ramo dela está vazio. O desenho **omite** a pílula; o bloco vazio
   já diz “Este ramo está vazio…”. A revisão confirma ou pede “Abre 0 perguntas”.
2. **F-B — o fecho do diálogo de reativar um ramo** (`arquivadas-reativar-ramo-impacto`). O texto do UI-D-576
   termina com “Quem já respondeu as outras perguntas responde só esta.”, que lê errado para um bloco de várias
   perguntas, e o UI-SPEC não dá uma variante para bloco. O desenho reaproveita o texto do UI-D-576 como está;
   a revisão decide a variante.
3. **F-C — a cor do segmento selecionado do Lista | Fluxo** (`fluxo-seletor`). O `SegmentedControl` entregue
   pinta o segmento ativo com a marca; o desenho o pinta neutro (fundo terciário e um visto) para a página ter um
   único preenchimento de marca (“Adicionar pergunta”), como o orçamento de marca do UI-SPEC exige. A revisão
   confirma ou aceita a marca no segmento.

## Decisions already fixed upstream

Já decididas em `12.2-CONTEXT.md` (D-640..D-653) e `12.2-UI-SPEC.md` (UI-D-665..UI-D-684) e **fora de
revisão** (só os PU acima e os achados F-A..F-C são revisáveis): o ramo é um objeto próprio, com abridora,
respostas e nome opcional, e a condição sai da pergunta (D-640, UI-D-669); uma pergunta está em no máximo um
ramo, o aninhamento é derivado e a abridora vem antes de toda pergunta do ramo (D-641); o nome é opcional e o
rótulo vem da condição (D-642); as perguntas de um ramo podem estar em etapas diferentes (D-643); três níveis,
e a pergunta aparece quando todo ramo da cadeia está aberto (D-644); o que deixa de valer é apagado cadeia
abaixo e o aviso lista os títulos (D-645); os bloqueios de 12.1 se estendem aos ramos e as recusas listam ramos
e perguntas (D-646); o seletor Lista | Fluxo sem rota nova (D-647); o Fluxo é somente de leitura e o toque abre o
editor (D-648); o Fluxo é uma árvore vertical recuada, com a resposta na conexão (D-649); este portão (D-650);
criar o ramo a partir da abridora (D-651); a ordem é a árvore e ramos andam em bloco (D-652); e Desfazer e
Arquivar ramo (D-653). Os limites são 3 níveis, 15 ramos por formulário, nome de 60 caracteres, 30 perguntas e 10
etapas (UI-D-683). O sketch 018 (Fase 12.1) continua `pending` na lista; este 019 estende o look dele, e se o
Igor mudar o 018, os quadros afetados do 019 são redesenhados. Este desenho é um artefato de revisão e nunca vira
dependência do código.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** (o Amarelo claro mostra a
   tinta escura derivada).
2. **Comece pelos dois quadros que decidem a fase:** `fluxo-aninhado` (a árvore de três níveis, o admin
   responde “quem vê esta pergunta?”) e `membro-ramo-aparece` (três perguntas sob um trilho só, do lado do
   membro).
3. **Lista** — um ramo, em outra etapa, três níveis, vazio, dois ramos de uma abridora, limite de 15, 320px,
   escuro, e a reordenação com o bloco andando junto.
4. **Folhas** — a folha da pergunta (Ramo, privada, sem ramos, salvar antes, profundidade, limite, 320px) e a
   folha do ramo (criar, Sim ou Não, editar, trocar a pergunta que decide, erros, com respostas, nome de 60
   caracteres em 320px, descartar), depois Desfazer e Arquivar com as suas recusas.
5. **Recusas e Arquivadas** — as cinco listas agrupadas por ramo (inclusive a de 5 e “e mais N”) e as três
   telas de Arquivadas.
6. **Fluxo** — o seletor, o simples, o aninhado, com etapas, com vários ramos, o ramo vazio, o longo (20
   respostas cortadas em 4), o toque numa pergunta e num ramo, 320px, escuro e desktop.
7. **Membro e leitores** — a prévia, o bloco que aparece, aninhado, que fecha com rascunhos guardados, em outra
   etapa, a etapa que some, 320px, escuro, o diálogo de apagar sobre uma árvore (7 títulos, 5 e “e mais 2”) e o
   “Não se aplica” da equipe.
8. **As perguntas (a) a (f), os padrões PU-1..PU-12, as quatro decisões de produto e os achados F-A..F-C.**

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-417, D-650). Para aprovar, cole no frontmatter deste
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
`approved: false`, as tarefas de interface web dos planos 14 a 19 e a tarefa de navegador do plano 21 ficam
bloqueadas**; os planos de servidor, de SQL, de contrato e de biblioteca pura não esperam por esta revisão. Uma
aprovação provisória do product owner já desbloqueia a codificação; deltas posteriores do designer são um passe
de polimento.

Se o Igor dispensar o portão (PU-12), ele registra a dispensa como decisão em `12.2-CONTEXT.md` e os planos 14
a 19 tiram a guarda; a parte mínima que ele ainda deveria olhar são os quadros `fluxo-aninhado` e
`membro-ramo-aparece`. A coluna Winner de `../MANIFEST.md` só muda se o usuário pedir.
