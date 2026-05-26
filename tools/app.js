/* ============================================
   TEAM MANAGER - app.js
   Frontend vanilla JS conectado a Express API
   ============================================ */

const $ = id => document.getElementById(id);
const API_BASE = '';

/* ============================================
   ESTADO GLOBAL
   ============================================ */
let allTeams = [];
let editingId = null;
let currentLogoPng = null;
let currentLogoWebm = null;
let currentFlagPng = null;
let currentFlagWebm = null;
let pendingPngFile = null;
let pendingWebmFile = null;
let pendingFlagPngFile = null;
let pendingFlagWebmFile = null;
let eyedropperMode = 'primary';
let eyedropperImage = null;
let confirmCallback = null;

/* ============================================
   UTILIDADES
   ============================================ */
function showToast(msg, type = 'success') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.warning}<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ============================================
   API - FETCH HELPERS
   ============================================ */
async function apiGetTeams() {
  const res = await fetch(`${API_BASE}/api/teams`);
  if (!res.ok) throw new Error('Error cargando equipos');
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Error cargando equipos');
  return json.data;
}

async function apiCreateTeam(body) {
  const res = await fetch(`${API_BASE}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error creando equipo');
  }
  return res.json();
}

async function apiUpdateTeam(id, body) {
  const res = await fetch(`${API_BASE}/api/teams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error actualizando equipo');
  }
  return res.json();
}

async function apiDeleteTeam(id) {
  const res = await fetch(`${API_BASE}/api/teams/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error eliminando equipo');
  }
  return res.json();
}

async function apiClearAll() {
  const res = await fetch(`${API_BASE}/api/teams`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error limpiando base de datos');
  }
  return res.json();
}

/* ============================================
   UPLOAD ASSET (logo o flag)
   ============================================ */
async function apiUploadAsset(file, teamId, assetType = 'logo') {
  const form = new FormData();
  form.append('teamId', teamId);
  form.append('assetType', assetType);
  form.append('logo', file);
  const res = await fetch(`${API_BASE}/api/upload-logo`, {
    method: 'POST',
    body: form
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error subiendo archivo');
  }
  const json = await res.json();
  return json.data || json;
}

async function apiExport() {
  const res = await fetch(`${API_BASE}/api/export`);
  if (!res.ok) throw new Error('Error exportando');
  return res.blob();
}

async function apiImport(data) {
  const res = await fetch(`${API_BASE}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error importando');
  }
  return res.json();
}

/* ============================================
   CARGA DE DATOS
   ============================================ */
