const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const ArchiverLib = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// DIRECTORIOS Y ARCHIVOS (Team Manager)
// ============================================
const PUBLIC_DIR = path.join(__dirname, "public");
const LOGOS_DIR = path.join(__dirname, "logos");
const DATA_DIR = path.join(__dirname, "data");
const TEAMS_FILE = path.join(DATA_DIR, "equipos.json");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const PLAYERS_LOGOS_DIR = path.join(LOGOS_DIR, "players");

// Directorios para templates y eventos
const TEMPLATES_DIR = path.join(__dirname, "templates");
const EVENTS_DIR = path.join(__dirname, "eventos");
const SHARED_DIR = path.join(__dirname, "shared");

// Crear directorios si no existen
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(LOGOS_DIR)) {
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEAMS_FILE)) {
    fs.writeFileSync(TEAMS_FILE, "[]");
}
if (!fs.existsSync(PLAYERS_LOGOS_DIR)) {
    fs.mkdirSync(PLAYERS_LOGOS_DIR, { recursive: true });
}
if (!fs.existsSync(PLAYERS_FILE)) {
    fs.writeFileSync(PLAYERS_FILE, "[]");
}
if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
}
if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tournament-Token']
}));
app.options('*', cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(PUBLIC_DIR));
app.use('/logos', express.static(LOGOS_DIR));
app.use('/tools', express.static(path.join(__dirname, 'tools')));

// Static routes for modular architecture with cache-control for OBS
const noStoreOptions = {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-store');
        if (filePath.endsWith('.ini')) {
            res.setHeader('Content-Type', 'text/plain');
        }
    }
};
app.use('/overlays', express.static(path.join(__dirname, 'overlays'), noStoreOptions));
app.use('/control', express.static(path.join(__dirname, 'overlays/control'), noStoreOptions));
app.use('/templates', express.static(TEMPLATES_DIR, noStoreOptions));
app.use('/shared', express.static(SHARED_DIR, noStoreOptions));
app.use('/eventos', express.static(EVENTS_DIR, noStoreOptions));

// ============================================
// FUNCIONES TEAM MANAGER
// ============================================
function readTeams() {
    try {
        return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function writeTeams(data) {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(data, null, 2));
}

function generateTeamId(teams) {
    let max = 0;
    teams.forEach(t => {
        const num = parseInt(t.teamId?.replace(/\D/g, '') || '0');
        if (num > max) max = num;
    });
    return 'T-' + String(max + 1).padStart(4, '0');
}

function validateTeam(body, isUpdate = false) {
    const errors = [];
    if (!isUpdate || body.teamName !== undefined) {
        if (!body.teamName || typeof body.teamName !== 'string' || body.teamName.trim().length === 0) {
            errors.push('teamName es requerido');
        } else if (body.teamName.trim().length > 100) {
            errors.push('teamName máximo 100 caracteres');
        }
    }
    if (body.tag !== undefined && body.tag.length > 10) {
        errors.push('tag máximo 10 caracteres');
    }
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    if (body.primaryColor !== undefined && !hexRegex.test(body.primaryColor)) {
        errors.push('primaryColor debe ser HEX válido (#RRGGBB)');
    }
    if (body.secondaryColor !== undefined && !hexRegex.test(body.secondaryColor)) {
        errors.push('secondaryColor debe ser HEX válido (#RRGGBB)');
    }
    return errors;
}

function deleteLogoFile(logoPath) {
    if (!logoPath) return;
    const cleanPath = logoPath.replace(/^\//, '');
    const fullPath = path.join(__dirname, cleanPath);
    if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
    }
}

function readPlayers() {
    try {
        return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function writePlayers(data) {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

function validatePlayer(body, isUpdate = false) {
    const errors = [];
    if (!isUpdate || body.nickname !== undefined) {
        if (!body.nickname || typeof body.nickname !== 'string' || body.nickname.trim().length === 0) {
            errors.push('nickname es requerido');
        } else if (body.nickname.trim().length > 100) {
            errors.push('nickname máximo 100 caracteres');
        }
    }
    if (!isUpdate || body.uid !== undefined) {
        if (!body.uid || typeof body.uid !== 'string' || body.uid.trim().length === 0) {
            errors.push('uid es requerido');
        } else if (body.uid.trim().length > 32) {
            errors.push('uid máximo 32 caracteres');
        }
    }
    return errors;
}

function deletePlayerLogoFile(logoPath) {
    if (!logoPath) return;
    const cleanPath = logoPath.replace(/^\//, '');
    const fullPath = path.join(__dirname, cleanPath);
    if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
    }
}

// ============================================
// MULTER CONFIG (Team Manager)
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = req.body.entityType === 'player' ? PLAYERS_LOGOS_DIR : LOGOS_DIR;
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (req.body.entityType === 'player') {
            const uid = req.body.uid || 'unknown';
            cb(null, uid + ext);
        } else {
            const teamId = req.body.teamId || 'unknown';
            const suffix = req.body.assetType === 'flag' ? 'B' : '';
            cb(null, teamId + suffix + ext);
        }
    }
});

function fileFilter(req, file, cb) {
    const isPlayer = req.body.entityType === 'player';
    const allowed = isPlayer
        ? ['image/png', 'video/webm', 'image/jpeg', 'image/webp']
        : ['image/png', 'video/webm'];
    if (!allowed.includes(file.mimetype)) {
        return cb(new Error(isPlayer ? 'Solo PNG, WEBM, JPG o WEBP permitidos' : 'Solo PNG o WEBM permitidos'));
    }
    cb(null, true);
}

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter
});

