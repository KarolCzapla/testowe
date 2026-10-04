import {matchesMovie} from './app-logic.js';

const search = document.querySelector('#search');
const cards = [...document.querySelectorAll('.movie-card')];

search?.addEventListener('input', () => {
  let visible = 0;
  for (const card of cards) {
    const show = matchesMovie(card.dataset.title, search.value);
    card.hidden = !show;
    visible += Number(show);
  }
  document.querySelector('#count').textContent = `${visible} title${visible === 1 ? '' : 's'}`;
  document.querySelector('#empty').hidden = visible !== 0;
});

for (const button of document.querySelectorAll('.watchlist')) {
  button.addEventListener('click', async () => {
    const saved = button.classList.toggle('saved');
    button.textContent = saved ? '✓' : '+';
    button.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} watchlist`);
    await fetch(saved ? '/api/watchlist' : `/api/watchlist/${button.dataset.movieId}`, {
      method: saved ? 'POST' : 'DELETE',
      headers: {'Content-Type': 'application/json'},
      body: saved ? JSON.stringify({id: button.dataset.movieId}) : undefined,
    });
  });
}
