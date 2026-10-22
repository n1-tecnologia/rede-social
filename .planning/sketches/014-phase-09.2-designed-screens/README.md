---
sketch: 014-phase-09.2-designed-screens
name: phase-09.2-designed-screens
phase: 09.2
question: "As telas novas do banco por tenant — o campo 'Código do projeto' do Dados (com o bloco de acesso manual), a linha 'Projeto' do resumo e a tarefa 'Preparar o banco de dados' da confirmação; a aba Banco com a visão geral (estado, projeto, esquema), a Preparação (etapa que falhou e 'Tentar de novo') e as Credenciais; a coluna Banco e o filtro 'Banco com problema' da lista de tenants; o selo 'Banco: Atrasado' do cabeçalho; e as telas 'Comunidade em atualização' e 'Comunidade em preparação' — leem como a própria linguagem do painel e das telas de acesso suspenso, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - dados-projeto-vazio
  - dados-projeto-erros
  - dados-projeto-acesso-manual
  - dados-320
  - resumo-projeto
  - confirmacao-banco-executando
  - confirmacao-banco-falhou-parcial
  - confirmacao-banco-segundo-plano
  - banco-pronto
  - banco-atrasado
  - banco-pausado
  - banco-inacessivel
  - banco-nao-verificado
  - banco-compartilhado-fora-de-producao
  - banco-em-mudanca
  - banco-320-ref-e-textos-longos
  - preparacao-executando
  - preparacao-falhou
  - preparacao-concluida-recolhida
  - preparacao-concluida-expandida
  - preparacao-320
  - credenciais-guardadas
  - credenciais-folha-substituir
  - credenciais-folha-erro
  - credenciais-nao-informadas
  - banco-carregando-e-erro
  - lista-coluna-banco
  - lista-cartao-mobile
  - lista-filtro-problema
  - lista-filtro-vazio
  - cabecalho-selo-banco
  - status-reativar-bloqueado-mudanca
  - membro-em-atualizacao
  - membro-em-atualizacao-escuro
  - membro-em-preparacao
  - membro-marca-clara-e-escura
  - membro-320-nome-longo
  - entrar-cartao-em-atualizacao
  - cadastro-cartao-em-preparacao
  - cadastro-email-existente
  - toasts
status: approved
approved: true
approved_by: Igor (recorded by Claude on Igor's instruction)
approved_at: 2026-10-22
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-09.2, design-review, D-33, UI-04, D-417, database-per-tenant]
---

# Sketch 014: Fase 09.2 — Banco por tenant (portão de revisão D-417 / D-365 / D-33)

## Design Question

