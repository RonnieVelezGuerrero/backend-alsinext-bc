// Alsinext: compromiso con la IA con foto. API pública (los usuarios llegan por QR, sin login).
// La lista de fotos nunca devuelve correos.
// Excepción (spec 006): el emparejamiento solo lo usa el administrador de Alsinext.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const router = require('express').Router();

const { query, queryOne, withTransaction, isMockMode } = require('../../config/db');
const { env } = require('../../config/env');
const { asyncHandler } = require('../../utils/asyncHandler');
const {
  rejectMockDb,
  requireConfiguredSecret,
  createLoginLimiter,
  createAdminLogin,
  createAdminRegister,
  requireAlsinextAdmin,
  createPairHandler,
  createPresentationState,
} = require('./alsinext.access');
const { runPairing, runPairNewcomers, getPendingStatus, generateMissingTitles } = require('./alsinext.pairTeams');
const { requestAffinityScores, requestProjectTitles } = require('./alsinext.gemini');
const {
  normalizeEmail,
  isValidEmail,
  isValidStyle,
  toPublicPhotos,
  toPublicTeams,
  normalizeName,
  isValidName,
  normalizeAiUsage,
  isValidAiUsage,
} = require('./alsinext.logic');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads/alsinext');
const PHOTO_URL_PREFIX = '/api/alsinext/photos/';
// Fotos de los AI Champions (spec 006): las pone el responsable; fuera de git
const CHAMPIONS_DIR = path.join(__dirname, '../../../uploads/alsinext-champions');
const CHAMPION_PHOTO_URL_PREFIX = '/api/alsinext/champions/photos/';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // el navegador ya reduce la foto; esto es un tope de seguridad
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CHAMPIONS_DIR, { recursive: true });

// Nombre de archivo seguro: sin carpetas y sin empezar por punto (evita «..» y ocultos)
function safePhotoName(name) {
  const base = path.basename(String(name || ''));
  if (!/^[a-zA-Z0-9._-]+$/.test(base) || base.startsWith('.')) return null;
  return base;
}

// Sirve una foto de la carpeta indicada (fotos de compromisos o de champions)
function sendPhotoFrom(dir) {
  return (req, res) => {
    const name = safePhotoName(req.params.file);
    if (!name) {
      res.status(400).json({ error: 'invalid_file' });
      return;
    }

    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.sendFile(path.resolve(filePath));
  };
}

// Borra los archivos subidos en una petición rechazada (para no dejar huérfanos)
function removeUploads(files) {
  for (const file of files) fs.unlink(file.path, () => {});
}

// Archivos de la petición: la foto original y la copia con efecto (spec 003)
function uploadedFiles(req) {
  return [...(req.files?.photo || []), ...(req.files?.styledPhoto || [])];
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    // Nombre aleatorio: el archivo no revela el correo de la persona
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}.${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 2 }, // 5 MB por archivo (spec 002 y 003)
  fileFilter: (_req, file, cb) => {
    const ok = Boolean(IMAGE_TYPES[String(file.mimetype || '').toLowerCase()]);
    cb(ok ? null : new Error('bad_file_type'), ok);
  },
});

router.get('/photos/:file', sendPhotoFrom(UPLOADS_DIR));

// Fotos de champions: públicas como las de los participantes (sin nombres ni equipos)
router.get('/champions/photos/:file', sendPhotoFrom(CHAMPIONS_DIR));

router.get('/photos', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT id, image_filename, styled_filename FROM alsinext_compromisos ORDER BY id');
  res.json(toPublicPhotos(rows, PHOTO_URL_PREFIX));
}));

// ---------- Emparejamiento con los AI Champions (spec 006) ----------
// Solo el administrador de Alsinext (tabla alsinext_admin), independiente del portal (RF-1).
// Con la BD simulada no se sirve nada protegido.

// Hash ficticio: si el usuario no existe se compara contra él (mismo tiempo de respuesta)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

// Acceso: 5 fallos en 15 min → bloqueado 15 min (RF-1c)
router.post('/admin/login', rejectMockDb(isMockMode), requireConfiguredSecret(env.jwtSecret), createAdminLogin({
  findAdminByUsername: (username) => queryOne('SELECT id, password_hash, is_admin FROM alsinext_admin WHERE username = ? LIMIT 1', [username]),
  comparePassword: (password, hash) => bcrypt.compare(password, hash),
  dummyHash: DUMMY_HASH,
  limiter: createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  secret: env.jwtSecret,
}));

// Crear cuenta desde el «Login» (RF-1f): nace sin permiso (is_admin = 0); el responsable la
// hace administradora en la BD. Máximo 5 cuentas nuevas cada 15 min (RF-1g).
router.post('/admin/register', rejectMockDb(isMockMode), createAdminRegister({
  hashPassword: (password) => bcrypt.hash(password, 12),
  insertAccount: (username, hash) => query('INSERT INTO alsinext_admin (username, password_hash) VALUES (?, ?)', [username, hash]),
  limiter: createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
}));

const protectPairing = [
  rejectMockDb(isMockMode),
  requireConfiguredSecret(env.jwtSecret),
  requireAlsinextAdmin({
    secret: env.jwtSecret,
    // Solo cuentas con permiso: si se le quita is_admin, su sesión deja de valer
    findAdminById: (id) => queryOne('SELECT id FROM alsinext_admin WHERE id = ? AND is_admin = 1 LIMIT 1', [id]),
  }),
];

