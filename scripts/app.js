(function () {
  'use strict';

  var API_BASE = 'https://acodes.pro/mytv_backend/api/';
  var SPORTS_BACKGROUND_URL = 'https://acodes.pro/mytv_backend/assets/footballwallpaper.png';
  var SPORTS_FIELD_TEXTURE_URL = 'https://acodes.pro/mytv_backend/assets/fieldfootball.png';
  var APP_VERSION = '0.1.0';
  var CATALOG_CACHE_TTL = 15 * 60 * 1000;
  var app = document.getElementById('app');
  var home = null, heroIndex = 0, heroTimer = null, catalogCache = {}, mediaLandingCache = {}, ratingCache = {}, ratingPending = {}, detailsCache = {}, vodSourcePrefetchCache = {}, sportsCache = null, sportsDetailsCache = {}, sportsKeyHandler = null, activeStreamingHub = null, detailsOrigin = 'home', playerReturn = null, searchState = {query:'',platform:'Todas',genre:'Todos',rating:'all',type:'all',submitted:false,loading:false,results:[]};
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
  function stopActivePlayback() {
    Array.prototype.slice.call(document.querySelectorAll('video')).forEach(function(video){
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch(error) {}
    });
    if (liveTvKeyHandler) { document.removeEventListener('keydown',liveTvKeyHandler); liveTvKeyHandler=null; }
    if (sportsKeyHandler) { document.removeEventListener('keydown',sportsKeyHandler); sportsKeyHandler=null; }
  }
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
  function bindSidebar() { document.querySelectorAll('[data-nav]').forEach(function(button){ button.addEventListener('click',function(){ var page=button.getAttribute('data-nav'); stopActivePlayback(); if(page==='home') { renderHome(); return; } if(page==='search') { renderSearch(); return; } if(page==='favorites') { renderFavorites(); return; } if(page==='sports') { renderSports(); return; } if(page==='live') { renderLiveTv(); return; } if(page==='movies' || page==='series') { renderMediaLanding(page); return; } if(page==='settings') { renderSettings(); return; } renderPlaceholder(page); }); }); }
  function renderPlaceholder(page) {
    clearInterval(heroTimer);
    var labels={search:'Buscar',favorites:'Favoritos',sports:'Esportes',live:'TV ao Vivo',movies:'Filmes',series:'Séries',settings:'Configurações'};
    app.innerHTML='<section class="placeholder-page">'+sidebarMarkup(page)+'<div class="placeholder-content"><h1>'+escapeHtml(labels[page] || '')+'</h1><p>Esta seção será adicionada nas próximas etapas do aplicativo Tizen.</p></div></section>';
    bindSidebar();
  }
  function sportEscape(value) { return escapeHtml(value || ''); }
  function sportDate(match) { return [match.dateStr, String(match.timeStr || '').slice(0,5)].filter(Boolean).join(' • '); }
  function sportLongDate(match) { var value=new Date(String(match.dateStr || '')+'T12:00:00'); return isNaN(value.getTime())?sportDate(match):value.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}).replace(/^./,function(letter){return letter.toUpperCase();}); }
  function displayBroadcastName(value) { return String(value || '').replace(/^(?:embedtv|rdcanais|rei\s*dos\s*canais)\s*(?:[·|:/-]+\s*)?/i,'').trim(); }
  function sportIsLive(match) { return !!match.isLive || /live|ao vivo|1h|2h/i.test(String(match.status || '')); }
  function sportBroadcasts(match) {
    var list=(match.broadcastOptions || []).filter(function(item){return item && item.name;});
    if(list.length) return list;
    return String(match.broadcastChannel || '').split(/\s*[,|/]\s*/).filter(Boolean).map(function(name,index){return {id:'legacy:'+index+':'+name,name:name,channelId:index===0?match.broadcastChannelId:null,playable:true};});
  }
  function sportReminderKey() { return userStorageKey('sports_reminders'); }
  function sportReminders() { try{return JSON.parse(localStorage.getItem(sportReminderKey()) || '[]');}catch(error){return [];} }
  function sportReminded(id) { return sportReminders().some(function(item){return item.id===id;}); }
  function toggleSportReminder(match) {
    var items=sportReminders(), index=items.findIndex(function(item){return item.id===match.id;});
    if(index>=0) items.splice(index,1); else items.push({id:match.id,leagueName:match.leagueName,homeTeam:match.homeTeam,awayTeam:match.awayTeam,dateStr:match.dateStr,timeStr:match.timeStr,createdAt:Date.now()});
    localStorage.setItem(sportReminderKey(),JSON.stringify(items)); return index<0;
  }
  function normalizedLeague(value) { return String(value || 'Outros eventos').replace(/\s*[-–—]\s*(grupo|rodada|quartas?|semi[- ]?final|final).*/i,'').replace(/\s*\([FM]\)\s*$/i,'').trim() || 'Outros eventos'; }
  function sportCard(match) {
    var live=sportIsLive(match), reminded=sportReminded(match.id), bg=match.backgroundUrl || SPORTS_BACKGROUND_URL, score=live ? ((match.homeScore || '0')+' × '+(match.awayScore || '0')) : String(match.timeStr || '').slice(0,5);
    return '<button class="sports-card" data-sport-match="'+sportEscape(match.id)+'" style="background-image:linear-gradient(180deg,rgba(3,8,20,.08),rgba(3,8,20,.94)),url(\''+cleanUrl(bg)+'\')"><div class="sports-card-top">'+(live?'<span class="sports-live-badge">AO VIVO</span>':'')+(reminded?'<i class="sports-reminder-badge" aria-label="Lembrete ativo">🔔</i>':'')+'</div><div class="sports-card-teams"><strong>'+sportEscape(score || '—')+'</strong><img src="'+attrUrl(match.homeBadgeUrl || '')+'" alt="'+sportEscape(match.homeTeam)+'"><b>×</b><img src="'+attrUrl(match.awayBadgeUrl || '')+'" alt="'+sportEscape(match.awayTeam)+'"></div><div class="sports-card-bottom"><span>'+sportEscape(sportLongDate(match))+'</span></div></button>';
  }
  function sportsCollections(matches) {
    var groups={}; matches.forEach(function(match){var key=normalizedLeague(match.leagueName);(groups[key]=groups[key] || []).push(match);});
    return Object.keys(groups).map(function(name){return {name:name,matches:groups[name].sort(function(a,b){return (sportIsLive(b)-sportIsLive(a)) || String(a.dateStr+a.timeStr).localeCompare(String(b.dateStr+b.timeStr));})};});
  }
  function renderSports() {
    clearInterval(heroTimer); activeStreamingHub=null;
    if(sportsKeyHandler) { document.removeEventListener('keydown',sportsKeyHandler); sportsKeyHandler=null; }
    app.innerHTML='<section class="sports-page">'+sidebarMarkup('sports')+'<main class="sports-content"><div class="sports-page-heading"><div><h1>Esportes</h1><p>Ao vivo, próximos eventos e competições</p></div></div><div class="sports-loading"><div class="loader"></div><span>Carregando agenda esportiva…</span></div></main></section>';
    bindSidebar();
    function show(matches) {
      var content=document.querySelector('.sports-content'); if(!content) return;
      var collections=sportsCollections(matches || []);
      content.innerHTML='<div class="sports-page-heading"><div><h1>Esportes</h1><p>Ao vivo, próximos eventos e competições</p></div></div>'+(collections.length?collections.map(function(collection){return '<section class="sports-league"><h2>'+sportEscape(collection.name)+'</h2><div class="sports-row">'+collection.matches.map(sportCard).join('')+'</div></section>';}).join(''):'<p class="sports-empty">Não há novas transmissões disponíveis no momento.</p>');
      content.querySelectorAll('[data-sport-match]').forEach(function(card){card.addEventListener('click',function(){var match=(matches || []).find(function(item){return String(item.id)===card.getAttribute('data-sport-match');});if(match) renderSportsOverlay(match);});});
    }
    if(sportsCache && Date.now()-sportsCache.time<5*60*1000) show(sportsCache.matches);
    else request('get_sports.php',{method:'GET'},20000).then(function(matches){sportsCache={time:Date.now(),matches:Array.isArray(matches)?matches:[]};show(sportsCache.matches);}).catch(function(){show([]);});
  }
  function sportsDetails(match,section) {
    var key=match.id+':'+section, cached=sportsDetailsCache[key];
    if(cached && Date.now()-cached.time<60*1000) return Promise.resolve(cached.data);
    return request('get_sports_details.php?fixture_id='+encodeURIComponent(match.id)+'&section='+encodeURIComponent(section),{method:'GET'},18000).then(function(data){sportsDetailsCache[key]={time:Date.now(),data:data};return data;});
  }
  function sportPlayerMarkup(match) { return '<div class="sports-video"><div class="sports-video-art" style="background-image:linear-gradient(0deg,rgba(3,8,20,.75),rgba(3,8,20,.12)),url(\''+cleanUrl(match.backgroundUrl || SPORTS_BACKGROUND_URL)+'\')"></div><video id="sports-video" autoplay playsinline preload="auto"></video><div class="sports-video-state" id="sports-video-state"><span class="loader"></span><span>Conectando ao canal…</span></div></div>'; }
  function sportOverview(match) { return '<div class="sports-section-message sports-summary"><b>'+sportEscape(sportIsLive(match)?'EVENTO AO VIVO':'EVENTO AGENDADO')+'</b><span>Use as abas para ver informações e estatísticas do evento.</span></div>'; }
  function sportsLineups(data,match) {
    var lineups=(data && data.lineups) || []; if(lineups.length<2) return '<div class="sports-section-message">Escalação ainda não disponível</div>';
    function teamPlayers(team,homeSide){var players=team.startXI || [];return players.map(function(player,index){var grid=String(player.grid || '').split(':'), line=Number(grid[0]) || Math.floor(index/3)+1, slot=Number(grid[1]) || index%3+1, sameLine=players.filter(function(item){return (Number(String(item.grid || '').split(':')[0]) || Math.floor(players.indexOf(item)/3)+1)===line;}).length, tacticalX=homeSide?(8+(line-1)*12):(92-(line-1)*12), tacticalY=(slot/(Math.max(1,sameLine)+1))*74+12;return '<span class="tactical-player '+(homeSide?'home':'away')+'" style="left:'+tacticalX+'%;top:'+tacticalY+'%"><i>'+sportEscape(player.number || '•')+'</i><b>'+sportEscape(String(player.name || '').split(' ').slice(-1)[0])+'</b></span>';}).join('');}
    var home=lineups[0], away=lineups[1]; return '<div class="sports-lineups sports-lineups-shared"><div class="sports-lineup-labels"><span><b>'+sportEscape(home.teamName || match.homeTeam)+'</b><small>'+sportEscape(home.formation || '')+'</small></span><span><b>'+sportEscape(away.teamName || match.awayTeam)+'</b><small>'+sportEscape(away.formation || '')+'</small></span></div><div class="tactical-field tactical-field-wide" style="background-image:url(\''+SPORTS_FIELD_TEXTURE_URL+'\')">'+teamPlayers(home,true)+teamPlayers(away,false)+'</div></div>';
  }
  function sportStatValue(team,key,fallback) { return (team && team.values && team.values[key]) || fallback || '—'; }
  function sportsStatistics(data) { var teams=(data && data.teams) || []; if(teams.length<2) return '<div class="sports-section-message">Estatísticas ainda não disponíveis</div>'; var a=teams[0],b=teams[1],stats=[['⚽','Gols',a.goals,b.goals],['◎','Chutes no gol',sportStatValue(a,'shotsOnGoal'),sportStatValue(b,'shotsOnGoal')],['◌','Finalizações',sportStatValue(a,'totalShots'),sportStatValue(b,'totalShots')],['◒','Posse de bola',sportStatValue(a,'possession'),sportStatValue(b,'possession')],['↗','Passes certos',sportStatValue(a,'accuratePasses'),sportStatValue(b,'accuratePasses')],['▣','Defesas',sportStatValue(a,'saves'),sportStatValue(b,'saves')],['⚑','Escanteios',sportStatValue(a,'corners'),sportStatValue(b,'corners')],['⊘','Impedimentos',sportStatValue(a,'offsides'),sportStatValue(b,'offsides')],['!','Faltas',sportStatValue(a,'fouls'),sportStatValue(b,'fouls')],['▰','Cartões amarelos',sportStatValue(a,'yellowCards'),sportStatValue(b,'yellowCards')],['■','Cartões vermelhos',sportStatValue(a,'redCards'),sportStatValue(b,'redCards')],['⇄','Substituições',a.substitutions,b.substitutions]]; return '<div class="sports-stats"><div class="sports-stats-head"><b>'+sportEscape(a.teamName)+'</b><b>'+sportEscape(b.teamName)+'</b></div><div class="sports-stats-columns">'+[stats.slice(0,6),stats.slice(6)].map(function(column){return '<section>'+column.map(function(stat){return '<div><b>'+sportEscape(stat[2])+'</b><span>'+stat[0]+' '+sportEscape(stat[1])+'</span><b>'+sportEscape(stat[3])+'</b></div>';}).join('')+'</section>';}).join('')+'</div></div>'; }
  function sportsStandings(data) { var groups=(data && data.groups) || [], bracket=(data && data.bracket) || []; if(groups.length){var group=groups[0];return '<div class="sports-standing"><h3>'+sportEscape(group.name || 'Classificação')+'</h3>'+((group.rows || []).slice(0,10).map(function(row){return '<div><span>'+sportEscape(row.position)+'</span><img src="'+attrUrl(row.teamLogo || '')+'" alt=""><b>'+sportEscape(row.teamName)+'</b><small>J '+sportEscape(row.played)+' · P '+sportEscape(row.points)+'</small></div>';}).join(''))+'</div>';} if(bracket.length)return '<div class="sports-bracket">'+bracket.slice(-3).map(function(round){return '<section><h3>'+sportEscape(round.name)+'</h3>'+((round.matches || []).slice(0,4).map(function(game){return '<div>'+sportEscape(game.homeTeam)+' <b>'+sportEscape(game.homeGoals || '—')+'</b><br>'+sportEscape(game.awayTeam)+' <b>'+sportEscape(game.awayGoals || '—')+'</b></div>';}).join(''))+'</section>';}).join('')+'</div>';return '<div class="sports-section-message">A classificação ou o chaveamento ainda não está disponível.</div>'; }
  function renderSportsOverlay(match) {
    if(sportsKeyHandler) document.removeEventListener('keydown',sportsKeyHandler);
    var broadcasts=sportBroadcasts(match), sourceIndex=0, tab=0, fullscreen=false, loadedChannelId=null;
    function paint(sectionData,loading) {
      var retainedPlayer=document.querySelector('.sports-video'), broadcast=broadcasts[sourceIndex], broadcastName=displayBroadcastName((broadcast && broadcast.name) || match.broadcastChannel), body=tab===0?sportOverview(match):(loading?'<div class="sports-section-message"><div class="loader"></div>Carregando informações da partida…</div>':tab===1?sportsLineups(sectionData,match):tab===2?sportsStatistics(sectionData):sportsStandings(sectionData));
      if(retainedPlayer && retainedPlayer.parentNode) retainedPlayer.parentNode.removeChild(retainedPlayer);
      app.innerHTML='<section class="sports-watch '+(fullscreen?'is-fullscreen':'')+'">'+sportPlayerMarkup(match)+'<section class="sports-watch-panel" style="background-image:linear-gradient(90deg,rgba(3,12,24,.98),rgba(3,12,24,.90)),url(\''+cleanUrl(match.backgroundUrl || SPORTS_BACKGROUND_URL)+'\')"><aside class="sports-watch-event"><div class="sports-watch-event-heading"><h1>'+sportEscape(match.leagueName)+'</h1>'+(sportIsLive(match)?'<span class="sports-live-badge">AO VIVO</span>':'')+'</div><p>'+sportEscape(sportLongDate(match))+'</p><div class="sports-watch-match"><div><img src="'+attrUrl(match.homeBadgeUrl || '')+'" alt=""><b>'+sportEscape(match.homeTeam)+'</b></div><section><strong>'+sportEscape(sportIsLive(match)?((match.homeScore || '0')+' × '+(match.awayScore || '0')):(match.timeStr || '—'))+'</strong><small>'+sportEscape(broadcastName || 'Transmissão não informada')+'</small></section><div><img src="'+attrUrl(match.awayBadgeUrl || '')+'" alt=""><b>'+sportEscape(match.awayTeam)+'</b></div></div><div class="sports-watch-actions"><button id="sport-back" aria-label="Voltar">←</button><button id="sport-reminder" class="'+(sportReminded(match.id)?'is-reminded':'')+'" aria-label="Lembrete">🔔</button><button id="sport-source" aria-label="Trocar canal" '+(broadcasts.length>1?'':'disabled')+'>↻</button><button id="sport-fullscreen" aria-label="Tela cheia">⛶</button></div></aside><main class="sports-watch-main"><div class="sports-tabs">'+['RESUMO','ESCALAÇÕES','ESTATÍSTICAS'].map(function(name,index){return '<button data-sport-tab="'+index+'" class="'+(tab===index?'selected':'')+'">'+name+'</button>';}).join('')+'</div><div class="sports-watch-data">'+body+'</div></main></section></section>';
      if(retainedPlayer){var freshPlayer=document.querySelector('.sports-video');if(freshPlayer) freshPlayer.parentNode.replaceChild(retainedPlayer,freshPlayer);}
      document.getElementById('sport-back').addEventListener('click',renderSports); document.getElementById('sport-reminder').addEventListener('click',function(){toggleSportReminder(match);paint(sectionData,false);}); document.getElementById('sport-source').addEventListener('click',function(){if(broadcasts.length>1){sourceIndex=(sourceIndex+1)%broadcasts.length;loadedChannelId=null;paint(sectionData,false);}}); document.getElementById('sport-fullscreen').addEventListener('click',function(){fullscreen=true;paint(sectionData,false);}); document.querySelectorAll('[data-sport-tab]').forEach(function(button){button.addEventListener('click',function(){tab=Number(button.getAttribute('data-sport-tab'));if(tab===0)paint(null,false);else {paint(null,true);sportsDetails(match,['details','lineups','statistics'][tab]).then(function(response){paint(response.data || null,false);}).catch(function(){paint(null,false);});}});}); if(broadcast && loadedChannelId!==broadcast.channelId){loadedChannelId=broadcast.channelId;loadSportChannel(broadcast);}
    }
    function loadSportChannel(broadcast) { var state=document.getElementById('sports-video-state'), video=document.getElementById('sports-video'); if(!state || !video || !broadcast || !broadcast.channelId) return; state.innerHTML='<span class="loader"></span><span>Conectando ao canal…</span>'; request('live_tv.php?id_app='+encodeURIComponent(deviceId())+'&channel_id='+encodeURIComponent(broadcast.channelId),{method:'GET'},18000).then(function(data){var channel=(data.channels || []).find(function(item){return Number(item.id)===Number(broadcast.channelId);}) || (data.channels || [])[0], stream=channel && (channel.streams || []).find(function(item){return item.url;}); if(!stream || !stream.id) throw new Error('Canal indisponível'); return request('resolve_stream.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stream_id:Number(stream.id),id_app:deviceId(),force:false})},30000);}).then(function(resolved){var url=(resolved.delivery_mode && resolved.delivery_mode!=='direct' ? resolved.proxy_url : resolved.url) || resolved.proxy_url || resolved.url; if(!resolved.ok || !url) throw new Error(resolved.error || 'Canal indisponível'); video.muted=false; video.volume=1; video.src=decodePlayableUrl(url); video.load(); return video.play();}).then(function(){state.classList.add('is-hidden');}).catch(function(){state.textContent='Transmissão temporariamente indisponível';}); }
    sportsKeyHandler=function(event){if(!document.querySelector('.sports-watch')){document.removeEventListener('keydown',sportsKeyHandler);sportsKeyHandler=null;return;}if(event.keyCode===10009 || event.key==='Escape'){stopActivePlayback();renderSports();event.preventDefault();return;}if(fullscreen && event.keyCode===13){fullscreen=false;paint(null,false);event.preventDefault();return;}var direction={37:'left',38:'up',39:'right',40:'down'}[event.keyCode];if(direction&&focusRemoteDirection(direction)){event.preventDefault();return;}if((event.keyCode===13||event.keyCode===23)&&document.activeElement&&document.activeElement.click){document.activeElement.click();event.preventDefault();}};
    document.addEventListener('keydown',sportsKeyHandler); paint(null,false);
  }
  /* TV ao Vivo: catálogo e player seguem o mesmo contrato do LiveTVPage Android. */
  var liveTvCache=null, liveTvKeyHandler=null, liveTvState={channel:null,epg:null,full:false,loading:false,sourceIndex:0,traffic:'0 KB/s'};
  function visibleLiveChannel(channel) { return channel && String(channel.addon_id || '').toLowerCase()!=='sports' && !/^(?:rdcanais|embedtv|rei\s*dos\s*canais)\s*[·|:/-]/i.test(String(channel.name || '')); }
  function liveChannels(data) { return (data && data.channels || []).filter(visibleLiveChannel); }
  function liveFavoriteKey() { return userStorageKey('favorite_live_channels'); }
  function liveFavorites() { try{return JSON.parse(localStorage.getItem(liveFavoriteKey()) || '[]');}catch(error){return [];} }
  function isLiveFavorite(channel) { return liveFavorites().some(function(item){return String(item.id)===String(channel.id);}); }
  function toggleLiveFavorite(channel) { var items=liveFavorites(),index=items.findIndex(function(item){return String(item.id)===String(channel.id);}); if(index>=0)items.splice(index,1);else items.unshift({id:channel.id,name:channel.name,logo:channel.logo || '',category:channel.category || ''});localStorage.setItem(liveFavoriteKey(),JSON.stringify(items));return index<0; }
  function liveCategories(channels) { var seen={Todos:true}, list=['Todos']; channels.forEach(function(channel){var category=String(channel.category || '').trim();if(category&&!seen[category]){seen[category]=true;list.push(category);}});return list; }
  function liveStreamList(channel) { return (channel.streams || []).filter(function(stream){return stream && stream.enabled!==false && (stream.id || stream.url || stream.source_url);}).sort(function(a,b){var aw=a.is_working===false?1:0,bw=b.is_working===false?1:0;if(aw!==bw)return aw-bw;return Number(a.availability_rank || 0)-Number(b.availability_rank || 0)||Number(a.effective_priority===undefined?a.priority:a.effective_priority || 0)-Number(b.effective_priority===undefined?b.priority:b.effective_priority || 0);}); }
  function epgProgress(program) { if(!program||!program.start_time||!program.end_time)return 0;var start=Date.parse(program.start_time),end=Date.parse(program.end_time);return isNaN(start)||isNaN(end)||end<=start?0:Math.max(0,Math.min(1,(Date.now()-start)/(end-start))); }
  function refreshLiveEpg(){var node=document.querySelector('.live-epg');if(node)node.outerHTML=liveEpgMarkup();}
  function loadLiveEpg(channel) { if(!channel)return Promise.resolve(null);return request('get_epg.php?channel_id='+encodeURIComponent(channel.id),{method:'GET'},13000).then(function(data){if(data && String(data.status).toLowerCase()==='success' && liveTvState.channel && String(liveTvState.channel.id)===String(channel.id)){liveTvState.epg=data;refreshLiveEpg();}return liveTvState.epg;}).catch(function(){return liveTvState.epg;}); }
  function livePlaybackUrl(resolved) { return (resolved && (resolved.proxy_url || resolved.url)) || ''; }
  function activateLiveStream(video,channel,index,tuneToken,force) {
    var streams=liveStreamList(channel),stream=streams[index];
    if(!video||!stream) return Promise.reject(new Error('Nenhuma fonte disponível'));
    liveTvState.sourceIndex=index;
    return request('resolve_stream.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stream_id:Number(stream.id),id_app:deviceId(),force:!!force})},30000).then(function(resolved){if(tuneToken && tuneToken!==liveTvState.tuneToken)throw new Error('Sintonia substituída');var url=decodePlayableUrl(livePlaybackUrl(resolved));if(!resolved||!resolved.ok||!url)throw new Error((resolved&&resolved.error)||'Canal indisponível');video.pause();video.removeAttribute('src');video.load();video.muted=false;video.volume=1;video.src=url;video.load();liveTvState.videoChannelId=channel.id;liveTvState.traffic='12 KB/s';return new Promise(function(resolve,reject){var settled=false,timer=setTimeout(function(){fail(new Error('Tempo de conexão esgotado'));},18000);function clean(){clearTimeout(timer);video.removeEventListener('error',fail);video.removeEventListener('loadeddata',frame);video.removeEventListener('canplay',frame);}function finish(){if(settled)return;settled=true;clean();resolve();}function fail(error){if(settled)return;settled=true;clean();reject(error instanceof Error?error:new Error('Fonte indisponível'));}function frame(){if(video.videoWidth>0&&video.videoHeight>0){liveTvState.traffic='12 KB/s';finish();}}video.addEventListener('error',fail);video.addEventListener('loadeddata',frame);video.addEventListener('canplay',frame);video.play().then(frame).catch(fail);});});
  }
  function tuneLiveChannel(channel,video,onDone) {
    if(!channel||!video)return;var tuneToken=(liveTvState.tuneToken||0)+1;liveTvState.tuneToken=tuneToken;liveTvState.channel=channel;liveTvState.loading=true;liveTvState.sourceIndex=0;liveTvState.traffic='0 KB/s';localStorage.setItem(userStorageKey('last_live_channel'),String(channel.id));loadLiveEpg(channel);
    var streams=liveStreamList(channel), index=0;
    function attempt(force){if(tuneToken!==liveTvState.tuneToken)return;if(index>=streams.length){liveTvState.loading=false;if(onDone)onDone('Não foi possível sintonizar este canal agora.');return;}activateLiveStream(video,channel,index,tuneToken,force).then(function(){if(tuneToken!==liveTvState.tuneToken)return;liveTvState.loading=false;if(onDone)onDone();}).catch(function(){if(tuneToken!==liveTvState.tuneToken)return;if(!force){attempt(true);return;}index+=1;attempt(false);});}
    attempt(false);
  }
  function liveChannelCard(channel,selected) { return '<button class="live-channel-card '+(selected?'selected':'')+'" data-live-channel="'+escapeHtml(channel.id)+'"><span class="live-channel-logo">'+(channel.logo?'<img src="'+attrUrl(channel.logo)+'" alt="">':'<b>TV</b>')+'</span><span><b>'+escapeHtml(channel.name)+'</b><small>'+escapeHtml(channel.category || 'Transmissão Digital')+'</small></span><i>'+ (isLiveFavorite(channel)?'♥':'') +'</i></button>'; }
  function liveEpgMarkup() { var epg=liveTvState.epg||{},now=epg.now, next=(epg.next||[]).slice(0,3);return '<section class="live-epg"><div class="live-on-air"><div><small>NO AR AGORA</small><b>'+escapeHtml(now?now.title:'Sem Guia de Programação')+'</b><span>'+escapeHtml(now&&now.description || '')+'</span>'+(now?'<i><em style="width:'+(epgProgress(now)*100)+'%"></em></i>':'')+'</div><time>'+escapeHtml(now?(String(now.start_time||'').slice(11,16)+' - '+String(now.end_time||'').slice(11,16)):'')+'</time></div><h3>A Seguir na Programação</h3><div class="live-upcoming">'+(next.length?next.map(function(program){return '<article><time>'+escapeHtml(String(program.start_time||'').slice(11,16))+'</time><b>'+escapeHtml(program.title||'Sem título')+'</b><span>'+escapeHtml(program.description||'')+'</span></article>';}).join(''):'<span>Guia de programação indisponível.</span>')+'</div></section>'; }
  function renderLiveTv() {
    clearInterval(heroTimer);activeStreamingHub=null;if(liveTvKeyHandler){document.removeEventListener('keydown',liveTvKeyHandler);liveTvKeyHandler=null;}
    app.innerHTML='<section class="live-page">'+sidebarMarkup('live')+'<main class="live-content"><div class="live-page-heading"><div><h1>TV ao Vivo</h1><p>Canais e programação em tempo real</p></div></div><div class="live-loading"><span class="loader"></span>Carregando canais…</div></main></section>';bindSidebar();
    function show(data){var channels=liveChannels(data),saved=localStorage.getItem(userStorageKey('last_live_channel')),selected=channels.find(function(channel){return String(channel.id)===String(saved);})||liveTvState.channel||channels[0],categories=liveCategories(channels),activeCategory='Todos';liveTvState.channel=selected;
      function paint(error){var retainedVideo=document.getElementById('live-video'),channel=liveTvState.channel||selected,keepVideo=retainedVideo&&String(liveTvState.videoChannelId)===String(channel&&channel.id);if(retainedVideo&&!keepVideo){retainedVideo.pause();retainedVideo.removeAttribute('src');retainedVideo.load();}if(retainedVideo&&retainedVideo.parentNode)retainedVideo.parentNode.removeChild(retainedVideo);var visible=channels.filter(function(item){return activeCategory==='Todos'||item.category===activeCategory;});app.innerHTML='<section class="live-page">'+sidebarMarkup('live')+'<main class="live-content"><div class="live-page-heading"><div><h1>TV ao Vivo</h1><p>Canais e programação em tempo real</p></div></div><div class="live-grid"><section class="live-preview"><div class="live-video-wrap" style="background-image:url(\''+cleanUrl(channel&&channel.logo || '')+'\')"><video id="live-video" playsinline preload="auto"></video><div class="live-video-state '+(liveTvState.loading?'':'is-hidden')+'" id="live-video-state"><span class="loader"></span><b>'+escapeHtml(error||'Sintonizando canal…')+'</b><small>'+escapeHtml(channel&&channel.name||'')+' · <i id="live-traffic">'+escapeHtml(liveTvState.traffic)+'</i></small></div><button id="live-fullscreen" class="live-fullscreen">⛶</button></div><div class="live-channel-info"><span class="live-main-logo">'+(channel&&channel.logo?'<img src="'+attrUrl(channel.logo)+'" alt="">':'TV')+'</span><div><h2>'+escapeHtml(channel&&channel.name||'Canal')+'</h2><p>'+escapeHtml(channel&&channel.category||'Transmissão Digital')+'</p></div><button id="live-favorite" class="live-favorite '+(channel&&isLiveFavorite(channel)?'is-favorite':'')+'">'+(channel&&isLiveFavorite(channel)?'♥ FAVORITADO':'♡ FAVORITAR')+'</button></div>'+liveEpgMarkup()+'</section><section class="live-list"><h2>Lista de Canais</h2><div class="live-categories">'+categories.map(function(category){return '<button data-live-category="'+escapeHtml(category)+'" class="'+(activeCategory===category?'selected':'')+'">'+escapeHtml(category)+'</button>';}).join('')+'</div><div class="live-channel-list">'+(visible.length?visible.map(function(item){return liveChannelCard(item,channel&&String(item.id)===String(channel.id));}).join(''):'<p>Nenhum canal nesta categoria.</p>')+'</div></section></div></main></section>';if(keepVideo){var fresh=document.getElementById('live-video');if(fresh)fresh.parentNode.replaceChild(retainedVideo,fresh);}bindSidebar();bind();}
      function done(error){var state=document.getElementById('live-video-state'),traffic=document.getElementById('live-traffic');if(traffic)traffic.textContent=liveTvState.traffic;if(!state)return;if(error){state.innerHTML='<b>'+escapeHtml(error)+'</b>';state.classList.remove('is-hidden');}else state.classList.add('is-hidden');}
      function bind(){document.querySelectorAll('[data-live-category]').forEach(function(button){button.addEventListener('click',function(){activeCategory=button.getAttribute('data-live-category');paint();});});document.querySelectorAll('[data-live-channel]').forEach(function(button){button.addEventListener('click',function(){var next=channels.find(function(item){return String(item.id)===button.getAttribute('data-live-channel');});if(next&&(!liveTvState.channel||next.id!==liveTvState.channel.id)){liveTvState.channel=next;liveTvState.epg=null;liveTvState.loading=true;paint();tuneLiveChannel(next,document.getElementById('live-video'),done);}});});document.getElementById('live-favorite').addEventListener('click',function(){toggleLiveFavorite(liveTvState.channel);paint();});document.getElementById('live-fullscreen').addEventListener('click',function(){renderLivePlayer(channels);});var video=document.getElementById('live-video');if(video&&!video.src&&liveTvState.channel){tuneLiveChannel(liveTvState.channel,video,done);}}
      paint();
    }
    if(liveTvCache&&Date.now()-liveTvCache.time<5*60*1000)show(liveTvCache.data);else request('live_tv.php?id_app='+encodeURIComponent(deviceId()),{method:'GET'},20000).then(function(data){liveTvCache={time:Date.now(),data:data};show(data);}).catch(function(){var node=document.querySelector('.live-content');if(node)node.innerHTML='<div class="live-loading">Não foi possível carregar os canais agora.</div>';});
  }
  function renderLivePlayer(channels) { var current=liveTvState.channel;if(!current)return;var overlay=true;function done(error){var state=document.getElementById('live-video-state');if(!state)return;if(error){state.innerHTML='<b>'+escapeHtml(error)+'</b>';state.classList.remove('is-hidden');}else state.classList.add('is-hidden');}function paint(error){var previous=document.getElementById('live-video'),keepPrevious=previous&&String(liveTvState.videoChannelId)===String(current.id);if(previous&&!keepPrevious){previous.pause();previous.removeAttribute('src');previous.load();}if(previous&&previous.parentNode)previous.parentNode.removeChild(previous);app.innerHTML='<section class="live-player"><video id="live-video" playsinline preload="auto"></video><div class="live-player-backdrop" style="background-image:url(\''+cleanUrl(current.logo||'')+'\')"></div><div class="live-player-state '+(liveTvState.loading?'':'is-hidden')+'" id="live-video-state"><span class="loader"></span><b>'+escapeHtml(error||'Sintonizando canal…')+' · '+escapeHtml(liveTvState.traffic)+'</b></div><section class="live-player-overlay '+(overlay?'':'is-hidden')+'"><div class="live-player-title"><span>'+ (current.logo?'<img src="'+attrUrl(current.logo)+'" alt="">':'TV') +'</span><div><h1>'+escapeHtml(current.name)+'</h1><p>'+escapeHtml(current.category||'Transmissão Digital')+'</p></div><b>'+escapeHtml((liveTvState.epg&&liveTvState.epg.now&&liveTvState.epg.now.title)||'')+'</b></div><div class="live-player-controls"><button id="live-player-back">← VOLTAR</button><button id="live-player-source">FONTE '+(liveTvState.sourceIndex+1)+'</button><button id="live-player-list">LISTA DE CANAIS</button></div></section></section>';var video=document.getElementById('live-video');if(keepPrevious){video.src=previous.src;video.muted=false;video.volume=1;video.play().catch(function(){});}else {liveTvState.loading=true;tuneLiveChannel(current,video,done);}bind();}
    function bind(){document.getElementById('live-player-back').addEventListener('click',renderLiveTv);document.getElementById('live-player-source').addEventListener('click',function(){var video=document.getElementById('live-video'),streams=liveStreamList(current);if(streams.length>1){liveTvState.loading=true;activateLiveStream(video,current,(liveTvState.sourceIndex+1)%streams.length,null,true).then(function(){liveTvState.loading=false;paint();}).catch(function(){liveTvState.loading=false;paint('Outra fonte não está disponível');});}});document.getElementById('live-player-list').addEventListener('click',renderLiveTv);}
    liveTvKeyHandler=function(event){if(!document.querySelector('.live-player')){document.removeEventListener('keydown',liveTvKeyHandler);liveTvKeyHandler=null;return;}var code=event.keyCode;if(code===10009||event.key==='Escape'){renderLiveTv();event.preventDefault();return;}if(code===13){overlay=!overlay;paint();event.preventDefault();return;}if(code===38||code===40){var index=channels.findIndex(function(item){return String(item.id)===String(current.id);});current=channels[(index+(code===38?-1:1)+channels.length)%channels.length];liveTvState.channel=current;liveTvState.epg=null;liveTvState.loading=true;paint();event.preventDefault();}};document.addEventListener('keydown',liveTvKeyHandler);paint(); }

  function renderSettings() {
    clearInterval(heroTimer); activeStreamingHub=null;
    var user={}; try{user=JSON.parse(localStorage.getItem('mytv_user') || '{}');}catch(error){}
    var device='Samsung Tizen TV', expiry=user.prazo || user.expira_em || 'Acesso ativo';
    var entries=[['Recarga & Planos','Renove ou estenda seu período de acesso','Ativo'],['Vincular E-mail',user.email || 'Nenhum e-mail vinculado',''],['Vincular Telefone',user.telefone || 'Adicione um número para recuperação',''],['Criar / Mudar Senha','Para acessar sua conta em outros dispositivos',''],['Notificações de eventos esportivos','Desativadas: avisos aparecem somente dentro do app','Desativadas'],['Suporte & Ajuda','Leia o QR code com o celular para receber ajuda',''],['Reportar problemas & feedback','Leia o QR code com o celular para enviar sugestões ou reportar falhas',''],['Mudar de Conta','Entre com o ID e a senha de outra conta','']];
    app.innerHTML='<section class="settings-page">'+sidebarMarkup('settings')+'<main class="settings-content"><h1>Configurações</h1><section class="account-card"><div><small>APARELHO</small><b>'+escapeHtml(device)+'</b><span>Versão '+APP_VERSION+' • Build 1</span></div><div><small>CONTA</small><b>'+escapeHtml(user.nome || user.id || 'Minha conta')+'</b><span>'+escapeHtml(expiry)+'</span></div></section><h2>Gerenciar Conta</h2><div class="settings-list">'+entries.map(function(entry,index){return '<button class="setting-item '+(index===7?'danger':'')+'"><div><b>'+escapeHtml(entry[0])+'</b><span>'+escapeHtml(entry[1])+'</span></div>'+(entry[2]?'<em>'+escapeHtml(entry[2])+'</em>':'<i>›</i>')+'</button>';}).join('')+'</div></main></section>';
    bindSidebar();
  }
  function progressItemCard(item,progress,history) {
    var media={id:item.mediaId,media_type:item.isTvShow?'tv':'movie',title:item.title,name:item.title,poster_thumb_url:item.poster_url,poster_url:item.poster_url}, ratio=Math.max(0,Math.min(1,Number(progress.positionMs)/Math.max(1,Number(progress.durationMs)))), remaining=Math.max(0,Math.ceil((progress.durationMs-progress.positionMs)/60000));
    return '<button class="favorite-media-card" data-progress-item="'+escapeHtml(item.mediaId)+'" data-progress-type="'+(item.isTvShow?'tv':'movie')+'"><span class="favorite-poster" style="background-image:url(\''+cleanUrl(item.poster_url)+'\')"></span><b>'+escapeHtml(item.title || 'Título não disponível')+'</b>'+(history?'':'<span class="progress-track"><i style="width:'+(ratio*100).toFixed(2)+'%"></i></span><small>'+((remaining>0)?'Faltam '+remaining+' min':'Quase no fim')+'</small>')+'</button>';
  }
  function favoriteMediaCard(item) {
    var progress=getProgress(item.id,item.media_type==='tv'), poster=item.poster_thumb_url || item.poster_url || '';
    return '<button class="favorite-media-card" data-favorite-media="'+escapeHtml(item.id)+'" data-favorite-type="'+escapeHtml(item.media_type)+'"><span class="favorite-poster" style="background-image:url(\''+cleanUrl(poster)+'\')"></span><b>'+escapeHtml(item.title || item.name || 'Título não disponível')+'</b>'+(isResumable(progress)?'<small class="favorite-resume">'+(item.media_type==='tv'?'Continuar T'+(progress.seasonNumber || 1)+' E'+(progress.episodeNumber || 1):'Continuar')+'</small>':'')+'</button>';
  }
  function renderFavorites() {
    clearInterval(heroTimer); activeStreamingHub=null;
    var media=favorites(), allProgress=watchProgress().sort(function(a,b){return b.lastWatchedAt-a.lastWatchedAt;}), continuing=allProgress.filter(isResumable), history=allProgress.filter(function(item){return item.positionMs>0 && item.durationMs>0;}).slice(0,30), channels=liveFavorites();
    function mediaRow(title,content,kind){return content.length?'<section class="favorite-row"><h2>'+title+'</h2><div class="favorite-items '+(kind||'')+'">'+content.join('')+'</div></section>':'';}
    var channelRow=channels.length?mediaRow('Canais Favoritos',channels.map(function(channel){return '<button class="favorite-channel-card" data-channel-id="'+escapeHtml(channel.id)+'">'+(channel.logo?'<img src="'+attrUrl(channel.logo)+'" alt="">':'')+'<b>'+escapeHtml(channel.name || 'Canal')+'</b></button>'; }),'channels'):'';
    app.innerHTML='<section class="favorites-page">'+sidebarMarkup('favorites')+'<main class="favorites-content"><h1>Favoritos</h1>'+channelRow+mediaRow('Minha Lista',media.map(favoriteMediaCard))+mediaRow('Continuar assistindo',continuing.map(function(item){return progressItemCard(item,item,false); }))+mediaRow('Histórico',history.map(function(item){return progressItemCard(item,item,true); }))+(channels.length||media.length||history.length?'':'<p class="favorites-empty">Sua lista está vazia. Favorite filmes, séries e, futuramente, canais ao vivo para encontrá-los aqui.</p>')+'</main></section>';
    bindSidebar();
    document.querySelectorAll('[data-favorite-media]').forEach(function(card){card.addEventListener('click',function(){renderMediaDetails(Number(card.getAttribute('data-favorite-media')),card.getAttribute('data-favorite-type')==='tv',1);});});
    document.querySelectorAll('[data-progress-item]').forEach(function(card){card.addEventListener('click',function(){var progress=allProgress.find(function(item){return String(item.mediaId)===card.getAttribute('data-progress-item') && String(!!item.isTvShow)===String(card.getAttribute('data-progress-type')==='tv');});if(!progress || !progress.imdb_id){renderMediaDetails(Number(card.getAttribute('data-progress-item')),card.getAttribute('data-progress-type')==='tv',1);return;}openVod({mediaId:progress.mediaId,imdbId:progress.imdb_id,title:progress.title,isTv:!!progress.isTvShow,season:progress.seasonNumber||1,episode:progress.episodeNumber||1,poster:progress.poster_url,backdrop:progress.backdrop_url});});});
    document.querySelectorAll('[data-channel-id]').forEach(function(card){card.addEventListener('click',function(){localStorage.setItem(userStorageKey('last_live_channel'),card.getAttribute('data-channel-id'));renderLiveTv();});});
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
  /* Filmes e Séries usam o mesmo payload pré-gerado que abastece o Android.
     Assim títulos, ordem editorial e artes não divergem entre as duas TVs. */
  function mediaLandingDefinition(kind) {
    return kind==='series' ? {
      title:'Séries', action:'ASSISTIR SÉRIE', type:'tv',
      hero:'destaques',
      rows:[['Séries Populares','populares'],['Ação e Aventura','acao_aventura'],['Séries de Drama','drama'],['Ficção Científica e Fantasia','sci_fi']]
    } : {
      title:'Filmes', action:'ASSISTIR AGORA', type:'movie',
      hero:'destaques',
      rows:[['Mais Assistidos','mais_assistidos'],['Lançamentos','lancamentos'],['Ação','acao'],['Comédia','comedia']]
    };
  }
  function landingItem(item,type) {
    var copy=Object.assign({},item || {});
    copy.media_type=copy.media_type || type;
    return copy;
  }
  function loadMediaLanding(kind) {
    var cached=mediaLandingCache[kind];
    if(cached && Date.now()-cached.time<CATALOG_CACHE_TTL) return Promise.resolve(cached.data);
    var definition=mediaLandingDefinition(kind);
    return request('get_tmdb.php',{method:'GET'},20000).then(function(payload){
      var section=(payload && payload[kind==='series'?'series':'movies']) || {};
      var heroes=(section[definition.hero] || []).map(function(item){ return landingItem(item,definition.type); });
      var rows=definition.rows.map(function(row){ return {title:row[0],items:(section[row[1]] || []).map(function(item){ return landingItem(item,definition.type); })}; }).filter(function(row){ return row.items.length; });
      if(!heroes.length && !rows.length) throw new Error('Catálogo indisponível');
      var data={heroes:heroes,rows:rows}; mediaLandingCache[kind]={time:Date.now(),data:data}; return data;
    });
  }
  function landingGenres(item) {
    return (item.genres || []).map(function(genre){ return typeof genre==='string' ? genre : genre.name; }).filter(Boolean).slice(0,3);
  }
  function landingHeroMarkup(item,kind,index,total) {
    var definition=mediaLandingDefinition(kind), title=detailTitle(item), genres=landingGenres(item), year=String(item.release_date || item.first_air_date || '').slice(0,4), rating=item.imdb_rating || item.vote_average, logo=item.logo_url || item.title_logo_url || '';
    return '<section class="landing-hero" style="background-image:url(\''+cleanUrl(item.backdrop_large_url || item.backdrop_url || item.poster_url || item.poster_thumb_url || '')+'\')"><div class="landing-hero-gradient"></div><div class="landing-hero-copy">'+(logo?'<img class="landing-hero-logo" src="'+attrUrl(logo)+'" alt="'+escapeHtml(title)+'">':'<h1>'+escapeHtml(title)+'</h1>')+(genres.length?'<div class="landing-genre-list">'+genres.map(function(genre){return '<span>'+escapeHtml(genre)+'</span>';}).join('')+'</div>':'')+'<div class="landing-hero-meta">'+(rating?'<span class="landing-imdb"><img src="assets/images/imdb_logo.png" alt="IMDb">'+escapeHtml(ratingText(rating))+'</span>':'')+(year?'<span>'+escapeHtml(year)+'</span>':'')+'</div><p>'+escapeHtml(item.overview || 'Sinopse não disponível.')+'</p><div class="landing-hero-actions"><button class="landing-play" data-landing-hero="'+escapeHtml(item.id)+'">▶ '+definition.action+'</button><button class="landing-favorite '+(isFavorite(item.id,kind==='series')?'is-favorite':'')+'" data-landing-favorite="'+escapeHtml(item.id)+'" aria-label="Favoritar">'+(isFavorite(item.id,kind==='series')?'♥':'♡')+'</button></div>'+(total>1?'<div class="landing-pagination">'+(index+1)+' / '+total+'</div>':'')+'</div></section>';
  }
  function renderMediaLanding(kind) {
    clearInterval(heroTimer); activeStreamingHub=null;
    var definition=mediaLandingDefinition(kind), pageToken=Date.now(), heroPosition=0, rotateTimer=null, current=null;
    app.innerHTML='<section class="media-landing '+kind+'">'+sidebarMarkup(kind)+'<main class="media-landing-content"><div class="media-landing-loading"><div class="loader"></div><span>Carregando '+definition.title.toLowerCase()+'…</span></div></main></section>';
    bindSidebar();
    function renderLoaded() {
      if(!current || !document.querySelector('.media-landing')) return;
      var heroes=current.heroes.length?current.heroes:(current.rows[0] && current.rows[0].items || []), hero=heroes[heroPosition % Math.max(1,heroes.length)];
      var content=document.querySelector('.media-landing-content'); if(!content || content.getAttribute('data-page-token') && content.getAttribute('data-page-token')!==String(pageToken)) return;
      content.setAttribute('data-page-token',String(pageToken));
      content.innerHTML=(hero?landingHeroMarkup(hero,kind,heroPosition,heroes.length):'')+'<div class="media-landing-rows">'+current.rows.map(function(row){ return '<section class="catalog-row"><h2>'+escapeHtml(row.title)+'</h2><div class="row catalog-items">'+row.items.map(mediaCard).join('')+'</div></section>'; }).join('')+'</div>';
      bindLanding();
    }
    function openItem(id) {
      var found=null; current.heroes.concat.apply(current.heroes,current.rows.map(function(row){return row.items;})).some(function(item){if(String(item.id)===String(id)){found=item;return true;}return false;});
      if(found){detailsOrigin=kind;renderMediaDetails(Number(found.id),kind==='series',1);}
    }
    function bindLanding() {
      document.querySelectorAll('[data-landing-hero]').forEach(function(button){button.addEventListener('click',function(){openItem(button.getAttribute('data-landing-hero'));});});
      document.querySelectorAll('[data-landing-favorite]').forEach(function(button){button.addEventListener('click',function(){var id=button.getAttribute('data-landing-favorite'),item=current.heroes.find(function(entry){return String(entry.id)===String(id);});if(item){saveFavorite(item,kind==='series');renderLoaded();}});});
      document.querySelectorAll('.media-landing .media-card').forEach(function(card){card.addEventListener('click',function(){openItem(card.getAttribute('data-media-id'));});});
      enrichRatings(current.rows);
      var firstCard=document.querySelector('.media-landing .media-card'); if(firstCard) firstCard.focus();
    }
    loadMediaLanding(kind).then(function(data){
      if(!document.querySelector('.media-landing') || !document.querySelector('.media-landing.'+kind)) return;
      current=data; renderLoaded();
      if(data.heroes.length>1) rotateTimer=setInterval(function(){var focused=document.activeElement;if(!document.querySelector('.media-landing.'+kind)){clearInterval(rotateTimer);return;}if(focused&&focused.closest&&focused.closest('.media-landing-rows'))return;heroPosition=(heroPosition+1)%data.heroes.length;renderLoaded();},5000);
    }).catch(function(){var content=document.querySelector('.media-landing-content');if(content)content.innerHTML='<div class="media-landing-error">Não foi possível carregar o catálogo agora.</div>';});
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
  function episodeProgress(progress,season,episode) { return progress && progress.episodeProgress && progress.episodeProgress['T'+season+'E'+episode] || null; }
  function saveProgress(data,position,duration,completed) { if(!data.mediaId || !duration) return; var all=watchProgress(), key=progressKey(data.mediaId,data.isTv), index=all.findIndex(function(entry){return progressKey(entry.mediaId,entry.isTvShow)===key;}), previous=index>=0?all[index]:{}, episodeKey='T'+(data.season || 1)+'E'+(data.episode || 1), episodeMap=previous.episodeProgress || {}, positionMs=completed?0:Math.max(0,Math.floor(position*1000)), durationMs=Math.max(0,Math.floor(duration*1000)); if(data.isTv&&previous.seasonNumber&&previous.episodeNumber&&previous.durationMs&&!episodeMap['T'+previous.seasonNumber+'E'+previous.episodeNumber])episodeMap['T'+previous.seasonNumber+'E'+previous.episodeNumber]={positionMs:Number(previous.positionMs)||0,durationMs:Number(previous.durationMs)||0,completed:(previous.completedEpisodeKeys||[]).indexOf('T'+previous.seasonNumber+'E'+previous.episodeNumber)>=0,lastWatchedAt:previous.lastWatchedAt||Date.now()}; if(data.isTv) episodeMap[episodeKey]={positionMs:positionMs,durationMs:durationMs,completed:!!completed,lastWatchedAt:Date.now()}; var item={mediaId:Number(data.mediaId),isTvShow:!!data.isTv,seasonNumber:data.season || null,episodeNumber:data.episode || null,positionMs:positionMs,durationMs:durationMs,completedEpisodeKeys:previous.completedEpisodeKeys || [],episodeProgress:episodeMap,lastWatchedAt:Date.now(),title:data.title || '',poster_url:data.poster || '',backdrop_url:data.backdrop || '',imdb_id:data.imdbId || ''}; if(data.isTv && completed) item.completedEpisodeKeys=(item.completedEpisodeKeys.concat([episodeKey])).filter(function(value,index,list){return list.indexOf(value)===index;}); if(index>=0)all[index]=item;else all.push(item); all.sort(function(a,b){return b.lastWatchedAt-a.lastWatchedAt;});writeStored('watch_progress',all.slice(0,30)); }
  function isResumable(progress) { return progress && progress.positionMs>0 && progress.durationMs>0 && progress.positionMs<progress.durationMs*.92; }
  function mediaCard(item) {
    var image=item.poster_thumb_url || item.poster_url || item.poster_path || '', title=item.title || item.name || 'Título não disponível', key=ratingKey(item), initial=item.imdb_rating || (String(item.rating_source || '').toLowerCase()==='imdb' ? item.vote_average : null), cached=ratingCache[key], imdb=initial || (cached !== undefined ? cached : null);
    return '<button class="media-card" data-media-id="'+escapeHtml(item.id)+'" data-media-type="'+escapeHtml(item.media_type || 'movie')+'"><span class="media-poster" style="background-image:url(\''+cleanUrl(image)+'\')"></span><span class="media-title">'+escapeHtml(title)+'</span><span class="media-bottom"><span class="imdb-mark"><img src="assets/images/imdb_logo.png" alt="IMDb"><b data-imdb="'+escapeHtml(key)+'">'+(imdb ? ratingText(imdb) : '—')+'</b></span><span class="media-kind">'+mediaType(item)+'</span></span></button>';
  }
  function renderCatalog(collections) {
    var target=document.getElementById('catalog'); if(!target) return;
    if(!collections.length) { target.innerHTML='<p class="catalog-message">Nenhum título disponível neste catálogo agora.</p>'; return; }
    target.innerHTML=collections.map(function(collection){ return '<section class="catalog-row"><h2>'+escapeHtml(collection.title)+'</h2><div class="row catalog-items">'+collection.items.map(mediaCard).join('')+'</div></section>'; }).join('');
    target.querySelectorAll('.media-card').forEach(function(card){ card.addEventListener('click',function(){ detailsOrigin='streaming'; renderMediaDetails(Number(card.getAttribute('data-media-id')), String(card.getAttribute('data-media-type')).toLowerCase()==='tv'); }); });
    enrichRatings(collections);
    var firstCatalogItem=target.querySelector('.media-card'); if(firstCatalogItem) firstCatalogItem.focus();
  }
  function enrichRatings(collections) {
    var unique={};
    collections.forEach(function(collection){ collection.items.forEach(function(item){ unique[ratingKey(item)]=item; }); });
    Object.keys(unique).forEach(function(key){ var item=unique[key], cached=ratingCache[key]; if(cached !== undefined) { updateRating(key,cached); return; } if(ratingPending[key]) return; ratingPending[key]=true; request('get_imdb_rating.php?id='+encodeURIComponent(item.id)+'&type='+encodeURIComponent(item.media_type || (item.name && !item.title ? 'tv' : 'movie')),{method:'GET'},12000).then(function(result){ var value=result && result.imdb_rating; ratingCache[key]=value || null; updateRating(key,value); }).catch(function(){ ratingCache[key]=null; updateRating(key,null); }).finally(function(){ delete ratingPending[key]; }); });
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
  function ageRatingInfo(rawRating) {
    var rating=String(rawRating || '').trim().toUpperCase().replace(/ ANOS/g,'').replace(/\+/g,'');
    if(!rating) return null;
    var american={
      'TV-MA':'Conteúdo destinado ao público adulto; pode ser inadequado para menores de 17 anos',
      'TV-14':'Pode ser inadequado para menores de 14 anos; orientação dos responsáveis fortemente recomendada',
      'TV-PG':'Orientação dos responsáveis recomendada; pode conter material inadequado para crianças',
      'PG':'Orientação dos responsáveis recomendada; pode conter material inadequado para crianças',
      'TV-G':'Conteúdo adequado ao público em geral',
      'G':'Conteúdo adequado ao público em geral',
      'TV-Y':'Conteúdo destinado a crianças de todas as idades',
      'TV-Y7':'Destinado a crianças a partir de 7 anos',
      'TV-Y7-FV':'Destinado a crianças a partir de 7 anos; contém violência fantasiosa',
      'PG-13':'Pode ser inadequado para menores de 13 anos; atenção dos responsáveis recomendada',
      'R':'Menores de 17 anos devem estar acompanhados por um responsável, segundo o sistema americano',
      'NC-17':'Destinado a maiores de 17 anos, segundo o sistema americano'
    };
    if(american[rating]) return {label:rating,description:american[rating],heading:'Classificação Indicativa Americana',kind:'foreign'};
    var brazilian={
      'L':{label:'L',description:'Recomendado para todas as idades',kind:'livre'},
      'LIVRE':{label:'L',description:'Recomendado para todas as idades',kind:'livre'},
      '0':{label:'L',description:'Recomendado para todas as idades',kind:'livre'},
      '10':{label:'10',description:'Não Recomendado para menores de 10 anos',kind:'10'},
      '12':{label:'12',description:'Não Recomendado para menores de 12 anos',kind:'12'},
      '14':{label:'14',description:'Não Recomendado para menores de 14 anos',kind:'14'},
      '16':{label:'16',description:'Não Recomendado para menores de 16 anos',kind:'16'},
      '18':{label:'18',description:'Não Recomendado para menores de 18 anos',kind:'18'}
    };
    return brazilian[rating] || {label:rating,description:'Classificação indicativa: '+rating,kind:'other'};
  }
  function ageBadge(info) {
    var label=escapeHtml(info.label).replace('TV-','TV<br>');
    return '<span class="age-badge age-'+escapeHtml(info.kind)+'">'+label+'</span>';
  }
  function ageInfo(certification) {
    var info=ageRatingInfo(certification); if(!info) return '';
    return '<div class="detail-age">'+ageBadge(info)+'<div><b>'+escapeHtml(info.heading || 'Classificação indicativa')+'</b><small>'+escapeHtml(info.description)+'</small></div></div>';
  }
  function renderMediaDetails(mediaId,isTv,season) {
    clearInterval(heroTimer);
    season=season || 1;
    var key=detailKey(mediaId,isTv,season), cached=detailsCache[key];
    app.innerHTML='<section class="media-details"><div class="details-loading"><div class="loader"></div><span>Carregando detalhes…</span></div></section>';
    function show(payload) {
      var item=payload.item || {}, episodes=payload.episodes || [], backdrop=item.backdrop_large_url || item.backdrop_url || '', logo=item.logo_url, title=detailTitle(item), genres=(item.genres || []).map(function(genre){ return genre.name; }).join(' • '), progress=getProgress(mediaId,isTv), isFav=isFavorite(mediaId,isTv);
      var seasonButtons=(item.seasons || []).filter(function(entry){ return Number(entry.season_number)>0; }).map(function(entry){ return '<button class="season-tab '+(Number(entry.season_number)===Number(season)?'selected':'')+'" data-season="'+escapeHtml(entry.season_number)+'">T'+escapeHtml(entry.season_number)+'</button>'; }).join('');
      var episodeCards=episodes.map(function(episode){ var episodeSeason=Number(episode.season_number || season), episodeNumber=Number(episode.episode_number), watched=episodeProgress(progress,episodeSeason,episodeNumber), resumable=isResumable(watched), remaining=resumable?Math.max(1,Math.ceil((watched.durationMs-watched.positionMs)/60000)):0, ratio=resumable?Math.max(0,Math.min(100,watched.positionMs/watched.durationMs*100)):0; return '<button class="episode-card" data-season="'+escapeHtml(episodeSeason)+'" data-episode="'+escapeHtml(episodeNumber)+'">'+(episode.still_url?'<img src="'+attrUrl(episode.still_url)+'" alt="">':'')+'<div><b>T'+escapeHtml(episodeSeason)+'E'+escapeHtml(episodeNumber)+' • '+escapeHtml(episode.name || 'Episódio')+'</b>'+(resumable?'<i class="episode-progress"><u style="width:'+ratio.toFixed(2)+'%"></u></i><small>Faltam '+remaining+' min</small>':'')+'</div></button>'; }).join('');
      var providers=(item.streaming_providers || []).map(function(provider){ return '<div class="detail-provider">'+(provider.logo_url?'<img src="'+attrUrl(provider.logo_url)+'" alt="">':'')+'<span>'+escapeHtml(provider.name)+'</span></div>'; }).join('');
      app.innerHTML='<section class="media-details"><div class="details-backdrop" style="background-image:url(\''+cleanUrl(backdrop)+'\')"></div><div class="details-gradient"></div><button class="details-back" id="details-back">← <span>VOLTAR</span></button><main class="details-content"><section class="details-hero">'+
        (logo?'<img class="details-logo" src="'+attrUrl(logo)+'" alt="'+escapeHtml(title)+'">':'<h1>'+escapeHtml(title)+'</h1>')+
        '<div class="details-meta">'+escapeHtml(detailMeta(item,isTv))+'</div><div class="details-ratings" id="details-ratings">'+detailsRatings(item,payload.ratings)+'</div>'+(genres?'<div class="details-genres">'+escapeHtml(genres)+'</div>':'')+'</section>'+
        '<section class="details-body"><p class="details-overview">'+escapeHtml(item.overview || 'Sinopse indisponível.')+'</p>'+ageInfo(item.certification)+'<div class="details-actions"><div><button class="primary-action" id="detail-play">▶ '+(isResumable(progress)?'CONTINUAR T'+escapeHtml(progress.seasonNumber || 1)+'E'+escapeHtml(progress.episodeNumber || 1):'ASSISTIR')+'</button>'+(isResumable(progress)?'<small class="details-remaining">Faltam '+Math.max(1,Math.ceil((progress.durationMs-progress.positionMs)/60000))+' min</small>':'')+'</div><button class="secondary-action" id="detail-favorite">'+(isFav?'♥ FAVORITADO':'♡ FAVORITAR')+'</button></div>'+
        (isTv && seasonButtons?'<h2>Temporadas</h2><div class="season-tabs">'+seasonButtons+'</div><h2>Episódios</h2><div class="episode-row">'+episodeCards+'</div>':'')+
        (providers?'<h2>Disponível em</h2><div class="detail-providers">'+providers+'</div>':'')+
        ((item.similar_titles || []).length?'<h2>Títulos semelhantes</h2><div class="row detail-similar">'+item.similar_titles.map(mediaCard).join('')+'</div>':'')+
        '<h2>Informações</h2><div class="details-info">'+escapeHtml([genres,item.original_title && item.original_title!==title?'Título original: '+item.original_title:'',item.number_of_seasons?(item.number_of_seasons+' temporadas • '+(item.number_of_episodes || 0)+' episódios'):'',item.imdb_id?'IMDb: '+item.imdb_id:'','Metadados: TMDB • Disponibilidade: JustWatch (Brasil)'].filter(Boolean).join('\n'))+'</div></section></main></section>';
      var firstEpisode=episodes[0] || null, resume=isResumable(progress);
      var initialVodData={mediaId:mediaId,imdbId:item.imdb_id || '',title:title,isTv:isTv,season:resume ? Number(progress.seasonNumber || season) : (firstEpisode ? Number(firstEpisode.season_number || season) : Number(season)),episode:resume ? Number(progress.episodeNumber || 1) : (firstEpisode ? Number(firstEpisode.episode_number) : 1),episodes:episodes,backdrop:backdrop,poster:item.poster_thumb_url || item.poster_url || '',certification:item.certification || ''};
      // Consulta fontes enquanto a pessoa lê os detalhes. Não inicia player
      // nem baixa vídeo; apenas deixa a lista pronta para o botão Assistir.
      prefetchVodSources(initialVodData);
      document.getElementById('details-back').addEventListener('click',function(){ if(detailsOrigin==='search') renderSearch(); else if(detailsOrigin==='movies' || detailsOrigin==='series') renderMediaLanding(detailsOrigin); else if(activeStreamingHub) renderStreaming(activeStreamingHub,false); else renderHome(); });
      document.getElementById('detail-play').addEventListener('click',function(){ openVod(initialVodData); });
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
  function renderSearch(focusSelector) {
    clearInterval(heroTimer); activeStreamingHub=null;
    var resultHtml=!searchState.submitted ? '<p class="search-empty">Digite um título, ajuste os filtros e pressione BUSCAR.</p>' : (searchState.loading ? '<div class="search-loading"><div class="loader"></div><span>Buscando no catálogo completo…</span></div>' : (searchState.results.length ? '<div class="search-results">'+searchState.results.map(mediaCard).join('')+'</div>' : '<p class="search-empty">Nenhum título encontrado.</p>'));
    app.innerHTML='<section class="search-page">'+sidebarMarkup('search')+'<div class="search-layout"><aside class="search-controls">'+keyboardMarkup()+searchFiltersMarkup()+'</aside><main class="search-result-area">'+resultHtml+'</main></div></section>';
    bindSidebar();
    document.querySelectorAll('[data-key]').forEach(function(button){button.addEventListener('click',function(){var key=button.getAttribute('data-key');searchState.query+=key;renderSearch('[data-key="'+key.replace(/"/g,'')+'"]');});});
    document.querySelectorAll('[data-key-action]').forEach(function(button){button.addEventListener('click',function(){var action=button.getAttribute('data-key-action');if(action==='clear')searchState.query='';else if(action==='backspace')searchState.query=searchState.query.slice(0,-1);else submitSearch();renderSearch('[data-key-action="'+action+'"]');});});
    document.querySelectorAll('[data-filter]').forEach(function(button){button.addEventListener('click',function(){nextFilter(button.getAttribute('data-filter'));});});
    document.querySelectorAll('.search-results .media-card').forEach(function(card){card.addEventListener('click',function(){detailsOrigin='search';renderMediaDetails(Number(card.getAttribute('data-media-id')),String(card.getAttribute('data-media-type')).toLowerCase()==='tv');});});
    if(searchState.results.length) enrichRatings([{items:searchState.results}]);
    var focusTarget=document.querySelector(focusSelector || '[data-key="a"]'); if(focusTarget) focusTarget.focus();
  }
  function submitSearch() {
    var query=searchState.query.trim(); if(query.length<3 && searchState.platform==='Todas' && searchState.genre==='Todos' && searchState.rating==='all' && searchState.type==='all') { searchState.submitted=true; searchState.results=[]; return; }
    searchState.submitted=true;searchState.loading=true;searchState.results=[];
    var args='?rating='+encodeURIComponent(searchState.rating)+'&page=1'+(query.length>=3?'&query='+encodeURIComponent(query):'')+(searchState.platform!=='Todas'?'&provider='+encodeURIComponent(searchState.platform):'')+(searchState.genre!=='Todos'?'&genre='+encodeURIComponent(searchState.genre):'')+(searchState.type!=='all'?'&media_kind='+encodeURIComponent(searchState.type):'');
    request('search_tmdb.php'+args,{method:'GET'},18000).then(function(result){searchState.results=(result.results || []).slice(0,30);searchState.loading=false;renderSearch();}).catch(function(){searchState.results=[];searchState.loading=false;renderSearch();});
  }
  function sourceQuality(source) { var text=String(source.name || source.title || source.description || '').toUpperCase(); return /4K|2160/.test(text)?4:/FHD|1080/.test(text)?3:/HD|720/.test(text)?2:/SD|480/.test(text)?1:0; }
  function decodePlayableUrl(value) { var raw=String(value || '').trim(); if(/^https?:\/\//i.test(raw)) return raw; var encoded=raw.replace(/^.*base64,/,'').replace(/-/g,'+').replace(/_/g,'/'); try { var decoded=atob(encoded); return /^https?:\/\//i.test(decoded) ? decoded : ''; } catch(error) { return ''; } }
  function normalizeVodSources(responses) {
    var seen={}, sources=[];
    responses.forEach(function(response){ (response && response.streams || []).forEach(function(source){ var url=decodePlayableUrl(source.url); if(url && !seen[url]) { seen[url]=true; sources.push({name:source.name || source.title || 'Fonte',url:url,headers:source.headers || {},quality:sourceQuality(source)}); } }); });
    return sources.sort(function(a,b){return b.quality-a.quality;}).slice(0,10);
  }
  function frostVodSources(data) {
    var type=data.isTv ? 'series' : 'movie', id=data.isTv ? data.imdbId+':'+(data.season || 1)+':'+(data.episode || 1) : data.imdbId;
    var controller=new AbortController(), timer=setTimeout(function(){controller.abort();},30000);
    return fetch('https://froststream.cloutteam.com/stream/'+type+'/'+id+'.json',{signal:controller.signal}).then(function(response){ if(!response.ok) throw new Error('Fonte Frost indisponível'); return response.json(); }).finally(function(){clearTimeout(timer);});
  }
  function resolveVodSources(data) {
    var type=data.isTv ? 'series' : 'movie', args='?imdb_id='+encodeURIComponent(data.imdbId)+'&type='+type+'&season='+encodeURIComponent(data.season || 1)+'&episode='+encodeURIComponent(data.episode || 1);
    // Mesmo fluxo do Android: agregador principal e adicional em paralelo;
    // Frost só é usado se nenhum dos dois devolver uma fonte válida.
    return Promise.all([request('get_vod_sources.php'+args,{method:'GET'},9000).catch(function(){return null;}),request('get_nuvio_sources.php'+args,{method:'GET'},9000).catch(function(){return null;})]).then(function(responses){
      var sources=normalizeVodSources(responses);
      if(sources.length) return sources;
      return frostVodSources(data).then(function(response){ return normalizeVodSources([response]); });
    });
  }
  function vodSourceCacheKey(data) {
    return [data.imdbId || '',data.isTv?'series':'movie',data.season || 1,data.episode || 1].join(':');
  }
  function prefetchVodSources(data) {
    if(!data || !data.imdbId) return Promise.resolve([]);
    var key=vodSourceCacheKey(data), cached=vodSourcePrefetchCache[key];
    if(cached && cached.sources && Date.now()-cached.time<90000) return Promise.resolve(cached.sources);
    if(cached && cached.pending) return cached.pending;
    var pending=resolveVodSources(data).then(function(sources){
      vodSourcePrefetchCache[key]={sources:sources,time:Date.now()};
      console.log('[MYTV_TIZEN] fontes pré-carregadas:',sources.length,key);
      return sources;
    }).catch(function(error){ delete vodSourcePrefetchCache[key]; throw error; });
    vodSourcePrefetchCache[key]={pending:pending,time:Date.now()};
    return pending;
  }
  function playbackVodSources(data) {
    var key=vodSourceCacheKey(data), cached=vodSourcePrefetchCache[key];
    if(cached && cached.sources && Date.now()-cached.time<90000) {
      delete vodSourcePrefetchCache[key];
      console.log('[MYTV_TIZEN] usando fontes pré-carregadas:',key);
      return Promise.resolve(cached.sources);
    }
    return prefetchVodSources(data);
  }
  function formatTime(seconds) { seconds=Math.max(0,Math.floor(seconds || 0)); var h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60), s=seconds%60; return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
  function vodAgeBanner(certification) { var info=ageRatingInfo(certification); if(!info) return ''; return '<div class="vod-age-banner" id="vod-age-banner">'+ageBadge(info)+'<div><b>'+escapeHtml(info.heading || 'Classificação indicativa')+'</b><small>'+escapeHtml(info.description)+'</small></div></div>'; }
  function openVod(data) {
    clearInterval(heroTimer); playerReturn={mediaId:data.mediaId,isTv:data.isTv,season:data.season};
    app.innerHTML='<section class="vod-player"><div class="vod-backdrop" style="background-image:url(\''+cleanUrl(data.backdrop)+'\')"></div><div class="vod-loading"><div class="loader"></div><b>Preparando reprodução...</b></div></section>';
    if(!data.imdbId) { renderVodError(data,'Não foi possível identificar este título para reprodução.'); return; }
    playbackVodSources(data).then(function(sources){ if(!sources.length) throw new Error('Nenhuma fonte de reprodução está disponível agora.'); renderVodPlayer(data,sources); }).catch(function(error){ renderVodError(data,error.message || 'Não foi possível preparar o vídeo.'); });
  }
  function renderVodError(data,message) { app.innerHTML='<section class="vod-player vod-error"><div class="vod-error-card"><div class="vod-error-icon">!</div><strong>Não foi possível carregar a mídia</strong><span>'+escapeHtml(message)+'</span><button id="vod-back-error">VOLTAR</button></div></section>'; document.getElementById('vod-back-error').addEventListener('click',returnFromVod); }
  function returnFromVod() { var target=playerReturn; if(target) renderMediaDetails(target.mediaId,target.isTv,target.season); else renderHome(); }
  function fetchVodSubtitles(data) {
    var id=data.isTv ? data.imdbId+':'+(data.season || 1)+':'+(data.episode || 1) : data.imdbId, type=data.isTv?'series':'movie';
    return fetch('https://opensubtitles-v3.strem.io/subtitles/'+type+'/'+encodeURIComponent(id)+'.json').then(function(response){return response.ok?response.json():{subtitles:[]};}).then(function(result){return (result.subtitles || []).filter(function(item){var lang=String(item.lang || '').toLowerCase();return item.url && ['pt-br','pob','en','eng','es','spa'].indexOf(lang)>=0;});}).catch(function(){return [];});
  }
  function renderVodPlayer(data,sources) {
    var sourceIndex=0, overlayVisible=true, menuVisible=false, subtitles=[], subtitleIndex=-1, aspectIndex=0, ratingShown=false, nextShown=false, nextReturnTimer=null, source=sources[0], lastProgressSaved=0;
    function sourceLabel(item) { var quality=Number(item.quality)||0; return quality>=3?'FHD 1080p':quality>=2?'HD 720p':quality===1?'SD 480p':'Automática'; }
    app.innerHTML='<section class="vod-player"><div class="vod-backdrop" id="vod-backdrop" style="background-image:url(\''+cleanUrl(data.backdrop)+'\')"></div><video id="vod-video" class="vod-video" playsinline preload="auto"></video><div class="vod-buffer" id="vod-buffer"><div class="loader"></div><b>Carregando vídeo...</b></div><div class="vod-overlay" id="vod-overlay"><div class="vod-top"><div><h1>'+escapeHtml(data.title)+'</h1>'+(data.isTv?'<p>Temporada '+escapeHtml(data.season)+' • Episódio '+escapeHtml(data.episode)+'</p>':'')+'</div><span id="vod-source-state">Carregando</span></div><div class="vod-timeline"><div class="vod-time"><b id="vod-current">00:00</b><button id="vod-play-pause">▶</button><span id="vod-total">00:00</span></div><input id="vod-seek" type="range" min="0" max="1000" value="0" aria-label="Linha do tempo"><small>Use ←/→ para avançar ou voltar 10 segundos.</small></div></div>'+vodAgeBanner(data.certification)+'<div class="vod-menu-modal" id="vod-menu-modal"></div><button class="vod-next" id="vod-next">PRÓXIMO EPISÓDIO ▶</button></section>';
    var video=document.getElementById('vod-video'), buffer=document.getElementById('vod-buffer'), overlay=document.getElementById('vod-overlay'), modal=document.getElementById('vod-menu-modal'), next=document.getElementById('vod-next'), age=document.getElementById('vod-age-banner'), hideTimer;
    function setOverlay(show) { overlayVisible=show; overlay.classList.toggle('is-hidden',!show); if(show && !menuVisible && !nextShown){clearTimeout(hideTimer);hideTimer=setTimeout(function(){setOverlay(false);},4000);} }
    function setBuffer(show) { buffer.classList.toggle('is-hidden',!show); document.getElementById('vod-backdrop').classList.toggle('is-hidden',!show); }
    function loadSource(index,position) { sourceIndex=index; source=sources[index]; setBuffer(true); document.getElementById('vod-source-state').textContent='Carregando'; video.src=source.url; video.load(); video.onloadedmetadata=function(){var stored=getProgress(data.mediaId,data.isTv), resume=position || (stored && Number(stored.seasonNumber||1)===Number(data.season||1) && Number(stored.episodeNumber||1)===Number(data.episode||1) && isResumable(stored) ? stored.positionMs/1000 : 0); if(resume) video.currentTime=Math.min(resume,video.duration||resume);}; video.play().catch(function(){}); }
    function closeMenu(){menuVisible=false;modal.classList.remove('is-open');modal.innerHTML='';setOverlay(true);}
    function nextEpisode(){ var candidates=(data.episodes || []).filter(function(item){return Number(item.season_number || item.seasonNumber || data.season)===Number(data.season) && Number(item.episode_number || item.episodeNumber)>Number(data.episode);}).sort(function(a,b){return Number(a.episode_number||a.episodeNumber)-Number(b.episode_number||b.episodeNumber);}); return candidates[0] || null; }
    function showNextEpisode(upcoming,returnOnTimeout){if(!upcoming)return;var season=Number(upcoming.season_number||upcoming.seasonNumber||data.season),episode=Number(upcoming.episode_number||upcoming.episodeNumber);next.innerHTML='<strong>PRÓXIMO EPISÓDIO</strong><span>T'+season+'E'+episode+' - '+escapeHtml(upcoming.name||upcoming.title||'Episódio')+'</span><small>'+escapeHtml(data.title)+'</small>';nextShown=true;next.classList.add('is-visible');next.focus();if(returnOnTimeout){clearTimeout(nextReturnTimer);nextReturnTimer=setTimeout(function(){if(document.querySelector('.vod-player')&&nextShown)returnFromVod();},15000);}}
    function showBottomPanel(){var stored=getProgress(data.mediaId,data.isTv),completed=(stored&&stored.completedEpisodeKeys)||[],episodeCards=(data.episodes||[]).map(function(item){var season=Number(item.season_number||item.seasonNumber||data.season),episode=Number(item.episode_number||item.episodeNumber),current=season===Number(data.season)&&episode===Number(data.episode),done=!current&&completed.indexOf('T'+season+'E'+episode)>=0,image=item.thumbnailUrl||item.thumbnail_url||item.still_url||item.still_path||item.backdrop_url||data.backdrop,label=current?'EM REPRODUÇÃO':done?'ASSISTIDO':'';return '<button class="vod-panel-episode" data-panel-season="'+season+'" data-panel-episode="'+episode+'" style="background-image:url(\''+cleanUrl(image)+'\')">'+(label?'<em class="'+(done?'done':'current')+'">'+label+'</em>':'')+'<div class="vod-panel-episode-info"><span class="vod-episode-number">EP '+episode+'</span><b>'+escapeHtml(item.name||item.title||'Episódio')+'</b>'+(current?'<i><u id="vod-panel-progress" style="width:0%"></u></i>':'')+'</div></button>';}).join('');modal.innerHTML='<div class="vod-menu-card vod-bottom-panel">'+(episodeCards?'<h2>Episódios</h2><div class="vod-panel-episodes">'+episodeCards+'</div>':'')+'<h2>Configurações do Player</h2><div class="vod-inline-settings"><button data-panel-setting="audio"><b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h4l5-4v12l-5-4H4zM17 9a4 4 0 010 6M19 6a8 8 0 010 12"/></svg>Áudio</b><small id="vod-audio-label">Português</small></button><button data-panel-setting="subtitle"><b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M13 10h4M7 14h4M13 14h4"/></svg>Legenda</b><small id="vod-subtitle-label">Desativada</small></button><button data-panel-setting="quality"><b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 9h2v6H9zM13 9h2v6h-2z"/></svg>Qualidade</b><small id="vod-quality-label">'+escapeHtml(sourceLabel(source))+'</small></button><button data-panel-setting="aspect"><b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>Tela</b><small id="vod-aspect-label">16:9</small></button></div></div>';modal.classList.add('is-open');menuVisible=true;var first=modal.querySelector('button');if(first)first.focus();modal.querySelectorAll('[data-panel-season]').forEach(function(button){button.addEventListener('click',function(){var season=Number(button.getAttribute('data-panel-season')),episode=Number(button.getAttribute('data-panel-episode'));if(season===Number(data.season)&&episode===Number(data.episode)){closeMenu();return;}saveProgress(data,video.currentTime||0,video.duration||0,false);closeMenu();openVod({mediaId:data.mediaId,imdbId:data.imdbId,title:data.title,isTv:true,season:season,episode:episode,episodes:data.episodes,backdrop:data.backdrop,poster:data.poster,certification:data.certification});});});modal.querySelectorAll('[data-panel-setting]').forEach(function(button){button.addEventListener('click',function(){var setting=button.getAttribute('data-panel-setting');if(setting==='audio'){var audioModes=['Português','Inglês','Espanhol'],nextAudio=(audioModes.indexOf(document.getElementById('vod-audio-label').textContent)+1)%audioModes.length;document.getElementById('vod-audio-label').textContent=audioModes[nextAudio];var tracks=video.audioTracks||[];for(var index=0;index<tracks.length;index+=1)tracks[index].enabled=String(tracks[index].language||'').toLowerCase().indexOf(['pt','en','es'][nextAudio])===0;}else if(setting==='subtitle'){subtitleIndex=subtitleIndex<subtitles.length-1?subtitleIndex+1:-1;document.getElementById('vod-subtitle-label').textContent=subtitleIndex>=0?(subtitles[subtitleIndex].langName||subtitles[subtitleIndex].lang||'Legenda'):'Desativada';Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function(track,index){track.track.mode=index===subtitleIndex?'showing':'disabled';});}else if(setting==='quality'){var nextQuality=(sourceIndex+1)%sources.length;loadSource(nextQuality,video.currentTime);document.getElementById('vod-quality-label').textContent=sourceLabel(sources[nextQuality]);}else {aspectIndex=(aspectIndex+1)%3;video.className='vod-video aspect-'+aspectIndex;document.getElementById('vod-aspect-label').textContent=['16:9','4:3','Preencher'][aspectIndex];}});});}
    function showMenu(kind){ var options=[]; if(kind==='episodes') options=(data.episodes||[]).map(function(item){return {label:'T'+(item.season_number||item.seasonNumber)+' E'+(item.episode_number||item.episodeNumber)+' • '+(item.name||'Episódio'),image:item.still_url||item.still_path||item.backdrop_url||data.backdrop,value:'episode:'+JSON.stringify({season:Number(item.season_number||item.seasonNumber),episode:Number(item.episode_number||item.episodeNumber)})};}); if(kind==='subtitle') options=[{label:'Sem legenda',value:'subtitle:-1'}].concat(subtitles.map(function(item,index){return {label:item.langName||item.lang||'Legenda',value:'subtitle:'+index};})); if(kind==='audio') options=[{label:'Português',value:'audio:pt'},{label:'Inglês',value:'audio:en'},{label:'Espanhol',value:'audio:es'}]; if(kind==='quality') options=sources.map(function(item,index){return {label:sourceLabel(item),value:'quality:'+index};}); if(kind==='aspect') options=[{label:'16:9',value:'aspect:0'},{label:'4:3',value:'aspect:1'},{label:'Preencher',value:'aspect:2'}]; var rows=options.map(function(option){return kind==='episodes'?'<button class="vod-episode-card" data-vod-option="'+escapeHtml(option.value)+'" style="background-image:linear-gradient(0deg,rgba(3,8,18,.84),rgba(3,8,18,.06)),url(\''+cleanUrl(option.image)+'\')"><b>'+escapeHtml(option.label.split(' • ')[0])+'</b><span>'+escapeHtml(option.label.split(' • ').slice(1).join(' • '))+'</span></button>':'<button data-vod-option="'+escapeHtml(option.value)+'">'+escapeHtml(option.label)+'</button>';}).join(''); modal.innerHTML='<div class="vod-menu-card '+(kind==='episodes'?'vod-episodes-menu':'')+'"><h2>'+({episodes:'Episódios',subtitle:'Legendas',audio:'Faixas de áudio',quality:'Qualidade',aspect:'Proporção'}[kind])+'</h2><div class="vod-menu-options">'+rows+'</div></div>'; modal.classList.add('is-open'); menuVisible=true; bottom.classList.add('is-open'); var first=modal.querySelector('button'); if(first) first.focus(); modal.querySelectorAll('[data-vod-option]').forEach(function(button){button.addEventListener('click',function(){var value=button.getAttribute('data-vod-option'), parts=value.split(':'); if(parts[0]==='quality'){loadSource(Number(parts[1]),video.currentTime);} else if(parts[0]==='aspect'){aspectIndex=Number(parts[1]);video.className='vod-video aspect-'+aspectIndex;} else if(parts[0]==='subtitle'){subtitleIndex=Number(parts[1]); Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function(track,index){track.track.mode=index===subtitleIndex?'showing':'disabled';});} else if(parts[0]==='audio'){var tracks=video.audioTracks || []; for(var trackIndex=0;trackIndex<tracks.length;trackIndex+=1){var track=tracks[trackIndex];track.enabled=String(track.language || '').toLowerCase().indexOf(parts[1])===0;}} else if(parts[0]==='episode'){var episode=JSON.parse(value.slice(8)); saveProgress(data,video.duration || 0,video.duration || 0,true); closeMenu(); openVod({mediaId:data.mediaId,imdbId:data.imdbId,title:data.title,isTv:true,season:episode.season,episode:episode.episode,episodes:data.episodes,backdrop:data.backdrop,poster:data.poster,certification:data.certification});return;} closeMenu();});}); }
    loadSource(0,0);
    video.addEventListener('waiting',function(){setBuffer(true);}); video.addEventListener('playing',function(){setBuffer(false);document.getElementById('vod-source-state').textContent='Conexão ativa'; if(!ratingShown && age){ratingShown=true;setTimeout(function(){age.classList.add('is-visible');setTimeout(function(){age.classList.remove('is-visible');},8000);},3000);} });
    video.addEventListener('error',function(){if(sourceIndex<sources.length-1) loadSource(sourceIndex+1,video.currentTime||0); else renderVodError(data,'Todas as fontes de reprodução falharam.');});
    video.addEventListener('timeupdate',function(){var duration=video.duration||0;document.getElementById('vod-current').textContent=formatTime(video.currentTime);document.getElementById('vod-total').textContent=formatTime(duration);document.getElementById('vod-seek').value=duration?Math.round(video.currentTime/duration*1000):0;var panelProgress=document.getElementById('vod-panel-progress');if(panelProgress)panelProgress.style.width=(duration?Math.round(video.currentTime/duration*100):0)+'%';if(duration && Date.now()-lastProgressSaved>5000){lastProgressSaved=Date.now();saveProgress(data,video.currentTime,duration,video.currentTime>=duration*.92);}var upcoming=nextEpisode();if(data.isTv && upcoming && duration && duration-video.currentTime<=75 && !nextShown)showNextEpisode(upcoming,false);});
    video.addEventListener('ended',function(){saveProgress(data,video.duration || 0,video.duration || 0,true);var upcoming=nextEpisode();if(upcoming)showNextEpisode(upcoming,true);else returnFromVod();});
    document.getElementById('vod-play-pause').addEventListener('click',function(){if(video.paused)video.play();else video.pause();}); document.getElementById('vod-seek').addEventListener('input',function(event){if(video.duration)video.currentTime=Number(event.target.value)/1000*video.duration;});
    next.addEventListener('click',function(){var upcoming=nextEpisode();if(upcoming){clearTimeout(nextReturnTimer);saveProgress(data,video.duration || 0,video.duration || 0,true);openVod({mediaId:data.mediaId,imdbId:data.imdbId,title:data.title,isTv:true,season:Number(upcoming.season_number||upcoming.seasonNumber),episode:Number(upcoming.episode_number||upcoming.episodeNumber),episodes:data.episodes,backdrop:data.backdrop,poster:data.poster,certification:data.certification});}});
    fetchVodSubtitles(data).then(function(items){subtitles=items;items.forEach(function(item){var track=document.createElement('track');track.kind='subtitles';track.label=item.langName||item.lang;track.srclang=item.lang||'pt';track.src=item.url;track.default=false;track.addEventListener('load',function(){track.track.mode='hidden';});video.appendChild(track);track.track.mode='hidden';});});
    document.addEventListener('keydown',function playerKeys(event){if(!document.querySelector('.vod-player')){clearTimeout(nextReturnTimer);document.removeEventListener('keydown',playerKeys);return;}if(event.key==='Escape'||event.keyCode===10009){if(menuVisible)closeMenu();else {clearTimeout(nextReturnTimer);saveProgress(data,video.currentTime || 0,video.duration || 0,false);returnFromVod();}event.preventDefault();return;}var direction={37:'left',38:'up',39:'right',40:'down'}[event.keyCode];if(menuVisible&&direction){var onEpisode=document.activeElement&&document.activeElement.classList.contains('vod-panel-episode'),hasEpisodes=!!modal.querySelector('.vod-panel-episodes');if(direction==='up'&&(onEpisode||!hasEpisodes)){closeMenu();event.preventDefault();return;}if(onEpisode&&(direction==='left'||direction==='right')&&focusRowSibling('.vod-panel-episode',direction)){event.preventDefault();return;}focusRemoteDirection(direction);event.preventDefault();return;}if(nextShown)return;if(event.key==='ArrowLeft'){video.currentTime=Math.max(0,video.currentTime-10);setOverlay(true);}else if(event.key==='ArrowRight'){video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);setOverlay(true);}else if(event.key==='ArrowDown'){showBottomPanel();setOverlay(true);event.preventDefault();}else if(event.key==='ArrowUp'){closeMenu();event.preventDefault();}else if((event.key==='Enter'||event.keyCode===13) && !menuVisible){if(video.paused)video.play();else video.pause();setOverlay(true);}});
    setOverlay(true);
  }
  /* Navegação espacial para o controle Samsung: setas escolhem o alvo visível
     mais próximo na direção solicitada e OK aciona o botão focalizado. */
  function remoteTargets(){return Array.prototype.slice.call(document.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function(node){var box=node.getBoundingClientRect(),style=window.getComputedStyle(node);return box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none';});}
  function focusRowSibling(selector,direction){var items=Array.prototype.slice.call(document.querySelectorAll(selector)),index=items.indexOf(document.activeElement),next=index+(direction==='right'?1:-1);if(index<0||next<0||next>=items.length)return false;items[next].focus();return true;}
  function focusRemoteDirection(direction){var targets=remoteTargets(),current=document.activeElement,from=current&&current.getBoundingClientRect?current.getBoundingClientRect():null;if(!targets.length)return false;if(!from||!targets.some(function(node){return node===current;})){targets[0].focus();return true;}var x=from.left+from.width/2,y=from.top+from.height/2,best=null,bestScore=Infinity;targets.forEach(function(node){if(node===current)return;var box=node.getBoundingClientRect(),nx=box.left+box.width/2,ny=box.top+box.height/2,dx=nx-x,dy=ny-y;var valid=direction==='left'?dx<-4:direction==='right'?dx>4:direction==='up'?dy<-4:dy>4;if(!valid)return;var main=(direction==='left'||direction==='right')?Math.abs(dx):Math.abs(dy),cross=(direction==='left'||direction==='right')?Math.abs(dy):Math.abs(dx),score=main+cross*2.8;if(score<bestScore){bestScore=score;best=node;}});if(best){best.focus();return true;}return false;}
  document.addEventListener('keydown',function(event){
    if(event.defaultPrevented)return;
    if(document.querySelector('.media-details') && (event.keyCode===10009 || event.keyCode===27)) { if(detailsOrigin==='search') renderSearch(); else if(detailsOrigin==='movies' || detailsOrigin==='series') renderMediaLanding(detailsOrigin); else if(activeStreamingHub) renderStreaming(activeStreamingHub,false); else renderHome(); return; }
    if(document.querySelector('.streaming-page') && event.keyCode===10009) { renderHome(); return; }
    if(document.querySelector('.vod-player,.sports-watch,.live-player')) return;
    var remoteDirection={37:'left',38:'up',39:'right',40:'down'}[event.keyCode];
    if(remoteDirection && document.activeElement&&document.activeElement.classList.contains('episode-card')&&(remoteDirection==='left'||remoteDirection==='right')&&focusRowSibling('.episode-card',remoteDirection)){event.preventDefault();return;}
    if(remoteDirection && focusRemoteDirection(remoteDirection)){event.preventDefault();return;}
    if((event.keyCode===13||event.keyCode===23) && document.activeElement && document.activeElement.click && document.activeElement!==document.body){document.activeElement.click();event.preventDefault();return;}
    if(!home || document.querySelector('.streaming-page,.media-landing')) return;
    var heroes=home.heroes || []; if(!heroes.length) return;
    if(event.keyCode===37) { heroIndex=(heroIndex-1+heroes.length)%heroes.length; renderHome(); }
    if(event.keyCode===39) { heroIndex=(heroIndex+1)%heroes.length; renderHome(); }
  });
  document.addEventListener('visibilitychange',function(){ if(document.hidden) clearInterval(heroTimer); });
  bootstrap();
}());
