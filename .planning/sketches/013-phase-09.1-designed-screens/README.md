---
sketch: 013-phase-09.1-designed-screens
name: phase-09.1-designed-screens
phase: 09.1
question: "As telas novas do acesso por pagamento — o Pagamentos do admin com Configuração (integração, produtos de acesso e a chave 'Exigir assinatura para entrar' com a confirmação), Acessos (linhas, filtros, bloquear, liberar e-mail) e Eventos (estados, 'Liberar manualmente'); a tela 'Sua assinatura não está ativa'; o aviso 'Seu acesso ainda não foi liberado' no cadastro, no login e no participar; o selo e o filtro 'Assinatura pendente' em Membros; o bloco 'Pagamento' do formulário de produto; o 'Comprar' que abre a página de pagamento e o 'Indisponível'; a notificação 'Compra confirmada'; e a linha 'Pagamentos' do painel da plataforma — leem como a própria linguagem do protótipo e das telas de Membros e Loja, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - pagamentos-abas-390
  - pagamentos-abas-320
  - configuracoes-linha-pagamentos
  - config-nao-conectado
  - config-conectado-ultimo-evento
  - config-conectado-sem-evento
  - config-token-erro
  - config-produtos-vazio
  - config-produtos-lista-dois
  - config-produto-folha-novo
  - config-produto-folha-editar-erros
  - config-produto-remover
  - config-produto-remover-ultimo-recusa
  - config-chave-desabilitada
  - config-chave-confirmar-sem-ninguem
  - config-chave-confirmar-com-membros-liberar
  - config-chave-confirmar-com-membros-cortar
  - config-chave-confirmar-320
  - config-chave-ligada
  - config-carregando-e-erro
  - config-320-textos-longos
  - acessos-populada
  - acessos-vazio
  - acessos-filtro-vazio
  - acessos-busca-vazia
  - acessos-folha-gateway
  - acessos-folha-manual
  - acessos-folha-bloqueado
  - acessos-bloquear-dialogo
  - acessos-remover-liberacao-dialogo
  - acessos-liberar-folha
  - acessos-liberar-erros
  - acessos-carregando-e-erro
  - acessos-320-email-longo
  - eventos-populada
  - eventos-liberar-manualmente-dialogo
  - eventos-sem-conta-erro-409
  - eventos-vazio
  - eventos-carregando-e-erro
  - eventos-320-textos-longos
  - pendente-com-link
  - pendente-sem-link
  - pendente-320-nome-longo
  - pendente-escuro
  - pendente-marca-clara-e-escura
  - aviso-cadastro-com-assinar
  - aviso-cadastro-sem-link
  - aviso-login
  - aviso-participar-com-verificar
  - aviso-320
  - membros-selo-e-filtro
  - membros-filtro-vazio
  - membros-folha-assinatura-pendente
  - produto-formulario-bloco-pagamento
  - produto-formulario-aviso-sem-link
  - produto-formulario-erro-id
  - produto-pagina-comprar-gateway
  - produto-pagina-indisponivel
  - produto-pagina-gestor-selo
  - produto-pagina-liberada
  - notificacao-compra-confirmada
  - notificacao-compra-removida
  - push-compra-confirmada
  - plataforma-linha-pagamentos
  - plataforma-desativar-dialogo
  - toasts
status: approved
approved: true
approved_by: Igor (recorded by Claude on Igor's explicit instruction in the execute-phase session, 2026-10-20 and 2026-10-21)
approved_at: 2026-10-21
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-09.1, design-review, D-33, UI-04, D-417, payments]
---

# Sketch 013: Fase 09.1 — Acesso por pagamento (portão de revisão D-417 / D-365 / D-33)

## Design Question

