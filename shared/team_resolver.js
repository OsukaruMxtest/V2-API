// ============================================
// TEAM RESOLVER
// Centraliza acceso a equipos/assets
// ============================================

let __teamsCache = null;
let __teamsCacheTime = 0;

const TEAM_CACHE_TTL = 5000;

// ============================================
// FETCH TEAMS
// ============================================

async function fetchTeams(forceRefresh = false) {
    const now = Date.now();

    if (
        !forceRefresh &&
        __teamsCache &&
        (now - __teamsCacheTime) < TEAM_CACHE_TTL
    ) {
        return __teamsCache;
    }

    try {
        const response = await fetch('/api/teams');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();

        const teams = Array.isArray(json.data)
            ? json.data
            : [];

        __teamsCache = teams;
        __teamsCacheTime = now;

        return teams;

    } catch (err) {
        console.error('[TEAM RESOLVER] Error fetching teams:', err);

        return __teamsCache || [];
    }
}

// ============================================
// GET TEAM BY TEAM MANAGER ID
// Ejemplo: T-0001
// ============================================

async function getTeamById(teamId) {
    if (!teamId) return null;

    const teams = await fetchTeams();

    return teams.find(
        t => t.teamId === teamId
    ) || null;
}

// ============================================
// GET TEAM BY TAG
// Ejemplo: LMG
// ============================================

async function getTeamByTag(tag) {
    if (!tag) return null;

    const teams = await fetchTeams();

    return teams.find(
        t => (t.tag || '').toUpperCase() === tag.toUpperCase()
    ) || null;
}

// ============================================
// GET TEAM BY NAME
// ============================================

async function getTeamByName(name) {
    if (!name) return null;

    const teams = await fetchTeams();

    return teams.find(
        t => (t.teamName || '').toUpperCase() === name.toUpperCase()
    ) || null;
}

// ============================================
// GET BEST LOGO
// Prioridad:
// 1. WEBM
// 2. PNG
// ============================================

function getBestLogo(team) {
    if (!team) return null;

    if (team.logoWebm) {
        return {
            type: 'webm',
            src: team.logoWebm
        };
    }

    if (team.logoPng) {
        return {
            type: 'png',
            src: team.logoPng
        };
    }

    return null;
}

// ============================================
// GET BEST FLAG
// Prioridad:
// 1. WEBM
// 2. PNG
// ============================================

function getBestFlag(team) {
    if (!team) return null;

    if (team.flagWebm) {
        return {
            type: 'webm',
            src: team.flagWebm
        };
    }

    if (team.flagPng) {
        return {
            type: 'png',
            src: team.flagPng
        };
    }

    return null;
}

// ============================================
// CLEAR CACHE
// ============================================

function clearTeamsCache() {
    __teamsCache = null;
    __teamsCacheTime = 0;
}

// ============================================
// DEBUG HELPERS
// ============================================

window.TeamResolver = {
    fetchTeams,
    getTeamById,
    getTeamByTag,
    getTeamByName,
    getBestLogo,
    getBestFlag,
    clearTeamsCache
};

console.log('[TEAM RESOLVER] Loaded');