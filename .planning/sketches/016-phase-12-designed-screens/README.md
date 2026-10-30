---
sketch: 016-phase-12-designed-screens
name: phase-12-designed-screens
phase: "12"
question: "As telas novas do formulário de perfil — o construtor do admin (lista de perguntas, ordenar, resumo e exportação), a folha da pergunta com os 13 tipos e os estados bloqueados, as perguntas arquivadas, a tela de completar o perfil com os 13 controles, o aviso e 'Minhas respostas' no perfil, as respostas no perfil de outro membro e na visão da equipe, e a linha do módulo no painel — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - construtor-vazio
  - construtor-lista
  - construtor-sem-obrigatoria
  - construtor-reordenar
  - construtor-limite
  - construtor-erro
  - construtor-320
  - editor-tipo-grade
  - editor-nova-texto-curto
  - editor-escolha-opcoes
  - editor-escolha-outro
  - editor-numero-data
  - editor-erros
  - editor-bloqueado-tipo
  - editor-bloqueado-opcoes
  - editor-perfil-congelado
  - editor-substituir
  - editor-descartar
  - editor-320
  - dialogo-obrigatoria-impacto
  - dialogo-arquivar
  - dialogo-excluir
  - dialogo-reativar-obrigatoria
  - arquivadas-lista
  - arquivadas-vazio
  - exportar-dialogo
  - exportar-preparando
  - exportar-sem-membros
  - previa-membro
  - membro-primeira
  - membro-retorno-faltando
  - membro-edicao
  - membro-erros
  - membro-offline
  - membro-salvando
  - membro-formulario-mudou
  - membro-aviso-publica
  - membro-vazio
  - membro-erro-carga
  - membro-320
  - membro-escuro
  - perfil-aviso-novas
  - perfil-minhas-respostas
  - perfil-minhas-respostas-colapsado
  - perfil-minhas-respostas-vazio
  - outro-membro-publicas
  - staff-respostas
  - staff-respostas-arquivadas
  - staff-sem-respostas
  - plataforma-linha-modulo
  - plataforma-desativar
status: approved
approved: true
approved_by: "Igor (recorded by Claude on Igor's instruction)"
approved_at: 2026-10-30
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-12, design-review, D-417, UI-04, profile-form]
---

# Sketch 016: Fase 12 — Formulário de perfil do tenant (portão de revisão D-417 / D-365 / D-33)

## Design Question

A Fase 12 deixa o admin do tenant montar um formulário de perfil e deixa os membros responderem. A maior
parte é modelo, portão e API; a parte que aparece na tela tem **dois públicos** e nove superfícies. O
protótipo do time de design **não** tem construtor de formulário nem questionário de perfil
(`reference/frontend-design/`), então todas as superfícies são **[designed]** e, pelas regras D-33, D-365 e
D-417, precisam ser desenhadas e revisadas **antes de codar**:

1. o **construtor** do admin: a aba Perguntas (resumo com anel e exportação, lista, reordenar, vazio,
   limite, erro) e a aba Arquivadas (UI-D-564..UI-D-568, UI-D-578);
2. a **folha da pergunta**: a grade dos 13 tipos, as opções e o “Outro”, os limites de número e data, o
   aviso LGPD, os três estados bloqueados, o congelamento de “Mostrar no perfil do membro” e o modo
   substituir (UI-D-569..UI-D-575);
3. as **confirmações**, a **exportação** e a **prévia** (UI-D-576, UI-D-577, UI-D-579, UI-D-580);
4. a **tela de completar o perfil** do membro, com os 13 controles, em três modos (primeira vez, retorno,
   edição) e os estados de erro, sem conexão, salvando e formulário mudou (UI-D-581..UI-D-588);
5. o **perfil**: o aviso “Há perguntas novas”, “Minhas respostas”, as respostas públicas no perfil de outro
   membro e a visão da equipe (UI-D-589..UI-D-593);
6. a **linha do módulo** no painel da plataforma e o diálogo de desativar (UI-D-594).

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos,
raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a
marca do tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px?

