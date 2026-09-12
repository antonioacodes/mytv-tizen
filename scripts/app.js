(function () {
  'use strict';

  var API_BASE = 'https://acodes.pro/mytv_backend/api/';
  var APP_VERSION = '0.1.0';
  var CATALOG_CACHE_TTL = 15 * 60 * 1000;
  var app = document.getElementById('app');
  var home = null, heroIndex = 0, heroTimer = null, catalogCache = {}, ratingCache = {}, detailsCache = {}, activeStreamingHub = null, detailsOrigin = 'home', playerReturn = null, searchState = {query:'',platform:'Todas',genre:'Todos',rating:'all',type:'all',submitted:false,loading:false,results:[]};
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
  function bindSidebar() { document.querySelectorAll('[data-nav]').forEach(function(button){ button.addEventListener('click',function(){ var page=button.getAttribute('data-nav'); if(page==='home') { renderHome(); return; } if(page==='search') { renderSearch(); return; } if(page==='favorites') { renderFavorites(); return; } if(page==='settings') { renderSettings(); return; } renderPlaceholder(page); }); }); }
  function renderPlaceholder(page) {
    clearInterval(heroTimer);
    var labels={search:'Buscar',favorites:'Favoritos',sports:'Esportes',live:'TV ao Vivo',movies:'Filmes',series:'Séries',settings:'Configurações'};
    app.innerHTML='<section class="placeholder-page">'+sidebarMarkup(page)+'<div class="placeholder-content"><h1>'+escapeHtml(labels[page] || '')+'</h1><p>Esta seção será adicionada nas próximas etapas do aplicativo Tizen.</p></div></section>';
    bindSidebar();
  }
  function renderSettings() {
    clearInterval(heroTimer); activeStreamingHub=null;
    var user={}; try{user=JSON.parse(localStorage.getItem('mytv_user') || '{}');}catch(error){}
    var device='Samsung Tizen TV', expiry=user.prazo || user.expira_em || 'Acesso ativo';
    var entries=[['Recarga & Planos','Renove ou estenda seu período de acesso','Ativo'],['Vincular E-mail',user.email || 'Nenhum e-mail vinculado',''],['Vincular Telefone',user.telefone || 'Adicione um número para recuperação',''],['Criar / Mudar Senha','Para acessar sua conta em outros dispositivos',''],['Notificações de eventos esportivos','Desativadas: avisos aparecem somente dentro do app','Desativadas'],['Suporte & Ajuda','Leia o QR code com o celular para receber ajuda',''],['Reportar problemas & feedback','Leia o QR code com o celular para enviar sugestões ou reportar falhas',''],['Mudar de Conta','Entre com o ID e a senha de outra conta','']];
    app.innerHTML='<section class="settings-page">'+sidebarMarkup('settings')+'<main class="settings-content"><h1>Configurações</h1><section class="account-card"><div><small>APARELHO</small><b>'+escapeHtml(device)+'</b><span>Versão '+APP_VERSION+' • Build 1</span></div><div><small>CONTA</small><b>'+escapeHtml(user.nome || user.id || 'Minha conta')+'</b><span>'+escapeHtml(expiry)+'</span></div></section><h2>Gerenciar Conta</h2><div class="settings-list">'+entries.map(function(entry,index){return '<button class="setting-item '+(index===7?'danger':'')+'"><div><b>'+escapeHtml(entry[0])+'</b><span>'+escapeHtml(entry[1])+'</span></div>'+(entry[2]?'<em>'+escapeHtml(entry[2])+'</em>':'<i>›</i>')+'</button>';}).join('')+'</div></main></section>';
    bindSidebar();
  }
  function progressItemCard(item,progress) {
    var media={id:item.mediaId,media_type:item.isTvShow?'tv':'movie',title:item.title,name:item.title,poster_thumb_url:item.poster_url,poster_url:item.poster_url}, ratio=Math.max(0,Math.min(1,Number(progress.positionMs)/Math.max(1,Number(progress.durationMs)))), remaining=Math.max(0,Math.ceil((progress.durationMs-progress.positionMs)/60000));
    return '<button class="favorite-media-card" data-favorite-media="'+escapeHtml(item.mediaId)+'" data-favorite-type="'+(item.isTvShow?'tv':'movie')+'"><span class="favorite-poster" style="background-image:url(\''+cleanUrl(item.poster_url)+'\')"></span><b>'+escapeHtml(item.title || 'Título não disponível')+'</b><span class="progress-track"><i style="width:'+(ratio*100).toFixed(2)+'%"></i></span><small>'+((remaining>0)?'Faltam '+remaining+' min':'Quase no fim')+'</small></button>';
  }
  function favoriteMediaCard(item) {
    var progress=getProgress(item.id,item.media_type==='tv'), poster=item.poster_thumb_url || item.poster_url || '';
    return '<button class="favorite-media-card" data-favorite-media="'+escapeHtml(item.id)+'" data-favorite-type="'+escapeHtml(item.media_type)+'"><span class="favorite-poster" style="background-image:url(\''+cleanUrl(poster)+'\')"></span><b>'+escapeHtml(item.title || item.name || 'Título não disponível')+'</b>'+(isResumable(progress)?'<small class="favorite-resume">'+(item.media_type==='tv'?'Continuar T'+(progress.seasonNumber || 1)+' E'+(progress.episodeNumber || 1):'Continuar')+'</small>':'')+'</button>';
  }
  function renderFavorites() {
    clearInterval(heroTimer); activeStreamingHub=null;
    var media=favorites(), allProgress=watchProgress().sort(function(a,b){return b.lastWatchedAt-a.lastWatchedAt;}), continuing=allProgress.filter(isResumable), history=allProgress.filter(function(item){return item.positionMs>0 && item.durationMs>0;}).slice(0,30), channels=readStored('favorite_channels');
    function mediaRow(title,content,kind){return content.length?'<section class="favorite-row"><h2>'+title+'</h2><div class="favorite-items '+(kind||'')+'">'+content.join('')+'</div></section>':'';}
    var channelRow=channels.length?mediaRow('Canais Favoritos',channels.map(function(channel){return '<button class="favorite-channel-card" data-channel-id="'+escapeHtml(channel.id)+'">'+(channel.logo?'<img src="'+attrUrl(channel.logo)+'" alt="">':'')+'<b>'+escapeHtml(channel.name || 'Canal')+'</b></button>'; }),'channels'):'';
    app.innerHTML='<section class="favorites-page">'+sidebarMarkup('favorites')+'<main class="favorites-content"><h1>Favoritos</h1>'+channelRow+mediaRow('Minha Lista',media.map(favoriteMediaCard))+mediaRow('Continuar assistindo',continuing.map(function(item){return progressItemCard(item,item); }))+mediaRow('Histórico',history.map(function(item){return progressItemCard(item,item); }))+(channels.length||media.length||history.length?'':'<p class="favorites-empty">Sua lista está vazia. Favorite filmes, séries e, futuramente, canais ao vivo para encontrá-los aqui.</p>')+'</main></section>';
    bindSidebar();
    document.querySelectorAll('[data-favorite-media]').forEach(function(card){card.addEventListener('click',function(){renderMediaDetails(Number(card.getAttribute('data-favorite-media')),card.getAttribute('data-favorite-type')==='tv',1);});});
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

  function openStreaming(hub) { clearInterval(heroTimer); activeStreamingHub=hub; renderStreaming(hub,true); }
  function renderStreaming(hub,showIntro) {
    var color=/^#[0-9a-f]{6}$/i.test(hub.color || '') ? hub.color : '#25272c';
    app.innerHTML='<section class="streaming-page" style="--provider-color:'+color+'">'+sidebarMarkup('')+
      '<div class="provider-hero-art" style="background-image:url(\''+cleanUrl(hub.logo)+'\')"></div>'+
      '<div class="streaming-content"><section class="provider-hero"><div class="provider-heading"><h1>'+escapeHtml(hub.name)+'</h1></div></section><div id="catalog"><p class="catalog-message">Carregando catálogo…</p></div></div></section>'+
      (showIntro && hub.intro ? '<div class="intro"><video autoplay playsinline src="'+attrUrl(hub.intro)+'"></video></div>' : '');
    bindSidebar();
    var video=document.querySelector('.intro video');
    if(video) { video.muted=false; video.volume=1; video.play().catch(function(error){ console.warn('[MYTV_TIZEN] introdução sem reprodução automática',error); }); function endIntro(){ var intro=document.querySelector('.intro'); if(intro) intro.remove(); } video.addEventListener('ended',endIntro); video.addEventListener('error',endIntro); }
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
  function userStorageKey(name) { var user={}; try{user=JSON.parse(localStorage.getItem('mytv_user') || '{}');}catch(error){} return 'mytv_'+name+'_user_'+(user.id || user.usuario_id || 'device'); }
  function readStored(name) { try { return JSON.parse(localStorage.getItem(userStorageKey(name)) || '[]'); } catch(error) { return []; } }
  function writeStored(name,value) { localStorage.setItem(userStorageKey(name),JSON.stringify(value)); }
  function favoriteKey(id,isTv) { return (isTv?'tv':'movie')+':'+id; }
  function favorites() { return readStored('favorites'); }
  function isFavorite(id,isTv) { return favorites().some(function(item){return favoriteKey(item.id,item.media_type==='tv')===favoriteKey(id,isTv);}); }
  function saveFavorite(item,isTv) { var all=favorites(), key=favoriteKey(item.id,isTv), index=all.findIndex(function(entry){return favoriteKey(entry.id,entry.media_type==='tv')===key;}); if(index>=0){all.splice(index,1);writeStored('favorites',all);return false;} all.unshift({id:Number(item.id),media_type:isTv?'tv':'movie',title:item.title || item.name || 'Título não disponível',name:item.name || item.title || '',poster_thumb_url:item.poster_thumb_url || item.poster_url || item.poster_path || '',poster_url:item.poster_url || item.poster_thumb_url || '',backdrop_url:item.backdrop_large_url || item.backdrop_url || '',imdb_id:item.imdb_id || '',added_at:Date.now()});writeStored('favorites',all);return true; }
  function progressKey(id,isTv) { return favoriteKey(id,isTv); }
  function watchProgress() { return readStored('watch_progress'); }
  function getProgress(id,isTv) { var key=progressKey(id,isTv); return watchProgress().find(function(entry){return progressKey(entry.mediaId,entry.isTvShow)===key;}) || null; }
  function saveProgress(data,position,duration,completed) { if(!data.mediaId || !duration) return; var all=watchProgress(), key=progressKey(data.mediaId,data.isTv), index=all.findIndex(function(entry){return progressKey(entry.mediaId,entry.isTvShow)===key;}), previous=index>=0?all[index]:{}; var item={mediaId:Number(data.mediaId),isTvShow:!!data.isTv,seasonNumber:data.season || null,episodeNumber:data.episode || null,positionMs:completed?0:Math.max(0,Math.floor(position*1000)),durationMs:Math.max(0,Math.floor(duration*1000)),completedEpisodeKeys:previous.completedEpisodeKeys || [],lastWatchedAt:Date.now(),title:data.title || '',poster_url:data.poster || '',backdrop_url:data.backdrop || '',imdb_id:data.imdbId || ''}; if(data.isTv && completed) item.completedEpisodeKeys=(item.completedEpisodeKeys.concat(['T'+(data.season || 1)+'E'+(data.episode || 1)])).filter(function(value,index,list){return list.indexOf(value)===index;}); if(index>=0)all[index]=item;else all.push(item); all.sort(function(a,b){return b.lastWatchedAt-a.lastWatchedAt;});writeStored('watch_progress',all.slice(0,30)); }
  function isResumable(progress) { return progress && progress.positionMs>0 && progress.durationMs>0 && progress.positionMs<progress.durationMs*.92; }
  function mediaCard(item) {
    var image=item.poster_thumb_url || item.poster_url || item.poster_path || '', title=item.title || item.name || 'Título não disponível', key=ratingKey(item), initial=item.imdb_rating || (String(item.rating_source || '').toLowerCase()==='imdb' ? item.vote_average : null);
    return '<button class="media-card" data-media-id="'+escapeHtml(item.id)+'" data-media-type="'+escapeHtml(item.media_type || 'movie')+'"><span class="media-poster" style="background-image:url(\''+cleanUrl(image)+'\')"></span><span class="media-title">'+escapeHtml(title)+'</span><span class="media-bottom"><span class="imdb-mark"><img src="assets/images/imdb_logo.png" alt="IMDb"><b data-imdb="'+escapeHtml(key)+'">'+(initial ? ratingText(initial) : '—')+'</b></span><span class="media-kind">'+mediaType(item)+'</span></span></button>';
  }
  function renderCatalog(collections) {
    var target=document.getElementById('catalog'); if(!target) return;
    if(!collections.length) { target.innerHTML='<p class="catalog-message">Nenhum título disponível neste catálogo agora.</p>'; return; }
    target.innerHTML=collections.map(function(collection){ return '<section class="catalog-row"><h2>'+escapeHtml(collection.title)+'</h2><div class="row catalog-items">'+collection.items.map(mediaCard).join('')+'</div></section>'; }).join('');
    target.querySelectorAll('.media-card').forEach(function(card){ card.addEventListener('click',function(){ detailsOrigin='streaming'; renderMediaDetails(Number(card.getAttribute('data-media-id')), String(card.getAttribute('data-media-type')).toLowerCase()==='tv'); }); });
    enrichRatings(collections);
  }
  function enrichRatings(collections) {
    var unique={};
    collections.forEach(function(collection){ collection.items.forEach(function(item){ unique[ratingKey(item)]=item; }); });
    Object.keys(unique).forEach(function(key){ var item=unique[key], cached=ratingCache[key]; if(cached !== undefined) { updateRating(key,cached); return; } request('get_imdb_rating.php?id='+encodeURIComponent(item.id)+'&type='+encodeURIComponent(item.media_type || (item.name && !item.title ? 'tv' : 'movie')),{method:'GET'},12000).then(function(result){ var value=result && result.imdb_rating; ratingCache[key]=value || null; updateRating(key,value); }).catch(function(){ ratingCache[key]=null; updateRating(key,null); }); });
  }
  function updateRating(key,value) { document.querySelectorAll('[data-imdb="'+key+'"]').forEach(function(node){ node.textContent=value ? ratingText(value) : '—'; }); }
  function duration(minutes) { var total=Number(minutes)||0, hours=Math.floor(total/60), rest=total%60; return hours ? hours+' h'+(rest ? ' '+rest+' min' : '') : total+' min'; }
  function detailKey(id,isTv,season) { return (isTv?'tv':'movie')+':'+id+':'+(season || 0); }
  function detailTitle(item) { return item.title || item.name || 'Título não disponível'; }
  function detailsRatings(item,ratings) {
    var values=(ratings || {}).ratings || {}, imdb=(ratings || {}).imdb_rating || item.imdb_rating;
    var labels=[['tmdb','rating_tmdb.svg','cyan','TMDB'],['trakt','rating_trakt.svg','red','Trakt'],['tomatoes','rating_tomatoes.svg','tomato','Rotten Tomatoes: crítica'],['audience','rating_audience.svg','tomato','Rotten Tomatoes: público'],['metacritic','rating_metacritic.svg','yellow','Metacritic']];
    var html=imdb ? '<span class="detail-imdb"><img src="assets/images/imdb_logo.png" alt="IMDb">'+ratingText(imdb)+'</span>' : '';
    labels.forEach(function(entry){ var value=values[entry[0]]; if(value!==undefined && value!==null) html+='<span class="detail-rating '+entry[2]+'"><img src="assets/images/'+entry[1]+'" alt="'+entry[3]+'">'+escapeHtml(Number(value).toLocaleString('pt-BR',{maximumFractionDigits:0}))+(entry[0]==='tomatoes'||entry[0]==='audience'?'%':'')+'</span>'; });
    return html;
  }
  function mediaLogoUrl(result) {
    var candidates=[result && result.logo_url,result && result.url,result && result.logo,result && result.image_url,result && result.data && result.data.logo_url,result && result.data && result.data.url,result && result.item && result.item.logo_url];
    for(var i=0;i<candidates.length;i+=1) if(typeof candidates[i]==='string' && candidates[i].trim()) return candidates[i];
    return '';
  }
  function detailMeta(item,isTv) { var year=(item.release_date || item.first_air_date || '').slice(0,4), parts=[]; if(year) parts.push(year); if(isTv && item.number_of_seasons) parts.push(item.number_of_seasons+' temporada'+(Number(item.number_of_seasons)===1?'':'s')); if(item.runtime) parts.push(duration(item.runtime)); return parts.join(' • '); }
  function ageInfo(certification) {
    var value=String(certification || '').trim(); if(!value) return '';
    var map={'L':'Livre','0':'Livre','10':'10','12':'12','14':'14','16':'16','18':'18','TV-MA':'18','TV-14':'14','TV-PG':'10','TV-Y7':'Livre','PG-13':'14','R':'18'}, badge=map[value.toUpperCase()] || value;
    return '<div class="detail-age"><span class="age-badge age-'+escapeHtml(badge.toLowerCase().replace(/[^a-z0-9]/g,''))+'">'+escapeHtml(badge)+'</span><div><b>'+((badge===value)?'Classificação indicativa americana':'Classificação indicativa')+'</b><small>'+((badge==='Livre')?'Livre para todos os públicos':(badge===value?'Classificação estrangeira. Verifique a recomendação de idade.':'Não recomendado para menores de '+escapeHtml(badge)+' anos'))+'</small></div></div>';
  }
  function renderMediaDetails(mediaId,isTv,season) {
    clearInterval(heroTimer);
    season=season || 1;
    var key=detailKey(mediaId,isTv,season), cached=detailsCache[key];
    app.innerHTML='<section class="media-details"><div class="details-loading"><div class="loader"></div><span>Carregando detalhes…</span></div></section>';
    function show(payload) {
      var item=payload.item || {}, episodes=payload.episodes || [], backdrop=item.backdrop_large_url || item.backdrop_url || '', logo=item.logo_url, title=detailTitle(item), genres=(item.genres || []).map(function(genre){ return genre.name; }).join(' • '), progress=getProgress(mediaId,isTv), isFav=isFavorite(mediaId,isTv);
      var seasonButtons=(item.seasons || []).filter(function(entry){ return Number(entry.season_number)>0; }).map(function(entry){ return '<button class="season-tab '+(Number(entry.season_number)===Number(season)?'selected':'')+'" data-season="'+escapeHtml(entry.season_number)+'">T'+escapeHtml(entry.season_number)+'</button>'; }).join('');
      var episodeCards=episodes.map(function(episode){ return '<button class="episode-card" data-season="'+escapeHtml(episode.season_number || season)+'" data-episode="'+escapeHtml(episode.episode_number)+'">'+(episode.still_url?'<img src="'+attrUrl(episode.still_url)+'" alt="">':'')+'<div><b>T'+escapeHtml(episode.season_number || 1)+'E'+escapeHtml(episode.episode_number)+' • '+escapeHtml(episode.name || 'Episódio')+'</b><small>'+escapeHtml(episode.runtime?duration(episode.runtime):'')+'</small></div></button>'; }).join('');
      var providers=(item.streaming_providers || []).map(function(provider){ return '<div class="detail-provider">'+(provider.logo_url?'<img src="'+attrUrl(provider.logo_url)+'" alt="">':'')+'<span>'+escapeHtml(provider.name)+'</span></div>'; }).join('');
      app.innerHTML='<section class="media-details"><div class="details-backdrop" style="background-image:url(\''+cleanUrl(backdrop)+'\')"></div><div class="details-gradient"></div><button class="details-back" id="details-back">← <span>VOLTAR</span></button><main class="details-content"><section class="details-hero">'+
        (logo?'<img class="details-logo" src="'+attrUrl(logo)+'" alt="'+escapeHtml(title)+'">':'<h1>'+escapeHtml(title)+'</h1>')+
        '<div class="details-meta">'+escapeHtml(detailMeta(item,isTv))+'</div><div class="details-ratings" id="details-ratings">'+detailsRatings(item,payload.ratings)+'</div>'+(genres?'<div class="details-genres">'+escapeHtml(genres)+'</div>':'')+'</section>'+
        '<section class="details-body"><p class="details-overview">'+escapeHtml(item.overview || 'Sinopse indisponível.')+'</p>'+ageInfo(item.certification)+'<div class="details-actions"><div><button class="primary-action" id="detail-play">▶ '+(isResumable(progress)?'CONTINUAR':'ASSISTIR')+'</button>'+(isResumable(progress)?'<small class="details-remaining">Faltam '+Math.max(1,Math.ceil((progress.durationMs-progress.positionMs)/60000))+' min</small>':'')+'</div><button class="secondary-action" id="detail-favorite">'+(isFav?'♥ FAVORITADO':'♡ FAVORITAR')+'</button></div>'+
        (isTv && seasonButtons?'<h2>Temporadas</h2><div class="season-tabs">'+seasonButtons+'</div><h2>Episódios</h2><div class="episode-row">'+episodeCards+'</div>':'')+
        (providers?'<h2>Disponível em</h2><div class="detail-providers">'+providers+'</div>':'')+
        ((item.similar_titles || []).length?'<h2>Títulos semelhantes</h2><div class="row detail-similar">'+item.similar_titles.map(mediaCard).join('')+'</div>':'')+
        '<h2>Informações</h2><div class="details-info">'+escapeHtml([genres,item.original_title && item.original_title!==title?'Título original: '+item.original_title:'',item.number_of_seasons?(item.number_of_seasons+' temporadas • '+(item.number_of_episodes || 0)+' episódios'):'',item.imdb_id?'IMDb: '+item.imdb_id:'','Metadados: TMDB • Disponibilidade: JustWatch (Brasil)'].filter(Boolean).join('\n'))+'</div></section></main></section>';
      document.getElementById('details-back').addEventListener('click',function(){ if(detailsOrigin==='search') renderSearch(); else if(activeStreamingHub) renderStreaming(activeStreamingHub,false); else renderHome(); });
      document.getElementById('detail-play').addEventListener('click',function(){ var first=episodes[0] || null, resume=isResumable(progress); openVod({mediaId:mediaId,imdbId:item.imdb_id || '',title:title,isTv:isTv,season:resume ? Number(progress.seasonNumber || season) : (first ? Number(first.season_number || season) : Number(season)),episode:resume ? Number(progress.episodeNumber || 1) : (first ? Number(first.episode_number) : 1),episodes:episodes,backdrop:backdrop,poster:item.poster_thumb_url || item.poster_url || '',certification:item.certification || ''}); });
      document.getElementById('detail-favorite').addEventListener('click',function(){ saveFavorite(item,isTv); renderMediaDetails(mediaId,isTv,season); });
      document.querySelectorAll('.season-tab').forEach(function(tab){ tab.addEventListener('click',function(){ renderMediaDetails(mediaId,isTv,Number(tab.getAttribute('data-season'))); }); });
      document.querySelectorAll('.episode-card').forEach(function(card){ card.addEventListener('click',function(){ openVod({mediaId:mediaId,imdbId:item.imdb_id || '',title:title,isTv:true,season:Number(card.getAttribute('data-season')),episode:Number(card.getAttribute('data-episode')),episodes:episodes,backdrop:backdrop,poster:item.poster_thumb_url || item.poster_url || '',certification:item.certification || ''}); }); });
      document.querySelectorAll('.detail-similar .media-card').forEach(function(card){ card.addEventListener('click',function(){ renderMediaDetails(Number(card.getAttribute('data-media-id')),String(card.getAttribute('data-media-type')).toLowerCase()==='tv',1); }); });
      request('get_imdb_rating.php?id='+encodeURIComponent(mediaId)+'&type='+(isTv?'tv':'movie'),{method:'GET'},12000).then(function(ratings){ var node=document.getElementById('details-ratings'); if(node) node.innerHTML=detailsRatings(item,ratings); }).catch(function(){});
      request('get_media_logo.php?id='+encodeURIComponent(mediaId)+'&type='+(isTv?'tv':'movie'),{method:'GET'},12000).then(function(result){ var image=mediaLogoUrl(result), current=document.querySelector('.details-logo'), heading=document.querySelector('.details-hero h1'); if(!image) return; if(current) current.src=cleanUrl(image); else if(heading) heading.outerHTML='<img class="details-logo" src="'+attrUrl(image)+'" alt="'+escapeHtml(title)+'">'; }).catch(function(){});
    }
    if(cached && Date.now()-cached.time<15*60*1000) { show(cached.data); return; }
    request('get_media_details.php?id='+encodeURIComponent(mediaId)+'&type='+(isTv?'tv':'movie')+(isTv?'&season_number='+encodeURIComponent(season):''),{method:'GET'},20000).then(function(data){ if(!data || !data.item) throw new Error('Detalhes indisponíveis'); detailsCache[key]={time:Date.now(),data:data}; show(data); }).catch(function(){ var target=document.querySelector('.details-loading'); if(target) target.textContent='Não foi possível carregar os detalhes agora.'; });
  }
  function keyboardMarkup() {
    var rows=['abcdefg','hijklmn','opqrstu','vwxyz','1234567890'];
    return '<div class="search-keyboard"><div class="search-query">'+escapeHtml(searchState.query || 'Digite um título')+'</div><div class="keyboard-actions"><button data-key-action="clear">LIMPAR</button><button data-key-action="backspace">APAGAR</button></div>'+rows.map(function(row){ return '<div class="keyboard-row">'+row.split('').map(function(key){ return '<button data-key="'+key+'">'+key+'</button>'; }).join('')+'</div>'; }).join('')+'<div class="keyboard-row"><button class="space-key" data-key=" ">ESPAÇO</button><button class="search-key" data-key-action="submit">BUSCAR</button></div></div>';
  }
  function nextFilter(name) {
    var options={platform:['Todas','Netflix','Prime Video','HBO Max','Disney+','Apple TV+','Globoplay'],genre:['Todos','Ação','Comédia','Drama','Crime','Animação','Família'],rating:['all','below_6','7_8','8_9','above_9'],type:['all','movie','tv','anime']}, values=options[name], current=searchState[name], index=values.indexOf(current); searchState[name]=values[(index+1)%values.length]; renderSearch();
  }
  function searchFiltersMarkup() { var ratingLabels={all:'Todas',below_6:'Abaixo de 6','7_8':'7 a 8','8_9':'8 a 9',above_9:'Acima de 9'}, typeLabels={all:'Todos',movie:'Filme',tv:'Série',anime:'Anime'}; return '<div class="search-filters"><button data-filter="platform"><small>Plataforma</small><b>'+escapeHtml(searchState.platform)+'⌄</b></button><button data-filter="genre"><small>Gênero</small><b>'+escapeHtml(searchState.genre)+'⌄</b></button><button data-filter="rating"><small>Nota</small><b>'+escapeHtml(ratingLabels[searchState.rating])+'⌄</b></button><button data-filter="type"><small>Tipo</small><b>'+escapeHtml(typeLabels[searchState.type])+'⌄</b></button></div>'; }
  function renderSearch() {
    clearInterval(heroTimer); activeStreamingHub=null;
    var resultHtml=!searchState.submitted ? '<p class="search-empty">Digite um título, ajuste os filtros e pressione BUSCAR.</p>' : (searchState.loading ? '<div class="search-loading"><div class="loader"></div><span>Buscando no catálogo completo…</span></div>' : (searchState.results.length ? '<div class="search-results">'+searchState.results.map(mediaCard).join('')+'</div>' : '<p class="search-empty">Nenhum título encontrado.</p>'));
    app.innerHTML='<section class="search-page">'+sidebarMarkup('search')+'<div class="search-layout"><aside class="search-controls">'+keyboardMarkup()+searchFiltersMarkup()+'</aside><main class="search-result-area">'+resultHtml+'</main></div></section>';
    bindSidebar();
    document.querySelectorAll('[data-key]').forEach(function(button){button.addEventListener('click',function(){searchState.query+=button.getAttribute('data-key');renderSearch();});});
    document.querySelectorAll('[data-key-action]').forEach(function(button){button.addEventListener('click',function(){var action=button.getAttribute('data-key-action');if(action==='clear')searchState.query='';else if(action==='backspace')searchState.query=searchState.query.slice(0,-1);else submitSearch();renderSearch();});});
    document.querySelectorAll('[data-filter]').forEach(function(button){button.addEventListener('click',function(){nextFilter(button.getAttribute('data-filter'));});});
    document.querySelectorAll('.search-results .media-card').forEach(function(card){card.addEventListener('click',function(){detailsOrigin='search';renderMediaDetails(Number(card.getAttribute('data-media-id')),String(card.getAttribute('data-media-type')).toLowerCase()==='tv');});});
  }
  function submitSearch() {
    var query=searchState.query.trim(); if(query.length<3 && searchState.platform==='Todas' && searchState.genre==='Todos' && searchState.rating==='all' && searchState.type==='all') { searchState.submitted=true; searchState.results=[]; return; }
    searchState.submitted=true;searchState.loading=true;searchState.results=[];
    var args='?rating='+encodeURIComponent(searchState.rating)+'&page=1'+(query.length>=3?'&query='+encodeURIComponent(query):'')+(searchState.platform!=='Todas'?'&provider='+encodeURIComponent(searchState.platform):'')+(searchState.genre!=='Todos'?'&genre='+encodeURIComponent(searchState.genre):'')+(searchState.type!=='all'?'&media_kind='+encodeURIComponent(searchState.type):'');
    request('search_tmdb.php'+args,{method:'GET'},18000).then(function(result){searchState.results=(result.results || []).slice(0,30);searchState.loading=false;renderSearch(); enrichRatings([{items:searchState.results}]);}).catch(function(){searchState.results=[];searchState.loading=false;renderSearch();});
  }
  function sourceQuality(source) { var text=String(source.name || source.title || source.description || '').toUpperCase(); return /4K|2160/.test(text)?4:/FHD|1080/.test(text)?3:/HD|720/.test(text)?2:/SD|480/.test(text)?1:0; }
  function decodePlayableUrl(value) { var raw=String(value || '').trim(); if(/^https?:\/\//i.test(raw)) return raw; var encoded=raw.replace(/^.*base64,/,'').replace(/-/g,'+').replace(/_/g,'/'); try { var decoded=atob(encoded); return /^https?:\/\//i.test(decoded) ? decoded : ''; } catch(error) { return ''; } }
  function resolveVodSources(data) {
    var type=data.isTv ? 'series' : 'movie', args='?imdb_id='+encodeURIComponent(data.imdbId)+'&type='+type+'&season='+encodeURIComponent(data.season || 1)+'&episode='+encodeURIComponent(data.episode || 1);
    return Promise.all([request('get_vod_sources.php'+args,{method:'GET'},14000).catch(function(){return null;}),request('get_nuvio_sources.php'+args,{method:'GET'},14000).catch(function(){return null;})]).then(function(responses){
      var seen={}, sources=[];
      responses.forEach(function(response){ (response && response.streams || []).forEach(function(source){ var url=decodePlayableUrl(source.url); if(url && !seen[url]) { seen[url]=true; sources.push({name:source.name || source.title || 'Fonte',url:url,headers:source.headers || {},quality:sourceQuality(source)}); } }); });
      return sources.sort(function(a,b){return b.quality-a.quality;}).slice(0,10);
    });
  }
  function formatTime(seconds) { seconds=Math.max(0,Math.floor(seconds || 0)); var h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60), s=seconds%60; return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
  function vodAgeBanner(certification) { var value=String(certification || '').toUpperCase(), map={'TV-MA':'18','TV-14':'14','TV-PG':'10','TV-Y7':'Livre','PG-13':'14','R':'18'}, age=map[value] || certification; if(!age) return ''; return '<div class="vod-age-banner" id="vod-age-banner"><span class="age-badge age-'+escapeHtml(String(age).toLowerCase().replace(/[^a-z0-9]/g,''))+'">'+escapeHtml(age)+'</span><div><b>Classificação Indicativa</b><small>'+((age==='Livre')?'Livre para todos os públicos':'Não recomendado para menores de '+escapeHtml(age)+' anos')+'</small></div></div>'; }
  function openVod(data) {
    clearInterval(heroTimer); playerReturn={mediaId:data.mediaId,isTv:data.isTv,season:data.season};
    app.innerHTML='<section class="vod-player"><div class="vod-backdrop" style="background-image:url(\''+cleanUrl(data.backdrop)+'\')"></div><div class="vod-loading"><div class="loader"></div><b>Preparando reprodução...</b></div></section>';
    if(!data.imdbId) { renderVodError(data,'Não foi possível identificar este título para reprodução.'); return; }
    resolveVodSources(data).then(function(sources){ if(!sources.length) throw new Error('Nenhuma fonte de reprodução está disponível agora.'); renderVodPlayer(data,sources); }).catch(function(error){ renderVodError(data,error.message || 'Não foi possível preparar o vídeo.'); });
  }
  function renderVodError(data,message) { app.innerHTML='<section class="vod-player vod-error"><div class="vod-backdrop" style="background-image:url(\''+cleanUrl(data.backdrop)+'\')"></div><div class="vod-error-card"><strong>Não foi possível carregar a mídia</strong><span>'+escapeHtml(message)+'</span><button id="vod-back-error">VOLTAR</button></div></section>'; document.getElementById('vod-back-error').addEventListener('click',returnFromVod); }
  function returnFromVod() { var target=playerReturn; if(target) renderMediaDetails(target.mediaId,target.isTv,target.season); else renderHome(); }
  function fetchVodSubtitles(data) {
    var id=data.isTv ? data.imdbId+':'+(data.season || 1)+':'+(data.episode || 1) : data.imdbId, type=data.isTv?'series':'movie';
    return fetch('https://opensubtitles-v3.strem.io/subtitles/'+type+'/'+encodeURIComponent(id)+'.json').then(function(response){return response.ok?response.json():{subtitles:[]};}).then(function(result){return (result.subtitles || []).filter(function(item){var lang=String(item.lang || '').toLowerCase();return item.url && ['pt-br','pob','en','eng','es','spa'].indexOf(lang)>=0;});}).catch(function(){return [];});
  }
  function renderVodPlayer(data,sources) {
    var sourceIndex=0, overlayVisible=true, menuVisible=false, subtitles=[], subtitleIndex=-1, aspectIndex=0, ratingShown=false, nextShown=false, source=sources[0], lastProgressSaved=0;
    function sourceLabel(item) { return item.name+(item.quality ? ' • '+(['','SD','HD','FHD','4K'][item.quality] || '') : ''); }
    app.innerHTML='<section class="vod-player"><div class="vod-backdrop" id="vod-backdrop" style="background-image:url(\''+cleanUrl(data.backdrop)+'\')"></div><video id="vod-video" class="vod-video" playsinline preload="auto"></video><div class="vod-buffer" id="vod-buffer"><div class="loader"></div><b>Carregando vídeo...</b></div><div class="vod-overlay" id="vod-overlay"><div class="vod-top"><div><h1>'+escapeHtml(data.title)+'</h1>'+(data.isTv?'<p>Temporada '+escapeHtml(data.season)+' • Episódio '+escapeHtml(data.episode)+'</p>':'')+'</div><span id="vod-source-state">Carregando</span></div><div class="vod-timeline"><div class="vod-time"><b id="vod-current">00:00</b><button id="vod-play-pause">▶</button><span id="vod-total">00:00</span></div><input id="vod-seek" type="range" min="0" max="1000" value="0" aria-label="Linha do tempo"><small>Use ←/→ para avançar ou voltar 10 segundos.</small></div></div><div class="vod-bottom-menu" id="vod-bottom-menu"><button data-vod-menu="episodes">EPISÓDIOS</button><button data-vod-menu="subtitle">LEGENDAS</button><button data-vod-menu="audio">ÁUDIO</button><button data-vod-menu="quality">QUALIDADE</button><button data-vod-menu="aspect">PROPORÇÃO</button></div>'+vodAgeBanner(data.certification)+'<div class="vod-menu-modal" id="vod-menu-modal"></div><button class="vod-next" id="vod-next">PRÓXIMO EPISÓDIO ▶</button></section>';
    var video=document.getElementById('vod-video'), buffer=document.getElementById('vod-buffer'), overlay=document.getElementById('vod-overlay'), bottom=document.getElementById('vod-bottom-menu'), modal=document.getElementById('vod-menu-modal'), next=document.getElementById('vod-next'), age=document.getElementById('vod-age-banner'), hideTimer;
    function setOverlay(show) { overlayVisible=show; overlay.classList.toggle('is-hidden',!show); if(show && !menuVisible && !nextShown){clearTimeout(hideTimer);hideTimer=setTimeout(function(){setOverlay(false);},4000);} }
    function setBuffer(show) { buffer.classList.toggle('is-hidden',!show); document.getElementById('vod-backdrop').classList.toggle('is-hidden',!show); }
    function loadSource(index,position) { sourceIndex=index; source=sources[index]; setBuffer(true); document.getElementById('vod-source-state').textContent='Carregando'; video.src=source.url; video.load(); video.onloadedmetadata=function(){var stored=getProgress(data.mediaId,data.isTv), resume=position || (stored && Number(stored.seasonNumber||1)===Number(data.season||1) && Number(stored.episodeNumber||1)===Number(data.episode||1) && isResumable(stored) ? stored.positionMs/1000 : 0); if(resume) video.currentTime=Math.min(resume,video.duration||resume);}; video.play().catch(function(){}); }
    function closeMenu(){menuVisible=false;bottom.classList.remove('is-open');modal.classList.remove('is-open');modal.innerHTML='';setOverlay(true);}
    function nextEpisode(){ var candidates=(data.episodes || []).filter(function(item){return Number(item.season_number || item.seasonNumber || data.season)===Number(data.season) && Number(item.episode_number || item.episodeNumber)>Number(data.episode);}).sort(function(a,b){return Number(a.episode_number||a.episodeNumber)-Number(b.episode_number||b.episodeNumber);}); return candidates[0] || null; }
    function showMenu(kind){ var options=[]; if(kind==='episodes') options=(data.episodes||[]).map(function(item){return {label:'T'+(item.season_number||item.seasonNumber)+' E'+(item.episode_number||item.episodeNumber)+' • '+(item.name||'Episódio'),value:'episode:'+JSON.stringify({season:Number(item.season_number||item.seasonNumber),episode:Number(item.episode_number||item.episodeNumber)})};}); if(kind==='subtitle') options=[{label:'Sem legenda',value:'subtitle:-1'}].concat(subtitles.map(function(item,index){return {label:item.langName||item.lang||'Legenda',value:'subtitle:'+index};})); if(kind==='audio') options=[{label:'Português',value:'audio:pt'},{label:'Inglês',value:'audio:en'},{label:'Espanhol',value:'audio:es'}]; if(kind==='quality') options=sources.map(function(item,index){return {label:sourceLabel(item),value:'quality:'+index};}); if(kind==='aspect') options=[{label:'16:9',value:'aspect:0'},{label:'4:3',value:'aspect:1'},{label:'Preencher',value:'aspect:2'}]; modal.innerHTML='<div class="vod-menu-card"><h2>'+({episodes:'Episódios',subtitle:'Legendas',audio:'Faixas de áudio',quality:'Qualidade',aspect:'Proporção'}[kind])+'</h2>'+options.map(function(option,index){return '<button data-vod-option="'+escapeHtml(option.value)+'">'+escapeHtml(option.label)+'</button>';}).join('</div>'); modal.classList.add('is-open'); menuVisible=true; bottom.classList.add('is-open'); var first=modal.querySelector('button'); if(first) first.focus(); modal.querySelectorAll('[data-vod-option]').forEach(function(button){button.addEventListener('click',function(){var value=button.getAttribute('data-vod-option'), parts=value.split(':'); if(parts[0]==='quality'){loadSource(Number(parts[1]),video.currentTime);} else if(parts[0]==='aspect'){aspectIndex=Number(parts[1]);video.className='vod-video aspect-'+aspectIndex;} else if(parts[0]==='subtitle'){subtitleIndex=Number(parts[1]); Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function(track,index){track.track.mode=index===subtitleIndex?'showing':'disabled';});} else if(parts[0]==='audio'){var tracks=video.audioTracks || []; for(var trackIndex=0;trackIndex<tracks.length;trackIndex+=1){var track=tracks[trackIndex];track.enabled=String(track.language || '').toLowerCase().indexOf(parts[1])===0;}} else if(parts[0]==='episode'){var episode=JSON.parse(value.slice(8)); saveProgress(data,video.duration || 0,video.duration || 0,true); closeMenu(); openVod({mediaId:data.mediaId,imdbId:data.imdbId,title:data.title,isTv:true,season:episode.season,episode:episode.episode,episodes:data.episodes,backdrop:data.backdrop,poster:data.poster,certification:data.certification});return;} closeMenu();});}); }
    loadSource(0,0);
    video.addEventListener('waiting',function(){setBuffer(true);}); video.addEventListener('playing',function(){setBuffer(false);document.getElementById('vod-source-state').textContent='Conexão ativa'; if(!ratingShown && age){ratingShown=true;setTimeout(function(){age.classList.add('is-visible');setTimeout(function(){age.classList.remove('is-visible');},8000);},3000);} });
    video.addEventListener('error',function(){if(sourceIndex<sources.length-1) loadSource(sourceIndex+1,video.currentTime||0); else renderVodError(data,'Todas as fontes de reprodução falharam.');});
    video.addEventListener('timeupdate',function(){var duration=video.duration||0;document.getElementById('vod-current').textContent=formatTime(video.currentTime);document.getElementById('vod-total').textContent=formatTime(duration);document.getElementById('vod-seek').value=duration?Math.round(video.currentTime/duration*1000):0;if(duration && Date.now()-lastProgressSaved>5000){lastProgressSaved=Date.now();saveProgress(data,video.currentTime,duration,video.currentTime>=duration*.92);}var upcoming=nextEpisode();if(data.isTv && upcoming && duration && duration-video.currentTime<=75 && !nextShown){nextShown=true;next.classList.add('is-visible');next.focus();}});
    video.addEventListener('ended',function(){saveProgress(data,video.duration || 0,video.duration || 0,true);var upcoming=nextEpisode();if(upcoming){nextShown=true;next.classList.add('is-visible');next.focus();}else returnFromVod();});
    document.getElementById('vod-play-pause').addEventListener('click',function(){if(video.paused)video.play();else video.pause();}); document.getElementById('vod-seek').addEventListener('input',function(event){if(video.duration)video.currentTime=Number(event.target.value)/1000*video.duration;});
    bottom.querySelectorAll('[data-vod-menu]').forEach(function(button){button.addEventListener('click',function(){showMenu(button.getAttribute('data-vod-menu'));});}); next.addEventListener('click',function(){var upcoming=nextEpisode();if(upcoming){saveProgress(data,video.duration || 0,video.duration || 0,true);openVod({mediaId:data.mediaId,imdbId:data.imdbId,title:data.title,isTv:true,season:Number(upcoming.season_number||upcoming.seasonNumber),episode:Number(upcoming.episode_number||upcoming.episodeNumber),episodes:data.episodes,backdrop:data.backdrop,poster:data.poster,certification:data.certification});}});
    fetchVodSubtitles(data).then(function(items){subtitles=items;items.forEach(function(item){var track=document.createElement('track');track.kind='subtitles';track.label=item.langName||item.lang;track.srclang=item.lang||'pt';track.src=item.url;track.default=false;video.appendChild(track);});});
    document.addEventListener('keydown',function playerKeys(event){if(!document.querySelector('.vod-player')){document.removeEventListener('keydown',playerKeys);return;}if(event.key==='Escape'||event.keyCode===10009){if(menuVisible)closeMenu();else {saveProgress(data,video.currentTime || 0,video.duration || 0,false);returnFromVod();}event.preventDefault();return;}if(nextShown)return;if(event.key==='ArrowLeft'){video.currentTime=Math.max(0,video.currentTime-10);setOverlay(true);}else if(event.key==='ArrowRight'){video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);setOverlay(true);}else if(event.key==='ArrowDown'){menuVisible=true;bottom.classList.add('is-open');var first=bottom.querySelector('button');if(first)first.focus();setOverlay(true);}else if(event.key==='ArrowUp'){closeMenu();}else if(event.key==='Enter' && !menuVisible){if(video.paused)video.play();else video.pause();setOverlay(true);}});
    setOverlay(true);
  }
  document.addEventListener('keydown',function(event){
    if(document.querySelector('.media-details') && (event.keyCode===10009 || event.keyCode===27)) { if(detailsOrigin==='search') renderSearch(); else if(activeStreamingHub) renderStreaming(activeStreamingHub,false); else renderHome(); return; }
    if(document.querySelector('.streaming-page') && event.keyCode===10009) { renderHome(); return; }
    if(!home || document.querySelector('.streaming-page')) return;
    var heroes=home.heroes || []; if(!heroes.length) return;
    if(event.keyCode===37) { heroIndex=(heroIndex-1+heroes.length)%heroes.length; renderHome(); }
    if(event.keyCode===39) { heroIndex=(heroIndex+1)%heroes.length; renderHome(); }
  });
  document.addEventListener('visibilitychange',function(){ if(document.hidden) clearInterval(heroTimer); });
  bootstrap();
}());
