(function(){

    if(window.OverlayConfig) return;

    // ============================================================
    // EVENT ISOLATION & MODULAR ARCHITECTURE
    // ============================================================
    const HAS_EVENT_RUNTIME = !!window.EventRuntime;
    const EVENT_ID = HAS_EVENT_RUNTIME ? window.EventRuntime.eventId : null;
    const EVENT_PREFIX = EVENT_ID ? `[${EVENT_ID.toUpperCase()}]` : '[LEGACY]';
    const SENDER_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

    // ============================================================
    // AUTO-DETECT OVERLAY NAME FROM PATHNAME (sanitizado)
    // ============================================================
    function detectOverlayName() {
        try {
            const pathname = (window.location && window.location.pathname) || '';
            const match = pathname.match(/\/([^/]+)\.html?$/i);
            if (match) {
                let name = match[1];
                if (HAS_EVENT_RUNTIME && EVENT_ID) {
                    const suffix = '_' + EVENT_ID;
                    if (name.slice(-suffix.length) === suffix) {
                        name = name.slice(0, -suffix.length);
                    }
                }
                return name.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';
            }
        } catch (e) {}
        return 'unknown';
    }

    const OVERLAY_NAME = detectOverlayName();

    // ============================================================
    // AUTHORITY CHECK
    // ============================================================
    function isAuthority() {
        if (!HAS_EVENT_RUNTIME || !window.EventRuntime) return true;
        return window.EventRuntime.getAuthority() === OVERLAY_NAME;
    }

    /**
     * Logger with event context.
     * Respects EventRuntime.config.debug when available.
     * @private
     */
    function log(level, ...args) {
        const prefix = `[OverlayConfig]${EVENT_PREFIX}`;
        const debug = HAS_EVENT_RUNTIME && window.EventRuntime && window.EventRuntime.config && window.EventRuntime.config.debug;
        if (level === 'error' && typeof console !== 'undefined' && console.error) {
            console.error(prefix, ...args);
        } else if (level === 'warn' && typeof console !== 'undefined' && console.warn) {
            console.warn(prefix, ...args);
        } else if ((debug || (typeof window !== 'undefined' && window.DEBUG_OVERLAY === true)) && typeof console !== 'undefined' && console.log) {
            console.log(prefix, ...args);
        }
    }

    /**
     * Get namespaced storage key for config.
     * @private
     * @returns {string}
     */
    function getStorageKey() {
        return HAS_EVENT_RUNTIME ? window.EventRuntime.storageKeys.config : 'overlayConfig';
    }

    /**
     * Get namespaced storage key for config broadcast.
     * @private
     * @returns {string}
     */
    function getBroadcastStorageKey() {
        return HAS_EVENT_RUNTIME ? window.EventRuntime.storageKeys.configBroadcast : 'overlayConfigBroadcast';
    }

    /**
     * Get namespaced BroadcastChannel name for config.
     * @private
     * @returns {string}
     */
    function getChannelName() {
        return HAS_EVENT_RUNTIME ? window.EventRuntime.channels.config : 'pubgm_config';
    }

    /**
     * Validate payload for event isolation.
     * @private
     * @param {*} payload
     * @returns {boolean}
     */
    function shouldProcessPayload(payload) {
        if (!payload || typeof payload !== 'object') return false;
        // Legacy mode: accept everything
        if (!HAS_EVENT_RUNTIME) return true;
        // No eventId: assume legacy compat (accept)
        if (!payload.eventId) return true;
        // Mismatch: reject (isolation)
        if (payload.eventId !== EVENT_ID) {
            log('log', 'IGNORADO — eventId mismatch:', payload.eventId, '!==', EVENT_ID);
            return false;
        }
        return true;
    }

    // ============================================================
    // LEGACY BRIDGE — ONLY created in modular mode
    // ============================================================
    let legacyConfigChannel = null;
    if (HAS_EVENT_RUNTIME) {
        try {
            legacyConfigChannel = new BroadcastChannel('pubgm_config');
            log('log', 'Legacy bridge canal creado (pubgm_config)');
        } catch (e) {
            // silent — legacy bridge is optional
        }
    }

    // ============================================================
    // ORIGINAL CONFIG STATE (preserved exactly)
    // ============================================================
    const STORAGE_KEY = getStorageKey();
    const BROADCAST_STORAGE_KEY = getBroadcastStorageKey();
    const CHANNEL_NAME = getChannelName();

    let data = {
        alerts:{
            firstKill:true,
            firstGrenade:true,
            teamEliminated:true,
            zone:true
        },
        tables:{
            teamBars:true,
            desafios:true
        },
        animations:{
            enabled:true
        },
        map:{
            enabled:true
        },
        finalScreen:{
            automaticMode:false
        },
        display:{
            displayMode:"team"
        },
        columns:{
            showPP:true,
            showTotal:true
        },
        ui:{
            showTeamTable:true,
            showDropsRoutes:false,
            showThrowables:false
        },
        scoring:{
            pp:{ 1:20,2:18,3:16,4:14,5:12,6:10,7:8,8:6,9:5,10:4,11:3,12:2,13:1,14:1,15:1,16:1 },
            pePerKill:1,
            bonusEnabled:false,
            bonus:{
                grenade:3,
                vehicle:8,
                melee:13,
                molotov:3,
                distance:15,
                killDist:18
            }
        }
    };

    const listeners = [];
    const UPDATE_DEDUPE_MS = 100;

    // 8. Variables simples en lugar de Map mágico
    let lastSnapshotKey = null;
    let lastSnapshotTime = 0;

    // 4. Debounce para save()
    let saveDebounceTimer = null;

    // 7. Throttle para storage events
    let lastStorageTimestamp = 0;
    const STORAGE_THROTTLE_MS = 50;

    // PROBLEM 4 FIX: periodic cleanup
    function cleanExpiredDedupe() {
        const now = Date.now();
        if (lastSnapshotTime && (now - lastSnapshotTime) > UPDATE_DEDUPE_MS * 10) {
            lastSnapshotKey = null;
            lastSnapshotTime = 0;
        }
    }
    const dedupeCleanupInterval = setInterval(cleanExpiredDedupe, 5000);

    let configChannel = null;
    try{
        configChannel = new BroadcastChannel(CHANNEL_NAME);
    }catch(e){
        log('warn', 'BroadcastChannel no disponible:', e.message);
    }

    // ============================================================
    // REGISTER OVERLAY IN RUNTIME + AUTO-HEARTBEAT
    // ============================================================
    if (HAS_EVENT_RUNTIME && window.EventRuntime) {
        window.EventRuntime.registerOverlay(OVERLAY_NAME);
        window.EventRuntime.startOverlayHeartbeat(OVERLAY_NAME, 3000);
        log('log', 'overlay registrado en runtime:', OVERLAY_NAME);
    }

    // ============================================================
    // MERGE DEEP (preserved + hardened + 2. prototype pollution fix)
    // ============================================================
    function mergeDeep(target, source){
        if (!source || typeof source !== 'object') return target;
        // CRITICAL FIX: Handle root-level arrays by returning a shallow copy
        if (Array.isArray(source)) {
            return source.slice();
        }
        for(const key in source){
            // 2. Prototype pollution guard
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            if (source[key] === null) {
                target[key] = null;
            } else if (Array.isArray(source[key])) {
                // CRITICAL FIX: Replace arrays entirely with shallow copy
                target[key] = source[key].slice();
            } else if (
                typeof source[key] === "object"
            ){
                if(!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])){
                    target[key] = {};
                }
                mergeDeep(target[key], source[key]);
            }else{
                target[key] = source[key];
            }
        }
        return target;
    }

    // ============================================================
    // LOAD (preserved + modular storage key + hardening)
    // ============================================================
    function load(){
        try{
            const stored = localStorage.getItem(STORAGE_KEY);
            if(!stored) return;
            // Hardening: reject oversized payloads
            if (stored.length > 50000) {
                log('warn', 'Config localStorage muy grande, ignorando:', stored.length);
                return;
            }
            const parsed = JSON.parse(stored);
            // PROBLEM 3 FIX: extract config from metadata wrapper if present
            const configToLoad = parsed.config || parsed;
            // 6. Validar que no sea array ni primitivo
            if (!configToLoad || typeof configToLoad !== 'object' || Array.isArray(configToLoad)) {
                log('warn', 'Config corrupta en localStorage, ignorando');
                return;
            }
            // State migration: displayMode → display.displayMode
            if(configToLoad.displayMode !== undefined && (!configToLoad.display || configToLoad.display.displayMode === undefined)){
                if(!configToLoad.display) configToLoad.display = {};
                configToLoad.display.displayMode = configToLoad.displayMode;
                delete configToLoad.displayMode;
            }
            mergeDeep(data, configToLoad);
        }catch(e){
            log('error', 'Error cargando config:', e.message);
        }
    }

    // ============================================================
    // SAVE (preserved + modular storage key + 4. debounce)
    // ============================================================
    function flushSave() {
        try{
            const savePayload = {
                config: data,
                _source: 'overlay_config',
                senderId: SENDER_ID,
                timestamp: Date.now()
            };
            if (HAS_EVENT_RUNTIME) {
                savePayload.eventId = EVENT_ID;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savePayload));
        }catch(e){
            log('error', 'Error guardando config:', e.message);
        }
    }

    function save(){
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
        }
        saveDebounceTimer = setTimeout(function() {
            saveDebounceTimer = null;
            flushSave();
        }, 200);
    }

    // ============================================================
    // NOTIFY (preserved + event-safe + dual broadcast + authority + 1. hash ligero + 5. slice)
    // ============================================================
    function notify(){
        const snapshot = JSON.parse(JSON.stringify(data));
        const now = Date.now();

        // 1. Hash ligero para dedupe (NO stringify completo)
        const snapshotKey = (
            (snapshot.finalScreen?.automaticMode || false) + '|' +
            (snapshot.display?.displayMode || 'team') + '|' +
            (snapshot.alerts?.firstKill || false) + '|' +
            (snapshot.map?.enabled || false) + '|' +
            Math.floor(now / UPDATE_DEDUPE_MS)
        );

        // PROBLEM 5 FIX: dedupe — don't notify if same snapshot within 100ms
        if (snapshotKey === lastSnapshotKey && (now - lastSnapshotTime) < UPDATE_DEDUPE_MS) {
            return;
        }
        lastSnapshotKey = snapshotKey;
        lastSnapshotTime = now;

        // 5. Copiar array para evitar mutación durante iteración
        const callbacks = listeners.slice();
        callbacks.forEach(fn=>{
            try{ fn(snapshot); }catch(e){}
        });

        // Authority check: solo authority emite por BroadcastChannel
        if (configChannel && isAuthority()){
            try{
                const payload = {
                    type:"config_update",
                    config: snapshot,
                    timestamp: Date.now(),
                    _source: 'overlay_config',
                    senderId: SENDER_ID
                };
                if (HAS_EVENT_RUNTIME) {
                    payload.eventId = EVENT_ID;
                }
                configChannel.postMessage(payload);
            }catch(e){
                log('error', 'Error en notify BC:', e.message);
            }
        } else if (HAS_EVENT_RUNTIME && !isAuthority()) {
            log('log', 'notify BC omitido — no authority:', OVERLAY_NAME);
        }

        // Legacy bridge: broadcast to old overlays (solo authority)
        if (HAS_EVENT_RUNTIME && isAuthority() && legacyConfigChannel) {
            try {
                const legacyPayload = {
                    type:"config_update",
                    config: snapshot,
                    timestamp: Date.now(),
                    _legacyBridge: true,
                    _source: 'overlay_config',
                    senderId: SENDER_ID
                };
                legacyConfigChannel.postMessage(legacyPayload);
            } catch(e) {}
        }

        try{
            const lsPayload = {
                config: snapshot,
                timestamp: Date.now(),
                _source: 'overlay_config',
                senderId: SENDER_ID
            };
            if (HAS_EVENT_RUNTIME) {
                lsPayload.eventId = EVENT_ID;
            }
            localStorage.setItem(BROADCAST_STORAGE_KEY, JSON.stringify(lsPayload));
        }catch(e){
            log('error', 'Error en notify localStorage:', e.message);
        }
    }

    function emitSnapshot(){
        const snapshot = JSON.parse(JSON.stringify(data));
        // 5. Copiar array para evitar mutación
        const callbacks = listeners.slice();
        callbacks.forEach(fn=>{ try{ fn(snapshot); }catch(e){} });
    }

    // ============================================================
    // BROADCASTCHANNEL LISTENER (modular + legacy dual + 11. size limit)
    // ============================================================
    if(configChannel){
        configChannel.onmessage = function(e){
            if(!e.data || e.data.type !== "config_update" || !e.data.config) return;
            // 11. Size limit heurístico
            try {
                const size = JSON.stringify(e.data).length;
                if (size > 50000) {
                    log('warn', 'Config BC payload muy grande, ignorando:', size);
                    return;
                }
            } catch (err) {}
            // Event isolation validation
            if (!shouldProcessPayload(e.data)) return;
            // Anti-loop: ignore self-broadcast
            if (e.data._source === 'overlay_config' && e.data.senderId === SENDER_ID) return;
            mergeDeep(data, e.data.config);
            save();
            emitSnapshot();
        };
    }

    // Legacy channel listener (only in modular mode)
    if (legacyConfigChannel) {
        legacyConfigChannel.onmessage = function(e){
            if(!e.data || e.data.type !== "config_update" || !e.data.config) return;
            if (e.data._legacyBridge) return; // avoid loops
            // Event isolation validation
            if (!shouldProcessPayload(e.data)) return;
            // Anti-loop: ignore self-broadcast
            if (e.data._source === 'overlay_config' && e.data.senderId === SENDER_ID) return;
            mergeDeep(data, e.data.config);
            save();
            emitSnapshot();
        };
    }

    // ============================================================
    // STORAGE LISTENER (modular + legacy dual + 7. throttle)
    // ============================================================
    let _ignoreStorageUpdate = false;

    function handleStorageEvent(e){
        // 7. Throttle storage events
        const now = Date.now();
        if (now - lastStorageTimestamp < STORAGE_THROTTLE_MS) {
            return;
        }
        lastStorageTimestamp = now;

        if (
            e.key !== STORAGE_KEY &&
            e.key !== BROADCAST_STORAGE_KEY &&
            e.key !== 'overlayConfig' &&
            e.key !== 'overlayConfigBroadcast'
        ) return;
        if (!e.newValue) return;
        if (_ignoreStorageUpdate) return;
        try{
            const parsed = JSON.parse(e.newValue);

            // validate payload before merging
            if (!parsed || typeof parsed !== 'object') return;

            // Anti-loop: ignore self-broadcast
            if (parsed.senderId === SENDER_ID) return;
            if (parsed._source === 'overlay_config' && parsed.senderId === SENDER_ID) return;

            // Event isolation: in modular mode, validate eventId
            if (HAS_EVENT_RUNTIME) {
                if (parsed.eventId && parsed.eventId !== EVENT_ID) {
                    log('log', 'Storage IGNORADO — eventId mismatch:', parsed.eventId);
                    return;
                }
                if (!parsed.eventId && e.key === 'overlayConfig') {
                    log('log', 'Storage legacy compat (sin eventId)');
                }
            }

            // Only merge the config portion, not metadata
            const configToMerge = parsed.config || parsed;
            if (configToMerge && typeof configToMerge === 'object' && !Array.isArray(configToMerge)) {
                mergeDeep(data, configToMerge);
                emitSnapshot();
            }
        }catch(err){
            log('error', 'Error en storage listener:', err.message);
        }
    }

    window.addEventListener("storage", handleStorageEvent);

    // ============================================================
    // CLEANUP / LIFECYCLE + 10. destroy guard
    // ============================================================
    let destroyed = false;

    function destroy() {
        if (destroyed) return;
        destroyed = true;

        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
            saveDebounceTimer = null;
            flushSave(); // flush pending save
        }

        if (configChannel) {
            try { configChannel.onmessage = null; } catch(e) {}
            try { configChannel.close(); } catch(e) {}
            configChannel = null;
        }
        if (legacyConfigChannel) {
            try { legacyConfigChannel.onmessage = null; } catch(e) {}
            try { legacyConfigChannel.close(); } catch(e) {}
            legacyConfigChannel = null;
        }
        window.removeEventListener("storage", handleStorageEvent);
        window.removeEventListener('beforeunload', destroy);
        listeners.length = 0;
        lastSnapshotKey = null;
        lastSnapshotTime = 0;
        clearInterval(dedupeCleanupInterval);
        // Unregister from runtime
        if (HAS_EVENT_RUNTIME && window.EventRuntime) {
            window.EventRuntime.stopOverlayHeartbeat(OVERLAY_NAME);
            window.EventRuntime.unregisterOverlay(OVERLAY_NAME);
            log('log', 'overlay desregistrado del runtime:', OVERLAY_NAME);
        }
        log('log', 'destroy() completado');
    }

    window.addEventListener('beforeunload', destroy);

    // ============================================================
    // 3. CLONE HELPER (structuredClone con fallback)
    // ============================================================
    function safeClone(obj) {
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(obj);
            } catch (e) {
                // fallback
            }
        }
        return JSON.parse(JSON.stringify(obj));
    }

    // ============================================================
    // PUBLIC API (preserved + enhanced)
    // ============================================================
    window.OverlayConfig = {

        get(){
            return safeClone(data);
        },

        set(patch){
            if (!patch || typeof patch !== 'object') {
                log('warn', 'set() ignorado — payload inválido');
                return;
            }
            // 3. Clone defensively using structuredClone when available
            const safePatch = safeClone(patch);
            mergeDeep(data, safePatch);
            _ignoreStorageUpdate = true;
            save();
            notify();
            _ignoreStorageUpdate = false;
        },

        subscribe(fn){
            if (typeof fn !== 'function') {
                log('warn', 'subscribe() ignorado — no es función');
                return function(){};
            }
            // Prevent duplicate listeners
            if (!listeners.includes(fn)) {
                listeners.push(fn);
            }
            try{ fn(safeClone(data)); }catch(e){}
            // Return unsubscribe function
            return function() {
                const index = listeners.indexOf(fn);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            };
        },

        // New public APIs for modular system
        destroy: destroy,
        getEventId: function() { return EVENT_ID; },
        getMode: function() { return HAS_EVENT_RUNTIME ? 'modular' : 'legacy'; }

    };

    load();
    save();

    log('log', 'inicializado — modo:', HAS_EVENT_RUNTIME ? 'MODULAR' : 'LEGACY', 'overlay:', OVERLAY_NAME);

})();