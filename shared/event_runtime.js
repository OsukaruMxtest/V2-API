/*
 * event_runtime.js
 * Central Runtime Orchestrator for PUBG Mobile Esports Overlay Ecosystem
 *
 * Single source of truth for:
 *   - eventId / modular mode detection
 *   - BroadcastChannel names (snapshot, commands, heartbeat, config)
 *   - localStorage keys (config, broadcast, manualCmd, state, heartbeat)
 *   - Overlay registry & heartbeat engine
 *   - Authority overlay management
 *   - Global scene state
 *
 * V1.3 — Vanilla ES6, zero dependencies, legacy-safe, hardened
 * (c) 2025 PUBG Mobile Esports Engineering
 */

(function(global) {
    'use strict';

    // ============================================================
    // 10. PROTECCIÓN DOBLE CARGA
    // ============================================================
    if (global.EventRuntime) return;

    // ============================================================
    // 1. AUTO-DETECCIÓN DE EVENTO + 7. SANITIZACIÓN + 9. VACÍO
    // ============================================================
    let eventId = null;
    let isModular = false;

    try {
        const pathname = (global.location && global.location.pathname) || '';
        const match = pathname.match(/\/eventos\/([^/]+)\//);
        if (match && match[1]) {
            eventId = match[1].replace(/[^a-zA-Z0-9_-]/g, '');
            if (!eventId) {
                eventId = null;
            } else {
                isModular = true;
            }
        }
    } catch (e) {
        // Silencioso
    }

    const EVENT_PREFIX = eventId ? '[' + eventId.toUpperCase() + ']' : '[LEGACY]';
    const LOG_PREFIX = '[EventRuntime]' + EVENT_PREFIX;

    // ============================================================
    // 2. THROTTLE PARA warn()
    // ============================================================
    const warnCache = Object.create(null);
    const WARN_THROTTLE_MS = 1000;

    // ============================================================
    // 8. CONFIG REACTIVA + FLAG DEBUG
    // ============================================================
    const runtimeConfig = {
        heartbeatTimeout: 10000,
        deadMultiplier: 6,
        minDeadTimeout: 120000,
        cleanupInterval: 5000,
        freezeThreshold: 30000,
        debug: false
    };

    function log() {
        if (!runtimeConfig.debug) return;
        if (typeof console !== 'undefined' && console.log) {
            console.log.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
        }
    }

    function warn() {
        if (typeof console === 'undefined' || !console.warn) return;
        const args = Array.prototype.slice.call(arguments);
        const key = args.length > 0 ? (typeof args[0] === 'string' ? args[0] : String(args[0])) : '';
        const now = Date.now();
        const last = warnCache[key] || 0;
        if (now - last < WARN_THROTTLE_MS) return;
        warnCache[key] = now;
        console.warn.apply(console, [LOG_PREFIX].concat(args));
    }

    // ============================================================
    // 2. CHANNELS CENTRALIZADOS + 7. FREEZE
    // ============================================================
    const channels = {
        snapshot: isModular ? 'pubgm_' + eventId + '_snapshot' : 'pubgm_snapshot',
        commands: isModular ? 'pubgm_' + eventId + '_commands' : 'pubgm_commands',
        heartbeat: isModular ? 'pubgm_' + eventId + '_heartbeat' : 'pubgm_heartbeat',
        config: isModular ? 'pubgm_' + eventId + '_config' : 'pubgm_config'
    };
    Object.freeze(channels);

    // ============================================================
    // 3. STORAGE KEYS CENTRALIZADAS + 7. FREEZE
    // ============================================================
    const storageKeys = {
        config: isModular ? 'overlayConfig_' + eventId : 'overlayConfig',
        configBroadcast: isModular ? 'overlayConfigBroadcast_' + eventId : 'overlayConfigBroadcast',
        manualCmd: isModular ? 'overlayManualCmd_' + eventId : 'overlay_manual_cmd',
        overlayState: isModular ? 'overlayState_' + eventId : 'overlayState',
        heartbeat: isModular ? 'overlayHeartbeat_' + eventId : 'overlayHeartbeat'
    };
    Object.freeze(storageKeys);

    // ============================================================
    // 6. REGISTRY
    // ============================================================
    const overlays = Object.create(null);
    const heartbeatTimers = Object.create(null);

    let cleanupIntervalId = null;
    let lastCleanupRun = 0;
    let destroyed = false;
    let persistTimer = null;

    // ============================================================
    // 13. PERSISTENCIA MÍNIMA
    // ============================================================
    let authority = 'overlay_control';

    const sceneState = {
        activeOverlay: null,
        finalsRunning: false,
        tacticalMapVisible: true,
        alertsEnabled: true,
        paused: false
    };

    // 2. Guard localStorage + 3. validar tamaño
    function loadPersistedState() {
        if (!global.localStorage) return;
        try {
            const raw = global.localStorage.getItem(storageKeys.overlayState);
            if (!raw) return;
            if (raw.length > 50000) {
                warn('loadPersistedState: payload demasiado grande, ignorando');
                return;
            }
            const parsed = JSON.parse(raw);
            if (parsed.authority && typeof parsed.authority === 'string') {
                authority = parsed.authority;
            }
            if (parsed.sceneState && typeof parsed.sceneState === 'object') {
                const keys = Object.keys(parsed.sceneState);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    if (Object.prototype.hasOwnProperty.call(sceneState, k)) {
                        const v = parsed.sceneState[k];
                        if (isValidType(k, v)) {
                            sceneState[k] = v;
                        }
                    }
                }
            }
        } catch (e) {
            // Silencioso
        }
    }

    function flushPersistState() {
        if (!global.localStorage) return;
        try {
            const payload = {
                authority: authority,
                sceneState: shallowClone(sceneState),
                _timestamp: Date.now()
            };
            global.localStorage.setItem(storageKeys.overlayState, JSON.stringify(payload));
        } catch (e) {
            // Silencioso
        }
    }

    // 3. Debounce ligero
    function savePersistedState() {
        if (!global.localStorage) return;
        if (persistTimer) {
            clearTimeout(persistTimer);
        }
        persistTimer = setTimeout(function() {
            persistTimer = null;
            flushPersistState();
        }, 250);
    }

    // ============================================================
    // UTILIDADES
    // ============================================================
    function shallowClone(obj) {
        const clone = {};
        const keys = Object.keys(obj);
        for (let i = 0; i < keys.length; i++) {
            clone[keys[i]] = obj[keys[i]];
        }
        return clone;
    }

    // 1. isValidType con null fix + 6. string vacío inválido
    function isValidType(key, value) {
        const original = sceneState[key];
        if (original === null) {
            return value === null || (typeof value === 'string' && value.trim() !== '');
        }
        const expected = typeof original;
        const actual = typeof value;
        if (expected === 'boolean' && actual === 'boolean') return true;
        if (expected === 'string' && actual === 'string') return true;
        if (expected === 'number' && actual === 'number') return true;
        return false;
    }

    // ============================================================
    // 4. OVERLAY REGISTRY
    // ============================================================
    function registerOverlay(name) {
        if (!name || typeof name !== 'string') {
            warn('registerOverlay ignorado: nombre inválido');
            return;
        }
        const now = Date.now();
        if (!overlays[name]) {
            overlays[name] = {
                lastHeartbeat: now,
                registeredAt: now
            };
            log('overlay registrado:', name);
            emitBus('runtime:overlay_registered', { name: name, eventId: eventId });
        } else {
            overlays[name].lastHeartbeat = now;
        }
    }

    function unregisterOverlay(name) {
        if (!name || !overlays[name]) return;
        stopOverlayHeartbeat(name);
        delete overlays[name];
        log('overlay removido:', name);
        emitBus('runtime:overlay_removed', { name: name, eventId: eventId });
    }

    function heartbeatOverlay(name) {
        if (!name) return;
        if (!overlays[name]) {
            registerOverlay(name);
            return;
        }
        overlays[name].lastHeartbeat = Date.now();
    }

    function getOverlayState(name) {
        const entry = overlays[name];
        if (!entry) return null;
        const now = Date.now();
        const elapsed = now - entry.lastHeartbeat;
        const timeout = runtimeConfig.heartbeatTimeout;
        const deadThreshold = Math.max(timeout * runtimeConfig.deadMultiplier, runtimeConfig.minDeadTimeout);

        const alive = elapsed <= timeout;
        const stale = !alive && elapsed <= deadThreshold;
        const dead = !alive && elapsed > deadThreshold;

        return {
            name: name,
            alive: alive,
            stale: stale,
            dead: dead,
            lastHeartbeat: entry.lastHeartbeat,
            registeredAt: entry.registeredAt,
            elapsedMs: elapsed
        };
    }

    function getAllOverlays() {
        const result = Object.create(null);
        const names = Object.keys(overlays);
        for (let i = 0; i < names.length; i++) {
            result[names[i]] = getOverlayState(names[i]);
        }
        return result;
    }

    // ============================================================
    // 8. AUTO-HEARTBEAT HELPER + 4. DOUBLE-START GUARD + 5. CLAMP
    // ============================================================
    function startOverlayHeartbeat(name, intervalMs) {
        intervalMs = (typeof intervalMs === 'number' && intervalMs > 0) ? intervalMs : 3000;
        intervalMs = Math.max(500, intervalMs);
        if (!name || typeof name !== 'string') {
            warn('startOverlayHeartbeat ignorado: nombre inválido');
            return;
        }
        // 4. Evitar doble start
        if (heartbeatTimers[name]) {
            return;
        }
        if (!overlays[name]) {
            registerOverlay(name);
        }
        heartbeatTimers[name] = setInterval(function() {
            heartbeatOverlay(name);
        }, intervalMs);
        log('auto-heartbeat iniciado:', name, intervalMs + 'ms');
    }

    function stopOverlayHeartbeat(name) {
        if (!name || !heartbeatTimers[name]) return;
        clearInterval(heartbeatTimers[name]);
        delete heartbeatTimers[name];
    }

    // ============================================================
    // 5. AUTHORITY OVERLAY
    // ============================================================
    function setAuthority(name) {
        if (!name || typeof name !== 'string') return;
        const previous = authority;
        authority = name;
        if (previous !== name) {
            log('authority cambiada:', previous, '->', name);
            emitBus('runtime:authority_changed', { authority: name, previous: previous, eventId: eventId });
            savePersistedState();
        }
    }

    function getAuthority() {
        return authority;
    }

    // ============================================================
    // 6. SCENE STATE
    // ============================================================
    function setSceneState(partial) {
        if (!partial || typeof partial !== 'object') return;
        let changed = false;
        const keys = Object.keys(partial);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!Object.prototype.hasOwnProperty.call(sceneState, key)) continue;
            const value = partial[key];
            if (!isValidType(key, value)) {
                warn('setSceneState tipo inválido para', key, ':', typeof value);
                continue;
            }
            if (sceneState[key] !== value) {
                sceneState[key] = value;
                changed = true;
            }
        }
        if (changed) {
            log('sceneState actualizado');
            emitBus('runtime:scene_changed', shallowClone(sceneState));
            savePersistedState();
        }
    }

    function getSceneState() {
        return shallowClone(sceneState);
    }

    // ============================================================
    // 7. EVENT BUS INTEGRATION
    // ============================================================
    function emitBus(eventName, payload) {
        if (global.OverlayBus && typeof global.OverlayBus.emit === 'function') {
            try {
                global.OverlayBus.emit(eventName, payload);
            } catch (e) {
                warn('Error emitiendo en OverlayBus:', e);
            }
        }
    }

    // ============================================================
    // 8. HEARTBEAT ENGINE + 1. FREEZE-SAFE REAL
    // ============================================================
    function startCleanupEngine() {
        if (cleanupIntervalId) return;
        lastCleanupRun = Date.now();
        cleanupIntervalId = setInterval(function() {
            const now = Date.now();
            const delta = now - lastCleanupRun;

            // 1. FREEZE-SAFE REAL: solo sumar exceso, no el ciclo normal
            if (delta > runtimeConfig.freezeThreshold + runtimeConfig.cleanupInterval) {
                const adjust = delta - runtimeConfig.cleanupInterval;
                log('freeze detectado, ajustando heartbeats (+' + adjust + 'ms)');
                const names = Object.keys(overlays);
                for (let i = 0; i < names.length; i++) {
                    overlays[names[i]].lastHeartbeat += adjust;
                }
                lastCleanupRun = now;
                return;
            }
            lastCleanupRun = now;

            const names = Object.keys(overlays);
            const timeout = runtimeConfig.heartbeatTimeout;
            const deadThreshold = Math.max(timeout * runtimeConfig.deadMultiplier, runtimeConfig.minDeadTimeout);

            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                const entry = overlays[name];
                const elapsed = now - entry.lastHeartbeat;

                if (elapsed > deadThreshold) {
                    log('overlay dead eliminado:', name, '(' + elapsed + 'ms)');
                    stopOverlayHeartbeat(name);
                    delete overlays[name];
                    emitBus('runtime:overlay_removed', { name: name, reason: 'dead', eventId: eventId });
                }
            }
        }, runtimeConfig.cleanupInterval);
    }

    function stopCleanupEngine() {
        if (cleanupIntervalId) {
            clearInterval(cleanupIntervalId);
            cleanupIntervalId = null;
        }
    }

    // ============================================================
    // 9. CLEANUP & LIFECYCLE + 5. FLUSH PERSIST
    // ============================================================
    function destroy() {
        // TODO: si en futuro se necesita reinicializar (hot reload),
        // agregar un método reset() que ponga destroyed = false y re-lance boot.
        if (destroyed) return;
        destroyed = true;

        // 5. Flush debounce pendiente antes de limpiar todo
        if (persistTimer) {
            clearTimeout(persistTimer);
            persistTimer = null;
            flushPersistState();
        }

        stopCleanupEngine();

        const timerNames = Object.keys(heartbeatTimers);
        for (let i = 0; i < timerNames.length; i++) {
            clearInterval(heartbeatTimers[timerNames[i]]);
            delete heartbeatTimers[timerNames[i]];
        }

        const names = Object.keys(overlays);
        for (let i = 0; i < names.length; i++) {
            delete overlays[names[i]];
        }

        if (global.removeEventListener) {
            global.removeEventListener('beforeunload', destroy);
        }

        log('destroy() completado');
    }

    if (global.addEventListener) {
        global.addEventListener('beforeunload', destroy);
    }

    // ============================================================
    // 10. BOOT
    // ============================================================
    loadPersistedState();
    startCleanupEngine();

    // ============================================================
    // 11. PUBLIC API
    // ============================================================
    global.EventRuntime = {
        eventId: eventId,
        isModular: isModular,
        channels: channels,
        storageKeys: storageKeys,

        // 1. Config reactiva expuesta
        config: runtimeConfig,

        registerOverlay: registerOverlay,
        unregisterOverlay: unregisterOverlay,
        heartbeatOverlay: heartbeatOverlay,
        getOverlayState: getOverlayState,
        getAllOverlays: getAllOverlays,

        startOverlayHeartbeat: startOverlayHeartbeat,
        stopOverlayHeartbeat: stopOverlayHeartbeat,

        setAuthority: setAuthority,
        getAuthority: getAuthority,

        setSceneState: setSceneState,
        getSceneState: getSceneState,

        destroy: destroy
    };

    log('inicializado — modo:', isModular ? 'MODULAR' : 'LEGACY', eventId ? '(' + eventId + ')' : '');

})(typeof window !== 'undefined' ? window : this);