// Equipos para la vista (RF-12, RF-13): solo nombres y fotos, nunca correos ni respuestas.
// [] mientras no se haya emparejado.
async function loadPublicTeams() {
  const rows = await query(
    `SELECT e.team_id, c.name AS champion_name, c.photo AS champion_photo,
            p.name AS member_name, p.image_filename, p.styled_filename,
            t.title_es, t.title_en
     FROM alsinext_equipos e
     JOIN alsinext_champions c ON c.id = e.champion_id
     LEFT JOIN alsinext_compromisos p ON p.email = e.email
     LEFT JOIN alsinext_equipos_titulos t ON t.team_id = e.team_id
     ORDER BY e.team_id, e.id`,
  );
  return toPublicTeams(rows, { photoPrefix: PHOTO_URL_PREFIX, championPhotoPrefix: CHAMPION_PHOTO_URL_PREFIX });
}

router.get('/teams', ...protectPairing, asyncHandler(async (_req, res) => {
  res.json(await loadPublicTeams());
}));

// RF-19, RF-20: «Presentar equipos» la marca como activa 10 min con los equipos de ese momento;
// la vista Burbujas (pública) la consulta cada 3 s. Sin presentación no se toca la BD.
// Cambio 2026-10-18: con { instant: true } («Mostrar equipos») las pantallas muestran la
// cuadrícula final sin tómbola.
const presentation = createPresentationState();

router.post('/presentation', ...protectPairing, asyncHandler(async (req, res) => {
  res.json({ id: presentation.start(await loadPublicTeams(), { instant: Boolean(req.body?.instant) }) });
}));

// RF-13i: el administrador pulsa una tarjeta de la cuadrícula final ({ team: índice }) o fuera
// ({ team: null }); las pantallas en Burbujas lo leen en su consulta
router.post('/presentation/select', ...protectPairing, (req, res) => {
  const code = presentation.select(req.body?.team);
  if (code === 'no_presentation') return res.status(409).json({ ok: false, code });
  if (code) return res.status(400).json({ ok: false, code });
  return res.json({ ok: true });
});

router.get('/presentation', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(isMockMode() ? { active: false } : presentation.current());
});

// Dependencias de los dos emparejamientos; nunca dos a la vez (candado compartido)
const pairingDeps = () => ({
  isMockMode,
  query,
  withTransaction,
  requestScores: requestAffinityScores,
  requestTitles: requestProjectTitles,
  apiKey: env.gemini.apiKey,
  model: env.gemini.model,
});
const pairLock = { inProgress: false };

// Lanza el emparejamiento desde la vista (la misma lógica que `npm run alsinext:pair`)
router.post('/pair', ...protectPairing, createPairHandler(() => runPairing(pairingDeps()), pairLock));

// RF-15: cuántas personas no tienen equipo y si ya se pueden emparejar (solo números)
router.get('/pairing/pending', ...protectPairing, asyncHandler(async (_req, res) => {
  res.json(await getPendingStatus({ query }));
}));

// RF-15: «Emparejar nuevos» (solo los que no tienen equipo; los equipos guardados no cambian)
router.post('/pair/newcomers', ...protectPairing, createPairHandler(() => runPairNewcomers(pairingDeps()), pairLock));

// RF-13f: «Generar títulos» para los equipos que aún no tienen (nunca cambia uno que ya existe)
router.post('/pair/titles', ...protectPairing, createPairHandler(() => generateMissingTitles(pairingDeps()), pairLock));

router.post('/commitments', (req, res, next) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'styledPhoto', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'La foto supera el límite de 5 MB.'
        : 'Tipo de archivo no permitido.';
      res.status(400).json({ error: 'bad_photo', message });
      return;
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  const files = uploadedFiles(req);
  const photo = req.files?.photo?.[0];
  const styledPhoto = req.files?.styledPhoto?.[0];
  const email = normalizeEmail(req.body.email);
  const style = req.body.style;
  const name = normalizeName(req.body.name);
  const aiUsage = normalizeAiUsage(req.body.aiUsage);

  if (!photo) {
    removeUploads(files);
    res.status(400).json({ error: 'photo_required' });
    return;
  }
  // 003 RF-6: sin copia o con un estilo que no es de los 5 → se rechaza
  if (!styledPhoto || !isValidStyle(style)) {
    removeUploads(files);
    res.status(400).json({ error: 'invalid_style' });
    return;
  }
  if (!isValidEmail(email)) {
    removeUploads(files);
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  // 005 RF-11: nombre (1–160) y respuesta sobre la IA (10–500), mismas reglas que el frontend
  if (!isValidName(name)) {
    removeUploads(files);
    res.status(400).json({ error: 'invalid_name' });
    return;
  }
  if (!isValidAiUsage(aiUsage)) {
    removeUploads(files);
    res.status(400).json({ error: 'invalid_ai_usage' });
    return;
  }

  const existing = await queryOne('SELECT id FROM alsinext_compromisos WHERE email = ? LIMIT 1', [email]);
  if (existing) {
    removeUploads(files);
    res.status(409).json({ error: 'already_committed' });
    return;
  }

  try {
    const result = await query(
      'INSERT INTO alsinext_compromisos (email, name, ai_usage, image_filename, styled_filename, style) VALUES (?, ?, ?, ?, ?, ?)',
      [email, name, aiUsage, photo.filename, styledPhoto.filename, style],
    );
    res.status(201).json({ id: result.insertId, imageUrl: `${PHOTO_URL_PREFIX}${styledPhoto.filename}` });
  } catch (error) {
    removeUploads(files);
    // Dos envíos simultáneos con el mismo correo: el índice único rechaza el segundo
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'already_committed' });
      return;
    }
    throw error;
  }
}));

module.exports = router;
