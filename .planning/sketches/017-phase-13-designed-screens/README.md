---
sketch: 017-phase-13-designed-screens
name: phase-13-designed-screens
phase: "13"
question: "As telas novas do app nativo — a splash, as telas de sem internet, de atualizar e de bloqueio, a folha de ativar notificações, as linhas de notificação e de bloqueio nas Configurações, a leitura do feed sem internet, o cadeado no lugar do preço, a exclusão de conta, a aba App do painel e as telas de denunciar e bloquear — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - splash-marca-escura
  - splash-marca-clara
  - splash-sem-logo
  - barra-carregando
  - sem-internet
  - nao-foi-possivel-abrir
  - sem-internet-320
  - atualize-o-app
  - bloqueio-face-id
  - bloqueio-erro
  - bloqueio-tentativas
  - bloqueio-escuro
  - cobertura-de-privacidade
  - explicador-ativar
  - explicador-equipe
  - configuracoes-notificacoes-ligadas
  - configuracoes-notificacoes-bloqueadas
  - configuracoes-bloqueio-do-app
  - configuracoes-bloqueio-indisponivel
  - feed-salvo-faixa
  - feed-salvo-toque
  - feed-salvo-midia
  - feed-sem-copia
  - feed-salvo-320
  - loja-cadeado
  - produto-bloqueado
  - comunidade-bloqueada
  - curso-bloqueado
  - produto-comprado-intacto
  - configuracoes-linha-excluir
  - excluir-conta-pagina
  - excluir-conta-dialogo
  - excluir-conta-erros
  - excluir-conta-unico-admin
  - exclusao-agendada
  - exclusao-cancelada-toast
  - app-vazio
  - app-em-preparacao
  - app-pronto
  - app-publicado
  - app-nome-longo
  - app-chaves-folha
  - app-chaves-erro
  - app-links-no-ar
  - app-links-incompletos
  - app-compra-desligada
  - app-compra-ligar-dialogo
  - app-ficha-revisor
  - app-passo-a-passo
  - app-320
  - post-menu-denunciar
  - comentario-menu
  - denunciar-folha
  - denunciar-enviando
  - denunciar-erro
  - denunciar-ja-feita
  - bloquear-dialogo
  - bloqueados-linha
  - bloqueados-lista
  - bloqueados-vazio
  - denuncias-linha-moderacao
  - denuncias-lista
  - denuncias-vazio
  - denuncias-resolver-folha
  - denuncias-remover-dialogo
  - denuncias-320
  - conteudo-bloqueado-oculto
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-13, design-review, D-417, UI-04, native-app, D-616]
---

# Sketch 017: Fase 13 — App nativo por tenant (portão de revisão D-417 / D-365 / D-33)

## Design Question

A Fase 13 coloca o app de cada tenant nas lojas de apps como uma casca nativa em volta das telas da web
(D-600, D-603). A parte nova que aparece na tela é pequena, mas **nenhuma dela existe no protótipo do time
de design** (`reference/frontend-design/`): as telas desenhadas pelo próprio app, as peças da web que só
existem dentro do app, a exclusão de conta, a aba App do painel da plataforma e, depois das decisões
D-616 a D-619, as telas de denunciar e bloquear. Pelas regras D-33, D-365 e D-417, todas são
**[designed]** e precisam ser desenhadas e revisadas **antes de codar**:

1. o **lançamento**: a splash sob marca escura, marca clara e sem logo, e a barra de carregamento
   (UI-D-602, UI-D-603);
2. as **telas nativas**: sem internet, não foi possível abrir, atualize o app, o bloqueio com Face ID e a
   cobertura de privacidade (UI-D-610, UI-D-611, UI-D-613);
3. as **notificações**: a folha que explica antes do pedido do sistema, as linhas de notificação e de
   "Bloqueio do app" nas Configurações (UI-D-607..UI-D-609);
4. o **feed salvo, desenhado pelo app** (D-618, UI-D-639, UI-D-640): a faixa, o toque, a mídia sem cópia, a
   tela sem cópia salva e os 320px;
5. a **compra desligada**: o cadeado no lugar do preço na Loja, no produto, na comunidade e no curso
   (UI-D-615);