// ============================================
// TEAM MANAGER API
// ============================================
app.get('/api/teams', (req, res) => {
    try {
        res.json({ success: true, data: readTeams() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/teams', (req, res) => {
    try {
        const errors = validateTeam(req.body);
        if (errors.length) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }

        const teams = readTeams();
        const teamId = generateTeamId(teams);
        const newTeam = {
            id: uuidv4(),
            teamId,
            teamName: req.body.teamName.trim(),
            tag: (req.body.tag || '').trim(),
            logoPng: req.body.logoPng || null,
            logoWebm: req.body.logoWebm || null,
            flagPng: req.body.flagPng || null,
            flagWebm: req.body.flagWebm || null,
            primaryColor: req.body.primaryColor || '#3B82F6',
            secondaryColor: req.body.secondaryColor || '#64748B',
            createdAt: new Date().toISOString()
        };
        teams.push(newTeam);
        writeTeams(teams);
        res.status(201).json({ success: true, data: newTeam });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/teams/:id', (req, res) => {
    try {
        const errors = validateTeam(req.body, true);
        if (errors.length) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }

        const teams = readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });

        const existing = teams[idx];

        if (req.body.logoPng !== undefined && req.body.logoPng !== existing.logoPng && existing.logoPng) {
            deleteLogoFile(existing.logoPng);
        }
        if (req.body.logoWebm !== undefined && req.body.logoWebm !== existing.logoWebm && existing.logoWebm) {
            deleteLogoFile(existing.logoWebm);
        }
        if (req.body.flagPng !== undefined && req.body.flagPng !== existing.flagPng && existing.flagPng) {
            deleteLogoFile(existing.flagPng);
        }
        if (req.body.flagWebm !== undefined && req.body.flagWebm !== existing.flagWebm && existing.flagWebm) {
            deleteLogoFile(existing.flagWebm);
        }

        teams[idx] = {
            ...existing,
            teamName: req.body.teamName !== undefined ? req.body.teamName.trim() : existing.teamName,
            tag: req.body.tag !== undefined ? req.body.tag.trim() : existing.tag,
            logoPng: req.body.logoPng !== undefined ? req.body.logoPng : existing.logoPng,
            logoWebm: req.body.logoWebm !== undefined ? req.body.logoWebm : existing.logoWebm,
            flagPng: req.body.flagPng !== undefined ? req.body.flagPng : existing.flagPng,
            flagWebm: req.body.flagWebm !== undefined ? req.body.flagWebm : existing.flagWebm,
            primaryColor: req.body.primaryColor !== undefined ? req.body.primaryColor.toUpperCase() : existing.primaryColor,
            secondaryColor: req.body.secondaryColor !== undefined ? req.body.secondaryColor.toUpperCase() : existing.secondaryColor
        };
        writeTeams(teams);
        res.json({ success: true, data: teams[idx] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/teams/:id', (req, res) => {
    try {
        const teams = readTeams();
        const team = teams.find(t => t.id === req.params.id);
        if (!team) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });

        deleteLogoFile(team.logoPng);
        deleteLogoFile(team.logoWebm);
        deleteLogoFile(team.flagPng);
        deleteLogoFile(team.flagWebm);

        const filtered = teams.filter(t => t.id !== req.params.id);
        writeTeams(filtered);
        res.json({ success: true, data: { deleted: req.params.id } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/teams', (req, res) => {
    try {
        const teams = readTeams();
        teams.forEach(t => {
            deleteLogoFile(t.logoPng);
            deleteLogoFile(t.logoWebm);
            deleteLogoFile(t.flagPng);
            deleteLogoFile(t.flagWebm);
        });
        writeTeams([]);
        res.json({ success: true, data: { cleared: true, count: teams.length } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        const logoType = ext === '.png' ? 'png' : 'webm';
        const relativePath = '/logos/' + req.file.filename;
        res.json({ success: true, data: { logo: relativePath, logoType } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/upload-player', upload.single('logo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        const logoType = ext === '.png' ? 'png' : ext === '.webm' ? 'webm' : ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'webp';
        const relativePath = '/logos/players/' + req.file.filename;
        res.json({ success: true, data: { logo: relativePath, logoType } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/import', (req, res) => {
    try {
        const data = req.body;
        if (!Array.isArray(data)) return res.status(400).json({ success: false, error: 'Formato inválido: se esperaba un array' });
        const valid = data.every(d => d && typeof d.teamId === 'string' && typeof d.teamName === 'string');
        if (!valid) return res.status(400).json({ success: false, error: 'Estructura inválida en los datos' });
        writeTeams(data);
        res.json({ success: true, data: { count: data.length } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/export', (req, res) => {
    try {
        const data = readTeams();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="equipos.json"');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// PLAYER MANAGER API
// ============================================
app.get('/api/players', (req, res) => {
    try {
        res.json({ success: true, data: readPlayers() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/players', (req, res) => {
    try {
        const errors = validatePlayer(req.body);
        if (errors.length) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }

        const players = readPlayers();
        const trimmedUid = req.body.uid.trim();
        if (players.some(p => p.uid === trimmedUid)) {
            return res.status(409).json({ success: false, error: 'UID ya registrado' });
        }

        const newPlayer = {
            id: uuidv4(),
            uid: trimmedUid,
            nickname: req.body.nickname.trim(),
            nombre: (req.body.nombre || '').trim(),
            discordId: (req.body.discordId || '').trim(),
            nationality: (req.body.nationality || '').trim(),
            logo: req.body.logo || '/logos/default.png',
            logoType: req.body.logoType || 'png',
            createdAt: new Date().toISOString()
        };
        players.push(newPlayer);
        writePlayers(players);
        res.status(201).json({ success: true, data: newPlayer });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/players/:id', (req, res) => {
    try {
        const errors = validatePlayer(req.body, true);
        if (errors.length) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }

        const players = readPlayers();
        const idx = players.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

        const existing = players[idx];
        const trimmedUid = req.body.uid !== undefined ? req.body.uid.trim() : existing.uid;

        if (req.body.uid !== undefined && trimmedUid !== existing.uid) {
            if (players.some(p => p.id !== req.params.id && p.uid === trimmedUid)) {
                return res.status(409).json({ success: false, error: 'UID ya registrado' });
            }
        }

        if (req.body.logo !== undefined && req.body.logo !== existing.logo && existing.logo && existing.logo !== '/logos/default.png') {
            deletePlayerLogoFile(existing.logo);
        }

        players[idx] = {
            ...existing,
            uid: req.body.uid !== undefined ? trimmedUid : existing.uid,
            nickname: req.body.nickname !== undefined ? req.body.nickname.trim() : existing.nickname,
            nombre: req.body.nombre !== undefined ? req.body.nombre.trim() : existing.nombre,
            discordId: req.body.discordId !== undefined ? req.body.discordId.trim() : existing.discordId,
            nationality: req.body.nationality !== undefined ? req.body.nationality.trim() : existing.nationality,
            logo: req.body.logo !== undefined
                ? (req.body.logo || '/logos/default.png')
                : (existing.logo || '/logos/default.png'),
            logoType: req.body.logoType !== undefined ? req.body.logoType : existing.logoType
        };
        writePlayers(players);
        res.json({ success: true, data: players[idx] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/players/:id', (req, res) => {
    try {
        const players = readPlayers();
        const player = players.find(p => p.id === req.params.id);
        if (!player) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

        deletePlayerLogoFile(player.logo);

        const filtered = players.filter(p => p.id !== req.params.id);
        writePlayers(filtered);
        res.json({ success: true, data: { deleted: req.params.id } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// PLAYER MANAGER API - BATCH IMPORT
// ============================================
app.post('/api/players/batch', (req, res) => {
    try {
        const items = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, error: 'Se esperaba un array de jugadores' });
        }

        const players = readPlayers();
        const inserted = [];
        const duplicates = [];
        const invalid = [];
        const newPlayers = [...players];
        const seenUids = new Set(players.map(p => p.uid));

        for (const item of items) {
            const uid = (item.uid || '').trim();
            const nickname = (item.nickname || '').trim();

            if (!uid || !nickname) {
                invalid.push({ uid: uid || '', nickname: nickname || '', reason: !uid ? 'UID vacio' : 'Nickname vacio' });
                continue;
            }

            if (seenUids.has(uid)) {
                const existing = newPlayers.find(p => p.uid === uid);
                duplicates.push({
                    uid,
                    nickname,
                    existing: existing ? {
                        uid: existing.uid,
                        nickname: existing.nickname,
                        nombre: existing.nombre || '',
                        discordId: existing.discordId || '',
                        nationality: existing.nationality || ''
                    } : null,
                    reason: 'UID ya registrado'
                });
                continue;
            }

            seenUids.add(uid);

            const newPlayer = {
                id: uuidv4(),
                uid,
                nickname,
                nombre: (item.nombre || '').trim(),
                discordId: (item.discordId || '').trim(),
                nationality: (item.nationality || '').trim(),
                logo: item.logo || '/logos/default.png',
                logoType: item.logoType || 'png',
                createdAt: new Date().toISOString()
            };

            newPlayers.push(newPlayer);
            inserted.push(newPlayer);
        }

        writePlayers(newPlayers);
        res.json({ success: true, inserted, duplicates, invalid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// AGREGADOR - CONFIGURACIONES Y VARIABLES
// ============================================
const TOURNAMENT_TOKEN = process.env.TOURNAMENT_TOKEN || "V2";

const OBSERVER_TIMEOUT = 30000;
const MAX_KILLS = 3000;

const WEAPON_CACHE_TTL = 8000;
const BACKPACK_CACHE_TTL = 2000;
const WEAPON_FETCH_TIMEOUT = 1200;

const SNAPSHOT_CACHE_TTL = 150;
const MAX_OBSERVER_AGE = 5000;
const MAX_SNAPSHOT_STALE = 3000;

const CONFIG_FILE = path.join(DATA_DIR, "tournament_config.json");
const TOURNAMENT_FILE = path.join(DATA_DIR, "tournaments.json");

const observers = new Map();
let masterObserver = null;
let masterSnapshot = {};
let currentGameID = null;
let matchFinishedTime = 0;
let gameStartLockUntil = 0;

const processedMatches = new Set();

const killMap = new Map();
const killHistory = [];

let weaponCache = { timestamp: 0, data: {} };
let backpackCache = { timestamp: 0, data: null };

let matchStats = {
    grenadeKills: {},
    molotovKills: {},
    vehicleKills: {},
    longestKill: { distance: 0, team: null },
    longestRun: { distance: 0, team: null },
    longestBlueZone: { time: 0, team: null },
    players: {},
    teams: {}
};

let tournamentConfig = loadJSON(CONFIG_FILE, {
    tournament: "",
    day: 1,
    group: "A",
    match: 1,
    sendToSheets: false,
    autoMatchIncrement: true,
    lastGameId: null
});

let tournaments = loadJSON(TOURNAMENT_FILE, []);

let snapshotCache = {
    timestamp: 0,
    data: null
};
let frozenSnapshot = null;
let freezeUntil = 0;

function now() { return Date.now(); }

function loadJSON(file, def) {
    try {
        if (!fs.existsSync(file)) return def;
        return JSON.parse(fs.readFileSync(file));
    } catch (e) {
        return def;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getKillKey(k) {
    if (!k) return null;
    return `${k.CauserUID || ""}_${k.VictimUID || ""}_${k.CurGameTime || ""}_${k.ItemID || ""}`;
}

function isValidKill(k) {
    if (!k) return false;
    if (!k.CauserUID) return false;
    if (!k.VictimUID) return false;
    const t = Number(k.CurGameTime || 0);
    if (t < 0 || t > 72000) return false;
    return true;
}

function normalizeSnapshotFields(snap) {
    if (!snap) return snap;
    const normalized = { ...snap };
    const fromRoot = Number(normalized.FinishedStartTime || 0);
    const fromAllinfo = Number(normalized.allinfo?.FinishedStartTime || 0);
    normalized.FinishedStartTime = fromRoot > 0 ? fromRoot : fromAllinfo;
    return normalized;
}

function resetMatch() {
    killMap.clear();
    killHistory.length = 0;
    weaponCache.data = {};
    weaponCache.timestamp = 0;
    backpackCache.data = null;
    backpackCache.timestamp = 0;
    matchStats.grenadeKills = {};
    matchStats.molotovKills = {};
    matchStats.vehicleKills = {};
    matchStats.longestKill = { distance: 0, team: null };
    matchStats.longestRun = { distance: 0, team: null };
    matchStats.longestBlueZone = { time: 0, team: null };
    matchStats.players = {};
    matchStats.teams = {};
    snapshotCache.data = null;
    snapshotCache.timestamp = 0;
}

function hardResetMatch(newGameID) {
    console.log("[HARD RESET] New GameID:", newGameID);
    resetMatch();
    masterSnapshot = {};
    observers.clear();
    masterObserver = null;
    processedMatches.clear();
    currentGameID = newGameID;
    matchFinishedTime = 0;
}

function isGameLocked() {
    return now() < gameStartLockUntil;
}

function safeResetMatch(newGameID) {
    console.log("[SAFE RESET] New GameID:", newGameID);
    frozenSnapshot = null;
    freezeUntil = 0;
    killMap.clear();
    killHistory.length = 0;
    matchFinishedTime = 0;
    snapshotCache.data = null;
    snapshotCache.timestamp = 0;
    gameStartLockUntil = now() + 3000;
    setTimeout(() => { hardResetMatch(newGameID); }, 500);
}

function selectMasterObserver() {
    const priority = ["obs1", "obs2", "obs3", "obs4", "obs5", "obs6", "obs7", "obs8"];
    const nowTime = now();
    for (const id of priority) {
        if (observers.has(id)) {
            const obs = observers.get(id);
            if (obs && obs.snapshot && obs.snapshot.allinfo && Array.isArray(obs.snapshot.allinfo.TotalPlayerList) && obs.snapshot.allinfo.TotalPlayerList.length > 0 && (nowTime - obs.timestamp) < MAX_OBSERVER_AGE) {
                masterObserver = id;
                return;
            }
        }
    }
    let bestObserver = null;
    let bestTime = 0;
    for (const [id, obs] of observers.entries()) {
        if (obs && obs.snapshot && obs.snapshot.allinfo && Array.isArray(obs.snapshot.allinfo.TotalPlayerList) && obs.snapshot.allinfo.TotalPlayerList.length > 0) {
            if ((nowTime - obs.timestamp) < MAX_OBSERVER_AGE && obs.timestamp > bestTime) {
                bestObserver = id;
                bestTime = obs.timestamp;
            }
        }
    }
    masterObserver = bestObserver;
}

function mergeKills(snapshot) {
    const list = snapshot?.killinfo || [];
    for (const k of list) {
        if (!isValidKill(k)) continue;
        const key = getKillKey(k);
        if (!killMap.has(key)) {
            killMap.set(key, k);
            killHistory.push(k);
        }
    }
    killHistory.sort((a, b) => Number(a.CurGameTime || 0) - Number(b.CurGameTime || 0));
    if (killHistory.length > MAX_KILLS) killHistory.splice(0, killHistory.length - MAX_KILLS);
}

function countMolotovKillsByTeam(killHistory, uidToTeamMap) {
    const result = {};
    const kills = killHistory || [];
    for (const k of kills) {
        if (String(k.ItemID) !== '602003') continue;
        if (String(k.ResultHealthStatus) !== '2') continue;
        const causerUid = String(k.CauserUID || '');
        const teamId = uidToTeamMap.get(causerUid);
        if (!teamId) continue;
        result[teamId] = (result[teamId] || 0) + 1;
    }
    return result;
}

function buildSnapshot() {
    if (isGameLocked()) {
        if (matchFinishedTime > 0) {
            console.log("[LOCK OVERRIDE] FinishedStartTime permitido:", matchFinishedTime);
        } else {
            console.log("[GAME LOCK] activo, restante:", gameStartLockUntil - now(), "ms");
            return masterSnapshot || {};
        }
    }
    selectMasterObserver();
    if (!masterObserver) {
        if (snapshotCache.data && (now() - snapshotCache.timestamp) > MAX_SNAPSHOT_STALE) return {};
        return masterSnapshot;
    }
    const master = observers.get(masterObserver);
    const nowTime = now();
    if (!master || !master.snapshot || !master.snapshot.allinfo || !Array.isArray(master.snapshot.allinfo.TotalPlayerList) || master.snapshot.allinfo.TotalPlayerList.length === 0 || (nowTime - master.timestamp) > MAX_OBSERVER_AGE) {
        masterObserver = null;
        if (snapshotCache.data && (nowTime - snapshotCache.timestamp) > MAX_SNAPSHOT_STALE) return {};
        return masterSnapshot;
    }
    const base = master.snapshot;
    if (!base || !base.allinfo || !Array.isArray(base.allinfo.TotalPlayerList) || base.allinfo.TotalPlayerList.length === 0) {
        if (snapshotCache.data && (nowTime - snapshotCache.timestamp) > MAX_SNAPSHOT_STALE) return {};
        return masterSnapshot;
    }
    matchStats.grenadeKills = {};
    matchStats.vehicleKills = {};
    matchStats.molotovKills = {};
    matchStats.longestKill = { distance: 0, team: null };
    matchStats.longestRun = { distance: 0, team: null };
    matchStats.longestBlueZone = { time: 0, team: null };
    matchStats.players = {};
    matchStats.teams = {};
    const players = base?.allinfo?.TotalPlayerList || [];
    const uidToTeamMap = new Map();
    for (const p of players) {
        const uid = String(p.uId ?? p.UID ?? '');
        const team = p.teamId ?? p.TeamID ?? '';
        if (uid && team) uidToTeamMap.set(uid, team);
    }
    const molotovKillsByTeam = countMolotovKillsByTeam(killHistory, uidToTeamMap);
    for (const p of players) {
        const team = p.teamId ?? p.TeamID ?? '';
        if (!team) continue;
        const grenadeKills = Number(p.killNumByGrenade ?? p.KillNumByGrenade ?? 0);
        const vehicleKills = Number(p.killNumInVehicle ?? p.KillNumInVehicle ?? 0);
        const longestKill = Number(p.maxKillDistance ?? p.MaxKillDistance ?? 0);
        const runDistance = Number(p.marchDistance ?? p.MarchDistance ?? 0);
        const blueTime = Number(p.outsideBlueCircleTime ?? p.OutsideBlueCircleTime ?? 0);
        matchStats.grenadeKills[team] = (matchStats.grenadeKills[team] || 0) + grenadeKills;
        matchStats.vehicleKills[team] = (matchStats.vehicleKills[team] || 0) + vehicleKills;
        if (longestKill > matchStats.longestKill.distance) matchStats.longestKill = { distance: longestKill, team };
        if (runDistance > matchStats.longestRun.distance) matchStats.longestRun = { distance: runDistance, team };
        if (blueTime > matchStats.longestBlueZone.time) matchStats.longestBlueZone = { time: blueTime, team };
        const uid = String(p.uId ?? p.UID ?? '');
        const playerName = p.playerName ?? p.PlayerName ?? '';
        matchStats.players[uid] = { name: playerName, team, kills: Number(p.killNum ?? p.KillNum ?? 0), damage: Number(p.damage ?? p.Damage ?? 0), rank: Number(p.rank ?? p.Rank ?? 99) };
        if (!matchStats.teams[team]) {
            matchStats.teams[team] = { kills: 0, damage: 0, rank: 99 };
            matchStats.molotovKills[team] = molotovKillsByTeam[team] || 0;
        }
        matchStats.teams[team].kills += Number(p.killNum ?? p.KillNum ?? 0);
        matchStats.teams[team].damage += Number(p.damage ?? p.Damage ?? 0);
        const playerRank = Number(p.rank ?? p.Rank ?? 99);
        if (playerRank < matchStats.teams[team].rank) matchStats.teams[team].rank = playerRank;
    }
    const gameID = base.GameID || base?.allinfo?.GameID || null;
    masterSnapshot = {
        GameID: gameID,
        GameStartTime: base.GameStartTime || base.allinfo?.GameStartTime || 0,
        FightingStartTime: base.FightingStartTime || base.allinfo?.FightingStartTime || 0,
        FinishedStartTime: matchFinishedTime > 0 ? matchFinishedTime : Number(base.FinishedStartTime || base.allinfo?.FinishedStartTime || 0),
        CurrentTime: base.CurrentTime || base.allinfo?.CurrentTime || 0,
        allinfo: base.allinfo,
        killinfo: killHistory,
        circleinfo: base.circleinfo,
        teambackpackinfo: base.teambackpackinfo || null,
        playerweapondetailinfo: Array.isArray(base.playerweapondetailinfo) ? base.playerweapondetailinfo : [],
        observer: "aggregator",
        observerName: "aggregator"
    };
    masterSnapshot = normalizeSnapshotFields(masterSnapshot);
    if (masterSnapshot.FinishedStartTime > 0) {
        console.log("[MATCH END] FinishedStartTime:", masterSnapshot.FinishedStartTime, "GameID:", masterSnapshot.GameID);
        if (!frozenSnapshot) {
            frozenSnapshot = { ...masterSnapshot };
            freezeUntil = now();
            console.log("[FROZEN] Snapshot final guardado — se servirá hasta nuevo GameID");
        } else {
            const incoming = masterSnapshot.playerweapondetailinfo;
            if (Array.isArray(incoming) && incoming.length > (frozenSnapshot.playerweapondetailinfo?.length || 0)) {
                frozenSnapshot.playerweapondetailinfo = incoming;
                console.log("[FROZEN] playerweapondetailinfo actualizado:", incoming.length, "entradas");
            }
        }
    }
    detectMatchEnd(masterSnapshot);
    return masterSnapshot;
}

function detectMatchEnd(snapshot) {
    const gid = snapshot.GameID;
    const finished = Number(snapshot.FinishedStartTime || 0);
    if (!gid) return;
    if (finished > 0) {
        if (processedMatches.has(gid)) return;
        processedMatches.add(gid);
        processMatchResults(snapshot);
    }
}

function processMatchResults(snapshot) {
    const teams = {};
    for (const team in matchStats.teams) {
        teams[team] = { team, pp: 0, pe: matchStats.teams[team].kills, total: 0 };
    }
    const list = Object.values(teams);
    list.sort((a, b) => b.pe - a.pe);
    list.forEach((t, i) => {
        const rank = i + 1;
        if (rank === 1) t.pp = 15;
        else if (rank === 2) t.pp = 12;
        else if (rank === 3) t.pp = 10;
        else if (rank === 4) t.pp = 8;
        else if (rank === 5) t.pp = 6;
        else if (rank === 6) t.pp = 4;
        else if (rank === 7) t.pp = 2;
        else t.pp = 1;
        t.total = t.pp + t.pe;
    });
    // El incremento automático de match se maneja desde final_template / results API
    // para evitar dobles incrementos cuando se usa el flujo oficial de resultados por evento.
}

// ============================================
// AGREGADOR - ENDPOINTS
// ============================================
app.post("/observer", (req, res) => {
    const headerToken = req.headers["x-tournament-token"];
    const bodyToken = req.body?.tournamentToken;
    const receivedToken = headerToken || bodyToken;
    if (receivedToken !== TOURNAMENT_TOKEN) {
        console.log(`[OBSERVER REJECTED] Token inválido — recibido: "${receivedToken}" | esperado: "${TOURNAMENT_TOKEN}"`);
        return res.status(403).json({ error: "tournament token mismatch" });
    }
    const body = req.body;
    if (!body?.snapshot) return res.status(400).json({ error: "invalid snapshot" });
    const snapshot = body.snapshot;
    if (!snapshot.allinfo) return res.status(400).json({ error: "invalid snapshot: missing allinfo" });
    if (!Array.isArray(snapshot.allinfo.TotalPlayerList)) snapshot.allinfo.TotalPlayerList = [];
    const id = body.observer || "observer";
    const incomingGameID = snapshot.GameID || snapshot?.allinfo?.GameID || null;
    if (incomingGameID && incomingGameID !== currentGameID) safeResetMatch(incomingGameID);
    const incomingFinished = Number(snapshot.FinishedStartTime || snapshot.allinfo?.FinishedStartTime || 0);
    if (incomingFinished > 0) {
        if (matchFinishedTime === 0) console.log("[MATCH END DETECTED]", incomingFinished, "GameID:", incomingGameID);
        matchFinishedTime = Math.max(matchFinishedTime, incomingFinished);
    }
    observers.set(id, { id, timestamp: now(), snapshot });
    mergeKills(snapshot);
    res.json({ status: "ok" });
});

setInterval(() => {
    const t = now();
    for (const [id, obs] of observers.entries()) {
        if (t - obs.timestamp > OBSERVER_TIMEOUT) {
            observers.delete(id);
            if (masterObserver === id) masterObserver = null;
        }
    }
}, 2000);

setInterval(async () => {
    let hasValidObserver = false;
    const nowTime = now();
    for (const obs of observers.values()) {
        if (obs?.snapshot?.allinfo?.TotalPlayerList?.length > 0 && (nowTime - obs.timestamp) < MAX_OBSERVER_AGE) {
            hasValidObserver = true;
            break;
        }
    }
    if (hasValidObserver) return;
    try {
        const r = await fetch("http://127.0.0.1:10086/getmatchsnapshot");
        const snapshot = await r.json();
        if (!snapshot || Object.keys(snapshot).length === 0) return;
        const id = "obs1";
        const incomingGameID = snapshot.GameID || snapshot?.allinfo?.GameID || null;
        if (incomingGameID && incomingGameID !== currentGameID) safeResetMatch(incomingGameID);
        const incomingFinished = Number(snapshot.FinishedStartTime || snapshot.allinfo?.FinishedStartTime || 0);
        if (incomingFinished > 0) {
            matchFinishedTime = Math.max(matchFinishedTime, incomingFinished);
            if (matchFinishedTime === incomingFinished) console.log("[FALLBACK] FinishedStartTime capturado:", matchFinishedTime);
        }
        observers.set(id, { id, timestamp: now(), snapshot });
        mergeKills(snapshot);
    } catch (e) { }
}, 1000);

app.get("/getmatchsnapshot", (req, res) => {
    if (frozenSnapshot) {
        const newSnapshot = buildSnapshot() || {};
        if (newSnapshot?.allinfo?.TotalPlayerList?.length > 0 && newSnapshot.GameID && newSnapshot.GameID !== frozenSnapshot.GameID) {
            console.log("[FREEZE RELEASE] Nuevo GameID con datos válidos:", newSnapshot.GameID);
            frozenSnapshot = null;
            freezeUntil = 0;
            snapshotCache.data = newSnapshot;
            snapshotCache.timestamp = now();
            return res.json(newSnapshot);
        }
        return res.json(frozenSnapshot);
    }
    if (snapshotCache.data && snapshotCache.data.allinfo?.TotalPlayerList?.length > 0 && (now() - snapshotCache.timestamp) < SNAPSHOT_CACHE_TTL) {
        return res.json(snapshotCache.data);
    }
    const newSnapshot = buildSnapshot() || {};
    if (newSnapshot?.allinfo?.TotalPlayerList?.length > 0) {
        snapshotCache.data = newSnapshot;
        snapshotCache.timestamp = now();
    }
    res.json(newSnapshot);
});

app.get("/tournamentconfig", (req, res) => { res.json(tournamentConfig); });
app.post("/tournamentconfig", (req, res) => {
    tournamentConfig = { ...tournamentConfig, ...req.body };
    saveJSON(CONFIG_FILE, tournamentConfig);
    res.json(tournamentConfig);
});
app.get("/gettournaments", (req, res) => { res.json(tournaments); });
app.post("/createtournament", (req, res) => {
    const t = req.body;
    tournaments.push(t);
    saveJSON(TOURNAMENT_FILE, tournaments);
    res.json({ status: "created" });
});
app.delete("/deletetournament", (req, res) => {
    const id = req.query.id;
    tournaments = tournaments.filter(t => t.id !== id);
    saveJSON(TOURNAMENT_FILE, tournaments);
    res.json({ status: "deleted" });
});
app.get("/gettournamentcalendar", (req, res) => {
    const id = req.query.id;
    const t = tournaments.find(x => x.id === id);
    res.json(t?.schedule || []);
});
app.post("/savetournamentcalendar", (req, res) => {
    const { id, schedule } = req.body;
    const t = tournaments.find(x => x.id === id);
    if (t) { t.schedule = schedule; saveJSON(TOURNAMENT_FILE, tournaments); }
    res.json({ status: "saved" });
});
app.get("/gettournamentstandings", (req, res) => { res.json({ teams: [] }); });

app.get("/getplayerweapondetailinfo", async (req, res) => {
    const t = now();
    if (t - weaponCache.timestamp < WEAPON_CACHE_TTL) return res.json(weaponCache.data);
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WEAPON_FETCH_TIMEOUT);
        const r = await fetch("http://127.0.0.1:10086/getplayerweapondetailinfo", { signal: controller.signal });
        clearTimeout(timeout);
        const data = await r.json();
        weaponCache.data = data;
        weaponCache.timestamp = now();
        res.json(data);
    } catch (e) {
        if (weaponCache.data && Object.keys(weaponCache.data).length > 0) return res.json(weaponCache.data);
        res.status(502).json({ error: "observer unavailable" });
    }
});

app.get("/getteambackpackinfo", async (req, res) => {
    const t = now();
    if (t - backpackCache.timestamp < BACKPACK_CACHE_TTL && backpackCache.data !== null) return res.json(backpackCache.data);
    try {
        const r = await fetch("http://127.0.0.1:10086/getteambackpackinfo");
        const data = await r.json();
        backpackCache.data = data;
        backpackCache.timestamp = now();
        res.json(data);
    } catch (e) {
        if (backpackCache.data !== null) return res.json(backpackCache.data);
        res.status(502).json({ error: "observer unavailable" });
    }
});

let lastOverlayCommand = { cmd: null, timestamp: 0, source: null };
const OVERLAY_BUFFER_SIZE = 10;
let overlayCommandsBuffer = [];

app.post("/overlaycommand", (req, res) => {
    const { cmd, timestamp, source } = req.body;
    if (!cmd || typeof cmd !== "string") return res.status(400).json({ error: "missing or invalid cmd" });
    if (!timestamp || typeof timestamp !== "number") return res.status(400).json({ error: "missing or invalid timestamp" });
    const nowTime = Date.now();
    if (nowTime - timestamp > 10000) {
        console.log("[OVERLAY CMD] Ignorado (demasiado viejo):", { cmd, timestamp });
        return res.json({ status: "ignored" });
    }
    const entry = { ...req.body, cmd, timestamp, source: source || null };
    if (timestamp > lastOverlayCommand.timestamp) {
        lastOverlayCommand = entry;
        console.log("[OVERLAY CMD]", lastOverlayCommand);
    }
    const exists = overlayCommandsBuffer.some(e => e.timestamp === timestamp);
    if (!exists) {
        overlayCommandsBuffer.push(entry);
        overlayCommandsBuffer.sort((a, b) => a.timestamp - b.timestamp);
        if (overlayCommandsBuffer.length > OVERLAY_BUFFER_SIZE) overlayCommandsBuffer = overlayCommandsBuffer.slice(-OVERLAY_BUFFER_SIZE);
    }
    res.json({ status: "ok" });
});

app.get("/overlaycommand", (req, res) => { res.json(lastOverlayCommand); });
app.get("/overlaycommand/latest", (req, res) => {
    const since = parseInt(req.query.since, 10);
    if (isNaN(since)) return res.json(lastOverlayCommand);
    const newer = overlayCommandsBuffer.filter(e => e.timestamp > since).pop();
    res.json(newer || null);
});

app.get("/observers", (req, res) => {
    const nowTime = now();
    const list = [];
    for (const [id, obs] of observers.entries()) {
        const ageSec = ((nowTime - obs.timestamp) / 1000).toFixed(1);
        const active = (nowTime - obs.timestamp) < OBSERVER_TIMEOUT;
        const fresh = (nowTime - obs.timestamp) < MAX_OBSERVER_AGE;
        list.push({ id, name: obs.snapshot?.observerName || id, isMaster: id === masterObserver, active, fresh, ageSec: parseFloat(ageSec), gameID: obs.snapshot?.GameID || obs.snapshot?.allinfo?.GameID || null });
    }
    res.json({ count: list.length, active: list.filter(o => o.active).length, fresh: list.filter(o => o.fresh).length, master: masterObserver, observers: list });
});

app.post("/resetstate", (req, res) => {
    console.log("[MANUAL RESET] Solicitado por:", req.body?.source || "desconocido");
    frozenSnapshot = null;
    freezeUntil = 0;
    snapshotCache.data = null;
    snapshotCache.timestamp = 0;
    masterSnapshot = {};
    masterObserver = null;
    matchFinishedTime = 0;
    gameStartLockUntil = 0;
    currentGameID = null;
    killMap.clear();
    killHistory.length = 0;
    observers.clear();
    resetMatch();
    res.json({ status: "ok", message: "Estado del aggregator reiniciado" });
});

app.get("/state", (req, res) => {
    res.json({
        currentGameID,
        matchFinishedTime,
        frozenSnapshot: frozenSnapshot ? { GameID: frozenSnapshot.GameID, FinishedStartTime: frozenSnapshot.FinishedStartTime, players: frozenSnapshot.allinfo?.TotalPlayerList?.length || 0 } : null,
        freezeUntil,
        observerCount: observers.size,
        masterObserver,
        gameStartLockActive: isGameLocked(),
        gameStartLockRemainingMs: Math.max(0, gameStartLockUntil - now()),
        snapshotCacheAge: snapshotCache.data ? now() - snapshotCache.timestamp : null,
        killHistoryLength: killHistory.length,
        tournamentToken: TOURNAMENT_TOKEN
    });
});

app.post("/gas-proxy", async (req, res) => {
    const { url, payload } = req.body;
    if (!url || !payload) return res.status(400).json({ error: "url and payload required" });
    try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow", body: JSON.stringify(payload) });
        const text = await response.text();
        try { res.json(JSON.parse(text)); } catch (e) { res.send(text); }
    } catch (err) {
        console.error("[GAS PROXY] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", (req, res) => {
    res.json({
        ok: true,
        timestamp: Date.now()
    });
});

// ============================================
// RAIZ REDIRIGE A CONTROL
// ============================================
app.get('/', (req, res) => {
    res.redirect('/control/overlay_control.html');
});

// ============================================
//  NUEVAS FUNCIONES PARA GENERACIÓN DE EVENT PACKAGES
// ============================================

function sanitizeEventName(name) {
    return name
        .trim()
        .replace(/[<>:"/\\|?*]+/g, '')
        .replace(/\s+/g, '_');
}

function loadTemplate(templateName) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template no encontrado: ${templateName}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
}

function renderTemplate(template, replacements) {
    let output = template;
    for (const key in replacements) {
        const value = replacements[key];
        if (value !== undefined && value !== null) {
            output = output.replaceAll(`__${key}__`, String(value));
        }
    }
    return output;
}

function buildEventConfig(data) {
    const { eventName, eventDate, teams, slots } = data;

    const config = {
        eventName,
        eventDate,
        generatedAt: new Date().toISOString(),
        teams: []
    };

    if (Array.isArray(teams)) {
        config.teams = teams.map(team => {
            const teamKey =
                team.teamKey ||
                team.teamManagerId ||
                team.logoKey ||
                (/^T-\d{4}$/i.test(String(team.teamId || '')) ? String(team.teamId) : '');

            let numericTeamId = Number(team.teamId);

            if ((isNaN(numericTeamId) || numericTeamId <= 0) && Array.isArray(slots)) {
                const slotMatch = slots.find(slot => {
                    const slotTeamKey =
                        slot.teamKey ||
                        slot.teamManagerId ||
                        slot.logoKey ||
                        (/^T-\d{4}$/i.test(String(slot.teamId || '')) ? String(slot.teamId) : '');

                    return String(slotTeamKey) === String(teamKey);
                });

                if (slotMatch) {
                    numericTeamId =
                        Number(slotMatch.teamId) ||
                        Number(slotMatch.slot) ||
                        Number(slotMatch.teamNo) ||
                        Number(slotMatch.pubgTeamId);
                }
            }

            return {
                teamId: !isNaN(numericTeamId) && numericTeamId > 0 ? numericTeamId : '',
                teamKey: teamKey,
                teamName: team.teamName || '',
                logoPng: team.logoPng || '',
                logoWebm: team.logoWebm || '',
                flagPng: team.flagPng || '',
                flagWebm: team.flagWebm || '',
                primaryColor: team.primaryColor || '',
                secondaryColor: team.secondaryColor || '',
                tag: team.tag || ''
            };
        });
    }

    return config;
}

function buildConfigJS(data) {
    const { eventName } = data;
    const safeEventName = sanitizeEventName(eventName);
    const eventPath = `/eventos/${safeEventName}/`;
    const configPath = `${eventPath}event_config.json`;

    return [
        `const eventName = "${eventName}";`,
        `const eventPath = "${eventPath}";`,
        `const overlays = [`,
        `  "${eventPath}barras_${safeEventName}.html",`,
        `  "${eventPath}alertas_${safeEventName}.html",`,
        `  "${eventPath}final_${safeEventName}.html",`,
        `  "${eventPath}overlay_control.html"`,
        `];`,
        `const configPath = "${configPath}";`
    ].join('\n');
}

function buildOverlayReplacements(data, slots) {
    const replacements = {
        EVENT_NAME: data.eventName,
        EVENT_DATE: data.eventDate
    };

    if (Array.isArray(slots)) {
        const teamsArray = data.teams || [];
        slots.forEach((slot, index) => {
            const pos = index + 1;
            const team = teamsArray.find(t =>
                Number(t.teamId) === Number(slot.teamId) ||
                String(t.teamKey || t.teamId) === String(slot.teamKey || slot.teamId)
            );
            if (team) {
                replacements[`TEAM_${pos}_NAME`] = team.teamName || '';
                replacements[`TEAM_${pos}_TAG`] = team.tag || '';
                replacements[`TEAM_${pos}_LOGO`] = team.logoPng || '';
                replacements[`TEAM_${pos}_LOGO_WEBM`] = team.logoWebm || '';
                replacements[`TEAM_${pos}_FLAG`] = team.flagPng || '';
                replacements[`TEAM_${pos}_FLAG_WEBM`] = team.flagWebm || '';
                replacements[`TEAM_${pos}_PRIMARY`] = team.primaryColor || '';
                replacements[`TEAM_${pos}_SECONDARY`] = team.secondaryColor || '';
            }
        });
    }

    return replacements;
}

async function generateEventPackage(data) {
    const { eventName, eventDate, slots, teams } = data;
    const safeEventName = sanitizeEventName(eventName);
    const eventDir = path.join(EVENTS_DIR, safeEventName);

    if (!fs.existsSync(eventDir)) {
        fs.mkdirSync(eventDir, { recursive: true });
    }
    const assetsDir = path.join(eventDir, 'assets');
    const resultadosDir = path.join(eventDir, 'resultados');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    if (!fs.existsSync(resultadosDir)) fs.mkdirSync(resultadosDir, { recursive: true });
    fs.mkdirSync(path.join(resultadosDir, 'matches'), { recursive: true });
    fs.mkdirSync(path.join(resultadosDir, 'csv'), { recursive: true });

    const configJson = buildEventConfig(data);
    console.log('[EVENT PACKAGE SERVER] generated config teams:', configJson.teams);
    fs.writeFileSync(
        path.join(eventDir, 'event_config.json'),
        JSON.stringify(configJson, null, 2),
        'utf8'
    );

    const configJs = buildConfigJS(data);
    fs.writeFileSync(
        path.join(eventDir, 'config.js'),
        configJs,
        'utf8'
    );

    const overlays = [
        { template: 'barras_template.html', output: `barras_${safeEventName}.html` },
        { template: 'alertas_template.html', output: `alertas_${safeEventName}.html` },
        { template: 'final_template.html', output: `final_${safeEventName}.html` },
        { template: 'overlay_control_template.html', output: 'overlay_control.html' }
    ];

    const replacements = buildOverlayReplacements(data, slots);

    for (const ov of overlays) {
        try {
            const templateContent = loadTemplate(ov.template);
            const rendered = renderTemplate(templateContent, replacements);
            fs.writeFileSync(path.join(eventDir, ov.output), rendered, 'utf8');
        } catch (err) {
            console.error(`[EVENT PACKAGE] Error generando ${ov.output}:`, err.message);
        }
    }

    const archive = ArchiverLib('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
        throw err;
    });
    archive.directory(eventDir, safeEventName);
    return archive;
}

// ============================================
//  NUEVO ENDPOINT DE GENERACIÓN DE EVENT PACKAGE
// ============================================
app.post('/api/generate-event-package', async (req, res) => {
    try {
        const { eventName, eventDate, slots, teams } = req.body;

        if (!eventName || typeof eventName !== 'string') {
            return res.status(400).json({ success: false, error: 'eventName es requerido' });
        }
        if (!eventDate) {
            return res.status(400).json({ success: false, error: 'eventDate es requerido' });
        }
        if (!Array.isArray(teams)) {
            return res.status(400).json({ success: false, error: 'teams debe ser un array' });
        }

        console.log('[EVENT PACKAGE SERVER] received slots:', slots);
        console.log('[EVENT PACKAGE SERVER] received teams:', teams);

        const data = { eventName, eventDate, slots, teams };

        const archiveStream = await generateEventPackage(data);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeEventName(eventName)}.zip"`);
        archiveStream.pipe(res);
        await archiveStream.finalize();

    } catch (err) {
        console.error('[EVENT PACKAGE ERROR]', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message || 'Error interno' });
        }
    }
});

// ============================================
// RESULTADOS POR EVENTO
// ============================================

function resolveEventPath(eventName) {
    const safeName = sanitizeEventName(eventName);
    const eventDir = path.join(EVENTS_DIR, safeName);
    const resolved = path.resolve(eventDir);
    const resolvedEvents = path.resolve(EVENTS_DIR);
    if (!resolved.startsWith(resolvedEvents)) {
        throw new Error('Nombre de evento invalido');
    }
    return resolved;
}

function ensureResultDirs(eventDir) {
    const resultadosDir = path.join(eventDir, 'resultados');
    const matchesDir = path.join(resultadosDir, 'matches');
    const csvDir = path.join(resultadosDir, 'csv');
    if (!fs.existsSync(resultadosDir)) fs.mkdirSync(resultadosDir, { recursive: true });
    if (!fs.existsSync(matchesDir)) fs.mkdirSync(matchesDir, { recursive: true });
    if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true });
    return { resultadosDir, matchesDir, csvDir };
}

function getNextMatchNumber(matchesDir) {
    if (!fs.existsSync(matchesDir)) return 1;
    const files = fs.readdirSync(matchesDir).filter(f => /^M\d+\.json$/.test(f));
    const nums = files.map(f => parseInt(f.replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function isDuplicateGameID(matchesDir, gameID) {
    if (!gameID) return false;
    if (!fs.existsSync(matchesDir)) return false;
    const files = fs.readdirSync(matchesDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(matchesDir, f), 'utf8'));
            const savedGameID = data.GameID || data.gameID || data.gameId || data.gameIdRaw;
            if (String(savedGameID) === String(gameID)) return true;
        } catch (e) { /* skip */ }
    }
    return false;
}

function escapeCsv(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function buildPlayersCsv(players, matchNumber, gameID, gameStartTime, finishedStartTime) {
    const exportedAt = new Date().toISOString();
    const headers = ['Match', 'GameID', 'GameStartTime', 'FinishedStartTime', 'ExportedAt', 'TeamID', 'TeamKey', 'TeamName', 'PlayerName', 'UID', 'Kills', 'Damage', 'Rank', 'SurvivalTime', 'Assists', 'Knocks', 'Headshots', 'MaxKillDistance', 'VehicleKills', 'GrenadeKills'];
    const rows = players.map(p => [
        matchNumber,
        gameID ?? '',
        gameStartTime ?? '',
        finishedStartTime ?? '',
        exportedAt,
        p.teamId ?? p.TeamID ?? '',
        p.teamKey ?? p.TeamKey ?? '',
        p.teamName ?? p.TeamName ?? '',
        p.playerName ?? p.PlayerName ?? p.name ?? '',
        p.uId ?? p.UID ?? p.uid ?? '',
        p.killNum ?? p.KillNum ?? p.kills ?? 0,
        p.damage ?? p.Damage ?? 0,
        p.rank ?? p.Rank ?? 99,
        p.survivalTime ?? p.SurvivalTime ?? 0,
        p.assists ?? p.Assists ?? 0,
        p.knockouts ?? p.Knockouts ?? p.KnockNum ?? p.knockNum ?? 0,
        p.headShotNum ?? p.HeadShotNum ?? p.headshots ?? 0,
        p.maxKillDistance ?? p.MaxKillDistance ?? 0,
        p.killNumInVehicle ?? p.KillNumInVehicle ?? 0,
        p.killNumByGrenade ?? p.KillNumByGrenade ?? 0
    ].map(escapeCsv).join(','));
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

function buildTeamsCsv(teams, matchNumber) {
    const headers = ['Match', 'TeamID', 'TeamKey', 'TeamName', 'Kills', 'Damage', 'Rank', 'PP', 'PE', 'Total'];
    const rows = teams.map(t => [
        matchNumber,
        t.teamId ?? t.TeamID ?? '',
        t.teamKey ?? t.TeamKey ?? '',
        t.teamName ?? t.TeamName ?? '',
        t.totalKills ?? t.kills ?? t.killNum ?? t.KillNum ?? 0,
        t.totalDamage ?? t.damage ?? t.Damage ?? 0,
        t.rank ?? t.Rank ?? 99,
        t.pp ?? t.PP ?? 0,
        t.pe ?? t.PE ?? t.killNum ?? t.KillNum ?? t.kills ?? 0,
        t.total ?? t.Total ?? t.totalPoints ?? t.TotalPoints ?? 0
    ].map(escapeCsv).join(','));
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

function buildTablaGeneralCsv(teams) {
    const headers = ['Pos', 'TeamID', 'TeamKey', 'TeamName', 'PJ', 'Total', 'WWCD', 'PP', 'PE', 'Elims', 'Damage', 'MejorPos', 'UltimaPos'];
    const rows = teams.map((t, i) => [
        i + 1,
        t.teamId ?? '',
        t.teamKey ?? '',
        t.teamName ?? '',
        t.partidasJugadas ?? 0,
        t.total ?? 0,
        t.wwcd ?? 0,
        t.pp ?? 0,
        t.pe ?? 0,
        t.kills ?? 0,
        t.damage ?? 0,
        t.mejorPosicion ?? 99,
        t.ultimaPosicion ?? 99
    ].map(escapeCsv).join(','));
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

function updateAcumulado(acumuladoPath, matchData, matchNumber) {
    let acumulado = loadJSON(acumuladoPath, { teams: [] });
    if (!acumulado.teams) acumulado.teams = [];

    const teamsMap = new Map();
    for (const t of acumulado.teams) {
        teamsMap.set(String(t.teamId), t);
    }

    for (const team of matchData.teams || []) {
        const teamId = team.teamId ?? team.TeamID ?? '';
        if (!teamId) continue;
        const teamKey = team.teamKey ?? team.TeamKey ?? '';
        const teamName = team.teamName ?? team.TeamName ?? '';
        const rank = Number(team.rank ?? team.Rank ?? 99);
        const pp = Number(team.pp ?? team.PP ?? 0);
        const pe = Number(team.pe ?? team.PE ?? team.killNum ?? team.KillNum ?? 0);
        const bonusTotal = Number(team.bonusTotal ?? team.BonusTotal ?? team.bonus ?? 0);
        const kills = Number(team.totalKills ?? team.kills ?? team.killNum ?? team.KillNum ?? 0);
        const damage = Number(team.totalDamage ?? team.damage ?? team.Damage ?? 0);

        let total = Number(team.total ?? team.Total ?? team.totalPoints ?? team.TotalPoints ?? 0);
        if ((!team.total && !team.Total && !team.totalPoints && !team.TotalPoints) || total === 0) {
            total = pp + pe + bonusTotal;
        }

        const id = String(teamId);
        let existing = teamsMap.get(id);
        if (!existing) {
            existing = {
                teamId: teamId,
                teamKey: teamKey,
                teamName: teamName,
                partidasJugadas: 0,
                total: 0,
                wwcd: 0,
                pp: 0,
                pe: 0,
                bonusTotal: 0,
                kills: 0,
                damage: 0,
                mejorPosicion: 99,
                ultimaPosicion: 99
            };
            teamsMap.set(id, existing);
            acumulado.teams.push(existing);
        }
        existing.partidasJugadas += 1;
        existing.total += total;
        existing.pp += pp;
        existing.pe += pe;
        existing.bonusTotal += bonusTotal;
        existing.kills += kills;
        existing.damage += damage;
        existing.ultimaPosicion = rank;
        if (rank === 1) existing.wwcd += 1;
        if (rank < existing.mejorPosicion) existing.mejorPosicion = rank;
    }

    acumulado.teams.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd;
        if (b.pp !== a.pp) return b.pp - a.pp;
        if (b.pe !== a.pe) return b.pe - a.pe;
        return a.ultimaPosicion - b.ultimaPosicion;
    });

    acumulado.lastUpdated = new Date().toISOString();
    acumulado.lastMatch = matchNumber;
    saveJSON(acumuladoPath, acumulado);
    return acumulado;
}

function appendPosicionesCsv(csvPath, rows, matchNumber) {
    const lines = rows.map(r => [
        matchNumber,
        r.teamId ?? r.TeamID ?? '',
        r.teamKey ?? r.TeamKey ?? '',
        r.teamName ?? r.TeamName ?? '',
        r.rank ?? r.Rank ?? 99,
        r.pp ?? r.PP ?? 0,
        r.pe ?? r.PE ?? r.killNum ?? r.KillNum ?? 0,
        r.total ?? r.Total ?? r.totalPoints ?? r.TotalPoints ?? 0
    ].map(escapeCsv).join(','));
    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, '\uFEFF' + 'Match,TeamID,TeamKey,TeamName,Rank,PP,PE,Total\n' + lines.join('\n'), 'utf8');
    } else {
        fs.appendFileSync(csvPath, '\n' + lines.join('\n'), 'utf8');
    }
}

// POST /api/events/:eventName/results/match
app.post('/api/events/:eventName/results/match', (req, res) => {
    try {
        const eventName = req.params.eventName;
        if (!eventName || typeof eventName !== 'string') {
            return res.status(400).json({ success: false, error: 'eventName invalido' });
        }

        const eventDir = resolveEventPath(eventName);
        if (!fs.existsSync(eventDir)) {
            return res.status(404).json({ success: false, error: 'Evento no encontrado' });
        }

        const { matchesDir, csvDir, resultadosDir } = ensureResultDirs(eventDir);
        const payload = req.body;

        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ success: false, error: 'Payload invalido' });
        }

        const gameID = payload.GameID || payload.gameID || payload.gameId || null;
        if (gameID && isDuplicateGameID(matchesDir, gameID)) {
            return res.status(409).json({ success: false, error: 'GameID ya registrado' });
        }

        let matchNumber = payload.matchNumber ? parseInt(payload.matchNumber, 10) : null;
        if (!matchNumber || isNaN(matchNumber) || matchNumber < 1) {
            matchNumber = getNextMatchNumber(matchesDir);
        }

        const matchKey = 'M' + matchNumber;
        const matchFile = path.join(matchesDir, matchKey + '.json');
        const playersCsvFile = path.join(csvDir, matchKey + '_jugadores.csv');
        const teamsCsvFile = path.join(csvDir, matchKey + '_equipos.csv');
        const posicionesCsvFile = path.join(csvDir, 'posiciones_por_partida.csv');
        const acumuladoPath = path.join(resultadosDir, 'acumulado.json');
        const tablaCsvFile = path.join(csvDir, 'tabla_general.csv');

        const matchData = {
            ...payload,
            matchNumber,
            matchKey,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(matchFile, JSON.stringify(matchData, null, 2), 'utf8');

        const players = payload.players || payload.allinfo?.TotalPlayerList || [];
        const teams = payload.teams || [];

        const gameStartTime = payload.GameStartTime || payload.gameStartTime || '';
        const finishedStartTime = payload.FinishedStartTime || payload.finishedStartTime || '';
        fs.writeFileSync(playersCsvFile, buildPlayersCsv(players, matchNumber, gameID, gameStartTime, finishedStartTime), 'utf8');
        fs.writeFileSync(teamsCsvFile, buildTeamsCsv(teams, matchNumber), 'utf8');

        appendPosicionesCsv(posicionesCsvFile, teams, matchNumber);

        const acumulado = updateAcumulado(acumuladoPath, matchData, matchNumber);

        fs.writeFileSync(tablaCsvFile, buildTablaGeneralCsv(acumulado.teams), 'utf8');

        res.json({
            success: true,
            matchKey,
            matchNumber,
            gameID,
            files: {
                match: matchFile,
                playersCsv: playersCsvFile,
                teamsCsv: teamsCsvFile,
                posicionesCsv: posicionesCsvFile,
                acumulado: acumuladoPath,
                tablaGeneral: tablaCsvFile
            }
        });
    } catch (err) {
        console.error('[RESULTS ERROR]', err);
        res.status(500).json({ success: false, error: err.message || 'Error interno' });
    }
});

// GET /api/events/:eventName/results
app.get('/api/events/:eventName/results', (req, res) => {
    try {
        const eventName = req.params.eventName;
        if (!eventName || typeof eventName !== 'string') {
            return res.status(400).json({ success: false, error: 'eventName invalido' });
        }

        const eventDir = resolveEventPath(eventName);
        if (!fs.existsSync(eventDir)) {
            return res.status(404).json({ success: false, error: 'Evento no encontrado' });
        }

        const resultadosDir = path.join(eventDir, 'resultados');
        const matchesDir = path.join(resultadosDir, 'matches');
        const csvDir = path.join(resultadosDir, 'csv');
        const acumuladoPath = path.join(resultadosDir, 'acumulado.json');

        const matches = [];
        if (fs.existsSync(matchesDir)) {
            const files = fs.readdirSync(matchesDir).filter(f => f.endsWith('.json')).sort();
            for (const f of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(matchesDir, f), 'utf8'));
                    matches.push({ file: f, matchNumber: data.matchNumber, gameID: data.GameID || data.gameID || data.gameId, savedAt: data.savedAt });
                } catch (e) { /* skip */ }
            }
        }

        const acumulado = fs.existsSync(acumuladoPath) ? JSON.parse(fs.readFileSync(acumuladoPath, 'utf8')) : null;

        res.json({
            success: true,
            eventName,
            matches,
            matchCount: matches.length,
            acumulado: acumulado ? {
                teamCount: acumulado.teams?.length || 0,
                lastUpdated: acumulado.lastUpdated,
                lastMatch: acumulado.lastMatch
            } : null
        });
    } catch (err) {
        console.error('[RESULTS GET ERROR]', err);
        res.status(500).json({ success: false, error: err.message || 'Error interno' });
    }
});

// ============================================
// ERROR HANDLER GLOBAL
// ============================================
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Error interno del servidor" });
});

// ============================================
// INICIO DEL SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log("=================================");
    console.log(" PUBG MOBILE AGGREGATOR PRO + TEAM MANAGER");
    console.log(" Multi Observer Enabled");
    console.log(" Bonus System Enabled");
    console.log(" Fallback Polling Active");
    console.log(" Team Manager API Active");
    console.log(" Event Package Generator Active");
    console.log("=================================");
    console.log(`PORT: ${PORT}`);
    console.log(`Snapshot: http://localhost:${PORT}/getmatchsnapshot`);
    console.log(`Teams API: http://localhost:${PORT}/api/teams`);
    console.log(`Event Generator: http://localhost:${PORT}/api/generate-event-package`);
    console.log(`Tournament Token: ${TOURNAMENT_TOKEN}`);
    console.log("[STATIC] shared:", SHARED_DIR);
    console.log("[STATIC] eventos:", EVENTS_DIR);
    console.log("[STATIC] overlays:", path.join(__dirname, "overlays"));
    console.log("[STATIC] control:", path.join(__dirname, "overlays/control"));
});