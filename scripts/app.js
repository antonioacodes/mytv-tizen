(function () {
  'use strict';

  var API_BASE = 'https://acodes.pro/mytv_backend/api/';
  var APP_VERSION = '0.1.0';
  var app = document.getElementById('app');
  var home = null, heroIndex = 0, heroTimer = null, catalogCache = {};
  var fallbackHero = { id:0, title:'BEM-VINDO AO MYTV', description:'Filmes, séries, esportes e TV ao vivo em um só lugar.', badge_text:'MYTV', rating_text:'LIVRE', backdrop_url:'assets/images/brand_background.png' };
  var hubs = [
    {id:'netflix',name:'Netflix',logo:'https://static.vecteezy.com/ti/vetor-gratis/p1/20190493-netflix-logotipo-netflix-icone-livre-gratis-vetor.jpg',intro:'assets/video/netflix.mp4'},
    {id:'prime',name:'Prime Video',logo:'https://rollingstone.com.br/wp-content/uploads/logo_prime_video_foto_reproducao.jpg',intro:'assets/video/primevideo.mp4'},
    {id:'max',name:'HBO Max',logo:'https://i.pinimg.com/736x/c7/d6/b0/c7d6b09c6a4f721c831f157b3ebe9ed9.jpg',intro:'assets/video/hbomax.mp4'},
    {id:'disney',name:'Disney+',logo:'https://disneyplusbrasil.com.br/wp-content/uploads/2024/03/Disney-Plus-novo-logotipo.jpg',intro:'assets/video/disneyplus.mp4'},
    {id:'apple',name:'Apple TV+',logo:'https://1000logos.net/wp-content/uploads/2022/02/Apple-TV-Logo.jpg',intro:'assets/video/appletv.mp4'},
    {id:'globoplay',name:'Globoplay',logo:'https://t2.tudocdn.net/602261?w=1200&h=1200',intro:''}
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
    app.innerHTML='<section class="splash"><div class="splash-content"><img class="splash-brand" src="assets/images/brand_logo.png" alt="MyTV">'+
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
      '<aside class="sidebar" aria-label="Menu"><img class="side-logo" src="assets/images/brand_logo.png" alt="MyTV"></aside><div class="home-content">'+renderHero(hero,heroIndex+1,visible.length)+
      '<section class="section"><h2 class="section-title">Plataformas de Streaming</h2><div class="row">'+hubs.map(hubCard).join('')+'</div></section>'+
      (cards.length ? '<section class="section"><h2 class="section-title">'+escapeHtml(settings.features_title || 'Aproveite ao máximo o App')+'</h2><div class="row">'+cards.map(featureCard).join('')+'</div></section>' : '')+'</div></section>';
    document.querySelectorAll('[data-provider]').forEach(function(button){ button.addEventListener('click',function(){ openStreaming(findHub(button.getAttribute('data-provider'))); }); });
    clearInterval(heroTimer);
    if (visible.length>1) heroTimer=setInterval(function(){ heroIndex=(heroIndex+1)%visible.length; renderHome(); },Math.max(3,Math.min(60,Number(settings.hero_interval_seconds) || 8))*1000);
  }
  function findHub(id) { for(var i=0;i<hubs.length;i+=1) if(hubs[i].id===id) return hubs[i]; return hubs[0]; }

  function openStreaming(hub) { clearInterval(heroTimer); renderStreaming(hub,true); }
  function renderStreaming(hub,showIntro) {
    app.innerHTML='<section class="streaming-page"><div class="streaming-content"><button class="back-button" id="back-home">VOLTAR</button><div class="provider-heading"><img src="'+attrUrl(hub.logo)+'" alt="'+escapeHtml(hub.name)+'"><h1>'+escapeHtml(hub.name)+'</h1></div><div id="catalog"><p class="catalog-message">Carregando catálogo…</p></div></div></section>'+
      (showIntro && hub.intro ? '<div class="intro"><video autoplay muted playsinline src="'+attrUrl(hub.intro)+'"></video></div>' : '');
    document.getElementById('back-home').addEventListener('click',renderHome);
    var video=document.querySelector('.intro video');
    if(video) { function endIntro(){ var intro=document.querySelector('.intro'); if(intro) intro.remove(); } video.addEventListener('ended',endIntro); video.addEventListener('error',endIntro); }
    loadCatalog(hub).then(renderCatalog).catch(function(){ var target=document.getElementById('catalog'); if(target) target.innerHTML='<p class="catalog-message">Não foi possível carregar o catálogo agora.</p>'; });
  }
  function loadCatalog(hub) {
    if(catalogCache[hub.id]) return Promise.resolve(catalogCache[hub.id]);
    var queries=[{title:'Top 10',collection:'trending'},{title:'Filmes em alta',collection:'trending',kind:'movie'},{title:'Séries em alta',collection:'trending',kind:'tv'},{title:'Lançamentos',collection:'releases'},{title:'Séries Originais '+hub.name,collection:'originals',kind:'tv'}];
    return Promise.all(queries.map(function(query){
      var args='?rating=all&page=1&provider='+encodeURIComponent(hub.name)+'&collection='+encodeURIComponent(query.collection)+(query.kind ? '&media_kind='+query.kind : '');
      return request('search_tmdb.php'+args,{method:'GET'},15000).then(function(result){ return {title:query.title,items:(result.results || []).slice(0,10)}; }).catch(function(){ return {title:query.title,items:[]}; });
    })).then(function(collections){ catalogCache[hub.id]=collections.filter(function(collection){ return collection.items.length; }); return catalogCache[hub.id]; });
  }
  function mediaCard(item) { var image=item.poster_path || item.poster_url || '', title=item.title || item.name || ''; return '<button class="media-card" style="background-image:url(\''+cleanUrl(image)+'\')"><span>'+escapeHtml(title)+'</span></button>'; }
  function renderCatalog(collections) {
    var target=document.getElementById('catalog'); if(!target) return;
    if(!collections.length) { target.innerHTML='<p class="catalog-message">Nenhum título disponível neste catálogo agora.</p>'; return; }
    target.innerHTML=collections.map(function(collection){ return '<section class="catalog-row"><h2>'+escapeHtml(collection.title)+'</h2><div class="row">'+collection.items.map(mediaCard).join('')+'</div></section>'; }).join('');
  }
  document.addEventListener('keydown',function(event){
    if(!home || document.querySelector('.streaming-page')) return;
    var heroes=home.heroes || []; if(!heroes.length) return;
    if(event.keyCode===37) { heroIndex=(heroIndex-1+heroes.length)%heroes.length; renderHome(); }
    if(event.keyCode===39) { heroIndex=(heroIndex+1)%heroes.length; renderHome(); }
  });
  document.addEventListener('visibilitychange',function(){ if(document.hidden) clearInterval(heroTimer); });
  bootstrap();
}());
