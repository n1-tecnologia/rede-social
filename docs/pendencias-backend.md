# Pendências de backend

Atualizado em 2026-10-09.

Os itens 11 a 16 vêm dos ajustes de 09/10 (branch `FRONT-AJUSTES`). Os demais são das rodadas anteriores e continuam valendo.

## Marca

### 1. Logo do modo escuro

- **O que mudou:** o assistente de novo tenant e a aba Marca ganharam o campo "Logo do modo escuro", só na prévia.
- **Back:** aceitar o upload `logoDark` em `BRANDING_UPLOAD_KINDS`, guardar a URL na marca e devolvê-la no bootstrap e no by-host (`hostBrandingSchema` e `resolveBranding`).
- **Por quê:** um logo escuro some no tema escuro. Com o segundo logo, o app troca sozinho conforme o tema.

## Eventos

### 2. Informações úteis (traje, incluso, o que levar, certificado)

- **O que mudou:** o formulário de evento ganhou a etapa 2 com esses campos. Hoje eles são salvos dentro da descrição, num bloco "Informações úteis".
- **Back:** colunas novas em `events`: `dress_code`, `included`, `bring`, `certificate` e `certificate_hours`. Criar e editar aceitam, o detalhe devolve. Migrar os blocos já salvos nas descrições.
- **Por quê:** o bloco gasta o limite de 4.000 caracteres da descrição e aparece como texto em qualquer lugar que mostre a descrição crua.

### 3. Código do ingresso

- **O que mudou:** o ingresso da tela Check-in e os cartões de "Meus eventos" mostram um código de exemplo (EXEMPLO). O cartão "Inscrição confirmada" saiu da página do evento em 2026-10-09.
- **Back:** gerar um código único por inscrição quando o membro responde "Vou" e devolvê-lo só para ele.
- **Por quê:** o membro mostra o código na entrada e o admin localiza a inscrição por ele.

### 4. QR pessoal e leitor do admin

- **O que mudou:** o ingresso mostra um QR decorativo (EXEMPLO). O "Escanear QR code" do admin não foi feito.
- **Back:** um token pessoal por inscrição e uma rota para o admin validar o QR lido e registrar a presença.
- **Por quê:** fazer o check-in na porta lendo o QR. Hoje o membro digita o código de 4 caracteres do local.

### 5. Programação (cronograma) · feito pelo backend (2026-10-07)

- **O que mudou:** a etapa 2 do formulário ganhou o "Cronograma": horário e o que acontece, mais o dia quando o evento tem vários dias. A página mostra esse cronograma para todos em "Programação", com abas por dia. Sem cronograma, quem está inscrito vê um exemplo (EXEMPLO).
- **Back:** o cronograma agora vive na coluna `events.schedule` (jsonb, até 30 itens de dia, horário e o que acontece). Criar e editar evento aceitam `schedule`, e o detalhe e a leitura de edição o devolvem. A lista e as respostas de escrita não o trazem. O front não grava mais o cronograma na descrição: os 4.000 caracteres são todos da descrição. O banco também recusa um valor fora do formato (`events_schedule_chk`), então um escritor que pule a API não grava lixo.
- **Decisão:** coluna e não tabela `event_schedule_items`, porque o cronograma é sempre salvo e lido junto com o evento (a edição substitui o evento inteiro) e nunca é consultado por item. Uma tabela custaria um comando a mais em cada leitura e escrita do evento, outro índice e outra política de isolamento por tenant.
- **Eventos antigos:** os cronogramas já salvos como texto na descrição continuam aparecendo (o front ainda lê esse formato enquanto a coluna do evento está vazia). Na primeira vez que o evento é salvo pelo formulário, o cronograma passa para a coluna e as linhas "Programação" saem da descrição. Não há migração em massa. Os outros campos de "Informações úteis" (item 2) continuam na descrição.
- **Ordem de publicação:** migração, depois o web, depois a API (detalhes em `docs/DEPLOY.md`, seção "Event schedule").

### 6. Certificado

- **O que mudou:** botão "Ver meu certificado" para quem fez check-in num evento encerrado. Hoje só mostra um aviso (EXEMPLO).
- **Back:** gerar o PDF (nome, evento, data e horas) e a rota `GET /v1/events/{id}/certificate`, só para o próprio membro. Depende do item 2.
- **Por quê:** o membro baixar o certificado.

