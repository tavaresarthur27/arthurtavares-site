// Para publicar um jogo, copie os arquivos para games/ e adicione um item abaixo.
// Para publicar um vídeo, adicione { id: 'ID_DO_YOUTUBE', title: 'Título' } em videos.
window.siteContent = {
  games: [
    { id: 'orbit', title: 'Orbit Pinball', category: '2D', label: 'PINBALL · ARCADE 2D', image: 'assets/orbit.webp', href: 'games/orbit/', description: 'O espírito do fliperama em uma nova órbita. Acerte os propulsores, acumule bônus e supere seu próprio recorde.', controls: 'Use ← e → ou A e D para os flippers. Segure e solte Espaço para lançar. P pausa a partida. No celular, use os botões abaixo da mesa.', tags: ['1 jogador', 'Teclado e toque', 'Recorde local'], theme: 'orbit' },
    { id: 'cosmic', title: 'Cosmic Cadet', category: '3D', label: 'PINBALL · ARCADE 3D', image: 'assets/cosmic.webp', href: 'games/cosmic-cadet/jogo.html', description: 'Uma missão em outra dimensão. Explore uma mesa espacial em 3D e suba de patente, de Cadete a Almirante.', controls: 'Use ← e → ou A e D para os flippers. Espaço ou S lança a bola e P pausa. Também há controles de toque. O jogo precisa de um navegador com WebGL.', tags: ['1 jogador', 'Teclado e toque', 'WebGL'], theme: 'cosmic' }
  ],
  videos: []
};
