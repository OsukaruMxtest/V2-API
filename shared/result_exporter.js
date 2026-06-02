/**
 * shared/result_exporter.js
 * Centraliza la construcción y envío del resultado final de partida.
 * Sin dependencias externas. Vanilla JS. No toca DOM ni UI.
 * Usa EventRuntime.endpoints y EventRuntime.storageKeys cuando existen.
 */
(function (global) {
  'use strict';

  // ─── Protección contra doble carga ───
  if (global.ResultExporter) return;

  // ─── Helpers de acceso a EventRuntime ───
  function _getEventRuntime() {
    return global.EventRuntime || null;
  }

  function _getStorageKeys() {
    var er = _getEventRuntime();
    if (er && er.storageKeys) {
      return er.storageKeys;
    }
    return {
      lastExportedGameId: 'pubg_overlay_lastExportedGameId',
      lastExportedMatchNumber: 'pubg_overlay_lastExportedMatchNumber',
      lastExportStatus: 'pubg_overlay_lastExportStatus',
      lastExportError: 'pubg_overlay_lastExportError',
      lastExportAttemptGameId: 'pubg_overlay_lastExportAttemptGameId'
    };
  }

  function _getEndpointUrl() {
    var er = _getEventRuntime();
    if (er && er.endpoints && typeof er.endpoints.saveMatchResult === 'function') {
      return er.endpoints.saveMatchResult();
    }
    return null;
  }

  function _resolveEventName(options) {
    var er = _getEventRuntime();
    if (options && options.eventName) return String(options.eventName);
    if (er && er.state && er.state.eventName) return String(er.state.eventName);
    return '';
  }

  function _resolveSafeEventName(options) {
    var er = _getEventRuntime();
    if (options && options.safeEventName) return String(options.safeEventName);
    if (er && er.state && er.state.safeEventName) return String(er.state.safeEventName);
    return '';
  }

  // ─── Helpers de localStorage ───
  function _lsGet(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function _lsSet(key, val) {
    try {
      global.localStorage.setItem(key, val);
    } catch (e) {
      // Silencioso: si localStorage falla, no rompe el flujo.
    }
  }

  function _toISO(val) {
    if (!val) return new Date().toISOString();
    var d = new Date(val);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function _isArray(val) {
    return Array.isArray(val);
  }

  function _toNumber(val, fallback) {
    var n = Number(val);
    return isNaN(n) ? fallback : n;
  }

  function _warn(msg) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(msg);
    }
  }

  // ─── 1. buildMatchResultPayload(options) ───
  function buildMatchResultPayload(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('[ResultExporter] buildMatchResultPayload requiere un objeto options.');
    }

    var gameId = options.gameId !== undefined ? options.gameId : options.GameID;
    if (!gameId && gameId !== 0) {
      throw new Error('[ResultExporter] Falta campo obligatorio: gameId / GameID');
    }

    var nextMatch = getNextMatchNumber();
    var rawMatchNumber = options.matchNumber !== undefined ? options.matchNumber : nextMatch;
    var matchNumber = _toNumber(rawMatchNumber, nextMatch);

    var eventName = _resolveEventName(options);
    var safeEventName = _resolveSafeEventName(options);

    var teams = _isArray(options.teams) ? options.teams : [];
    var players = _isArray(options.players) ? options.players : [];

    if (!Array.isArray(options.teams)) _warn('[ResultExporter] teams no es array, usando []');
    if (!Array.isArray(options.players)) _warn('[ResultExporter] players no es array, usando []');

    var payload = {
      eventName: eventName,
      safeEventName: safeEventName,
      gameId: String(gameId),
      GameID: String(gameId),
      matchNumber: matchNumber,
      gameStartTime: _toISO(options.gameStartTime),
      finishedStartTime: _toISO(options.finishedStartTime),
      exportedAt: _toISO(options.exportedAt),
      scoringConfig: options.scoringConfig || null,
      teams: teams,
      players: players,
      winner: options.winner || null,
      mvp: options.mvp || null,
      mvt: options.mvt || null,
      snapshot: options.snapshot || null
    };

    return payload;
  }

  // ─── 2. sendMatchResultToServer(payload) ───
  function sendMatchResultToServer(payload) {
    if (!payload || !payload.gameId) {
      return Promise.reject(new Error('[ResultExporter] Payload inválido para envío.'));
    }

    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('[ResultExporter] fetch no disponible.'));
    }

    var url = _getEndpointUrl();
    if (!url) {
      return Promise.reject(new Error('[ResultExporter] EventRuntime.endpoints.saveMatchResult() no disponible. No se puede enviar.'));
    }

    var body = JSON.stringify(payload);

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) {
      if (res.status === 409) {
        return { ok: true, duplicate: true, status: 409 };
      }
      if (!res.ok) {
        return res.text().then(function (txt) {
          throw new Error('[ResultExporter] Server error ' + res.status + ': ' + txt);
        });
      }
      return res.json().catch(function () { return { ok: true }; });
    });
  }

  // ─── 3. exportMatchResult(options) ───
  function exportMatchResult(options) {
    var payload;
    try {
      payload = buildMatchResultPayload(options);
    } catch (err) {
      markExportStatus('error', err.message);
      return Promise.reject(err);
    }

    var keys = _getStorageKeys();
    _lsSet(keys.lastExportAttemptGameId, String(payload.gameId));

    if (wasGameAlreadyExported(payload.gameId)) {
      _lsSet(keys.lastExportedGameId, String(payload.gameId));
      _lsSet(keys.lastExportedMatchNumber, String(payload.matchNumber));
      markExportStatus('duplicate');
      return Promise.resolve({ ok: true, duplicate: true, source: 'local' });
    }

    markExportStatus('saving');

    return sendMatchResultToServer(payload)
      .then(function (result) {
        if (result && result.duplicate) {
          _lsSet(keys.lastExportedGameId, String(payload.gameId));
          _lsSet(keys.lastExportedMatchNumber, String(payload.matchNumber));
          markExportStatus('duplicate');
        } else {
          markGameAsExported(payload.gameId, payload.matchNumber);
        }
        return result;
      })
      .catch(function (err) {
        markExportStatus('error', err.message);
        throw err;
      });
  }

  // ─── 4. wasGameAlreadyExported(gameId) ───
  function wasGameAlreadyExported(gameId) {
    if (!gameId && gameId !== 0) return false;
    var keys = _getStorageKeys();
    var last = _lsGet(keys.lastExportedGameId);
    return last === String(gameId);
  }

  // ─── 5. markGameAsExported(gameId, matchNumber) ───
  // Solo se llama en éxito real. Marca saved internamente.
  function markGameAsExported(gameId, matchNumber) {
    var keys = _getStorageKeys();
    _lsSet(keys.lastExportedGameId, String(gameId));
    _lsSet(keys.lastExportedMatchNumber, String(matchNumber));
    markExportStatus('saved');
  }

  // ─── 6. markExportStatus(status, errorMessage) ───
  function markExportStatus(status, errorMessage) {
    var keys = _getStorageKeys();
    _lsSet(keys.lastExportStatus, String(status));
    if (status === 'error' && errorMessage) {
      _lsSet(keys.lastExportError, String(errorMessage));
    } else {
      _lsSet(keys.lastExportError, '');
    }
  }

  // ─── 7. getNextMatchNumber() ───
  function getNextMatchNumber() {
    var keys = _getStorageKeys();
    var last = Number(_lsGet(keys.lastExportedMatchNumber));
    return isNaN(last) ? 1 : last + 1;
  }

  // ─── Exposición pública ───
  global.ResultExporter = {
    buildMatchResultPayload: buildMatchResultPayload,
    sendMatchResultToServer: sendMatchResultToServer,
    exportMatchResult: exportMatchResult,
    wasGameAlreadyExported: wasGameAlreadyExported,
    markGameAsExported: markGameAsExported,
    markExportStatus: markExportStatus,
    getNextMatchNumber: getNextMatchNumber
  };

})(typeof window !== 'undefined' ? window : this);