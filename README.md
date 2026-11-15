# Arthur Tavares — Jogos & criação

Site estático em português, com jogos jogáveis e o canal [Pixelzinho](https://www.youtube.com/@pixelzinho11). HTML, CSS e JavaScript; nenhuma dependência para executar o site.

## Abrir localmente

Na pasta do projeto, execute `python -m http.server 4173 --bind 127.0.0.1 --directory dist` e abra http://localhost:4173.

## Publicar conteúdo

- **Jogos:** coloque a versão web do jogo em `dist/games/nome-do-jogo/`. Adicione um item em `dist/content.js`, com título, descrição, categoria, imagem, caminho e controles. As categorias disponíveis são `2D` e `3D`.
- **Vídeos:** em `dist/content.js`, adicione itens em `videos`: `{ id: 'ID_DO_YOUTUBE', title: 'Título do vídeo' }`. Use o identificador de 11 caracteres do link do vídeo. A galeria mostra a miniatura e abre o vídeo no YouTube.
- **Bio e links:** edite `dist/index.html`. A aparência está em `dist/style.css`.

O canal informado não apresentava vídeos públicos na consulta inicial. Não há vídeos fictícios. A lista é editorial, atualizada pelo arquivo de conteúdo; não sincroniza automaticamente com o YouTube. Não há painel administrativo ou login.

## Jogos incluídos

Orbit Pinball e Cosmic Cadet foram copiados dos projetos locais em 15/11/2026. Os originais foram preservados. As cópias incluem um link de retorno ao portfólio. Mudanças futuras nos originais precisam ser copiadas para este site.

Cosmic Cadet usa Three.js pela CDN e precisa de WebGL. As fontes vêm do Google Fonts, com fontes locais de reserva. Recordes e partidas salvas pertencem ao navegador e endereço em que o jogo foi aberto.

## Verificação

Com Google Chrome instalado: `npm.cmd install`, inicie o servidor local e execute `npm.cmd test`. O teste cobre filtros, detalhes, foco após fechar o diálogo, menu móvel, larguras de 360 a 1440 px, links e início de ambos os jogos. Capturas de verificação ficam em `artifacts/`.

## Hospedagem

A pasta pública é `dist/`. Sirva-a em qualquer hospedagem estática. A configuração do plugin Sites está em `.openai/hosting.json`.
