---
sketch: 015-phase-09.4-designed-screens
name: phase-09.4-designed-screens
phase: 09.4
question: "As telas novas do projeto do cliente — a escolha 'Projeto da plataforma / Projeto do cliente' e o campo do token (com a data de vencimento e o 'Como criar o token') no Dados do Novo tenant; as linhas Dono e Organização da aba Banco; o cartão 'Token de acesso' com os sete estados; a folha 'Substituir token'; e os selos 'Token: …' do cabeçalho e da lista — leem como a própria linguagem do painel aprovado no sketch 014, em claro e escuro, em 320 e 390px?"
screens:
  - dados-dono-plataforma
  - dados-dono-cliente
  - dados-cliente-erros
  - dados-cliente-320
  - resumo-cliente
  - banco-cliente-token-valido
  - banco-cliente-token-vencendo
  - banco-cliente-token-vencido
  - banco-cliente-token-invalido
  - banco-cliente-sem-permissao
  - banco-cliente-organizacao-diferente
  - banco-cliente-token-nao-verificado
  - banco-cliente-320
  - token-folha-substituir
  - token-folha-erro
  - token-como-criar-aberto
  - cabecalho-selo-token
  - lista-selo-token
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-09.4, design-review, D-33, UI-04, D-417, customer-token]
---

# Sketch 015: Fase 09.4 — Projeto do cliente (portão de revisão D-417 / D-365 / D-33)

## Design Question

A Fase 09.4 deixa um tenant rodar num projeto Supabase que mora na **conta do Supabase do cliente**,
dirigido por um token de acesso limitado a esse único projeto (nunca um token da conta inteira), que
Igor cria no painel do Supabase e cola no painel da plataforma. Quase tudo é trabalho de servidor; a
parte que aparece na tela é pequena e tem **um só público**: o operador da plataforma (`super_admin`).
O protótipo do time de design **não** tem painel da plataforma (`reference/frontend-design/`), então
todas as superfícies desta fase são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser
desenhadas e revisadas **antes de codar**:

1. o assistente "Novo tenant": a escolha do dono do projeto, o campo do token, a data de vencimento
   opcional e o passo a passo "Como criar o token" no Dados (UI-D-549, UI-D-550, UI-D-557); as linhas do
   Resumo e as três frases novas do diálogo (UI-D-556);
2. a aba **Banco**: as linhas Dono e Organização, o aviso do plano que não é Pro (UI-D-552) e o cartão
   **Token de acesso** com sete estados e cinco avisos (UI-D-551, UI-D-553, UI-D-554);
3. a folha **Substituir token** e as recusas dela (UI-D-555);
4. o selo "Token: …" do cabeçalho do tenant e da lista, e o chip "Banco com problema" mais largo
   (UI-D-560).

A pergunta de design: tudo isso lê como a linguagem do painel aprovado no sketch 014 — ground `#f5f7fb`
com cartões brancos, raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e
**uma** cor de destaque —, em claro e escuro, em 320 e 390px?

## How to View

