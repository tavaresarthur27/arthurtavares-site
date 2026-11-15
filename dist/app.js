'use strict';
const { games, videos } = window.siteContent;
const grid = document.querySelector('#game-grid');
const dialog = document.querySelector('#game-dialog');
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function renderGames(filter = 'all') {
  const visible = games.filter(game => filter === 'all' || game.category === filter);
  grid.replaceChildren(...visible.map(game => {
    const card = element('article', 'game-card');
    const visual = element('a', `game-visual ${game.theme}`);
    visual.href = game.href;
    visual.setAttribute('aria-label', `Jogar ${game.title}`);
    const img = element('img');
    img.src = game.image; img.alt = `Prévia da mesa de ${game.title}`; img.loading = 'lazy';
    visual.append(img, element('span', 'game-badge', 'JOGUE NO NAVEGADOR'), element('span', 'game-art-title', game.title), element('span', 'card-play', '↗'));
    const info = element('div', 'game-info');
    info.append(element('p', 'eyebrow', game.label), element('h3', '', game.title), element('p', 'game-description', game.description));
    const actions = element('div', 'card-actions');
    const play = element('a', 'text-link', 'Jogar agora ↗'); play.href = game.href;
    const details = element('button', 'detail-button', 'Sobre o jogo +');
    details.setAttribute('aria-label', `Sobre o jogo ${game.title}`);
    details.addEventListener('click', () => openGame(game));
    actions.append(play, details); info.append(actions); card.append(visual, info);
    return card;
  }));
  document.querySelector('#filter-status').textContent = `${visible.length} ${visible.length === 1 ? 'jogo disponível' : 'jogos disponíveis'}`;
}
function openGame(game) {
  document.querySelector('#dialog-title').textContent = game.title;
  document.querySelector('#dialog-description').textContent = game.description;
  document.querySelector('#dialog-controls').textContent = game.controls;
  document.querySelector('#dialog-tags').replaceChildren(...game.tags.map(tag => element('span', '', tag)));
  document.querySelector('#dialog-play').href = game.href;
  dialog.showModal();
}
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(other => {
    other.classList.toggle('active', other === button);
    other.setAttribute('aria-pressed', String(other === button));
  });
  renderGames(button.dataset.filter);
}));
const menu = document.querySelector('.menu-toggle');
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  document.querySelector('#navigation').classList.toggle('open', open);
});
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); document.querySelector('#navigation').classList.remove('open'); }
document.querySelectorAll('#navigation a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
const videoGrid = document.querySelector('#video-grid');
const validVideos = videos.filter(video => /^[\w-]{11}$/.test(video.id) && typeof video.title === 'string');
if (validVideos.length) {
  document.querySelector('.channel-note').hidden = true;
  videoGrid.hidden = false;
  validVideos.forEach(video => {
    const card = element('a', 'video-card');
    card.href = `https://www.youtube.com/watch?v=${video.id}`;
    card.target = '_blank'; card.rel = 'noopener noreferrer';
    const image = element('img'); image.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`; image.alt = ''; image.loading = 'lazy';
    card.append(image, element('h3', '', video.title), element('span', 'text-link', 'Assistir no YouTube ↗'), element('span', 'sr-only', ' (abre em nova aba)'));
    videoGrid.append(card);
  });
}
document.querySelector('#game-count').textContent = games.length;
document.querySelector('#year').textContent = new Date().getFullYear();
renderGames();
