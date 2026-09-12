(function () {
  'use strict';

  var API_BASE = 'https://acodes.pro/mytv_backend/api/';
  var APP_VERSION = '0.1.0';
  var CATALOG_CACHE_TTL = 15 * 60 * 1000;
  var app = document.getElementById('app');
  var home = null, heroIndex = 0, heroTimer = null, catalogCache = {}, ratingCache = {};
  var fallbackHero = { id:0, title:'BEM-VINDO AO MYTV', description:'Filmes, séries, esportes e TV ao vivo em um só lugar.', badge_text:'MYTV', rating_text:'LIVRE', backdrop_url:'assets/images/brand_background.png' };
  var hubs = [
    {id:'netflix',name:'Netflix',color:'#e50914',logo:'https://static.vecteezy.com/ti/vetor-gratis/p1/20190493-netflix-logotipo-netflix-icone-livre-gratis-vetor.jpg',intro:'assets/video/netflix.mp4'},
    {id:'prime',name:'Prime Video',color:'#00a8e1',logo:'https://rollingstone.com.br/wp-content/uploads/logo_prime_video_foto_reproducao.jpg',intro:'assets/video/primevideo.mp4'},
    {id:'max',name:'HBO Max',color:'#6c2bd9',logo:'https://i.pinimg.com/736x/c7/d6/b0/c7d6b09c6a4f721c831f157b3ebe9ed9.jpg',intro:'assets/video/hbomax.mp4'},
    {id:'disney',name:'Disney+',color:'#0b63ce',logo:'https://disneyplusbrasil.com.br/wp-content/uploads/2024/03/Disney-Plus-novo-logotipo.jpg',intro:'assets/video/disneyplus.mp4'},
    {id:'apple',name:'Apple TV+',color:'#55555a',logo:'https://1000logos.net/wp-content/uploads/2022/02/Apple-TV-Logo.jpg',intro:'assets/video/appletv.mp4'},
    {id:'globoplay',name:'Globoplay',color:'#ff5b23',logo:'https://t2.tudocdn.net/602261?w=1200&h=1200',intro:''}
  ];

  function escapeHtml(value) { var div=document.createElement('div'); div.textContent=String(value || ''); return div.innerHTML; }
  function cleanUrl(value) { return String(value || '').replace(/['"\\()]/g, ''); }
  function attrUrl(value) { return escapeHtml(cleanUrl(value)); }
  function wait(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }
  function deviceId() {
    var key='mytv_device_id', id=localStorage.getItem(key);
    if (!id) { id=(window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'tizen-'+Date.now()+'-'+Math.random().toString(16).slice(2); localStorage.setItem(key,id); }
    return id;
  }
  function setSplash(message, failed) {
    app.innerHTML='<section class="splash"><div class="splash-content">'+
      (failed ? '<div class="splash-message">'+escapeHtml(message)+'</div><button class="error-action" id="retry">Tentar novamente</button>' : '<div class="loader"></div><div class="splash-message">'+escapeHtml(message)+'</div>')+'</div></section>';
    if (failed) document.getElementById('retry').addEventListener('click', bootstrap);
  }
  function request(path, options, timeoutMs) {
    var controller=new AbortController(), timer=setTimeout(function(){ controller.abort(); },timeoutMs || 30000);
    return fetch(API_BASE+path,Object.assign({signal:controller.signal},options || {})).then(function(response){
      if (!response.ok) throw new Error('Resposta do servidor ('+response.status+')');
      return response.json();
    }).finally(function(){ clearTimeout(timer); });
  }
  function authenticate() {
    var attempt=0;
    function run() {
      attempt+=1;
      setSplash(attempt===1 ? 'Verificando assinatura...' : 'Conexão instável. Nova tentativa '+attempt+'/3...');
      return request('auth.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_app:deviceId(),device_model:'Samsung Tizen TV',app_version:APP_VERSION,app_build:1})},35000)
        .catch(function(error){ if (attempt>=3) throw error; return wait(attempt*1000).then(run); });
    }
    return run();
  }
  function bootstrap() {
    clearInterval(heroTimer); home=null;
    authenticate().then(function(auth){
      if (!auth || !auth.is_valid || !auth.usuario) throw new Error((auth && auth.message) || 'Não foi possível validar a conta.');
      localStorage.setItem('mytv_user',JSON.stringify(auth.usuario)); setSplash('Carregando filmes, séries e jogos...');
      return request('home.php',{method:'GET'},30000);
    }).then(function(result){ home=result; renderHome(); }).catch(function(error){
      console.error('[MYTV_TIZEN] bootstrap error',error);
      setSplash('Não foi possível acessar o servidor. Verifique sua rede e tente novamente.',true);
    });
  }

  function isSports(hero) { return String(hero.kind || '').toLowerCase()==='sports'; }
  function isProgramme(hero) { return String(hero.kind || '').toLowerCase()==='programme'; }
  function heroInfo(hero) {
    var html=hero.is_live ? '<span class="live-badge">AO VIVO</span>' : (hero.badge_text ? '<span class="info-badge">'+escapeHtml(hero.badge_text)+'</span>' : '');
    if (isSports(hero)) {
      if (hero.broadcast_channel_logo_url) html+='<img class="channel-logo" src="'+attrUrl(hero.broadcast_channel_logo_url)+'" alt="">';
      if (hero.broadcast_channel) html+='<span class="channel-name">'+escapeHtml(hero.broadcast_channel)+'</span>';
    } else if (hero.rating_text) html+='<span class="hero-meta">'+escapeHtml(hero.rating_text)+'</span>';
    return html;
  }
  function team(logo,name) { return '<div class="team">'+(logo ? '<img src="'+attrUrl(logo)+'" alt="">' : '')+'<span>'+escapeHtml(name || '')+'</span></div>'; }
  function renderHero(hero,position,total) {
    var eyebrow=isSports(hero) ? hero.league_name : (isProgramme(hero) ? hero.programme_category : '');
    var logo=hero.title_logo_url && !isProgramme(hero) ? '<img class="hero-logo" src="'+attrUrl(hero.title_logo_url)+'" alt="">' : '';
    var copy='<div class="hero-copy">'+logo+(eyebrow ? '<div class="eyebrow">'+escapeHtml(eyebrow)+'</div>' : '')+'<h1>'+escapeHtml(hero.title || '')+'</h1>'+
      (heroInfo(hero) ? '<div class="hero-info">'+heroInfo(hero)+'</div>' : '')+'<p>'+escapeHtml(hero.description || '')+'</p>'+
      (total>1 ? '<div class="hero-pagination">'+position+' / '+total+'</div>' : '')+'</div>';
    return isSports(hero) ? '<section class="hero hero-sports">'+copy+'<div class="teams">'+team(hero.home_logo_url,hero.home_team)+'<span class="versus">×</span>'+team(hero.away_logo_url,hero.away_team)+'</div></section>' : '<section class="hero">'+copy+'</section>';
  }
  function hubCard(hub) {
    return '<button class="hub-card" data-provider="'+hub.id+'"><img src="'+attrUrl(hub.logo)+'" alt="'+escapeHtml(hub.name)+'" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'block\';"><span style="display:none">'+escapeHtml(hub.name)+'</span></button>';
  }
  function icon(name) {
    var paths={
      search:'<circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path>', home:'<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"></path>',
      favorites:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8z"></path>', sports:'<circle cx="12" cy="12" r="10"></circle><path d="m12 2 3 5-3 3-3-3 3-5zm-8 8 5-1 3 3-1 5-5-1-2-6zm16 0-5-1-3 3 1 5 5-1 2-6zM8 20l3-5h2l3 5"></path>',
      live:'<rect x="3" y="5" width="18" height="13" rx="2"></rect><path d="m8 22 4-4 4 4M8 9h8"></path>', movies:'<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m7 4 3 4 3-4 3 4 3-4M7 20l3-4 3 4 3-4 3 4"></path>',
      series:'<rect x="3" y="5" width="18" height="13" rx="2"></rect><path d="M8 2v3m8-3v3M8 21v1m8-1v1M3 10h18"></path>', settings:'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1z"></path>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+paths[name]+'</svg>';
  }
  function sidebarMarkup(active) {
    var entries=[{id:'search',label:'Buscar',icon:'search'},{id:'home',label:'Home',icon:'home'},{id:'favorites',label:'Favoritos',icon:'favorites'},{id:'sports',label:'Esportes',icon:'sports'},{id:'live',label:'TV ao Vivo',icon:'live'},{id:'movies',label:'Filmes',icon:'movies'},{id:'series',label:'Séries',icon:'series'},{id:'settings',label:'Configurações',icon:'settings'}];
    return '<aside class="sidebar" aria-label="Menu principal"><nav class="side-menu">'+entries.map(function(entry){ return '<button class="side-menu-item '+(active===entry.id ? 'is-active' : '')+'" data-nav="'+entry.id+'" aria-label="'+entry.label+'" title="'+entry.label+'">'+icon(entry.icon)+'</button>'; }).join('')+'</nav></aside>';
  }
  function bindSidebar() { document.querySelectorAll('[data-nav]').forEach(function(button){ button.addEventListener('click',function(){ var page=button.getAttribute('data-nav'); if(page==='home') { renderHome(); return; } renderPlaceholder(page); }); }); }
  function renderPlaceholder(page) {
    clearInterval(heroTimer);
    var labels={search:'Buscar',favorites:'Favoritos',sports:'Esportes',live:'TV ao Vivo',movies:'Filmes',series:'Séries',settings:'Configurações'};
    app.innerHTML='<section class="placeholder-page">'+sidebarMarkup(page)+'<div class="placeholder-content"><h1>'+escapeHtml(labels[page] || '')+'</h1><p>Esta seção será adicionada nas próximas etapas do aplicativo Tizen.</p></div></section>';
    bindSidebar();
  }
  function featureCard(card) {
    var color=/^#[0-9a-f]{6}$/i.test(card.background_color || '') ? card.background_color : '#25272c';
    var image=card.image_url ? 'background-image:url(\''+cleanUrl(card.image_url)+'\');' : '';
    return '<button class="feature-card" style="background-color:'+color+';'+image+'"><strong>'+escapeHtml(card.title || '')+'</strong><small>'+escapeHtml(card.subtitle || '')+'</small></button>';
  }
  function renderHome() {
    var settings=(home && home.settings) || {}, heroes=settings.hero_enabled===false ? [] : ((home && home.heroes) || []);
    var visible=heroes.length ? heroes : [fallbackHero], cards=settings.features_enabled===false ? [] : ((home && home.feature_cards) || []);
    heroIndex=Math.max(0,Math.min(heroIndex,visible.length-1));
    var hero=visible[heroIndex];
    app.innerHTML='<section class="home"><div class="home-backdrop" style="background-image:url(\''+cleanUrl(hero.backdrop_url || 'assets/images/brand_background.png')+'\')"></div><div class="home-gradient"></div>'+
      sidebarMarkup('home')+'<div class="home-content">'+renderHero(hero,heroIndex+1,visible.length)+
      '<section class="section"><h2 class="section-title">Plataformas de Streaming</h2><div class="row">'+hubs.map(hubCard).join('')+'</div></section>'+
      (cards.length ? '<section class="section"><h2 class="section-title">'+escapeHtml(settings.features_title || 'Aproveite ao máximo o App')+'</h2><div class="row">'+cards.map(featureCard).join('')+'</div></section>' : '')+'</div></section>';
    bindSidebar();
    document.querySelectorAll('[data-provider]').forEach(function(button){ button.addEventListener('click',function(){ openStreaming(findHub(button.getAttribute('data-provider'))); }); });
    clearInterval(heroTimer);
    if (visible.length>1) heroTimer=setInterval(function(){ heroIndex=(heroIndex+1)%visible.length; renderHome(); },Math.max(3,Math.min(60,Number(settings.hero_interval_seconds) || 8))*1000);
  }
  function findHub(id) { for(var i=0;i<hubs.length;i+=1) if(hubs[i].id===id) return hubs[i]; return hubs[0]; }

  function openStreaming(hub) { clearInterval(heroTimer); renderStreaming(hub,true); }
  function renderStreaming(hub,showIntro) {
    var color=/^#[0-9a-f]{6}$/i.test(hub.color || '') ? hub.color : '#25272c';
    app.innerHTML='<section class="streaming-page" style="--provider-color:'+color+'">'+sidebarMarkup('')+
      '<div class="provider-hero-art" style="background-image:url(\''+cleanUrl(hub.logo)+'\')"></div>'+
      '<div class="streaming-content"><section class="provider-hero"><div class="provider-heading"><img src="'+attrUrl(hub.logo)+'" alt="'+escapeHtml(hub.name)+'"><h1>'+escapeHtml(hub.name)+'</h1></div></section><div id="catalog"><p class="catalog-message">Carregando catálogo…</p></div></div></section>'+
      (showIntro && hub.intro ? '<div class="intro"><video autoplay muted playsinline src="'+attrUrl(hub.intro)+'"></video></div>' : '');
    bindSidebar();
    var video=document.querySelector('.intro video');
    if(video) { function endIntro(){ var intro=document.querySelector('.intro'); if(intro) intro.remove(); } video.addEventListener('ended',endIntro); video.addEventListener('error',endIntro); }
    loadCatalog(hub).then(renderCatalog).catch(function(){ var target=document.getElementById('catalog'); if(target) target.innerHTML='<p class="catalog-message">Não foi possível carregar o catálogo agora.</p>'; });
  }
  function loadCatalog(hub) {
    var cached=catalogCache[hub.id];
    if(cached && Date.now()-cached.time<CATALOG_CACHE_TTL) return Promise.resolve(cached.collections);
    var queries=[{title:'Top 10',collection:'trending'},{title:'Filmes em alta',collection:'trending',kind:'movie'},{title:'Séries em alta',collection:'trending',kind:'tv'},{title:'Lançamentos',collection:'releases'},{title:'Séries Originais '+hub.name,collection:'originals',kind:'tv'},{title:'Filmes mais bem avaliados',collection:'acclaimed',kind:'movie'},{title:'Séries mais bem avaliadas',collection:'acclaimed',kind:'tv'}];
    // Same restraint as Android: two catalogue calls at a time avoids a burst
    // of requests when a provider page opens on a slower TV connection.
    var next=0, loaded=[], failures=0;
    function requestNext() {
      if(next>=queries.length) return Promise.resolve();
      var query=queries[next++];
      var args='?rating=all&page=1&provider='+encodeURIComponent(hub.name)+'&collection='+encodeURIComponent(query.collection)+(query.kind ? '&media_kind='+query.kind : '');
      return request('search_tmdb.php'+args,{method:'GET'},15000).then(function(result){ loaded.push({title:query.title,items:(result.results || []).slice(0,10)}); }).catch(function(error){ failures+=1; console.warn('[MYTV_TIZEN] catálogo '+query.collection, error); loaded.push({title:query.title,items:[]}); }).then(requestNext);
    }
    return Promise.all([requestNext(),requestNext()]).then(function(){ var collections=loaded.filter(function(collection){ return collection.items.length; }); if(!collections.length && failures===queries.length) throw new Error('Catálogo indisponível'); catalogCache[hub.id]={time:Date.now(),collections:collections}; return collections; });
  }
  function mediaType(item) { var type=String(item.media_type || (item.name && !item.title ? 'tv' : 'movie')).toLowerCase(); if(type==='anime') return 'ANIME'; return type==='tv' || type==='series' ? 'SÉRIE' : 'FILME'; }
  function ratingKey(item) { return String(item.media_type || (item.name && !item.title ? 'tv' : 'movie'))+':'+item.id; }
  function ratingText(value) { return Number(value).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}); }
  function mediaCard(item) {
    var image=item.poster_thumb_url || item.poster_url || item.poster_path || '', title=item.title || item.name || 'Título não disponível', key=ratingKey(item), initial=item.imdb_rating || (String(item.rating_source || '').toLowerCase()==='imdb' ? item.vote_average : null);
    return '<button class="media-card" data-media-id="'+escapeHtml(item.id)+'" data-media-type="'+escapeHtml(item.media_type || 'movie')+'"><span class="media-poster" style="background-image:url(\''+cleanUrl(image)+'\')"></span><span class="media-title">'+escapeHtml(title)+'</span><span class="media-bottom"><span class="imdb-mark"><img src="assets/images/imdb_logo.png" alt="IMDb"><b data-imdb="'+escapeHtml(key)+'">'+(initial ? ratingText(initial) : '—')+'</b></span><span class="media-kind">'+mediaType(item)+'</span></span></button>';
  }
  function renderCatalog(collections) {
    var target=document.getElementById('catalog'); if(!target) return;
    if(!collections.length) { target.innerHTML='<p class="catalog-message">Nenhum título disponível neste catálogo agora.</p>'; return; }
    target.innerHTML=collections.map(function(collection){ return '<section class="catalog-row"><h2>'+escapeHtml(collection.title)+'</h2><div class="row catalog-items">'+collection.items.map(mediaCard).join('')+'</div></section>'; }).join('');
    enrichRatings(collections);
  }
  function enrichRatings(collections) {
    var unique={};
    collections.forEach(function(collection){ collection.items.forEach(function(item){ unique[ratingKey(item)]=item; }); });
    Object.keys(unique).forEach(function(key){ var item=unique[key], cached=ratingCache[key]; if(cached !== undefined) { updateRating(key,cached); return; } request('get_imdb_rating.php?id='+encodeURIComponent(item.id)+'&type='+encodeURIComponent(item.media_type || (item.name && !item.title ? 'tv' : 'movie')),{method:'GET'},12000).then(function(result){ var value=result && result.imdb_rating; ratingCache[key]=value || null; updateRating(key,value); }).catch(function(){ ratingCache[key]=null; updateRating(key,null); }); });
  }
  function updateRating(key,value) { document.querySelectorAll('[data-imdb="'+key+'"]').forEach(function(node){ node.textContent=value ? ratingText(value) : '—'; }); }
  document.addEventListener('keydown',function(event){
    if(document.querySelector('.streaming-page') && event.keyCode===10009) { renderHome(); return; }
    if(!home || document.querySelector('.streaming-page')) return;
    var heroes=home.heroes || []; if(!heroes.length) return;
    if(event.keyCode===37) { heroIndex=(heroIndex-1+heroes.length)%heroes.length; renderHome(); }
    if(event.keyCode===39) { heroIndex=(heroIndex+1)%heroes.length; renderHome(); }
  });
  document.addEventListener('visibilitychange',function(){ if(document.hidden) clearInterval(heroTimer); });
  bootstrap();
}());