```
open .planning/sketches/015-phase-09.4-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real. O arquivo abre offline. É um artefato de revisão sob `.planning/`:
nenhum código de aplicação o importa, empacota ou referencia (D-579). Os tokens são os de
`packages/ui/src/styles/tokens.css` e as primitivas (`Button`, `Card`, `StatusPill`, `Input`,
`SegmentedControl`, `BottomSheet`, o assistente, os cartões da aba Banco) são as dos sketches 013 e 014,
sem mudança; só a seção 18 do CSS é da Fase 09.4.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro**, as duas cores e
quatro presets (Rede Social neutro, Demo roxo, Lab verde e um **Amarelo claro**). Neste sketch eles
recolorem **também o painel**, de propósito, para conferir que a tinta de marca só aparece nos lugares
reservados; o painel real usa a marca neutra da plataforma. Cada quadro leva o seu nome em `data-frame`
e na etiqueta, com a rota e o componente. Telefones de 390px (e de 320px onde o contrato pede) ficam ao
lado da coluna de desktop do painel.

**A Fase 09.4 não acrescenta nenhum token, medida de espaçamento, tamanho de tipo ou peso** (UI-SPEC §
Design System). Todo texto vem do § Copywriting Contract de `09.4-UI-SPEC.md`. Nenhum quadro mostra o
token, um pedaço dele ou o tamanho dele (UI-D-561).

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Cinco perguntas, além da revisão visual:

### (a) A escolha do dono (UI-D-549)

"Onde fica o projeto?" como a primeira decisão do grupo "Projeto Supabase", e os dois rótulos em 320px.
Ver `dados-dono-plataforma`, `dados-dono-cliente`, `dados-cliente-320`.

*A decidir:* lê como a primeira decisão do grupo, e os rótulos sobrevivem a 320px?

### (b) Sete pílulas (UI-D-553)

Âmbar "Vencendo" contra perigo "Vencido", e as sete pílulas do token contra as oito do banco. Ver
`banco-cliente-token-vencendo`, `banco-cliente-token-vencido`, `banco-cliente-320`.

*A decidir:* se distinguem quando as duas famílias aparecem juntas?

### (c) O cartão à parte (UI-D-554)

O cartão "Token de acesso" como cartão próprio, entre Preparação e Credenciais, contra um segundo bloco
dentro de Credenciais. Ver `banco-cliente-token-valido`, `banco-cliente-token-invalido`.

*A decidir:* o cartão próprio é mais claro?

### (d) O passo a passo (UI-D-557)

`TokenHowTo` aberto no formulário e fechado no cartão e na folha. Ver `dados-dono-cliente`,
`token-como-criar-aberto`.

*A decidir:* é a divisão certa?

### (e) O terceiro selo (UI-D-560)

O selo "Token: …" do cabeçalho e o segundo selo da lista. Ver `cabecalho-selo-token`,
`lista-selo-token`, `banco-cliente-320`.

*A decidir:* quebram limpo em 320px?

## Para o product owner

PU-1 a PU-5 do UI-SPEC (§ Pending User Confirmation) foram **respondidas e aceitas por Igor em
2026-10-27**: PU-1 rodar este sketch (a aprovação do README continua na mão dele), PU-2 o selo
"Token: …" e o chip mais largo, PU-3 a data de vencimento digitada e opcional, PU-4 o aviso 30 dias
antes, PU-5 um token morto nunca afeta o membro. O product owner ainda pode revogar qualquer uma nesta
revisão. Se Igor dispensar o portão, ele registra a dispensa como decisão em `09.4-CONTEXT.md` e os
planos 14, 15 e 16 tiram a guarda; a parte mínima que ele ainda deveria olhar é o quadro
`banco-cliente-token-vencendo`.

## Achados do próprio desenho, para a revisão fechar

1. **F-1 — "Banco: Pronto" no cabeçalho.** O UI-D-541 só mostra "Banco: {estado}" quando o banco não
   está Pronto; o desenho mostra as combinações que existem.
2. **F-2 — o cabeçalho para "Não verificado".** O UI-D-560 diz "diferente de Válido"; a linha E08 e o
   chip excluem Não verificado. O desenho segue a segunda leitura.
3. **F-3 — o título de "Como criar o token" aberto.** Não definido no contrato; o desenho usa 14/700
   secundário.
4. **F-4 — `[PENDENTE-PERMISSÕES]`.** Aparece literal no passo 3; é um bloqueio de entrega (OQ-1).
   Aprovar o desenho não aprova a lista de permissões.
5. **F-5 — o seletor de marca.** Recolore também o painel, só neste sketch.
6. **F-6 — medidas com a fonte real.** A Manrope não estava instalada onde o arquivo foi aberto.
7. **F-7 — o controle entregue não quebra linha.** O `SegmentedControl` tem altura fixa e
   `whitespace-nowrap`; o UI-D-549 pede duas linhas em 320px. O código precisa de uma variante.

## Decisions already fixed upstream

Já decididas em `09.4-CONTEXT.md` (D-566..D-579) e `09.4-UI-SPEC.md` (UI-D-549..UI-D-563) e **fora de
revisão**: o token vale para um projeto só, é selado e só de escrita; um token morto nunca derruba a
comunidade nem aparece para o membro (UI-D-551); o estado do token é um eixo próprio, separado dos oito
estados do banco; o painel nunca mostra o token (UI-D-561); o caminho de volta, a transferência e o
novo registro da organização são comandos, sem tela; este desenho é um artefato de revisão e nunca vira
dependência do código (D-579).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** (o Amarelo claro
   mostra a tinta escura derivada).
2. **Assistente** — Dados com o dono da plataforma e do cliente, os erros, 320px, o Resumo e as três
   frases do diálogo.
3. **Aba Banco** — os sete estados do token, o 320px e o tenant de projeto da plataforma como contexto.
4. **Folha** — vazia, preenchida, com erros e com "Como criar o token" aberto.
5. **Cabeçalho e lista** — o terceiro selo e o chip "Banco com problema".
6. **As perguntas (a) a (e) e os sete achados.**

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
`status: changes-requested`). O desenho é revisado e a revisão se repete. **Enquanto este arquivo
disser `approved: false`, as tarefas de interface web dos planos 14, 15 e 16 ficam bloqueadas**; os
planos de servidor não esperam por esta revisão. Uma aprovação provisória do product owner já
desbloqueia a codificação; deltas posteriores do designer são um passe de polimento. A coluna Winner de
`../MANIFEST.md` só muda se o usuário pedir.