A Fase 09.2 faz cada tenant rodar no seu próprio projeto Supabase (Postgres, Auth, Storage e Realtime
próprios). A parte que aparece na tela é pequena e se divide em dois públicos. O protótipo do time de
design **não** tem painel da plataforma, tela de banco do tenant nem tela "em atualização"
(`reference/frontend-design/` conferido em 2026-10-22), então todas as superfícies desta fase são
**[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de
codar**:

1. o assistente "Novo tenant": o grupo "Projeto Supabase" do passo Dados (UI-D-533) e o bloco de
   acesso manual (UI-D-534), a linha "Projeto" do Resumo e a tarefa "Preparar o banco de dados" da
   confirmação (UI-D-535);
2. a aba **Banco** do tenant: a visão geral com os oito estados (UI-D-536, UI-D-539), a Preparação
   (UI-D-537), as Credenciais e a folha de troca (UI-D-538), o carregando e o erro (UI-D-544);
3. a lista de tenants: a coluna Banco, o cartão em telas pequenas e o filtro "Banco com problema"
   (UI-D-540);
4. o selo "Banco: {estado}" do cabeçalho e a guarda da aba Status durante uma mudança (UI-D-541);
5. as telas do membro "Comunidade em atualização" e "Comunidade em preparação", os cartões de entrar e
   de cadastro para os mesmos estados e a linha de e-mail repetido restaurada (UI-D-542, UI-D-543).

A pergunta de design: tudo isso lê como a linguagem do painel e das telas de acesso suspenso — ground
`#f5f7fb` com cartões brancos, raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos
400 / 700 e **uma** cor de destaque (a neutra da plataforma no painel, a do tenant nas telas de
membro) —, em claro e escuro, sob qualquer marca, em 320 e 390px?

## How to View

```
open .planning/sketches/014-phase-09.2-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota,
sem webfont remota e sem imagem real: os logos são formas de CSS. O arquivo abre offline e pode ser
enviado como está. É um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa,
empacota ou referencia. Os tokens são os de `packages/ui/src/styles/tokens.css` (copiados via sketch
013), e as primitivas (`Button`, `Card`, `StatusPill`, `Chip`, `Tabs`, `BottomSheet`, `EmptyState`,
`Input`, `Skeleton`, o assistente, `UnavailableCard`) são as dos sketches anteriores, sem mudança; só a
seção 17 do CSS é da Fase 09.2.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro**, as duas cores do
tenant e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um **Amarelo claro** cuja tinta
derivada é escura). Eles recolorem **só as telas de membro**: o painel vive no host da plataforma e usa
sempre a marca neutra. Os quadros `membro-em-atualizacao-escuro` e `membro-marca-clara-e-escura` forçam
o seu próprio tema e a sua própria marca. Cada quadro leva o seu nome em `data-frame` e na etiqueta,
com a rota ou o componente. Telefones de 390px (e de 320px onde o contrato pede) ficam ao lado da
coluna de desktop (a coluna de 1040px do painel com o trilho de 240px; a coluna de acesso `max-w-sm` das
telas de membro). Os três "Ver etapas" são `<details>` nativos e abrem e fecham.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 09.2 não acrescenta nenhum
token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC § Design System).
Todo texto de interface vem do § Copywriting Contract de `09.2-UI-SPEC.md` ou dos catálogos já
entregues. Nenhum quadro mostra uma credencial, um endereço de pooler ou um texto bruto de provedor
(UI-D-548).

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Seis perguntas, além da revisão visual:

### (a) Onde mora o código do projeto (UI-D-533)

Um campo em Dados, abaixo do e-mail, contra um sexto passo do assistente. Ver `dados-projeto-vazio`,
`dados-projeto-erros`, `dados-projeto-acesso-manual`.

*A decidir:* o formulário ainda lê como "quem é o tenant"?

### (b) Oito pílulas (UI-D-539)

Atenção ("vai se resolver ou espera um terceiro": Atrasado, Pausado) contra perigo ("precisa de uma
pessoa agora": Preparação falhou, Inacessível). Ver `lista-coluna-banco`, `banco-atrasado`,
`banco-inacessivel`, `banco-pausado`.

*A decidir:* a diferença se lê ao descer a lista de tenants?

### (c) O estado concluído recolhido (UI-D-537)

Uma linha "Preparação concluída em …" com "Ver etapas", contra oito linhas verdes permanentes. Ver
`preparacao-concluida-recolhida`, `preparacao-concluida-expandida`.

*A decidir:* o histórico continua fácil de achar?

### (d) A espera longa do diálogo (UI-D-535)

A tarefa "Preparar o banco de dados" com a linha da etapa e o botão fantasma "Continuar em segundo
plano" depois de 60 s. Ver `confirmacao-banco-executando`, `confirmacao-banco-falhou-parcial`,
`confirmacao-banco-segundo-plano`.

*A decidir:* está claro o que acontece com o logo e o ícone?

### (e) As telas do membro (UI-D-542)

Um glifo, um título, uma frase e um "Verificar de novo" em contorno, sem relógio e sem atualização
automática. Ver `membro-em-atualizacao`, `membro-em-preparacao`, `membro-marca-clara-e-escura`,
`membro-320-nome-longo`.

*A decidir:* leem como calmas e na marca, e distintas de "Comunidade indisponível"?

### (f) A aba Banco em 320px (UI-D-536)

O código de 20 letras, o link "Abrir no Supabase" e a grade de definições. Ver
`banco-320-ref-e-textos-longos`, `preparacao-320`.

*A decidir:* quebra sem rolagem lateral?

## Para o product owner

Três perguntas do UI-SPEC (§ Pending User Confirmation) foram **aplicadas como padrões do pesquisador**
neste desenho. O product owner pode revogar qualquer uma nesta revisão:

- **PU-1.** O painel carrega "Verificar agora" e "Substituir credenciais" (UI-D-536, UI-D-538). Revogar
  tira o botão da visão geral e o cartão de troca; os estados ficam só de leitura.
- **PU-2.** A guarda de mudança em andamento na aba Status e a pílula "Em mudança" (UI-D-541).
  Revogar tira o quadro `status-reativar-bloqueado-mudanca`, a pílula e uma nota.
- **PU-3.** Um membro de um projeto pausado ou inacessível vê a "Comunidade indisponível" genérica, a
  mesma de uma suspensão (UI-D-542). Revogar pede uma terceira tela de membro e conta ao membro que
  houve uma queda.

## Achados do próprio desenho, para a revisão fechar

Desenhar mostrou seis pontos que o UI-SPEC não fecha ou que contradiz o código entregue. Medidas
feitas com a fonte reserva do sistema (a Manrope não está instalada onde o arquivo foi aberto):
confirmar com a Manrope na compilação real.

1. **F-1 — "Continuar em segundo plano" em tinta neutra.** O `ghost` entregue pinta o texto na cor da
   marca; o UI-SPEC põe o botão na lista "explicitamente não é acento". O desenho usa o texto neutro.
   Confirmar.
2. **F-2 — o aviso de "Em mudança".** O UI-D-539 dá linha de aviso a "Em mudança", mas só define tons
   para atenção e perigo. O desenho usa a linha informativa neutra do UI-D-534 (`bg-bg-tertiary`).
3. **F-3 — "Salvar credenciais" e o campo vazio.** Botão desabilitado até um campo ser preenchido, sem
   erro de campo na folha. Ver `credenciais-folha-substituir`.
4. **F-4 — a linha informativa fica no assistente.** A frase "Não conseguimos obter o acesso…" é do
   fallback do assistente; a folha de troca usa a introdução própria e os mesmos três campos.
5. **F-5 — "Esquema" sem versão da lista.** A lista omite a linha em Em preparação, Preparação falhou
   e Em mudança; a aba mostra o progresso ("0 de 147", "98 de 147"). O contrato não fixa esse valor.
6. **F-6 — medidas com a fonte real.** A largura das pílulas e dos botões em 320px deve ser conferida
   com a Manrope.

## Decisions already fixed upstream

Já decididas em `09.2-CONTEXT.md` (D-533..D-547) e `09.2-UI-SPEC.md` (UI-D-533..UI-D-548) e **fora de
revisão**: uma conta por tenant e a retirada das telas da Fase 08.1 (D-533, UI-D-543); a mudança é um
comando, sem tela (D-536); as credenciais são seladas e só de escrita no painel (D-539, UI-D-538,
UI-D-548); o painel pede o código do projeto (D-541); o bootstrap é uma lista de etapas idempotentes
com "Tentar de novo" (D-542); o plano é só informação (D-543); "migrar todos" é de CI e de linha de
comando, o painel só mostra a versão (D-544); um tenant atrasado vê "em atualização" (D-545). Nesta
fase não existem botão de "migrar todos" ou "Atualizar agora", botão de "Mover para projeto próprio",
tela de mover, criação do projeto pelo painel, contagem de membros por tenant, tela com
atualização automática ou contagem regressiva, nem aviso "sua sessão terminou".

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o Amarelo
   claro mostra a tinta escura derivada). Só as telas de membro mudam de cor; o painel não.
2. **Assistente** — Dados vazio e com os erros, o bloco manual, o Resumo, os três estados do diálogo.
3. **Aba Banco** — os oito estados, a Preparação (executando, falhou, recolhida e aberta), as
   Credenciais e a folha, o carregando e o erro.
4. **Lista, cabeçalho e Status** — a coluna, o cartão, o filtro, o selo e o botão bloqueado.
5. **Telas do membro** — claro e escuro, sob as duas marcas, em 320px com o nome longo.
6. **Os 320px** — o código de 20 letras, o rótulo "Agendar o convite do primeiro administrador" e o
   bloco manual.
7. **As perguntas (a) a (f) e os seis achados.**
8. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/`
   (`platform.database.json`, `updating.json`, `preparing.json`, `platform.wizard.json`,
   `platform.json`, `signup.json`).

## O que este portão prende

**Esta revisão é o portão, não uma formalidade.** Enquanto este arquivo disser `approved: false`, as
tarefas de interface dos planos 18, 19, 20 e 21 (o assistente, a aba Banco, a lista, o cabeçalho e a
guarda do Status, e as telas do membro) ficam bloqueadas: cada uma carrega uma `precondition` que
procura `^approved: true` aqui. **Os planos de núcleo, SQL, API, worker, CI, a ferramenta de mover e a
remoção do código morto da Fase 08.1 não esperam por esta revisão.**

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

(Os cinco valores vão no frontmatter do topo, sem o recuo de quatro espaços mostrado aqui. O recuo
existe para que o exemplo não seja lido como se o portão já estivesse aberto: as tarefas procuram
`approved: true` no começo de uma linha.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Onde o desenho aprovado e o
`09.2-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit (os achados F-1
e F-2 pedem exatamente isso).

Seguindo o precedente dos sketches 001 a 013, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner de `../MANIFEST.md` só muda se o usuário pedir.
