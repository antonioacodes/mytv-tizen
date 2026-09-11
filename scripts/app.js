(function () {
  'use strict';

  const API_BASE = 'https://acodes.pro/mytv_backend/api/';
  const APP_VERSION = '0.1.0';
  const app = document.getElementById('app');
  const fallbackHero = {
    id: 0,
    title: 'BEM-VINDO AO MYTV',
    description: 'Filmes, séries, esportes e TV ao vivo em um só lugar.',
    badge_text: 'MYTV',
    rating_text: 'LIVRE',
    backdrop_url: ''
  };
  const hubs = ['Netflix', 'Prime Video', 'HBO Max', 'Disney+', 'Apple TV+', 'Globoplay'];
  let home = null;
  let heroIndex = 0;
  let heroTimer = null;

  function deviceId() {
    const key = 'mytv_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'tizen-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      localStorage.setItem(key, id);
    }
    return id;
  }

  function setSplash(message, failed) {
    app.innerHTML = '<section class="splash"><div class="splash-content"><div class="brand">MY<span>TV</span></div>' +
      (failed ? '<div class="splash-message">' + escapeHtml(message) + '</div><button class="error-action" id="retry">Tentar novamente</button>' : '<div class="loader"></div><div class="splash-message">' + escapeHtml(message) + '</div>') +
      '</div></section>';
    if (failed) document.getElementById('retry').addEventListener('click', bootstrap);
  }

  async function request(path, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try {
      const response = await fetch(API_BASE + path, Object.assign({ signal: controller.signal }, options || {}));
      if (!response.ok) throw new Error('Resposta do servidor (' + response.status + ')');
      return response.json();
    } finally { clearTimeout(timer); }
  }

  async function authenticate() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        setSplash(attempt === 1 ? 'Verificando assinatura...' : 'Conexão instável. Nova tentativa ' + attempt + '/3...');
        const payload = { id_app: deviceId(), device_model: 'Samsung Tizen TV', app_version: APP_VERSION, app_build: 1 };
        return await request('auth.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 35000);
      } catch (error) {
        lastError = error;
        await wait(attempt * 1000);
      }
    }
    throw lastError;
  }

  async function bootstrap() {
    try {
      const auth = await authenticate();
      if (!auth || !auth.is_valid || !auth.usuario) throw new Error((auth && auth.message) || 'Não foi possível validar a conta.');
      localStorage.setItem('mytv_user', JSON.stringify(auth.usuario));
      setSplash('Carregando filmes, séries e jogos...');
      home = await request('home.php', { method: 'GET' }, 30000);
      renderHome();
    } catch (error) {
      setSplash('Não foi possível acessar o servidor. Verifique sua rede e tente novamente.', true);
      console.error('[MYTV_TIZEN] bootstrap error', error);
    }
  }

  function renderHome() {
    const settings = (home && home.settings) || {};
    const heroes = settings.hero_enabled === false ? [] : ((home && home.heroes) || []);
    const visibleHeroes = heroes.length ? heroes : [fallbackHero];
    heroIndex = Math.min(heroIndex, visibleHeroes.length - 1);
    const hero = visibleHeroes[heroIndex];
    const cards = settings.features_enabled === false ? [] : ((home && home.feature_cards) || []);
    app.innerHTML = '<section class="home">' +
      '<div class="home-backdrop" style="background-image:url(\'' + cssUrl(hero.backdrop_url) + '\')"></div><div class="home-gradient"></div>' +
      '<aside class="sidebar" aria-label="Menu"><div class="side-logo">MYTV</div></aside>' +
      '<div class="home-content"><section class="hero">' +
      (hero.badge_text ? '<div class="eyebrow">' + escapeHtml(hero.badge_text) + '</div>' : '') +
      '<h1>' + escapeHtml(hero.title) + '</h1><div class="hero-meta">' + escapeHtml(hero.rating_text || '') + '</div>' +
      '<p>' + escapeHtml(hero.description || '') + '</p><button class="hero-action" data-destination="' + escapeHtml(hero.destination || '') + '">ASSISTIR</button>' +
      (visibleHeroes.length > 1 ? '<div class="hero-pagination">' + (heroIndex + 1) + ' / ' + visibleHeroes.length + '</div>' : '') +
      '</section><section class="section"><h2 class="section-title">Plataformas de Streaming</h2><div class="row">' + hubs.map(function (name) { return '<button class="hub-card">' + escapeHtml(name) + '</button>'; }).join('') + '</div></section>' +
      (cards.length ? '<section class="section"><h2 class="section-title">' + escapeHtml(settings.features_title || 'Aproveite ao máximo o App') + '</h2><div class="row">' + cards.map(featureCard).join('') + '</div></section>' : '') +
      '</div></section>';
    setupHomeNavigation(visibleHeroes, settings);
  }

  function featureCard(card) {
    const color = /^#[0-9a-f]{6}$/i.test(card.background_color || '') ? card.background_color : '#25272c';
    const image = card.image_url ? 'background-image:url(\'' + cssUrl(card.image_url) + '\');' : '';
    return '<button class="feature-card" style="background-color:' + color + ';' + image + '"><strong>' + escapeHtml(card.title || '') + '</strong><small>' + escapeHtml(card.subtitle || '') + '</small></button>';
  }

  function setupHomeNavigation(heroes, settings) {
    clearInterval(heroTimer);
    const seconds = Math.max(3, Math.min(60, Number(settings.hero_interval_seconds) || 8));
    if (heroes.length > 1) heroTimer = setInterval(function () { heroIndex = (heroIndex + 1) % heroes.length; renderHome(); }, seconds * 1000);
    document.querySelectorAll('button').forEach(function (button) {
      button.addEventListener('focus', function () { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } });
    });
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; }
  function cssUrl(value) { return String(value || '').replace(/['"\\()]/g, ''); }

  document.addEventListener('keydown', function (event) {
    if (!home) return;
    if (event.keyCode === 37) { heroIndex = Math.max(0, heroIndex - 1); renderHome(); }
    if (event.keyCode === 39) { const heroes = (home.heroes || []); if (heroes.length) { heroIndex = Math.min(heroes.length - 1, heroIndex + 1); renderHome(); } }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && heroTimer) { clearInterval(heroTimer); heroTimer = null; } });

  bootstrap();
}());