### 7. Pagamento e nota fiscal

- **O que mudou:** o pagamento e a nota fiscal não aparecem mais em lugar nenhum. O cartão "Inscrição confirmada", que mostrava "pagamento aprovado" e "Ver nota fiscal" de exemplo (EXEMPLO), saiu da página do evento em 2026-10-09.
- **Back:** preço por evento, integração de pagamento e emissão de nota fiscal.
- **Por quê:** eventos pagos. Depende de decisão de produto. Se os eventos forem pagos, o front volta a mostrar o pagamento e a nota fiscal na página do evento.

### 8. Tela "Meus eventos"

- **O que mudou:** tela nova com os eventos inscritos e participados, horas e certificados. Para somar horas e certificados, ela abre o detalhe de até 10 eventos, um por um.
- **Back:** rota `GET /v1/events/mine` com as listas e os totais.
- **Por quê:** a tela fica mais rápida, e os números ficam exatos acima de 10 eventos.

### 9. Tela "Fotos"

- **O que mudou:** tela nova com as fotos dos eventos que já aconteceram. Ela faz uma chamada por evento e mostra só os 12 mais recentes.
- **Back:** rota `GET /v1/events/photos`, paginada, com o evento de cada foto.
- **Por quê:** a tela fica mais rápida e mostra também os eventos mais antigos.

## Feed e perfil

### 10. Ícone de administrador

- **O que mudou:** ícone ao lado do nome do admin nos posts e no perfil, na cor secundária. Em "Editar perfil", o admin escolhe entre 10 ícones (coroa é o padrão). A escolha fica num cookie do aparelho (`rede_admin_icon`), então só o aparelho de quem escolheu mostra o ícone; os outros veem a coroa. O ícone aparece em todo autor quando só admins podem postar.
- **Back:**
  - guardar o ícone escolhido no perfil do membro (um campo como `adminIcon`, aceitando só os ids `crown`, `star`, `gem`, `seal`, `shield`, `trophy`, `medal`, `bolt`, `flame`, `heart`) e aceitá-lo no `PATCH /v1/me/profile`;
  - devolver o ícone e `isAdmin` (ou o papel) do autor no post (`feedPostAuthorSchema`) e no perfil de membro.
- **Por quê:** todos os membros verem o ícone que o admin escolheu, em qualquer aparelho. E, se o tenant liberar posts para membros, o ícone aparecer só nos admins, inclusive quando outra pessoa abre o perfil de um admin.

### 11. @ do Instagram

- **O que mudou:** campo "Instagram" em Editar perfil. O @ aparece abaixo do nome nas publicações (Início, comunidades, página do post e Reels), no perfil e na lista de membros (quando a bio não tem texto). Hoje ele fica dentro da bio, como última linha depois de uma linha em branco ("Instagram: @perfil", formato em `apps/web/lib/profile-instagram.ts`), e o web lê o `GET /v1/members/{id}` de cada autor para mostrar o @ nos posts. O formulário recusa uma bio cujo próprio texto termina nessa linha, então toda linha nesse formato é de fato o @ da pessoa.
- **Back:**
  - coluna `member_profiles.instagram_handle` com CHECK no formato do front (1 a 30 letras minúsculas, números, ponto e sublinhado, sem ponto no começo, no fim ou dois seguidos);
  - `instagramHandle` no `PATCH /v1/me/profile`, no `ownProfileSchema` e no `memberProfileSchema`;
  - o @ do autor no post (`feedPostAuthorSchema`), vindo na mesma consulta que já traz o nome e a foto;
  - migrar as bios que estão nesse formato: o @ vai para a coluna e a linha sai da bio;
  - decidir se o @ sozinho conta como bio para "Complete seu perfil" (hoje conta, porque está dentro da bio);
  - ordem: os schemas são `.strict()`, então o campo novo entra como `.optional()` e o web é publicado primeiro; depois a migration e a API.
- **Por quê:** a linha gasta até 44 dos 150 caracteres da bio, aparece como texto onde a bio é lida crua e cada página do feed faz uma chamada a mais por autor.

### 12. Proporção dos vídeos