async function loadAllTeams() {
  try {
    allTeams = await apiGetTeams();
    renderTeams();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ============================================
   RENDERIZADO DE CARDS
   ============================================ */
function renderTeams() {
  const grid = $('teamsGrid');
  const query = $('searchInput').value.trim().toLowerCase();
  let teams = [...allTeams];

  if (query) {
    teams = teams.filter(t =>
      (t.teamName || '').toLowerCase().includes(query) ||
      (t.tag || '').toLowerCase().includes(query) ||
      (t.teamId || '').toLowerCase().includes(query)
    );
  }

  if (teams.length === 0) {
    grid.innerHTML = emptyStateHTML(query);
    return;
  }

  grid.innerHTML = teams.map(buildCardHTML).join('');
}

function emptyStateHTML(query) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
      <h3>${query ? 'Sin resultados' : 'Sin equipos registrados'}</h3>
      <p>${query ? 'Intenta con otra búsqueda.' : 'Haz clic en "Agregar Equipo" para comenzar.'}</p>
    </div>`;
}

function buildCardHTML(t) {
  let logoHtml = '';
  if (t.logoPng) {
    logoHtml += `<img src="${t.logoPng}" alt="${escapeHtml(t.teamName)} PNG" style="max-width:50%;">`;
  }
  if (t.logoWebm) {
    logoHtml += `<video src="${t.logoWebm}" autoplay muted loop playsinline style="max-width:50%;"></video>`;
  }
  if (!logoHtml) {
    logoHtml = `<div class="card-logo-placeholder">?</div>`;
  }

  let flagHtml = '';
  if (t.flagPng) {
    flagHtml += `<img src="${t.flagPng}" alt="Bandera ${escapeHtml(t.teamName)} PNG" style="max-width:50%;">`;
  }
  if (t.flagWebm) {
    flagHtml += `<video src="${t.flagWebm}" autoplay muted loop playsinline style="max-width:50%;"></video>`;
  }

  return `
    <div class="team-card" style="--primary:${t.primaryColor || '#3b82f6'}; --secondary:${t.secondaryColor || '#64748b'}">
      <div class="card-logo-wrap">${logoHtml}</div>
      ${flagHtml ? `<div class="card-flag-wrap">${flagHtml}</div>` : ''}
      <div class="card-info">
        <h3>${escapeHtml(t.teamName)}</h3>
        ${t.tag ? `<span class="card-tag">${escapeHtml(t.tag)}</span>` : ''}
      </div>
      <div class="card-meta">
        <span><strong>ID:</strong> ${escapeHtml(t.teamId)}</span>
        <span><strong>Creado:</strong> ${formatDate(t.createdAt)}</span>
      </div>
      <div class="card-colors">
        <div class="color-dot" style="background:${t.primaryColor}" title="Primario: ${t.primaryColor}"></div>
        <div class="color-dot" style="background:${t.secondaryColor}" title="Secundario: ${t.secondaryColor}"></div>
      </div>
      <div class="card-actions">
        <button class="btn" onclick="editTeam('${t.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          Editar
        </button>
        <button class="btn btn-danger" onclick="deleteTeam('${t.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          Eliminar
        </button>
      </div>
    </div>`;
}

/* ============================================
   MODAL & FORMULARIO
   ============================================ */
function openModal(id = null) {
  editingId = id || null;
  $('modalTitle').textContent = id ? 'Editar Equipo' : 'Agregar Equipo';
  $('modalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';

  if (!id) {
    resetFormNew();
  } else {
    fillFormEdit(id);
  }
}

function resetFormNew() {
  $('teamId').value = '';
  $('teamName').value = '';
  $('tag').value = '';
  $('primaryColor').value = '#3b82f6';
  $('primaryHex').value = '#3B82F6';
  $('secondaryColor').value = '#64748b';
  $('secondaryHex').value = '#64748B';
  resetFiles();
}

function fillFormEdit(id) {
  const t = allTeams.find(x => x.id === id);
  if (!t) { closeModal(); return; }

  $('teamId').value = t.teamId;
  $('teamName').value = t.teamName;
  $('tag').value = t.tag || '';
  $('primaryColor').value = t.primaryColor || '#3b82f6';
  $('primaryHex').value = (t.primaryColor || '#3b82f6').toUpperCase();
  $('secondaryColor').value = t.secondaryColor || '#64748b';
  $('secondaryHex').value = (t.secondaryColor || '#64748b').toUpperCase();

  currentLogoPng = t.logoPng || null;
  currentLogoWebm = t.logoWebm || null;
  currentFlagPng = t.flagPng || null;
  currentFlagWebm = t.flagWebm || null;

  if (t.logoPng) showPreview(t.logoPng, 'png', '');
  if (t.logoWebm) showPreview(t.logoWebm, 'webm', '');
  if (t.flagPng) showPreview(t.flagPng, 'png', 'Flag');
  if (t.flagWebm) showPreview(t.flagWebm, 'webm', 'Flag');
}

function closeModal() {
  $('modalOverlay').classList.remove('active');
  document.body.style.overflow = '';
  editingId = null;
  resetFiles();
}

function closeModalOnBackdrop(e) {
  if (e.target === $('modalOverlay')) closeModal();
}

function resetFiles() {
  // Logos
  currentLogoPng = null;
  currentLogoWebm = null;
  pendingPngFile = null;
  pendingWebmFile = null;
  const pngInput = $('fileInputPng');
  const webmInput = $('fileInputWebm');
  if (pngInput) pngInput.value = '';
  if (webmInput) webmInput.value = '';

  // Flags
  currentFlagPng = null;
  currentFlagWebm = null;
  pendingFlagPngFile = null;
  pendingFlagWebmFile = null;
  const flagPngInput = $('fileInputFlagPng');
  const flagWebmInput = $('fileInputFlagWebm');
  if (flagPngInput) flagPngInput.value = '';
  if (flagWebmInput) flagWebmInput.value = '';

  // Previews logos
  $('previewArea').classList.remove('active');
  $('previewBox').innerHTML = '';
  $('eyedropperSection').classList.remove('active');
  eyedropperImage = null;
  const cvs = $('eyedropperCanvas');
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // Previews flags
  const previewAreaFlag = $('previewAreaFlag');
  const previewBoxFlag = $('previewBoxFlag');
  if (previewAreaFlag) previewAreaFlag.classList.remove('active');
  if (previewBoxFlag) previewBoxFlag.innerHTML = '';
}

/* ============================================
   COLOR INPUT SYNC
   ============================================ */
function syncHexFromPicker(which) {
  const hex = $(which + 'Color').value.toUpperCase();
  $(which + 'Hex').value = hex;
  updateDot(which, hex);
}

function syncPickerFromHex(which) {
  let hex = $(which + 'Hex').value;
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-F]{6}$/i.test(hex)) {
    $(which + 'Color').value = hex;
    updateDot(which, hex);
  }
}

function updateDot(which, hex) {
  const dotId = which === 'primary' ? 'dotPrimary' : 'dotSecondary';
  const dot = $(dotId);
  if (dot) dot.style.background = hex;
}

/* ============================================
   DRAG & DROP
   ============================================ */
function initDragDrop() {
  initDropZone('dropZonePng', 'fileInputPng');
  initDropZone('dropZoneWebm', 'fileInputWebm');
  initDropZone('dropZoneFlagPng', 'fileInputFlagPng');
  initDropZone('dropZoneFlagWebm', 'fileInputFlagWebm');
}

function initDropZone(zoneId, inputId) {
  const dropZone = $(zoneId);
  const fileInput = $(inputId);

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'), false);
  });

  dropZone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files.length) processFile(files[0], inputId);
  }, false);

  fileInput.addEventListener('change', handleFileSelect, false);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length) processFile(files[0], e.target.id);
}

function processFile(file, inputId) {
  if (!file) return;
  const isPng = file.type === 'image/png';
  const isWebm = file.type === 'video/webm';

  if (!isPng && !isWebm) {
    showToast('Solo se permiten archivos PNG o WEBM.', 'error');
    return;
  }

  if (isPng && file.size > 5 * 1024 * 1024) {
    showToast('PNG excede 5MB.', 'error');
    return;
  }
  if (isWebm && file.size > 20 * 1024 * 1024) {
    showToast('WEBM excede 20MB.', 'error');
    return;
  }

  if (inputId === 'fileInputPng') {
    pendingPngFile = file;
    currentLogoPng = URL.createObjectURL(file);
    showPreview(currentLogoPng, 'png', '');
    showToast('PNG de logo listo para subir.', 'success');
  } else if (inputId === 'fileInputWebm') {
    pendingWebmFile = file;
    currentLogoWebm = URL.createObjectURL(file);
    showPreview(currentLogoWebm, 'webm', '');
    showToast('WEBM de logo listo para subir.', 'success');
  } else if (inputId === 'fileInputFlagPng') {
    pendingFlagPngFile = file;
    currentFlagPng = URL.createObjectURL(file);
    showPreview(currentFlagPng, 'png', 'Flag');
    showToast('PNG de bandera listo para subir.', 'success');
  } else if (inputId === 'fileInputFlagWebm') {
    pendingFlagWebmFile = file;
    currentFlagWebm = URL.createObjectURL(file);
    showPreview(currentFlagWebm, 'webm', 'Flag');
    showToast('WEBM de bandera listo para subir.', 'success');
  }
}

/* ============================================
   PREVIEW (generalizada para logo y flag)
   ============================================ */
function showPreview(dataUrl, type, prefix = '') {
  const area = $('previewArea' + prefix);
  const box = $('previewBox' + prefix);
  const label = $('previewLabel' + prefix);
  area.classList.add('active');
  box.innerHTML = '';

  if (type === 'png') {
    const img = document.createElement('img');
    img.src = dataUrl;
    if (!prefix) img.onload = () => setupEyedropper(img);
    box.appendChild(img);
    label.innerHTML = prefix ? flagPngPreviewLabel() : pngPreviewLabel();
  } else {
    const vid = document.createElement('video');
    vid.src = dataUrl;
    vid.autoplay = true;
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    box.appendChild(vid);
    label.innerHTML = prefix ? flagWebmPreviewLabel() : webmPreviewLabel();
  }
}

function pngPreviewLabel() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
  </svg> Vista previa Logo PNG`;
}

function webmPreviewLabel() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg> Vista previa Logo WEBM`;
}

function flagPngPreviewLabel() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
  </svg> Vista previa Bandera PNG`;
}