6. a **exclusão de conta**: a linha, a página, a confirmação, os erros, o aviso do último administrador, a
   tela "Exclusão agendada" e o aviso de exclusão cancelada (UI-D-616..UI-D-619);
7. a **aba App** do painel: identidade, acessos às lojas, links, compra no app (os dois botões
   **desligados**, D-617, UI-D-641), ficha nas lojas e passo a passo (UI-D-620..UI-D-627);
8. **denunciar e bloquear** (D-616, UI-D-632..UI-D-638): os menus da publicação e do comentário, a folha de
   denúncia e seus estados, o diálogo de bloqueio, a lista de bloqueados, a lista de denúncias do admin e a
   folha de resolver.

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos,
raios de 12px, alvos de 44px (48dp nas telas nativas), a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e
**uma** cor de destaque, a marca do tenant —, em claro e escuro, sob qualquer marca (uma escura e uma
clara), em 320 e 390px?

## How to View

```
open .planning/sketches/017-phase-13-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real. O arquivo abre offline. É um artefato de revisão sob `.planning/`: nenhum
código de aplicação o importa, empacota ou referencia. Os tokens são os de
`packages/ui/src/styles/tokens.css` e as primitivas (`Button`, `Card`, `StatusPill`, `Input`, `Switch`,
`BottomSheet`, `ConfirmDialog`, `EmptyState`, `Tabs`, o quadro do grupo `(auth)`) são as dos sketches 013 a
016, sem mudança; só a seção 20 do CSS é da Fase 13.

Controles no topo (chrome do mockup, fora do produto): **Tema escuro / Tema claro**, as duas cores e quatro
presets (Rede Social neutro, **Marinho escuro**, **Amarelo claro** e Demo roxo). Os quadros de splash e de
bloqueio fixam, de propósito, uma marca escura e uma clara lado a lado, para a leitura não depender do
seletor. Cada quadro leva o seu nome em `data-frame` e na etiqueta, com a rota e o componente, na ordem da
lista `screens:` acima. Telefones de 390px (e de 320px onde o contrato pede) ficam ao lado da coluna de
desktop onde a superfície existe no desktop.

**A Fase 13 não acrescenta nenhum token, cor, medida de espaçamento, tamanho de tipo ou peso.** Todo texto
vem do Copywriting Contract de `13-UI-SPEC.md` ou de `13-UI-SPEC-ADDENDUM.md`. Nenhum quadro mostra um
membro real, um e-mail verdadeiro, uma chave ou uma senha. O logo do tenant é simulado.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito perguntas, além da revisão visual:

### (a) A splash (UI-D-602)

O logo sobre a cor da marca, como o ícone, lê bem numa marca muito clara e numa muito escura? Ver
`splash-marca-escura`, `splash-marca-clara`, `splash-sem-logo`. A troca para o fundo da página (200ms)
parece abrupta? Ver `barra-carregando`.

### (b) O bloqueio (UI-D-610)

A tela de bloqueio é calma: logo, uma frase, um botão e uma saída? Ver `bloqueio-face-id`, `bloqueio-erro`,
`bloqueio-tentativas`, `bloqueio-escuro`, `cobertura-de-privacidade`.

### (c) O cadeado no lugar do preço (UI-D-615)

A pílula "Bloqueado" com cadeado substitui o preço na Loja sem parecer quebrada? Ver `loja-cadeado`,
`produto-bloqueado`, `comunidade-bloqueada`, `curso-bloqueado`.

### (d) A folha que explica as notificações (UI-D-607)

A folha é distinta o bastante do pedido do sistema que vem depois? Ver `explicador-ativar`,
`explicador-equipe`.

### (e) A exclusão de conta (UI-D-617)

A página lê como séria sem virar um paredão de vermelho (um botão vermelho, um aviso âmbar)? Ver
`excluir-conta-pagina`, `excluir-conta-dialogo`, `exclusao-agendada`.

### (f) A aba App em 320px (UI-D-620)

Os seis cartões continuam escaneáveis em 320px? Ver `app-pronto`, `app-320`.

### (g) Denunciar e bloquear (D-616)

As telas de denunciar e bloquear ficam discretas, sem parecer um muro de vermelho? A fila de denúncias do
admin é fácil de varrer? Ver `post-menu-denunciar`, `comentario-menu`, `denunciar-folha`,
`bloquear-dialogo`, `denuncias-lista`, `denuncias-320`.

### (h) O feed salvo desenhado pelo app (D-618, UI-D-639)

A lista salva do feed, desenhada pelo app, parece a mesma do feed da web? Ver `feed-salvo-faixa`,
`feed-salvo-midia`, `feed-salvo-320`.

## Para o product owner

PU-1 a PU-14 do UI-SPEC (§ Pending User Confirmation) e **AD-1 a AD-8** do adendo
(`13-UI-SPEC-ADDENDUM.md`) são **padrões do planejador**; o product owner ainda pode revogar qualquer um
nesta revisão. O UI-SPEC foi aprovado antes das decisões D-616 a D-619; o adendo é o contrato da interface
dessas quatro decisões e este desenho mostra os dois juntos, para a aprovação ser de um desenho só.

As oito suposições do adendo, **desenhadas onde aparecem e listadas aqui como perguntas** (padrão: aceitas):

| # | Suposição | Se Igor revogar | Onde ver |
|---|---|---|---|
| AD-1 | Um membro só pode bloquear outro `member`, nunca `admin_tenant` nem `support_tenant` (são a voz do tenant e o canal de suporte); a equipe ainda pode ser denunciada. | Permitir o bloqueio da equipe deixaria um membro esconder publicações oficiais e respostas do suporte; o esquema não muda. | `post-menu-denunciar`, `comentario-menu` |
| AD-2 | O conteúdo de um membro bloqueado some sem marcador no lugar. | Um marcador "Conteúdo de membro bloqueado" acrescenta um componente de linha por lista. | `conteudo-bloqueado-oculto` |
| AD-3 | Os contadores de comentário e curtida não são recalculados por quem vê. | Contagem por leitor exige um join em toda consulta de lista; fora da fatia mínima. | `conteudo-bloqueado-oculto` |
| AD-4 | O toque num cartão do feed salvo, desenhado pelo app, mostra a frase de sem internet e não abre nada. | Abrir a publicação exigiria a página, que está sem rede: nada mais é possível. | `feed-salvo-toque` |
| AD-5 | Os motivos da denúncia são os cinco listados, fixos pela restrição da tabela (só se acrescenta depois). | Denúncia só com texto livre é mais simples, mas não dá ao admin nada para filtrar. | `denunciar-folha` |
| AD-6 | A denúncia é por par (quem denuncia, o item): uma segunda denúncia do mesmo item pelo mesmo membro é recusada com "Você já denunciou isto."; denúncias de membros diferentes são linhas separadas. | Agrupar por item acrescenta uma coluna de contagem e outra consulta de lista. | `denunciar-ja-feita`, `denuncias-lista` |
| AD-7 | Denúncias de uma publicação ou comentário do próprio autor, de itens apagados e de itens de outro tenant são recusadas. | Nenhuma. | `post-menu-denunciar` (o menu da própria publicação não tem "Denunciar") |
| AD-8 | As superfícies de denunciar e bloquear existem no navegador e no app, com o módulo `social` ligado ou desligado (a fatia mínima é capacidade do núcleo, não parte do `social`). | Prender ao `social` deixaria os comentários da V1 sem caminho de denúncia na revisão das lojas. | `post-menu-denunciar`, `comentario-menu` |

Os pontos que mais mudam o desenho se revogados: PU-1 (a folha de notificações como folha, não tela cheia),
PU-3 (a senha na exclusão), AD-1 (bloquear a equipe) e AD-2 (o marcador). Se Igor dispensar o portão, ele
registra a dispensa como decisão em `13-CONTEXT.md` e os planos de interface (17, 18, 19, 20, 21, 22, 25, 27
e 28) tiram a guarda; a parte mínima que ele ainda deveria olhar é o quadro `bloqueio-face-id` junto com
`excluir-conta-pagina` e `denunciar-folha`.

## Achados do próprio desenho, para a revisão fechar

1. **F-1 — o passo 3 de "Como gerar o app".** O adendo pede "mais uma linha" no passo 3 para dizer que o
   comando para no TestFlight e no teste interno do Google Play, mas não dá o texto. O desenho mantém o
   passo 3 do UI-SPEC (que já cita as duas), sem texto novo. Se Igor quiser a linha, ele a dita aqui.
2. **F-2 — classificação etária.** O valor "12+" no quadro `app-ficha-revisor` é um marcador: o valor real
   vem do modelo da loja e é a questão aberta OQ-3 do UI-SPEC.
3. **F-3 — o comando de gerar.** `[COMANDO]` aparece como constante, como no contrato (OQ-4).
4. **F-4 — logo simulado.** O logo é um símbolo genérico; o real é o do tenant. O seletor de marca recolore
   também o que no produto é neutro; serve para conferir a lista reservada de tinta de marca.
5. **F-5 — ícones.** Os glifos são redesenhos fiéis ao conjunto `lucide-react` do produto, não os arquivos
   reais. `Fingerprint` não existe nessa versão; a linha de bloqueio usa `ScanFace` para todo tipo.
6. **F-6 — fonte e medidas.** A Manrope só é usada se estiver instalada onde o arquivo for aberto; sem ela
   as quebras de 320px podem diferir um pouco. Os quadros de 130% de fonte aproximam a escala do sistema.
7. **F-7 — folhas e telas desenhadas inteiras.** No produto a folha tem altura máxima e rola; o rodapé com o
   botão principal fica fixo.
8. **F-8 — datas.** As datas dos quadros são fictícias (o prazo de 14 dias parte de 05/11/2026).

## Decisions already fixed upstream

Já decididas em `13-CONTEXT.md` (D-600..D-619) e `13-UI-SPEC.md` / `13-UI-SPEC-ADDENDUM.md`
(UI-D-600..UI-D-641) e **fora de revisão**: duas etapas, a casca nativa em volta da web (D-600, D-601,
D-603); membros e equipe no mesmo app, sem painel da plataforma (D-602); uma conta de loja por tenant
(D-604); credenciais numa tela e app gerado por comando (D-605); um projeto Firebase, chave da Apple por
tenant (D-606); a plataforma monta a ficha da loja (D-607); páginas de entrada da web inalteradas, app fixo
no tenant (D-608); anonimizar ao excluir, 14 dias de espera, mesma tela na web e no app, aviso da
assinatura (D-609, D-610); links que abrem o app (D-611); o básico: push, câmera, compartilhar, tela sem
internet, puxar para atualizar (D-612); bloqueio, número no ícone e feed salvo (D-613); pedido de
permissão depois do primeiro login, atrás da folha (D-614); compra no navegador e cadeado (D-615); o
mínimo de denunciar e bloquear (D-616); o botão de compra **desligado** nas duas lojas (D-617); o feed
salvo desenhado pela casca (D-618); o comando termina no TestFlight e no teste interno (D-619). Este
desenho é um artefato de revisão e nunca vira dependência do código.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** (o Marinho escuro e o
   Amarelo claro mostram as duas pontas).
2. **Lançamento e telas nativas** — splash, barra, sem internet, atualizar, bloqueio e cobertura.
3. **Notificações e feed salvo** — a folha, as linhas das Configurações, a faixa e os cartões do feed salvo.
4. **Compra desligada e exclusão de conta** — o cadeado, a página, o diálogo, os erros e a tela agendada.
5. **A aba App** — os seis cartões, as folhas de chaves, o diálogo de ligar a compra, a ficha, o passo a
   passo e os 320px.
6. **Denunciar e bloquear** — os menus, a folha, o diálogo, as listas e a fila do admin.
7. **As perguntas (a) a (h), as suposições AD-1 a AD-8 e os achados.**

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
`approved: false`, as tarefas de interface dos planos 17, 18, 19, 20, 21, 22, 25, 27 e 28 ficam
bloqueadas**; os planos de API, banco, worker, contrato, proxy, `.well-known`, script de release e dados da
plataforma não esperam por esta revisão. Uma aprovação provisória do product owner já desbloqueia a
codificação; deltas posteriores do designer são um passe de polimento. A coluna Winner de `../MANIFEST.md`
só muda se o usuário pedir.
