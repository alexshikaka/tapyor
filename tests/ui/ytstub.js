window.__ytlog = [];
window.YT = { Player: function(el, o){
  var self = this, t = 0, st = -1, vid = o.videoId, vol = 100, timer = null;
  window.__ytplayer = this;
  window.__ytlog.push('create ' + vid + ' origin=' + o.playerVars.origin);
  function set(s){ st = s; o.events.onStateChange({ data: s }); }
  function run(){ clearInterval(timer); set(1); timer = setInterval(function(){ t += 0.25; if (t >= 6) { clearInterval(timer); set(0); } }, 250); }
  this.getDuration = function(){ return 6; }; this.getCurrentTime = function(){ return t; };
  this.seekTo = function(x){ t = x; window.__ytlog.push('seek ' + x); };
  this.playVideo = function(){ window.__ytlog.push('play'); run(); };
  this.pauseVideo = function(){ window.__ytlog.push('pause'); clearInterval(timer); set(2); };
  this.stopVideo = function(){ window.__ytlog.push('stop'); clearInterval(timer); st = 5; };
  this.setVolume = function(v){ vol = v; window.__ytvol = v; window.__ytlog.push('volume ' + v); };
  this.loadVideoById = function(id){ vid = id; t = 0; window.__ytlog.push('load ' + id); if (id === 'bad') { setTimeout(function(){ o.events.onError({ data: 150 }); }, 50); return; } setTimeout(run, 50); };
  setTimeout(function(){ o.events.onReady(); if (vid === 'bad') o.events.onError({ data: 150 }); else run(); }, 50);
}};
// Настоящий iframe_api сам зовёт этот обработчик, когда YT готов. Подделка должна вести себя так же.
setTimeout(function(){ if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady(); }, 0);