function flagWebmPreviewLabel() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg> Vista previa Bandera WEBM`;
}

/* ============================================
   CUENTAGOTAS (EYEDROPPER) - SOLO LOGO PNG
   ============================================ */
function setupEyedropper(img) {
  const section = $('eyedropperSection');
  const canvas = $('eyedropperCanvas');
  const wrap = $('canvasWrap');
  section.classList.add('active');
  eyedropperImage = img;

  const maxWidth = wrap.clientWidth;
  const scale = maxWidth / img.naturalWidth;
  canvas.width = maxWidth;
  canvas.height = img.naturalHeight * scale;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  canvas.onclick = e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    if (eyedropperMode === 'primary') {
      $('primaryColor').value = hex;
      $('primaryHex').value = hex;
      updateDot('primary', hex);
      showToast(`Color primario: ${hex}`, 'success');
    } else {
      $('secondaryColor').value = hex;
      $('secondaryHex').value = hex;
      updateDot('secondary', hex);
      showToast(`Color secundario: ${hex}`, 'success');
    }
  };
}

function setEyedropperMode(mode) {
  eyedropperMode = mode;
  $('modePrimary').classList.toggle('active', mode === 'primary');
  $('modeSecondary').classList.toggle('active', mode === 'secondary');
}

function autoExtractColors() {
  if (!eyedropperImage) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const w = 100;
  const h = (eyedropperImage.naturalHeight / eyedropperImage.naturalWidth) * w;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(eyedropperImage, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  const map = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] & 0xF0;
    const g = data[i + 1] & 0xF0;
    const b = data[i + 2] & 0xF0;
    if (r < 15 && g < 15 && b < 15) continue;
    if (r > 240 && g > 240 && b > 240) continue;
    const key = `${r},${g},${b}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) {
    showToast('No se detectaron colores suficientes.', 'warning');
    return;
  }

  const c1 = sorted[0][0].split(',').map(Number);
  const c2 = sorted[1] ? sorted[1][0].split(',').map(Number) : [c1[0] ^ 0x80, c1[1] ^ 0x80, c1[2] ^ 0x80];

  const hex1 = rgbToHex(c1[0] | (c1[0] >> 4), c1[1] | (c1[1] >> 4), c1[2] | (c1[2] >> 4));
  const hex2 = rgbToHex(c2[0] | (c2[0] >> 4), c2[1] | (c2[1] >> 4), c2[2] | (c2[2] >> 4));

  $('primaryColor').value = hex1;
  $('primaryHex').value = hex1;
  updateDot('primary', hex1);

  $('secondaryColor').value = hex2;
  $('secondaryHex').value = hex2;
  updateDot('secondary', hex2);

  showToast('Colores extraídos automáticamente.', 'success');
}

