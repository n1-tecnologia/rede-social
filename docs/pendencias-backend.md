# Pendências de backend

Ajustes de 09/10 (branch `FRONT-AJUSTES`). Atualizado em 2026-10-09.

## Feed e perfil

### 1. @ do Instagram

- **O que mudou:** campo "Instagram" em Editar perfil. O @ aparece abaixo do nome nas publicações (Início, comunidades, página do post e Reels), no perfil e na lista de membros (quando a bio não tem texto). Hoje ele fica dentro da bio, como última linha depois de uma linha em branco ("Instagram: @perfil", formato em `apps/web/lib/profile-instagram.ts`), e o web lê o `GET /v1/members/{id}` de cada autor para mostrar o @ nos posts. O formulário recusa uma bio cujo próprio texto termina nessa linha, então toda linha nesse formato é de fato o @ da pessoa.
- **Back:**
  - coluna `member_profiles.instagram_handle` com CHECK no formato do front (1 a 30 letras minúsculas, números, ponto e sublinhado, sem ponto no começo, no fim ou dois seguidos);
  - `instagramHandle` no `PATCH /v1/me/profile`, no `ownProfileSchema` e no `memberProfileSchema`;
  - o @ do autor no post (`feedPostAuthorSchema`), vindo na mesma consulta que já traz o nome e a foto;
  - migrar as bios que estão nesse formato: o @ vai para a coluna e a linha sai da bio;
  - decidir se o @ sozinho conta como bio para "Complete seu perfil" (hoje conta, porque está dentro da bio);
  - ordem: os schemas são `.strict()`, então o campo novo entra como `.optional()` e o web é publicado primeiro; depois a migration e a API.
- **Por quê:** a linha gasta até 44 dos 150 caracteres da bio, aparece como texto onde a bio é lida crua e cada página do feed faz uma chamada a mais por autor.

### 2. Proporção dos vídeos

- **O que mudou:** o feed e o Reels descobrem a proporção de cada vídeo no navegador (pela capa e pelos metadados do vídeo) e a guardam durante a visita. Um toque no vídeo do feed agora abre o Reels por cima, já naquele vídeo: a D-124 ("o Reels só abre pela aba") foi revertida a pedido do dono do produto.
- **Back:** expor a largura e a altura do vídeo no post (`postMediaSchema`, onde `width` e `height` vêm nulos para vídeo), ou o `aspect_ratio` que o Mux já envia e que fica guardado em `media_assets.aspect_ratio`, para o quadro já vir certo do servidor. O Reels lê o mesmo `GET /v1/feed?media=video`, então a mudança vale para os dois.
- **Por quê:** até a proporção chegar, o quadro usa um palpite (4:5 no feed, a tela toda no Reels) e pode mudar de tamanho.

## Marca: ícone do app e aparência

### 3. Ícone do app no Android sem moldura

- **O que mudou:** o editor "Ícone do app" (Marca da plataforma, Marca do admin e assistente de novo tenant) monta o ícone no navegador, já com o fundo, e envia um PNG quadrado de 1024 px (JPEG só se o PNG passar de 2 MB) pelo upload de ícone que já existe (`kind: 'icon'`).
- **Back:** no worker (`deriveIconSet`), gerar o `maskable512` ocupando o quadrado inteiro quando a fonte for o ícone do app, em vez de colocá-lo em 80% sobre a cor principal. Precisa de um marcador vindo do upload (um tipo de upload próprio ou o campo do item 4), porque um ícone enviado de outro jeito continua precisando dessa margem.
- **Por quê:** com um fundo diferente da cor principal, aparece uma moldura no Android: a faixa da cor principal em volta do ícone.

### 4. Guardar as escolhas do editor de ícone

- **O que mudou:** as escolhas do editor "Ícone do app" ficam só no navegador; só o ícone pronto é enviado. Nas telas Marca, quem volta à página encontra o editor no padrão, e o ícone não acompanha uma troca da cor principal: o editor avisa para editar o ícone de novo.
- **Back:** um campo `appIcon` na marca com as escolhas (modo, cor ou imagem de fundo, tamanho do logo e as imagens de origem: o logo usado, a imagem de fundo e a arte), devolvido no detalhe do tenant (`GET /v1/platform/tenants/{id}`) e no `GET /v1/admin/branding`. Opcional: refazer o ícone quando a cor principal mudar.
- **Por quê:** o editor reabrir com o que foi usado da última vez, e o ícone acompanhar a cor principal sem ninguém precisar refazê-lo.

### 5. Aparência na Marca do admin

- **O que mudou:** Configurações → Marca mostra a aparência salva do tenant (fundo do modo claro, cores e fundo do modo escuro, cores dos botões) só para leitura, com um aviso de que fundo, modo escuro, botões e fonte dos títulos são definidos pela equipe da plataforma. Só a Marca da plataforma edita a aparência.
- **Back:** rota `PUT /v1/admin/branding/look` com o `brandingLookBodySchema` (o mesmo corpo da rota da plataforma), exigindo `tenant.manage` e usando o tenant da sessão, como as outras rotas de `/v1/admin/branding`. Com a rota, o front só passa o editor de aparência para a página.
- **Por quê:** o admin do tenant mudar a aparência da própria marca, como já muda o logo e as cores.

### 6. Remover o ícone do app de um tenant sem logo

- **O que mudou:** o editor "Ícone do app" deixa criar um tenant só com uma arte, sem logo. Depois de "Remover" o ícone, a prévia passou a mostrar o ícone que o app continua servindo, em vez de dizer que ele usa o ícone padrão da plataforma.
- **Back:** em `removeIconOverride` / `resolveIconSource` (`packages/core/server/platform/branding.ts`), quando o ícone é removido e não há logo, não refazer os ícones a partir da imagem anterior (`previous_i512`): limpar `iconUrls`, para o manifest e o ícone do iPhone voltarem ao padrão da plataforma. A fonte `previous_i512` continua servindo para refazer os ícones depois de uma troca de cor.
- **Por quê:** hoje a derivação que roda depois do "Remover" usa o 512 gerado a partir da arte removida, e o app instalado continua com a arte que o admin tirou.
