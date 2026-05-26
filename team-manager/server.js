const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const LOGOS_DIR = path.join(__dirname, 'logos');
const DATA_FILE = path.join(__dirname, 'equipos.json');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/logos', express.static(LOGOS_DIR));

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

/* ============================================
   MULTER CONFIG - soporta logo y flag (sufijo B)
   ============================================ */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const teamId = req.body.teamId || 'unknown';
    const suffix = req.body.assetType === 'flag' ? 'B' : '';
    cb(null, teamId + suffix + ext);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['image/png', 'video/webm'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Solo PNG o WEBM permitidos'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter
});

/* ============================================
   API ROUTES
   ============================================ */

app.get('/api/teams', (req, res) => {
  try {
    res.json({ success: true, data: readData() });
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

    const teams = readData();
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
    writeData(teams);
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

    const teams = readData();
    const idx = teams.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });

    const existing = teams[idx];

    // Borrar logos anteriores si cambian
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
    writeData(teams);
    res.json({ success: true, data: teams[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    const teams = readData();
    const team = teams.find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });

    deleteLogoFile(team.logoPng);
    deleteLogoFile(team.logoWebm);
    deleteLogoFile(team.flagPng);
    deleteLogoFile(team.flagWebm);

    const filtered = teams.filter(t => t.id !== req.params.id);
    writeData(filtered);
    res.json({ success: true, data: { deleted: req.params.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CLEAR ALL
app.delete('/api/teams', (req, res) => {
  try {
    const teams = readData();
    teams.forEach(t => {
      deleteLogoFile(t.logoPng);
      deleteLogoFile(t.logoWebm);
      deleteLogoFile(t.flagPng);
      deleteLogoFile(t.flagWebm);
    });
    writeData([]);
    res.json({ success: true, data: { cleared: true, count: teams.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// UPLOAD - soporta logo y flag mediante assetType
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

app.post('/api/import', (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ success: false, error: 'Formato inválido: se esperaba un array' });
    const valid = data.every(d => d && typeof d.teamId === 'string' && typeof d.teamName === 'string');
    if (!valid) return res.status(400).json({ success: false, error: 'Estructura inválida en los datos' });
    writeData(data);
    res.json({ success: true, data: { count: data.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const data = readData();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="equipos.json"');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log('Servidor corriendo en http://localhost:' + PORT);
});