A Fase 09.1 faz o gateway de pagamento de cada tenant (o Kiwify primeiro, atrás de uma interface
neutra de provedor) decidir quem pode entrar na comunidade e quem é dono de um produto da loja. O
protótipo do time de design **não** tem nenhuma tela de pagamentos, de loja ou de compra
(`reference/frontend-design/` conferido em 2026-10-20), então todas as superfícies desta fase são
**[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de
codar**:

1. a linha "Pagamentos" em Configurações e a página Pagamentos com as abas Configuração · Acessos ·
   Eventos (UI-D-513, UI-D-528);
2. a Configuração: o cartão Integração, os produtos de acesso e a chave "Exigir assinatura para
   entrar" com a confirmação e a caixa de liberar (UI-D-514, UI-D-515, UI-D-516);
3. Acessos: a lista, os filtros, as folhas e os diálogos de bloquear, liberar e remover (UI-D-517,
   UI-D-518, UI-D-520);
4. Eventos: os quatro estados e "Liberar manualmente" (UI-D-519, UI-D-520);
5. a tela "Sua assinatura não está ativa" (UI-D-521);
6. o aviso de acesso no cadastro, no login e no participar (UI-D-522);
7. o selo, o filtro e a nota em Membros (UI-D-523);
8. o bloco "Pagamento" do formulário de produto e a página do produto com "Comprar" e "Indisponível"
   (UI-D-524, UI-D-525);
9. a notificação "Compra confirmada" e o seu push (UI-D-526);
10. a linha "Pagamentos" do painel da plataforma e a confirmação de desativar (UI-D-527).

A pergunta de design: tudo isso lê como a linguagem do protótipo e das telas de Membros e Loja —
ground `#f5f7fb` com cartões brancos, raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com
pesos 400 / 700 e **uma** cor de destaque, que é a do tenant —, em claro e escuro, sob qualquer marca,
em 320 e 390px?

## How to View

```
open .planning/sketches/013-phase-09.1-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota,
sem webfont remota e sem imagem real: as fotos são gradientes. O arquivo abre offline e pode ser
enviado como está. É um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa,
empacota ou referencia. As primitivas e o chrome (tokens, BottomNav, trilho, `Button`, `Card`,
`EmptyState`, `ConfirmDialog`, `BottomSheet`, `Switch`, `Toast`, abas sublinhadas, `StatusPill`) são
os dos sketches 010 a 012, sem mudança; só a seção 16 do CSS é da Fase 09.1.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro**, as duas cores do
tenant e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um **Amarelo claro** cuja tinta
derivada é escura). Escrevem as cinco variáveis `--brand-*` como `brandStyleVars()` faz no servidor.
Os quadros `pendente-escuro` e `pendente-marca-clara-e-escura` forçam o seu próprio tema e a sua
própria marca, seja qual for o botão do topo. Cada quadro leva o seu nome em `data-frame` e na
etiqueta, com a rota ou o componente. Telefones de 390px (e de 320px onde o contrato pede) ficam ao
lado da coluna de desktop de 680px com o trilho de 240px, que **não** tem entrada de Pagamentos: a
porta é a linha em Configurações (UI-D-513). O diálogo da chave responde à caixa (o tom e o ajudante
mudam ao desmarcar); o resto é estático.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 09.1 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC
§ Design System). Todo texto de interface vem do § Copywriting Contract de `09.1-UI-SPEC.md` ou dos
catálogos já entregues. O tenant é **Rede Demo**; o gateway é o **Kiwify**.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Sete perguntas, além da revisão visual:

### (a) Três abas contra uma página longa (UI-D-513)

Configuração, Acessos e Eventos como três abas sublinhadas (`HubTabs`), em vez de uma página longa.
Ver `pagamentos-abas-390`, `pagamentos-abas-320`.

*A decidir:* o admin acha "quem tem acesso" sem procurar?

### (b) Pílulas por linha e aviso contra perigo (UI-D-517, UI-D-520)

Estado, origem e "Ainda sem conta" na mesma linha sob o e-mail. Ver `acessos-populada`,
`acessos-320-email-longo`, `eventos-populada`.

*A decidir:* continua legível em 320px, e a cor de aviso (o dinheiro decidiu) lê diferente da de
perigo (uma pessoa decidiu)?

### (c) A tela de corte e as suas três ações empilhadas (UI-D-521)

"Regularizar" de marca, "Verificar de novo" em contorno e "Sair". Ver `pendente-com-link`,
`pendente-sem-link`, `pendente-marca-clara-e-escura`.

*A decidir:* lê calma e clara, ou como castigo?

### (d) O "Assinar" em contorno sob a frase (UI-D-522)

Ver `aviso-cadastro-com-assinar`, `aviso-participar-com-verificar`, `aviso-320`.

*A decidir:* o contorno basta ao lado do envio de marca do formulário, ou o caminho para comprar se
perde?

### (e) O "Comprar" por link externo e a sua ajuda (UI-D-525)

Ver `produto-pagina-comprar-gateway`, `produto-pagina-indisponivel`, `produto-pagina-liberada`.

*A decidir:* a pessoa entende que o pagamento acontece fora e que a liberação é automática?

### (f) A caixa de liberar no diálogo da chave e a troca de tom (UI-D-516)

A caixa vem marcada (tom de marca: ninguém é cortado); ao desmarcar, o tom vira perigo. Ver
`config-chave-confirmar-com-membros-liberar`, `config-chave-confirmar-com-membros-cortar`,
`config-chave-confirmar-320`.

*A decidir:* o admin lê "liberar" contra "cortar" sem uma segunda olhada, e o diálogo cabe em 320px
com o plural e a caixa?

### (g) "Sem conta" na lista de eventos (UI-D-531)

O product owner escolheu "Sem conta" em 2026-10-20 no lugar de uma palavra interna que nenhuma outra
tela mostra a um usuário. Ver `eventos-populada`.

*A decidir:* lê claro?

## Para o product owner

Nada está em aberto. As três perguntas do product owner (PU-1, PU-2 e PU-3) foram respondidas em
**2026-10-20** (a caixa de liberar na confirmação da chave; sem "Desconectar"; "Sem conta") e não se
perguntam de novo. Estão registradas em `09.1-UI-SPEC.md` § Pending User Confirmation.

## Achados do próprio desenho, para a revisão fechar

Desenhar mostrou seis pontos que o UI-SPEC não fecha ou que contradiz o código entregue. Medidas
feitas com a fonte reserva do sistema (a Manrope não está instalada onde o arquivo foi aberto):
confirmar com a Manrope na compilação real.

1. **F-1 — "Sair" em tinta de marca ou neutra.** O `ghost` entregue pinta o texto na cor da marca; a
   lista de tinta de marca do UI-SPEC não inclui "Sair". O desenho usa o texto neutro. Confirmar.
2. **F-2 — o texto de "comprado".** O UI-SPEC (UI-D-525) cita "Você já tem este produto"; o catálogo
   entregue diz "Comprado" / "Você tem acesso a este produto.". O desenho usa o entregue.
3. **F-3 — token vazio: botão desabilitado e erro ao mesmo tempo.** UI-D-514 pede as duas coisas. O
   desenho mostra o erro ao esvaziar e deixar o campo, com o botão desabilitado. Ver `config-token-erro`.
4. **F-4 — a ação ao lado do texto em 320px (Eventos).** "Liberar manualmente" ao lado da coluna de
   texto a encolhe a uns 80px. O desenho traz a alternativa (a ação abaixo do texto abaixo de 360px).
   Ver `eventos-320-textos-longos`.
5. **F-5 — rótulos do formulário de cadastro.** O catálogo entregue diz "Nome completo", "Email",
   "Senha", "Cadastrar" e "Não participar"; o desenho usa o entregue.
6. **F-6 — medidas com a fonte real.** A largura das pílulas e dos botões em 320px deve ser conferida
   com a Manrope.

## Decisions already fixed upstream

Já decididas em `09.1-CONTEXT.md` (D-485..D-509) e `09.1-UI-SPEC.md` (UI-D-513..UI-D-532) e **fora de
revisão**: a chave é por tenant e liga a entrada e a loja a um provedor neutro (D-485, D-486); o
acesso é por e-mail e existe antes da conta (D-490); um bloqueio manual vale mais que a assinatura
(D-489); a tela de corte não limpa a sessão (D-499); o admin não recebe aviso de corte nem de volta
(D-500); o link de compra vem sempre da API, nunca da URL (UI-D-532); a loja nunca cai na compra
simulada em modo de pagamento (D-508). Nesta fase não existem "Desconectar", importação em lote,
visualizador de carga bruta, nova tentativa manual de evento nem e-mail da plataforma ao comprador.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Só recolore o que é da marca: o sublinhado da aba, os
   botões "Salvar integração", "Liberar acesso", "Regularizar" e "Comprar", o interruptor ligado, o chip
   ativo e o foco; as pílulas, os discos e "Assinar" **não** são cor de marca.
2. **Quadro e abas** — a linha em Configurações, as três abas, o 320px.
3. **Configuração** — o cartão de integração, a lista de produtos, a chave e as três confirmações
   (marque e desmarque a caixa no diálogo).
4. **Acessos e Eventos** — as linhas em 390 e 320px, as folhas, os diálogos e os erros.
5. **Tela de corte e aviso de acesso** — com e sem link, em 320px, em claro e escuro, sob as duas marcas.
6. **Membros, Loja, sino e plataforma** — as deltas.
7. **As perguntas (a) a (g) e os seis achados.**
8. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/payments.json`,
   `app.json`, `admin.json`, `signup.json`, `login.json`, `join.json`, `store.payments.json`,
   `notifications.json` ou `platform.payments.json`.

## O que este portão prende

**Esta revisão é o portão, não uma formalidade.** Enquanto este arquivo disser `approved: false`, as
tarefas de interface dos planos 13, 14, 15, 16 e 17 e, porque as suas especificações fixam o texto
aprovado, as do plano 19 ficam bloqueadas: cada uma carrega uma `precondition` que procura
`^approved: true` aqui. **Os planos de núcleo, SQL e API (02 a 12, 18 e 20) não esperam por esta
revisão.**

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-417). Para aprovar, cole no frontmatter
deste arquivo, no lugar dos valores pendentes:

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
`09.1-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit (os achados
F-1, F-2 e F-3 pedem exatamente isso).

Seguindo o precedente dos sketches 001 a 012, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner de `../MANIFEST.md` só muda se o usuário pedir.