/* ============================================
   CRUD - GUARDAR / EDITAR / ELIMINAR
   ============================================ */
async function saveTeam() {
  const teamName = $('teamName').value.trim();
  const tag = $('tag').value.trim();
  const primaryColor = $('primaryHex').value.trim().toUpperCase();
  const secondaryColor = $('secondaryHex').value.trim().toUpperCase();

  if (!teamName) {
    showToast('El nombre del equipo es obligatorio.', 'error');
    return;
  }

  try {
    if (editingId) {
      const existing = allTeams.find(t => t.id === editingId);
      let logoPngPath = currentLogoPng;
      let logoWebmPath = currentLogoWebm;
      let flagPngPath = currentFlagPng;
      let flagWebmPath = currentFlagWebm;

      if (pendingPngFile && existing) {
        const uploadRes = await apiUploadAsset(pendingPngFile, existing.teamId, 'logo');
        logoPngPath = uploadRes.logo;
        pendingPngFile = null;
      }
      if (pendingWebmFile && existing) {
        const uploadRes = await apiUploadAsset(pendingWebmFile, existing.teamId, 'logo');
        logoWebmPath = uploadRes.logo;
        pendingWebmFile = null;
      }
      if (pendingFlagPngFile && existing) {
        const uploadRes = await apiUploadAsset(pendingFlagPngFile, existing.teamId, 'flag');
        flagPngPath = uploadRes.logo;
        pendingFlagPngFile = null;
      }
      if (pendingFlagWebmFile && existing) {
        const uploadRes = await apiUploadAsset(pendingFlagWebmFile, existing.teamId, 'flag');
        flagWebmPath = uploadRes.logo;
        pendingFlagWebmFile = null;
      }

      const body = {
        teamName,
        tag: tag || '',
        logoPng: logoPngPath || null,
        logoWebm: logoWebmPath || null,
        flagPng: flagPngPath || null,
        flagWebm: flagWebmPath || null,
        primaryColor,
        secondaryColor
      };

      await apiUpdateTeam(editingId, body);
      showToast('Equipo actualizado.', 'success');
      await loadAllTeams();
      closeModal();
    } else {
      const body = {
        teamName,
        tag: tag || '',
        logoPng: null,
        logoWebm: null,
        flagPng: null,
        flagWebm: null,
        primaryColor,
        secondaryColor
      };

      const created = await apiCreateTeam(body);
      const newTeam = created.data || created;
      $('teamId').value = newTeam.teamId;

      if (pendingPngFile && newTeam.teamId) {
        const uploadRes = await apiUploadAsset(pendingPngFile, newTeam.teamId, 'logo');
        await apiUpdateTeam(newTeam.id, { logoPng: uploadRes.logo });
        pendingPngFile = null;
      }
      if (pendingWebmFile && newTeam.teamId) {
        const uploadRes = await apiUploadAsset(pendingWebmFile, newTeam.teamId, 'logo');
        await apiUpdateTeam(newTeam.id, { logoWebm: uploadRes.logo });
        pendingWebmFile = null;
      }
      if (pendingFlagPngFile && newTeam.teamId) {
        const uploadRes = await apiUploadAsset(pendingFlagPngFile, newTeam.teamId, 'flag');
        await apiUpdateTeam(newTeam.id, { flagPng: uploadRes.logo });
        pendingFlagPngFile = null;
      }
      if (pendingFlagWebmFile && newTeam.teamId) {
        const uploadRes = await apiUploadAsset(pendingFlagWebmFile, newTeam.teamId, 'flag');
        await apiUpdateTeam(newTeam.id, { flagWebm: uploadRes.logo });
        pendingFlagWebmFile = null;
      }

      showToast('Equipo creado.', 'success');
      await loadAllTeams();
      closeModal();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function editTeam(id) {
  openModal(id);
}

function deleteTeam(id) {
  const t = allTeams.find(x => x.id === id);
  if (!t) return;
  openConfirm(
    '¿Eliminar equipo?',
    `Se eliminará permanentemente a <strong>${escapeHtml(t.teamName)}</strong>.`,
    async () => {
      try {
        await apiDeleteTeam(id);
        await loadAllTeams();
        showToast('Equipo eliminado.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

/* ============================================
   IMPORT / EXPORT / CLEAR
   ============================================ */
async function exportJSON() {
  try {
    const blob = await apiExport();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equipos.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON exportado.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function importJSON(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      const valid = data.every(d => d && typeof d.teamId === 'string' && typeof d.teamName === 'string');
      if (!valid) throw new Error('Estructura inválida');

      openConfirm(
        'Importar JSON',
        `Esto reemplazará la base actual con ${data.length} equipo(s). ¿Continuar?`,
        async () => {
          try {
            await apiImport(data);
            await loadAllTeams();
            showToast('Base de datos importada.', 'success');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      );
    } catch (err) {
      showToast('Error al importar: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function confirmClearDB() {
  openConfirm(
    '¿Limpiar base de datos?',
    'Se eliminarán TODOS los equipos permanentemente.',
    async () => {
      try {
        await apiClearAll();
        await loadAllTeams();
        showToast('Base de datos limpiada.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

/* ============================================
   CONFIRM DIALOG
   ============================================ */
function openConfirm(title, message, onYes) {
  confirmCallback = onYes;
  $('confirmTitle').textContent = title;
  $('confirmMessage').innerHTML = message;
  $('confirmOverlay').classList.add('active');
}

function closeConfirm() {
  $('confirmOverlay').classList.remove('active');
  confirmCallback = null;
}

function initConfirmDialog() {
  $('confirmBtnYes').onclick = () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  };
}

/* ============================================
   INICIALIZACIÓN
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  initDragDrop();
  initConfirmDialog();
  loadAllTeams();
});