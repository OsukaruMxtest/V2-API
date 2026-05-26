// shared/app_config.js — Global Frontend Config v4.0
// Fuente única de verdad. Sin dependencias. Carga con <script>.

(function (g) {
  'use strict';

  // ── 1. Doble carga ────────────────────────────────────────────
  if (g.APP_CONFIG && g.APP_CONFIG.__init) return;

  // ── 2. Entorno ────────────────────────────────────────────────
  var hasLoc = typeof location !== 'undefined' && location !== null;
  var hasCon = typeof console  !== 'undefined' && console  !== null;
  var hasNav = typeof navigator !== 'undefined' && navigator !== null;

  var host = '', proto = '', orig = '';
  if (hasLoc) {
    try {
      host  = (location.hostname || '').toLowerCase();
      proto = (location.protocol || 'https:');
      orig  = (location.origin   || (proto + '//' + host));
    } catch (e) { host = ''; proto = 'https:'; orig = ''; }
  }

  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || /^127\./.test(host);
  var isFile  = proto === 'file:';
  var isRail  = host.endsWith('railway.app');
  var isGH    = host.endsWith('github.io');
  var isOBS   = typeof obsbrowser !== 'undefined';

  // ── 3. Constantes ─────────────────────────────────────────────
  var RAILWAY_API = 'https://v2-api-production-db45.up.railway.app';
  var VERSION     = '4.0.0';
  var CACHE_BUST  = VERSION + '-1'; // cambiar '-1' para forzar recarga inmediata

  var API_BASE = isLocal ? (orig || '') : (isRail ? (orig || RAILWAY_API) : RAILWAY_API);

  // Rutas base
  var P_EVENT   = '/eventos/';
  var P_OVERLAY = '/overlays/';
  var P_SHARED  = '/shared/';
  var P_CONTROL = '/control/';
  var P_LOGOS   = '/logos/';
  var P_TMPL    = '/templates/';
  var P_DATA    = '/data/';
  var P_TOOLS   = '/tools/';

  // Endpoints centralizados (freeze profundo)
  var API_URLS = Object.freeze({
    teams:        '/api/teams',
    players:      '/api/players',
    playersBatch: '/api/players/batch',
    uploadLogo:   '/api/upload-logo',
    uploadPlayer: '/api/upload-player',
    exportTeams:  '/api/export',
    importTeams:  '/api/import',
    genEventPkg:  '/api/generate-event-package',
    snapshot:     '/getmatchsnapshot',
    tournamentCfg:'/tournamentconfig',
    observers:    '/observers',
    state:        '/state',
    resetState:   '/resetstate',
    overlayCmd:   '/overlaycommand',
    gasProxy:     '/gas-proxy'
  });

  var ENV = isLocal ? 'development' : isRail ? 'production' : isGH ? 'github-pages' : isFile ? 'file' : 'production';
  var DEBUG = isLocal;

  // ── 4. Console ────────────────────────────────────────────────
  function safeLog(type, force) {
    return function () {
      if (!hasCon) return;
      if (!force && !DEBUG) return;
      var fn = console[type];
      if (typeof fn !== 'function') return;
      try { fn.apply(console, ['[CFG]'].concat(Array.prototype.slice.call(arguments))); }
      catch (e) {}
    };
  }
  var log   = safeLog('log',   false);
  var warn  = safeLog('warn',  false);
  var error = safeLog('error', true);  // siempre visible

  // ── 5. Helpers ────────────────────────────────────────────────
  function normSlash(s) {
    if (!s || typeof s !== 'string') return '';
    // Solo normalizar slashes consecutivos, no tocar protocolo ni query params
    return s.replace(/([^:])\/\/+/g, '$1/');
  }

  function resolveApi(path) {
    if (!path || typeof path !== 'string') return API_BASE;
    if (/^https?:\/\//.test(path)) return path;
    return normSlash(API_BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  }

  function resolveEndpoint(key) {
    if (!key || typeof key !== 'string') return '';
    var url = API_URLS[key];
    if (!url) {
      error('Endpoint no encontrado:', key);
      return '';
    }
    return resolveApi(url);
  }

  function resolveAsset(path, isDynamic) {
    if (!path || typeof path !== 'string') return '';
    if (/^https?:\/\//.test(path)) return path;
    // Assets estáticos locales (CSS, JS, imágenes de template) respetan origen
    if (!isDynamic) {
      return normSlash((orig || '').replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
    }
    // Assets dinámicos (logos subidos por usuarios) → backend
    return normSlash(RAILWAY_API.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  }

  function withCB(url) {
    if (!url || typeof url !== 'string') return '';
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + '_v=' + CACHE_BUST;
  }

  function supports(f) {
    f = (f || '').toLowerCase();
    switch (f) {
      case 'fetch':    return typeof fetch === 'function';
      case 'websocket':return typeof WebSocket === 'function';
      case 'localstorage':
        return typeof localStorage !== 'undefined' && (function(){ try { var t='__t__'; localStorage.setItem(t,t); localStorage.removeItem(t); return true; } catch(e){ return false; } })();
      case 'broadcastchannel': return typeof BroadcastChannel === 'function';
      case 'mutationobserver': return typeof MutationObserver === 'function';
      case 'promise':  return typeof Promise === 'function';
      case 'raf':      return typeof requestAnimationFrame === 'function';
      default: return false;
    }
  }

  // ── 6. Config object ──────────────────────────────────────────
  var cfg = {
    __init: true,
    VERSION: VERSION,
    CACHE_BUST: CACHE_BUST,
    ENV: ENV,
    DEBUG: DEBUG,

    API_BASE: API_BASE,
    RAILWAY_API: RAILWAY_API,
    API_URLS: API_URLS,

    EVENT_PATH: P_EVENT,
    OVERLAY_PATH: P_OVERLAY,
    SHARED_PATH: P_SHARED,
    CONTROL_PATH: P_CONTROL,
    LOGOS_PATH: P_LOGOS,
    TEMPLATES_PATH: P_TMPL,
    DATA_PATH: P_DATA,
    TOOLS_PATH: P_TOOLS,

    IS_LOCALHOST: isLocal,
    IS_RAILWAY: isRail,
    IS_GITHUB_PAGES: isGH,
    IS_FILE_PROTOCOL: isFile,
    IS_OBS: isOBS,

    resolveApi: resolveApi,
    resolveEndpoint: resolveEndpoint,
    resolveAsset: resolveAsset,
    withCacheBust: withCB,
    log: log,
    warn: warn,
    error: error,
    supports: supports
  };

  // ── 7. Freeze ─────────────────────────────────────────────────
  try {
    if (typeof Object.freeze === 'function') {
      Object.freeze(cfg);
      Object.freeze(API_URLS);
    }
  } catch (e) { if (DEBUG) warn('freeze no disponible'); }

  // ── 8. Expose ─────────────────────────────────────────────────
  g.APP_CONFIG = cfg;

  Object.defineProperty(g, 'getApiBase', {
    value: function () { return API_BASE; },
    writable: false,
    configurable: false,
    enumerable: false
  });

  // ── 9. Init log (solo dev) ────────────────────────────────────
  if (DEBUG) {
    log('init', { v: VERSION, env: ENV, api: API_BASE, host: host, obs: isOBS,
      sup: { fetch: supports('fetch'), ws: supports('websocket'), ls: supports('localstorage'), bc: supports('broadcastchannel') }
    });
  }

})(typeof globalThis !== 'undefined' ? globalThis :
   typeof window  !== 'undefined' ? window  :
   typeof global  !== 'undefined' ? global  :
   typeof self    !== 'undefined' ? self    : this);