## How to View

```
open .planning/sketches/016-phase-12-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real. O arquivo abre offline. É um artefato de revisão sob `.planning/`: nenhum
código de aplicação o importa, empacota ou referencia. Os tokens são os de
`packages/ui/src/styles/tokens.css` e as primitivas (`Button`, `Card`, `StatusPill`, `Input`,
`BottomSheet`, `ConfirmDialog`, `Tabs`, o cartão de completude do perfil, o quadro do grupo `(auth)`) são
as dos sketches 013, 014 e 015, sem mudança; só a seção 19 do CSS é da Fase 12.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro**, as duas cores e quatro
presets (Rede Social neutro, Demo roxo, Lab verde e um **Amarelo claro**). Cada quadro leva o seu nome em
`data-frame` e na etiqueta, com a rota e o componente, na ordem da tabela “Sketch gate” do UI-SPEC. Telefones
de 390px (e de 320px onde o contrato pede) ficam ao lado da coluna de desktop.

**A Fase 12 não acrescenta nenhum token, cor, medida de espaçamento, tamanho de tipo ou peso.** Todo texto
vem do Copywriting Contract de `12-UI-SPEC.md`. Nenhum quadro mostra a resposta de um membro real, um
e-mail verdadeiro ou um token.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Seis perguntas, além da revisão visual:

### (a) A grade de 13 tipos (UI-D-570)

Treze ladrilhos em 2 colunas (3 a partir de md), com ícone, nome e dica. Ver `editor-tipo-grade`,
`editor-nova-texto-curto`.

*A decidir:* a grade lê tão rápido quanto um menu, e recolhe limpo depois da escolha?

### (b) As pílulas neutras (UI-D-566)

Tipo e “No perfil” em pílulas neutras, mais “Obrigatória/Opcional” em texto simples. Ver `construtor-lista`.

*A decidir:* se leem bem numa lista de 7 linhas, ou o estado obrigatório precisa de uma marca mais forte?

### (c) Subir e descer (UI-D-567)

Modo “Reordenar” com duas setas de 44px por linha, sem arrastar. Ver `construtor-reordenar`.

*A decidir:* parecem naturais num telefone?

### (d) O formulário com 20 perguntas (UI-D-582)

Todas as perguntas num único cartão, com só as obrigatórias que faltam marcadas em perigo. Ver
`membro-retorno-faltando` (inclui um quadro com 20 perguntas), `membro-primeira`.

*A decidir:* continua legível, e as perguntas faltantes se destacam sem um paredão de vermelho?

### (e) 44px em 320px (UI-D-584)

As cinco estrelas (220px), as linhas de caixa e rádio e os três botões da linha de opção que quebram. Ver
`membro-320`, `editor-320`.

*A decidir:* cumprem 44px nas duas larguras?

### (f) O aviso “Há perguntas novas” (UI-D-589)

Cartão neutro com disco cinza, ao lado do cartão de completude entregue. Ver `perfil-aviso-novas`.

*A decidir:* é distinto o bastante do cartão de completude quando os dois aparecem?

## Para o product owner

PU-1 a PU-13 do UI-SPEC (§ Pending User Confirmation) são os **padrões do pesquisador**; o product owner
ainda pode revogar qualquer uma nesta revisão. A **PU-14** (os tipos de elemento da seção “UI Considerations”)
foi **confirmada pelo product owner em 2026-10-29**, em `/gsd-ui-phase 12`. Os pontos que mais mudam o
desenho se revogados: PU-1 (a catraca de “Mostrar no perfil do membro” com respostas, UI-D-575, quadro
`editor-perfil-congelado`), PU-4 (um só formulário pré-preenchido em vez de “só as novas”, quadro
`membro-retorno-faltando`), PU-6 (a edição na mesma rota do grupo `(auth)`, quadro `membro-edicao`) e PU-7
(sem arrastar, quadro `construtor-reordenar`). Se Igor dispensar o portão, ele registra a dispensa como
decisão em `12-CONTEXT.md` e os planos 11 a 18 tiram a guarda; a parte mínima que ele ainda deveria olhar é
o quadro `membro-retorno-faltando`.

## Achados do próprio desenho, para a revisão fechar

1. **F-1 — “colapsado” no perfil.** O UI-SPEC nomeia `perfil-minhas-respostas` e
   `perfil-minhas-respostas-colapsado` sem dizer o que cada um mostra. O desenho usa o primeiro para a seção
   com até quatro linhas (e o caso de 320px com resposta longa) e o segundo para mais de quatro linhas, com
   o `details` fechado e aberto.
2. **F-2 — “primeira vez” com valores.** `membro-primeira` mostra alguns campos preenchidos e marcados só
   para exibir os estados selecionados dos 13 controles. Na primeira vez real o formulário vem em branco e
   nada é sinalizado até o “Salvar”.
3. **F-3 — a frase do leitor de tela.** A região `aria-live` da reordenação é invisível no produto; o
   desenho a mostra como anotação.
4. **F-4 — folhas desenhadas inteiras.** No produto a folha tem altura máxima e rola.
5. **F-5 — o seletor de marca.** Recolore também o que no produto é neutro; serve para conferir a lista
   reservada de tinta de marca.
6. **F-6 — ícones.** Os glifos são redesenhos fiéis ao conjunto `lucide-react` do produto, não os arquivos
   reais.
7. **F-7 — fonte e medidas.** A Manrope só é usada se estiver instalada onde o arquivo for aberto; sem ela
   as quebras de 320px podem diferir um pouco.
8. **F-8 — desktop do formulário do membro.** O contrato não muda nada no desktop (coluna de 384px do grupo
   `(auth)`); o quadro de desktop de `membro-primeira` mostra isso.

## Decisions already fixed upstream

Já decididas em `12-CONTEXT.md` (D-580..D-596) e `12-UI-SPEC.md` (UI-D-564..UI-D-599) e **fora de
revisão**: o portão rígido com “Sair” sempre disponível e sem escrita na assinatura (D-581); todas as
perguntas numa só tela com um só “Salvar” (D-582); só o papel `member` é chamado a responder (D-584); a
conclusão é calculada, não gravada (D-585); pergunta opcional nunca segura o acesso (D-586); tipo e opções
com respostas ficam travados (D-587, UI-D-574); arquivar no lugar de excluir uma pergunta respondida
(D-588); os 13 tipos e os limites de número e data (D-590); “Outro” por pergunta (D-592); resposta privada
por padrão, com o aviso no próprio campo e a visão completa só para a equipe (D-593); o aviso LGPD na
criação, sem campo de finalidade (D-594); a exportação em CSV só para o admin, registrada (D-595); o módulo
ligável por tenant, desligado por padrão e o último da lista (D-596). Este desenho é um artefato de revisão
e nunca vira dependência do código.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** (o Amarelo claro mostra a
   tinta escura derivada).
2. **Construtor** — vazio, lista (telefone e desktop), sem obrigatória, reordenar, limite, erro e 320px.
3. **Folha** — a grade, criar, opções com e sem “Outro”, limites, erros, os três bloqueios, o congelamento
   do perfil, substituir, descartar e 320px.
4. **Confirmações, Arquivadas, exportação e prévia.**
5. **Membro** — os três quadros longos de `membro-primeira`, o retorno (e o quadro de 20 perguntas), erros,
   offline, salvando, formulário mudou, vazio, falha de leitura, 320px e escuro.
6. **Perfil e plataforma** — o aviso, “Minhas respostas”, outro membro, a visão da equipe e a linha do módulo.
7. **As perguntas (a) a (f) e os oito achados.**

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-417). Para aprovar, cole no frontmatter deste
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
`approved: false`, as tarefas de interface web dos planos 11 a 18 ficam bloqueadas**; os planos de servidor
(04 a 10) não esperam por esta revisão. Uma aprovação provisória do product owner já desbloqueia a
codificação; deltas posteriores do designer são um passe de polimento. A coluna Winner de `../MANIFEST.md`
só muda se o usuário pedir.
