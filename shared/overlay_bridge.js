(function() {
    if (window.OverlayBridge) return;

    // ============================================================
    // 1. EVENT ISOLATION & MODULAR ARCHITECTURE
    // ============================================================
    const HAS_EVENT_RUNTIME = !!window.EventRuntime;
    const EVENT_ID = HAS_EVENT_RUNTIME ? window.EventRuntime.eventId : null;
    const EVENT_PREFIX = EVENT_ID ? `[${EVENT_ID.toUpperCase()}]` : '[LEGACY]';

    // ============================================================
    // 2. AUTO-DETECT OVERLAY NAME FROM PATHNAME (sanitizado)
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
                // 2. Sanitizar: solo alfanumérico, guion bajo y guion medio
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

    // ============================================================
    // CENTRALIZED CHANNEL / STORAGE KEYS
    // ============================================================
    function getCommandChannelName() {
        return HAS_EVENT_RUNTIME ? window.EventRuntime.channels.commands : 'pubgm_commands';
    }

    function getManualCmdKey() {
        return HAS_EVENT_RUNTIME ? window.EventRuntime.storageKeys.manualCmd : 'overlay_manual_cmd';
    }

    // ============================================================
    // LOGS — respetar debug flag de EventRuntime
    // ============================================================
    function log(level, ...args) {
        const prefix = `[OverlayBridge]${EVENT_PREFIX}`;
        if (HAS_EVENT_RUNTIME && window.EventRuntime && window.EventRuntime.config && !window.EventRuntime.config.debug) {
            if (level !== 'error' && level !== 'warn') return;
        }
        if (level === 'error' && typeof console !== 'undefined' && console.error) {
            console.error(prefix, ...args);
        } else if (level === 'warn' && typeof console !== 'undefined' && console.warn) {
            console.warn(prefix, ...args);
        } else if (typeof console !== 'undefined' && console.log) {
            console.log(prefix, ...args);
        }
    }

    // ============================================================
    // ORIGINAL BRIDGE STATE (preserved exactly)
    // ============================================================
    let commandChannel = null;
    const BRIDGE_ID = Math.random().toString(36).slice(2);
    const recentCommands = new Map();
    const overlayBusListeners = [];
    const DEDUPE_MS = 150;
    let wired = false;
    let destroyed = false; // 3. guard global

    // PROBLEM 4 FIX: per-event flood throttling
    const lastCommandTimes = new Map();
    const FLOOD_MS = 30;

    // ============================================================
    // LEGACY BRIDGE — ONLY created in modular mode
    // ============================================================
    let legacyChannel = null;
    if (HAS_EVENT_RUNTIME) {
        try {
            legacyChannel = new BroadcastChannel('pubgm_commands');
            log('log', 'Legacy bridge canal creado (pubgm_commands)');
        } catch (e) {
            // silent — legacy bridge is optional
        }
    }

    // 8. Whitelist mínima para legacy bridge (evita reenviar payloads enormes)
    function broadcastLegacy(payload) {
        if (!legacyChannel) return;
        try {
            const minimal = {
                type: payload.type,
                cmd: payload.cmd,
                command: payload.command,
                eventId: payload.eventId,
                timestamp: Date.now(),
                _bridgeId: BRIDGE_ID,
                _legacyBridge: true
            };
            legacyChannel.postMessage(minimal);
        } catch(e) {}
    }

    // ============================================================
    // 6. DEDUPE — lightweight key (NO stringify completo)
    // ============================================================
    function makeDedupeKey(payload) {
        const cmd = payload.command || payload.cmd || '';
        const eventScope = payload.eventId || '__legacy__';
        // Usar timestamp redondeado a 50ms para agrupar ráfagas
        const ts = Math.floor((payload.timestamp || Date.now()) / 50);
        // Incluir teamId si existe (comandos de equipo)
        const teamId = payload.teamId || payload.teamID || 0;
        return eventScope + '::' + cmd + '::' + teamId + '::' + ts;
    }

    function isDuplicate(key) {
        const expiry = recentCommands.get(key);
        if (expiry && Date.now() < expiry) return true;
        recentCommands.set(key, Date.now() + DEDUPE_MS);
        // 7. Cleanup threshold subido a 200
        if (recentCommands.size > 200) {
            const now = Date.now();
            recentCommands.forEach((exp, k) => {
                if (exp < now) recentCommands.delete(k);
            });
        }
        return false;
    }

    // Periodic cleanup of expired dedupe entries
    function cleanExpiredDedupe() {
        const now = Date.now();
        recentCommands.forEach((exp, k) => {
            if (exp < now) recentCommands.delete(k);
        });
    }
    const dedupeCleanupInterval = setInterval(cleanExpiredDedupe, 5000);

    try {
        commandChannel = new BroadcastChannel(getCommandChannelName());
        log('log', 'BroadcastChannel iniciado en', getCommandChannelName(), 'id=' + BRIDGE_ID);
    } catch (e) {
        log('warn', 'BroadcastChannel no disponible', e);
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
    // EVENT VALIDATION
    // ============================================================
    function shouldProcessPayload(payload) {
        if (!payload || typeof payload !== 'object') return false;
        if (payload.type && payload.type !== 'command') return false;
        if (!HAS_EVENT_RUNTIME) return true;
        if (!payload.eventId) return true;
        if (payload.eventId !== EVENT_ID) {
            log('log', 'IGNORADO — eventId mismatch:', payload.eventId, '!==', EVENT_ID);
            return false;
        }
        return true;
    }

    // ============================================================
    // COMMAND PROCESSING
    // ============================================================
    function processCommand(rawPayload, shouldBroadcast) {
        const payload = Object.assign({}, rawPayload);

        if (!shouldProcessPayload(payload)) return;
        if (!payload || typeof payload !== 'object') return;

        const cmd = payload.command || payload.cmd;
        if (!cmd || typeof cmd !== 'string' || cmd.trim() === '') return;
        payload.command = cmd;

        // PROBLEM 4 FIX: per-event/cmd flood throttling
        const floodKey = (payload.eventId || '__legacy__') + '::' + cmd;
        const now = Date.now();
        const lastTime = lastCommandTimes.get(floodKey) || 0;
        if (now - lastTime < FLOOD_MS) return;
        lastCommandTimes.set(floodKey, now);

        // 5. DEDUPE ANTES de marcar procesado
        const key = makeDedupeKey(payload);
        if (isDuplicate(key)) {
            log('log', 'duplicado ignorado:', payload.command);
            return;
        }

        // 5. Marcar procesado SOLO después de pasar dedupe
        payload._processedByBridge = true;

        // 9. Usar window.OverlayBus explícito
        if (window.OverlayBus) {
            window.OverlayBus.emit(payload.command, payload);
            log('log', 'comando emitido en bus:', payload.command);
        } else {
            log('warn', 'OverlayBus no disponible');
        }

        // Authority check: solo authority puede broadcastear
        if (shouldBroadcast && commandChannel) {
            if (HAS_EVENT_RUNTIME && !isAuthority()) {
                log('log', 'broadcast bloqueado — no authority:', OVERLAY_NAME);
                return;
            }

            const broadcastPayload = Object.assign({}, payload, {
                type: 'command',
                _bridgeId: BRIDGE_ID,
                timestamp: Date.now()
            });
            if (HAS_EVENT_RUNTIME && !broadcastPayload.eventId) {
                broadcastPayload.eventId = EVENT_ID;
            }
            commandChannel.postMessage(broadcastPayload);
            log('log', 'comando broadcast:', payload.command);

            // Legacy bridge con payload mínimo
            broadcastLegacy(broadcastPayload);
        }
    }

    // ============================================================
    // STORAGE LISTENER
    // ============================================================
    function handleStorageEvent(e) {
        const manualKey = getManualCmdKey();
        const legacyKey = 'overlay_manual_cmd';

        if (e.key !== manualKey && e.key !== legacyKey) return;
        if (HAS_EVENT_RUNTIME && e.key === legacyKey) return;

        if (!e.newValue) return;
        try {
            const payload = JSON.parse(e.newValue);
            processCommand(payload, true);
        } catch (err) {
            log('error', 'Error parsing storage command', err);
        }
    }

    window.addEventListener('storage', handleStorageEvent);

    // ============================================================
    // BROADCASTCHANNEL LISTENERS
    // ============================================================
    if (commandChannel) {
        commandChannel.onmessage = function(event) {
            const data = event.data;
            if (!data) return;
            if (data._bridgeId === BRIDGE_ID) return;
            if (!shouldProcessPayload(data)) return;

            const cmd = data.cmd || data.command;
            if (!cmd) return;
            const payload = Object.assign({}, data, { command: cmd });
            processCommand(payload, false);
        };
    }

    if (legacyChannel) {
        legacyChannel.onmessage = function(event) {
            const data = event.data;
            if (!data) return;
            if (data._bridgeId === BRIDGE_ID) return;
            if (data._legacyBridge) return;
            if (!shouldProcessPayload(data)) return;

            const cmd = data.cmd || data.command;
            if (!cmd) return;
            const payload = Object.assign({}, data, { command: cmd });
            processCommand(payload, false);
        };
    }

    // ============================================================
    // CLEANUP
    // ============================================================
    function destroy() {
        // 4. Guard contra doble ejecución
        if (destroyed) return;
        destroyed = true;

        if (commandChannel) {
            commandChannel.close();
            commandChannel = null;
        }
        if (legacyChannel) {
            legacyChannel.close();
            legacyChannel = null;
        }
        if (typeof dedupeCleanupInterval !== 'undefined' && dedupeCleanupInterval) {
            clearInterval(dedupeCleanupInterval);
        }
        if (window.OverlayBus && typeof window.OverlayBus.off === 'function' && typeof overlayBusListeners !== 'undefined') {
            overlayBusListeners.forEach(function(entry) {
                try { window.OverlayBus.off(entry.cmd, entry.wrapped); } catch(e) {}
            });
        }
        if (HAS_EVENT_RUNTIME && window.EventRuntime) {
            window.EventRuntime.stopOverlayHeartbeat(OVERLAY_NAME);
            window.EventRuntime.unregisterOverlay(OVERLAY_NAME);
            log('log', 'overlay desregistrado del runtime:', OVERLAY_NAME);
        }
        window.removeEventListener('storage', handleStorageEvent);
        window.removeEventListener('beforeunload', destroy);
        log('log', 'destroy() completado — canales cerrados, listeners removidos');
    }

    window.addEventListener('beforeunload', destroy);

    // ============================================================
    // CONFIG WIRING
    // ============================================================
    let wireRetries = 0;
    const MAX_WIRE_RETRIES = 200;

    function wireCommandToConfig() {
        // 3. Guard destroyed + guard wired
        if (destroyed || wired) return;

        if (!window.OverlayBus || !window.OverlayConfig) {
            wireRetries++;
            if (wireRetries > MAX_WIRE_RETRIES) {
                log('warn', 'wireCommandToConfig: max retries alcanzado');
                return;
            }
            setTimeout(wireCommandToConfig, 50);
            return;
        }

        wired = true;

        function safeEmit(cmd, handler) {
            const wrapped = function(payload) {
                if (!shouldProcessPayload(payload)) return;
                handler(payload);
            };
            overlayBusListeners.push({ cmd, wrapped });
            window.OverlayBus.on(cmd, wrapped);
        }

        safeEmit('set_display_mode', function(payload) {
            if (!payload) return;
            const mode = payload.mode === 'individual' ? 'individual' : 'team';
            const current = OverlayConfig.get()?.display?.displayMode;
            if (current === mode) return;
            OverlayConfig.set({ display: { displayMode: mode } });
            log('log', 'display_mode →', mode);
        });

        safeEmit('display_mode_individual', function() {
            if (OverlayConfig.get()?.display?.displayMode === 'individual') return;
            OverlayConfig.set({ display: { displayMode: 'individual' } });
        });

        safeEmit('display_mode_team', function() {
            if (OverlayConfig.get()?.display?.displayMode === 'team') return;
            OverlayConfig.set({ display: { displayMode: 'team' } });
        });

        safeEmit('alert_firstKill_on', () => OverlayConfig.set({ alerts: { firstKill: true } }));
        safeEmit('alert_firstKill_off', () => OverlayConfig.set({ alerts: { firstKill: false } }));
        safeEmit('alert_firstGrenade_on', () => OverlayConfig.set({ alerts: { firstGrenade: true } }));
        safeEmit('alert_firstGrenade_off', () => OverlayConfig.set({ alerts: { firstGrenade: false } }));
        safeEmit('alert_teamEliminated_on', () => OverlayConfig.set({ alerts: { teamEliminated: true } }));
        safeEmit('alert_teamEliminated_off', () => OverlayConfig.set({ alerts: { teamEliminated: false } }));
        safeEmit('alert_zone_on', () => OverlayConfig.set({ alerts: { zone: true } }));
        safeEmit('alert_zone_off', () => OverlayConfig.set({ alerts: { zone: false } }));

        safeEmit('ui_dropsRoutes_on', () => OverlayConfig.set({ ui: { showDropsRoutes: true } }));
        safeEmit('ui_dropsRoutes_off', () => OverlayConfig.set({ ui: { showDropsRoutes: false } }));
        safeEmit('ui_throwables_on', () => OverlayConfig.set({ ui: { showThrowables: true } }));
        safeEmit('ui_throwables_off', () => OverlayConfig.set({ ui: { showThrowables: false } }));
        safeEmit('ui_teamTable_on', () => OverlayConfig.set({ ui: { showTeamTable: true } }));
        safeEmit('ui_teamTable_off', () => OverlayConfig.set({ ui: { showTeamTable: false } }));

        safeEmit('col_pp_on', () => OverlayConfig.set({ columns: { showPP: true } }));
        safeEmit('col_pp_off', () => OverlayConfig.set({ columns: { showPP: false } }));
        safeEmit('col_total_on', () => OverlayConfig.set({ columns: { showTotal: true } }));
        safeEmit('col_total_off', () => OverlayConfig.set({ columns: { showTotal: false } }));

        safeEmit('set_scoring', function(payload) {
            if (!payload) return;
            const patch = {};
            if (payload.pp !== undefined) patch.pp = payload.pp;
            if (payload.pePerKill !== undefined) patch.pePerKill = Number(payload.pePerKill);
            if (payload.bonusEnabled !== undefined) patch.bonusEnabled = !!payload.bonusEnabled;
            if (payload.bonus !== undefined) patch.bonus = payload.bonus;
            OverlayConfig.set({ scoring: patch });
            log('log', 'set_scoring →', patch);
        });

        log('log', 'comando→config listeners activos');
    }

    wireCommandToConfig();

    // ============================================================
    // PUBLIC API
    // ============================================================
    window.OverlayBridge = {
        // 10. Validar payload en dispatch
        dispatch: function(payload) {
            if (!payload || typeof payload !== 'object') {
                log('warn', 'dispatch ignorado — payload inválido');
                return;
            }
            if (HAS_EVENT_RUNTIME && !payload.eventId) {
                payload = Object.assign({}, payload, { eventId: EVENT_ID });
            }
            processCommand(payload, true);
        },
        destroy: destroy,
        getEventId: function() { return EVENT_ID; },
        getMode: function() { return HAS_EVENT_RUNTIME ? 'modular' : 'legacy'; },
        _overlayName: OVERLAY_NAME,
        _isAuthority: isAuthority
    };

    log('log', 'inicializado — modo:', HAS_EVENT_RUNTIME ? 'MODULAR' : 'LEGACY', 'overlay:', OVERLAY_NAME);
})();