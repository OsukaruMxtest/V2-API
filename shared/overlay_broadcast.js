/*
 * overlay_broadcast.js
 * Broadcast Overlay Architecture for PUBG Mobile Esports
 * Production-grade module for synchronizing multiple OBS Browser Sources
 * via BroadcastChannel.
 *
 * This module centralizes snapshot and command distribution,
 * eliminates redundant polling, and ensures resilience for long streams.
 *
 * V2.2 — Integrated with EventRuntime, legacy-safe, hardened
 * (c) 2025 PUBG Mobile Esports Engineering
 */

(function(global) {
    'use strict';

    // ============================================================
    // EVENT ISOLATION & MODULAR ARCHITECTURE
    // ============================================================
    const HAS_EVENT_RUNTIME = !!global.EventRuntime;
    const EVENT_ID = HAS_EVENT_RUNTIME ? global.EventRuntime.eventId : null;
    const EVENT_PREFIX = EVENT_ID ? `[${EVENT_ID.toUpperCase()}]` : '[LEGACY]';

    // ============================================================
    // AUTO-DETECT OVERLAY NAME FROM PATHNAME (sanitizado)
    // ============================================================
    function detectOverlayName() {
        try {
            const pathname = (global.location && global.location.pathname) || '';
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
        if (!HAS_EVENT_RUNTIME || !global.EventRuntime) return true;
        return global.EventRuntime.getAuthority() === OVERLAY_NAME;
    }

    /**
     * Logger with event context.
     * Respects EventRuntime.config.debug when available.
     * @private
     */
    function log(level, ...args) {
        const prefix = `[OverlayBroadcast]${EVENT_PREFIX}`;
        const debug = HAS_EVENT_RUNTIME && global.EventRuntime && global.EventRuntime.config && global.EventRuntime.config.debug;
        if (level === 'error' && typeof console !== 'undefined' && console.error) {
            console.error(prefix, ...args);
        } else if (level === 'warn' && typeof console !== 'undefined' && console.warn) {
            console.warn(prefix, ...args);
        } else if ((DEBUG || debug) && typeof console !== 'undefined' && console.log) {
            console.log(prefix, ...args);
        }
    }

    /**
     * Get namespaced channel name.
     * @private
     * @param {string} type - 'snapshot', 'commands', or 'heartbeat'
     * @returns {string}
     */
    function getChannelName(type) {
        return HAS_EVENT_RUNTIME ? global.EventRuntime.channels[type] : 'pubgm_' + type;
    }

    // 10. Object lookup para validación de tipos (más rápido que .includes)
    const VALID_TYPES = {
        snapshot: true,
        command: true,
        heartbeat: true
    };

    /**
     * Validate payload for event isolation.
     * @private
     * @param {*} payload
     * @returns {boolean}
     */
    function shouldProcessPayload(payload) {
        if (!payload || typeof payload !== 'object') return false;
        // Hardening: only accept command/snapshot/heartbeat types
        if (payload.type && !VALID_TYPES[payload.type]) return false;
        // Legacy mode: accept everything
        if (!HAS_EVENT_RUNTIME) return true;
        // No eventId: assume legacy compat
        if (!payload.eventId) return true;
        // Mismatch: reject (isolation)
        if (payload.eventId !== EVENT_ID) {
            log('log', 'IGNORADO — eventId mismatch:', payload.eventId, '!==', EVENT_ID);
            return false;
        }
        return true;
    }

    /**
     * Unique identifier for this overlay instance.
     * Used to ignore self-sent messages and prevent echo loops.
     */
    const SENDER_ID = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

    /**
     * Debug flag – set to true in development for detailed logs.
     */
    const DEBUG = typeof window !== 'undefined' && window.DEBUG_OVERLAY === true;

    /**
     * Core module state.
     * @private
     */
    const _state = {
        currentSnapshot: null,
        lastSnapshotKeys: new Map(),
        lastCommandTimestamps: new Map(),
        snapshotCallbacks: [],
        commandCallbacks: [],
        heartbeatCallbacks: [],
        heartbeatIntervalId: null,
        isInitialized: false,
        channels: {
            snapshot: null,
            commands: null,
            heartbeat: null
        }
    };

    // Legacy compatibility bridge channels (only created in modular mode)
    let _legacyChannels = {
        snapshot: null,
        commands: null,
        heartbeat: null
    };

    /**
     * Safely log errors without disrupting OBS.
     * @private
     * @param {*} err
     */
    function _logError(err) {
        if (typeof console !== 'undefined' && console.error) {
            console.error('[OverlayBroadcast]' + EVENT_PREFIX, err);
        }
    }

    /**
     * Generate a unique key for a snapshot without heavy stringification.
     * Uses snapshot.CurrentTime if available, otherwise GameID + player count.
     * @private
     * @param {*} snapshot
     * @returns {string|null}
     */
    function _getSnapshotKey(snapshot) {
        if (!snapshot) return null;

        // Common PUBG snapshot structures: sometimes allinfo contains the actual data
        const allinfo = snapshot.allinfo || snapshot;

        // If CurrentTime exists, it's the most reliable unique timestamp
        if (allinfo.CurrentTime !== undefined) {
            return `t:${allinfo.CurrentTime}`;
        }

        // If GameID and player list exist, combine them for a reasonable unique key
        if (allinfo.GameID && Array.isArray(allinfo.TotalPlayerList)) {
            return `g:${allinfo.GameID}:p:${allinfo.TotalPlayerList.length}`;
        }

        // 3. Fallback más estable (evita Date.now() que rompe dedupe)
        return `fallback:${allinfo.GameID || 'x'}:p:${(allinfo.TotalPlayerList && allinfo.TotalPlayerList.length) || 0}`;
    }

    /**
     * Create a BroadcastChannel with fallback.
     * @private
     * @param {string} name
     * @returns {BroadcastChannel|null}
     */
    function _createChannel(name) {
        try {
            return new BroadcastChannel(name);
        } catch (err) {
            _logError('BroadcastChannel not supported for ' + name + ': ' + err.message);
            return null;
        }
    }

    // ============================================================
    // DESTROY GUARD
    // ============================================================
    let destroyed = false;

    /**
     * Initialize BroadcastChannels and set up message listeners.
     * Called automatically when script loads, but can be called manually to reinitialize.
     * @public
     */
    function init() {
        if (_state.isInitialized) {
            _logError('OverlayBroadcast already initialized. Call destroy() first if you need to reinitialize.');
            return;
        }

        // 1. Permitir reinicialización tras destroy previo
        destroyed = false;

        // Create modular channels (namespaced by event)
        _state.channels.snapshot = _createChannel(getChannelName('snapshot'));
        _state.channels.commands = _createChannel(getChannelName('commands'));
        _state.channels.heartbeat = _createChannel(getChannelName('heartbeat'));

        // Legacy compatibility bridge (only in modular mode)
        if (HAS_EVENT_RUNTIME) {
            _legacyChannels.snapshot = _createChannel('pubgm_snapshot');
            _legacyChannels.commands = _createChannel('pubgm_commands');
            _legacyChannels.heartbeat = _createChannel('pubgm_heartbeat');
            log('log', 'Legacy bridge channels creados');
        }

        // Set up message handlers for modular channels
        if (_state.channels.snapshot) {
            _state.channels.snapshot.onmessage = function(event) {
                _handleSnapshotMessage(event.data);
            };
        }

        if (_state.channels.commands) {
            _state.channels.commands.onmessage = function(event) {
                _handleCommandMessage(event.data);
            };
        }

        if (_state.channels.heartbeat) {
            _state.channels.heartbeat.onmessage = function(event) {
                _handleHeartbeatMessage(event.data);
            };
        }

        // Set up message handlers for legacy bridge channels (only receive, no rebroadcast)
        if (_legacyChannels.snapshot) {
            _legacyChannels.snapshot.onmessage = function(event) {
                const data = event.data;
                if (!data || data._legacyBridge) return;
                _handleSnapshotMessage(data);
            };
        }

        if (_legacyChannels.commands) {
            _legacyChannels.commands.onmessage = function(event) {
                const data = event.data;
                if (!data || data._legacyBridge) return;
                _handleCommandMessage(data);
            };
        }

        if (_legacyChannels.heartbeat) {
            _legacyChannels.heartbeat.onmessage = function(event) {
                const data = event.data;
                if (!data || data._legacyBridge) return;
                _handleHeartbeatMessage(data);
            };
        }

        _state.isInitialized = true;

        // Register overlay in runtime
        if (HAS_EVENT_RUNTIME && global.EventRuntime) {
            global.EventRuntime.registerOverlay(OVERLAY_NAME);
            global.EventRuntime.startOverlayHeartbeat(OVERLAY_NAME, 3000);
            log('log', 'overlay registrado en runtime:', OVERLAY_NAME);
        }

        // Register cleanup on page unload
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', destroy);
        }

        log('log', 'inicializado — modo:', HAS_EVENT_RUNTIME ? 'MODULAR' : 'LEGACY');
    }

    /**
     * Clean up resources: close channels, clear intervals, remove listeners.
     * @public
     */
    function destroy() {
        if (destroyed) return;
        destroyed = true;

        if (_state.heartbeatIntervalId) {
            clearInterval(_state.heartbeatIntervalId);
            _state.heartbeatIntervalId = null;
        }

        // Close all modular channels
        Object.keys(_state.channels).forEach(key => {
            const ch = _state.channels[key];
            if (ch) {
                try { ch.onmessage = null; } catch (e) {}
                if (typeof ch.close === 'function') {
                    try { ch.close(); } catch (e) {}
                }
            }
            _state.channels[key] = null;
        });

        // Close all legacy bridge channels
        Object.keys(_legacyChannels).forEach(key => {
            const ch = _legacyChannels[key];
            if (ch) {
                try { ch.onmessage = null; } catch (e) {}
                if (typeof ch.close === 'function') {
                    try { ch.close(); } catch (e) {}
                }
            }
            _legacyChannels[key] = null;
        });

        // Remove beforeunload listener
        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', destroy);
        }

        // Unregister from runtime
        if (HAS_EVENT_RUNTIME && global.EventRuntime) {
            global.EventRuntime.stopOverlayHeartbeat(OVERLAY_NAME);
            global.EventRuntime.unregisterOverlay(OVERLAY_NAME);
            log('log', 'overlay desregistrado del runtime:', OVERLAY_NAME);
        }

        // Cleanup maps
        _state.lastSnapshotKeys.clear();
        _state.lastCommandTimestamps.clear();

        // Reset state
        _state.snapshotCallbacks = [];
        _state.commandCallbacks = [];
        _state.heartbeatCallbacks = [];
        _state.currentSnapshot = null;
        _state.isInitialized = false;

        log('log', 'destroy() completado');
    }

    /**
     * Handle incoming snapshot messages.
     * @private
     * @param {*} message
     */
    function _handleSnapshotMessage(message) {
        // Ignore messages sent by this instance
        if (message && message.senderId === SENDER_ID) return;

        // Event isolation validation
        if (!shouldProcessPayload(message)) return;

        let snapshotData = null;
        let timestamp = 0;

        // Normalize message format (supports raw snapshot or wrapped object)
        if (message && message.type === 'snapshot' && message.data) {
            snapshotData = message.data;
            timestamp = message.timestamp || 0;
        } else {
            snapshotData = message;
            timestamp = (message && message.timestamp) ? message.timestamp : Date.now();
        }

        // Validate snapshotData: must exist and be an object (not a primitive)
        if (!snapshotData || typeof snapshotData !== 'object') return;

        // Generate key for duplicate detection
        const key = _getSnapshotKey(snapshotData);
        const eventScope = (message && message.eventId) || '__legacy__';
        if (key && key === _state.lastSnapshotKeys.get(eventScope)) {
            // Duplicate snapshot, ignore
            return;
        }

        // Update state
        _state.lastSnapshotKeys.set(eventScope, key);
        _state.currentSnapshot = snapshotData;

        // 4. Cleanup ligero de lastSnapshotKeys para evitar memory leak
        if (_state.lastSnapshotKeys.size > 50) {
            const firstKey = _state.lastSnapshotKeys.keys().next().value;
            _state.lastSnapshotKeys.delete(firstKey);
        }

        // Notify all snapshot subscribers safely
        for (const cb of _state.snapshotCallbacks) {
            try {
                cb(snapshotData);
            } catch (err) {
                _logError('Snapshot callback error: ' + err.message);
            }
        }
    }

    /**
     * Handle incoming command messages.
     * @private
     * @param {*} message
     */
    function _handleCommandMessage(message) {
        if (!message || message.senderId === SENDER_ID) return;

        // Event isolation validation
        if (!shouldProcessPayload(message)) return;

        if (message.type !== 'command' || !message.cmd) return;

        // 5. Per-event + per-cmd timestamp dedupe (evita perder comandos distintos mismo timestamp)
        const eventScope = (message.eventId || '__legacy__') + '::' + message.cmd;
        const ts = message.timestamp || 0;
        const lastTs = _state.lastCommandTimestamps.get(eventScope) || 0;
        if (ts <= lastTs) return;

        _state.lastCommandTimestamps.set(eventScope, ts);

        // Notify command subscribers safely
        for (const cb of _state.commandCallbacks) {
            try {
                cb(message.cmd, message);
            } catch (err) {
                _logError('Command callback error: ' + err.message);
            }
        }
    }

    /**
     * Handle incoming heartbeat messages.
     * @private
     * @param {*} message
     */
    function _handleHeartbeatMessage(message) {
        if (!message || message.senderId === SENDER_ID) return;

        // Event isolation validation
        if (!shouldProcessPayload(message)) return;

        if (message.type !== 'heartbeat') return;

        // Notify heartbeat subscribers (if any) safely
        for (const cb of _state.heartbeatCallbacks) {
            try {
                cb(message);
            } catch (err) {
                _logError('Heartbeat callback error: ' + err.message);
            }
        }
    }

    /**
     * Broadcast a snapshot to all overlays.
     * Should be called by the leader overlay.
     * @public
     * @param {*} snapshot - The snapshot data (any JSON-serializable format)
     * @returns {boolean} - True if broadcast succeeded, false otherwise
     */
    function broadcastSnapshot(snapshot) {
        if (!snapshot) return false;
        if (typeof snapshot !== 'object') return false;

        // Authority check
        if (HAS_EVENT_RUNTIME && !isAuthority()) {
            log('log', 'broadcastSnapshot bloqueado — no authority:', OVERLAY_NAME);
            return false;
        }

        // 6. Heurística de tamaño (evita stringify completo)
        const playerCount = (snapshot.TotalPlayerList && snapshot.TotalPlayerList.length) || 0;
        if (playerCount > 200) {
            log('warn', 'Snapshot con muchos jugadores:', playerCount);
        }

        // Prepare wrapped message with type and timestamp
        const message = {
            type: 'snapshot',
            data: snapshot,
            timestamp: Date.now(),
            senderId: SENDER_ID
        };

        // Inject eventId in modular mode
        if (HAS_EVENT_RUNTIME) {
            message.eventId = EVENT_ID;
        }

        // Update local state immediately (leader doesn't need to wait for loopback)
        const key = _getSnapshotKey(snapshot);
        if (key) {
            _state.lastSnapshotKey = key;
        }
        _state.currentSnapshot = snapshot;

        // Send via modular BroadcastChannel
        let sent = false;
        if (_state.channels.snapshot) {
            try {
                _state.channels.snapshot.postMessage(message);
                sent = true;
            } catch (err) {
                _logError('broadcastSnapshot error: ' + err.message);
            }
        }

        // 9. Legacy bridge: enviar solo metadata mínima (NO snapshot completo)
        if (_legacyChannels.snapshot) {
            try {
                const legacyMessage = {
                    type: 'snapshot',
                    _legacyBridge: true,
                    _metaOnly: true,
                    eventId: message.eventId,
                    timestamp: message.timestamp,
                    senderId: SENDER_ID,
                    playerCount: playerCount,
                    gameId: (snapshot.allinfo || snapshot).GameID || null
                };
                _legacyChannels.snapshot.postMessage(legacyMessage);
            } catch (err) {
                _logError('broadcastSnapshot legacy error: ' + err.message);
            }
        }

        return sent;
    }

    /**
     * Broadcast a command to all overlays.
     * @public
     * @param {string} cmd - Command string (e.g., 'showFinal', 'hideAll')
     * @param {object} [extraData] - Optional extra payload data (V2.2)
     * @returns {boolean} - True if broadcast succeeded
     */
    function broadcastCommand(cmd, extraData) {
        if (!cmd || typeof cmd !== 'string') return false;

        // Authority check
        if (HAS_EVENT_RUNTIME && !isAuthority()) {
            log('log', 'broadcastCommand bloqueado — no authority:', OVERLAY_NAME);
            return false;
        }

        const message = {
            type: 'command',
            cmd: cmd,
            timestamp: Date.now(),
            senderId: SENDER_ID
        };

        // 7. Merge extraData si existe (sin romper compatibilidad)
        if (extraData && typeof extraData === 'object') {
            Object.assign(message, extraData);
        }

        // Inject eventId in modular mode
        if (HAS_EVENT_RUNTIME) {
            message.eventId = EVENT_ID;
        }

        let sent = false;
        if (_state.channels.commands) {
            try {
                _state.channels.commands.postMessage(message);
                sent = true;
            } catch (err) {
                _logError('broadcastCommand error: ' + err.message);
            }
        }

        // Legacy bridge: send CLONED message with _legacyBridge mark
        if (_legacyChannels.commands) {
            try {
                const legacyMessage = Object.assign({}, message, { _legacyBridge: true });
                _legacyChannels.commands.postMessage(legacyMessage);
            } catch (err) {
                _logError('broadcastCommand legacy error: ' + err.message);
            }
        }

        return sent;
    }

    /**
     * Subscribe to snapshot updates.
     * Prevents duplicate callbacks.
     * @public
     * @param {Function} callback - Function that receives the snapshot data.
     * @returns {Function} Unsubscribe function.
     */
    function subscribeSnapshot(callback) {
        if (typeof callback !== 'function') return function() {};

        // Avoid duplicate subscriptions
        if (!_state.snapshotCallbacks.includes(callback)) {
            _state.snapshotCallbacks.push(callback);
        }

        // Immediately deliver current snapshot if available
        if (_state.currentSnapshot) {
            try {
                callback(_state.currentSnapshot);
            } catch (err) {
                _logError('Initial snapshot callback error: ' + err.message);
            }
        }

        // Return unsubscribe function
        return function() {
            const index = _state.snapshotCallbacks.indexOf(callback);
            if (index !== -1) {
                _state.snapshotCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Subscribe to command updates.
     * Prevents duplicate callbacks.
     * @public
     * @param {Function} callback - Function that receives the command string and full message.
     * @returns {Function} Unsubscribe function.
     */
    function subscribeCommand(callback) {
        if (typeof callback !== 'function') return function() {};
        if (!_state.commandCallbacks.includes(callback)) {
            _state.commandCallbacks.push(callback);
        }
        return function() {
            const index = _state.commandCallbacks.indexOf(callback);
            if (index !== -1) {
                _state.commandCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Subscribe to heartbeat messages (optional, for monitoring).
     * Prevents duplicate callbacks.
     * @public
     * @param {Function} callback
     * @returns {Function} Unsubscribe function.
     */
    function subscribeHeartbeat(callback) {
        if (typeof callback !== 'function') return function() {};
        if (!_state.heartbeatCallbacks.includes(callback)) {
            _state.heartbeatCallbacks.push(callback);
        }
        return function() {
            const index = _state.heartbeatCallbacks.indexOf(callback);
            if (index !== -1) {
                _state.heartbeatCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Get the last valid snapshot stored.
     * @public
     * @returns {*} The last snapshot, or null if none.
     */
    function getCurrentSnapshot() {
        return _state.currentSnapshot;
    }

    /**
     * Start sending heartbeat messages (leader only).
     * @public
     * @param {number} intervalMs - Milliseconds between heartbeats (default 3000).
     * @returns {boolean} True if heartbeat started, false if already running or no channel.
     */
    function startHeartbeat(intervalMs) {
        intervalMs = (typeof intervalMs === 'number' && intervalMs > 0) ? intervalMs : 3000;
        // 2. Clamp mínimo 500ms
        intervalMs = Math.max(500, intervalMs);

        if (_state.heartbeatIntervalId) {
            _logError('Heartbeat already running. Call stopHeartbeat() first if you want to restart.');
            return false;
        }
        if (!_state.channels.heartbeat) return false;

        // Authority check
        if (HAS_EVENT_RUNTIME && !isAuthority()) {
            log('log', 'startHeartbeat bloqueado — no authority:', OVERLAY_NAME);
            return false;
        }

        let lastSent = Date.now();

        _state.heartbeatIntervalId = setInterval(() => {
            const now = Date.now();
            // Freeze-safe: si el intervalo se ejecutó muy rápido (acumulación post-freeze), skip
            if (now - lastSent < intervalMs * 0.5) {
                return;
            }
            lastSent = now;

            const message = {
                type: 'heartbeat',
                timestamp: now,
                senderId: SENDER_ID
            };
            // Inject eventId in modular mode
            if (HAS_EVENT_RUNTIME) {
                message.eventId = EVENT_ID;
            }
            try {
                _state.channels.heartbeat.postMessage(message);
            } catch (err) {
                _logError('Heartbeat send error: ' + err.message);
            }
            // Legacy bridge: send CLONED message with _legacyBridge mark
            if (_legacyChannels.heartbeat) {
                try {
                    const legacyMessage = Object.assign({}, message, { _legacyBridge: true });
                    _legacyChannels.heartbeat.postMessage(legacyMessage);
                } catch (err) {
                    _logError('Heartbeat legacy send error: ' + err.message);
                }
            }
        }, intervalMs);

        return true;
    }

    /**
     * Stop sending heartbeats (leader only).
     * @public
     */
    function stopHeartbeat() {
        if (_state.heartbeatIntervalId) {
            clearInterval(_state.heartbeatIntervalId);
            _state.heartbeatIntervalId = null;
        }
    }

    /**
     * Check if this overlay instance is the leader (by whether it sends heartbeats).
     * @public
     * @returns {boolean}
     */
    function isLeader() {
        return _state.heartbeatIntervalId !== null;
    }

    // Public API
    const OverlayBroadcast = {
        init,
        destroy,
        broadcastSnapshot,
        broadcastCommand,
        subscribeSnapshot,
        subscribeCommand,
        subscribeHeartbeat,
        getCurrentSnapshot,
        startHeartbeat,
        stopHeartbeat,
        isLeader,
        // New public APIs for modular system
        getEventId: function() { return EVENT_ID; },
        getMode: function() { return HAS_EVENT_RUNTIME ? 'modular' : 'legacy'; },
        // Expose senderId and overlay name for debugging
        _senderId: SENDER_ID,
        _overlayName: OVERLAY_NAME,
        _isAuthority: isAuthority
    };

    // Auto-initialize when script loads, but defer to ensure all scripts are ready
    let autoInitScheduled = false;
    if (typeof window !== 'undefined') {
        if (!autoInitScheduled) {
            autoInitScheduled = true;
            setTimeout(function() {
                if (!_state.isInitialized) init();
            }, 0);
        }
    } else {
        if (!_state.isInitialized) init();
    }

    // Expose globally
    global.OverlayBroadcast = OverlayBroadcast;

})(typeof window !== 'undefined' ? window : this);