- **O que mudou:** o feed e o Reels descobrem a proporção de cada vídeo no navegador (pela capa e pelos metadados do vídeo) e a guardam durante a visita. Desde 2026-10-09, um toque no vídeo do feed abre o Reels por cima, já naquele vídeo: a D-124 ("o Reels só abre pela aba") foi revertida a pedido do dono do produto.
- **Back:** expor a largura e a altura do vídeo no post (`postMediaSchema`, onde `width` e `height` vêm nulos para vídeo), ou o `aspect_ratio` que o Mux já envia e que fica guardado em `media_assets.aspect_ratio`, para o quadro já vir certo do servidor. O Reels lê o mesmo `GET /v1/feed?media=video`, então a mudança vale para os dois.
- **Por quê:** até a proporção chegar, o quadro usa um palpite (4:5 no feed, a tela toda no Reels) e pode mudar de tamanho.

## Marca: ícone do app e aparência

### 13. Ícone do app no Android sem moldura

- **O que mudou:** o editor "Ícone do app" (Marca da plataforma, Marca do admin e assistente de novo tenant) monta o ícone no navegador, já com o fundo, e envia um PNG quadrado de 1024 px (JPEG só se o PNG passar de 2 MB) pelo upload de ícone que já existe (`kind: 'icon'`).
- **Back:** no worker (`deriveIconSet`), gerar o `maskable512` ocupando o quadrado inteiro quando a fonte for o ícone do app, em vez de colocá-lo em 80% sobre a cor principal. Precisa de um marcador vindo do upload (um tipo de upload próprio ou o campo do item 14), porque um ícone enviado de outro jeito continua precisando dessa margem.
- **Por quê:** com um fundo diferente da cor principal, aparece uma moldura no Android: a faixa da cor principal em volta do ícone.

### 14. Guardar as escolhas do editor de ícone

- **O que mudou:** as escolhas do editor "Ícone do app" ficam só no navegador; só o ícone pronto é enviado. Nas telas Marca, quem volta à página encontra o editor no padrão, e o ícone não acompanha uma troca da cor principal: o editor avisa para editar o ícone de novo.
- **Back:** um campo `appIcon` na marca com as escolhas (modo, cor ou imagem de fundo, tamanho do logo e as imagens de origem: o logo usado, a imagem de fundo e a arte), devolvido no detalhe do tenant (`GET /v1/platform/tenants/{id}`) e no `GET /v1/admin/branding`. Opcional: refazer o ícone quando a cor principal mudar.
- **Por quê:** o editor reabrir com o que foi usado da última vez, e o ícone acompanhar a cor principal sem ninguém precisar refazê-lo.

### 15. Aparência na Marca do admin

- **O que mudou:** Configurações → Marca mostra a aparência salva do tenant (fundo do modo claro, cores e fundo do modo escuro, cores dos botões) só para leitura, com um aviso de que fundo, modo escuro, botões e fonte dos títulos são definidos pela equipe da plataforma. Só a Marca da plataforma edita a aparência.
- **Back:** rota `PUT /v1/admin/branding/look` com o `brandingLookBodySchema` (o mesmo corpo da rota da plataforma), exigindo `tenant.manage` e usando o tenant da sessão, como as outras rotas de `/v1/admin/branding`. Com a rota, o front só passa o editor de aparência para a página.
- **Por quê:** o admin do tenant mudar a aparência da própria marca, como já muda o logo e as cores.

### 16. Remover o ícone do app de um tenant sem logo

- **O que mudou:** o editor "Ícone do app" deixa criar um tenant só com uma arte, sem logo. Depois de "Remover" o ícone, a prévia passou a mostrar o ícone que o app continua servindo, em vez de dizer que ele usa o ícone padrão da plataforma.
- **Back:** em `removeIconOverride` / `resolveIconSource` (`packages/core/server/platform/branding.ts`), quando o ícone é removido e não há logo, não refazer os ícones a partir da imagem anterior (`previous_i512`): limpar `iconUrls`, para o manifest e o ícone do iPhone voltarem ao padrão da plataforma. A fonte `previous_i512` continua servindo para refazer os ícones depois de uma troca de cor.
- **Por quê:** hoje a derivação que roda depois do "Remover" usa o 512 gerado a partir da arte removida, e o app instalado continua com a arte que o admin tirou.
