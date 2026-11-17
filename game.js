import('./src/game.js').catch(error => {
  console.error('The Last Light failed to load:', error);
  document.getElementById('status').textContent = 'The forest could not load. Refresh the page or try another browser.';
  document.getElementById('start').textContent = 'Game unavailable';
});
