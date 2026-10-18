// Alsinext: protección de la vista de emparejamiento (spec 006, RF-1…RF-1f).
// Solo entra el administrador de Alsinext (tabla alsinext_admin: usuario + hash bcrypt),
// independiente del portal. Orden en las rutas protegidas:
//   rejectMockDb → requireConfiguredSecret → requireAlsinextAdmin → ruta
// Todo recibe sus dependencias, para probarlo sin base de datos ni Express.

const jwt = require('jsonwebtoken');

const ADMIN_SCOPE = 'alsinext_admin'; // un token del portal no lo lleva: no sirve aquí
const TOKEN_HOURS = 8;
const MIN_PASSWORD_LENGTH = 6;

// El secreto que firma las sesiones debe ser propio: el valor por defecto del backend está
// escrito en el código, y con él cualquiera podría fabricar una sesión de administrador.
const DEFAULT_SECRET = 'change_this_in_production';
const MIN_SECRET_LENGTH = 32;

function isUsableSecret(secret) {
  return typeof secret === 'string' && secret !== DEFAULT_SECRET && secret.length >= MIN_SECRET_LENGTH;
}

// Sin un JWT_SECRET propio en .env, el acceso y las rutas protegidas no funcionan
function requireConfiguredSecret(secret) {
  return function requireConfiguredSecretMiddleware(_req, res, next) {
    if (!isUsableSecret(secret)) {
      res.status(503).json({ error: 'not_configured' });
      return;
    }
    next();
  };
}

// RF-1f: contraseña del administrador (al crearla con la orden del servidor)
function isValidAdminPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

// Usuario del administrador: 3–80 caracteres, sin espacios (cabe en username VARCHAR(80))
function isValidAdminUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9._-]{3,80}$/.test(username);
}

// Con la BD simulada no se sirve nada protegido (ni el acceso)
function rejectMockDb(isMockMode) {
  return function rejectMockDbMiddleware(_req, res, next) {
    if (isMockMode()) {
      res.status(503).json({ error: 'mock_db' });
      return;
    }
    next();
  };
}

// RF-1c: tras `max` fallos dentro de `windowMs`, bloqueado hasta que pase `windowMs` desde el
// último. Global (no por IP): con ngrok todas las peticiones parecen venir del mismo sitio.
function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  let failures = []; // momentos de los fallos recientes
  let blockedUntil = 0;
  const forgetOld = () => { failures = failures.filter((t) => now() - t < windowMs); };
  return {
    isBlocked() {
      return now() < blockedUntil;
    },
    fail() {
      forgetOld();
      failures.push(now());
      if (failures.length >= max) {
        blockedUntil = now() + windowMs;
        failures = [];
      }
    },
    reset() {
      failures = [];
      blockedUntil = 0;
    },
  };
}

// Sesión de 8 h solo para Alsinext
function signAdminToken(adminId, secret) {
  return jwt.sign({ scope: ADMIN_SCOPE }, secret, {
    subject: String(adminId),
    expiresIn: `${TOKEN_HOURS}h`,
    algorithm: 'HS256',
  });
}

// Devuelve el contenido del token si es válido, del administrador y no ha caducado; si no, null
function verifyAdminToken(token, secret) {
  if (typeof token !== 'string' || token === '') return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return payload && payload.scope === ADMIN_SCOPE && payload.sub ? payload : null;
  } catch {
    return null;
  }
}

// POST /admin/login { username, password } (RF-1b, RF-1c)
// deps: findAdminByUsername, comparePassword, dummyHash, limiter, secret
function createAdminLogin({ findAdminByUsername, comparePassword, dummyHash, limiter, secret }) {
  return async function adminLogin(req, res, next) {
    try {
      if (limiter.isBlocked()) {
        res.status(429).json({ error: 'too_many_attempts' });
        return;
      }
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        limiter.fail();
        res.status(401).json({ error: 'wrong_credentials' });
        return;
      }
      const admin = await findAdminByUsername(username.trim());
      // Si el usuario no existe se compara igualmente (con un hash ficticio): misma respuesta
      // y mismo tiempo, para no revelar qué usuarios existen
      const matches = await comparePassword(password, admin ? admin.password_hash : dummyHash);
      if (!admin || !matches) {
        limiter.fail();
        res.status(401).json({ error: 'wrong_credentials' });
        return;
      }
      // RF-1f: cuenta creada desde la web pero sin permiso todavía (is_admin = 0 en la BD)
      if (Number(admin.is_admin) !== 1) {
        res.status(403).json({ error: 'not_admin' });
        return;
      }
      limiter.reset();
      res.json({ token: signAdminToken(admin.id, secret) });
    } catch (error) {
      next(error);
    }
  };
}

// POST /admin/register { username, password } (RF-1f, RF-1g): crea la cuenta SIN permiso;
// el responsable la hace administradora poniendo is_admin = 1 en la base de datos.
// deps: hashPassword, insertAccount(username, hash), limiter (cuentas nuevas por ventana)
function createAdminRegister({ hashPassword, insertAccount, limiter }) {
  return async function adminRegister(req, res, next) {
    try {
      if (limiter.isBlocked()) {
        res.status(429).json({ error: 'too_many_attempts' });
        return;
      }
      const { username, password } = req.body || {};
      const cleanUsername = typeof username === 'string' ? username.trim() : '';
      if (!isValidAdminUsername(cleanUsername)) {
        res.status(400).json({ error: 'invalid_username' });
        return;
      }
      if (!isValidAdminPassword(password)) {
        res.status(400).json({ error: 'invalid_password' });
        return;
      }
      try {
        await insertAccount(cleanUsername, await hashPassword(password));
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          res.status(409).json({ error: 'username_taken' });
          return;
        }
        throw error;
      }
      limiter.fail(); // cuenta como una cuenta nueva para el límite de 5 cada 15 min
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

// Rutas protegidas: token en «Authorization: Bearer …» (nunca en la URL) de un administrador
// que todavía existe. Deja req.alsinextAdmin = { id }.
function requireAlsinextAdmin({ secret, findAdminById }) {
  return async function requireAlsinextAdminMiddleware(req, res, next) {
    try {
      const header = req.headers?.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const payload = verifyAdminToken(token, secret);
      const admin = payload ? await findAdminById(Number(payload.sub)) : null;
      if (!admin) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      req.alsinextAdmin = { id: admin.id };
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Resultado de runPairing → código HTTP
const STATUS_BY_CODE = {
  already_paired: 409, // RF-8
  not_enough_participants: 400, // RF-10
  no_champions: 400,
  missing_key: 503,
  mock_db: 503,
  gemini_failed: 502, // RF-9: se puede reintentar
  not_paired_yet: 409, // RF-15: «Emparejar nuevos» antes de emparejar
  no_newcomers: 409,
  waiting_for_another: 409,
  pairing_changed: 409, // se puede reintentar
  no_missing_titles: 409, // RF-13f: «Generar títulos» sin nada que generar
};

function pairingHttpStatus(result) {
  if (result.ok) return 200;
  return STATUS_BY_CODE[result.code] || 500;
}

// POST /pair y POST /pair/newcomers: un único emparejamiento a la vez en este proceso (comparten
// `lock`); los demás reciben 409. (Las transacciones y el correo único protegen entre procesos.)
function createPairHandler(runPairingNow, lock = { inProgress: false }) {
  return async function pairHandler(_req, res, next) {
    if (lock.inProgress) {
      res.status(409).json({ ok: false, code: 'pairing_in_progress', message: 'Ya se está emparejando; espera a que termine.' });
      return;
    }
    lock.inProgress = true;
    try {
      const result = await runPairingNow();
      // Los resultados son resúmenes sin correos; los errores, solo código y mensaje
      const body = result.ok ? result : { ok: false, code: result.code, message: result.message };
      res.status(pairingHttpStatus(result)).json(body);
    } catch (error) {
      next(error);
    } finally {
      lock.inProgress = false;
    }
  };
}

// RF-19, RF-20: presentación activa para la vista Burbujas. Vive en la memoria del proceso (se
// pierde al reiniciar). start(teams) fija una copia de los equipos (nombres y fotos) y devuelve
// un id nuevo; current() los entrega solo durante `activeMs` (10 min).
// Cambio 2026-10-18: start(teams, { instant }) marca la presentación como instantánea («Mostrar
// equipos»): las pantallas muestran la cuadrícula final sin tómbola.
function createPresentationState({ now = Date.now, activeMs = 10 * 60 * 1000 } = {}) {
  let presentation = null; // { id, startedAt, teams, selected, instant }
  const isActive = () => Boolean(presentation) && now() - presentation.startedAt < activeMs;
  return {
    start(teams, { instant = false } = {}) {
      const id = Math.max(now(), (presentation?.id || 0) + 1); // siempre distinto del anterior
      presentation = { id, startedAt: now(), teams: JSON.parse(JSON.stringify(teams)), selected: null, instant: Boolean(instant) };
      return id;
    },
    // RF-13i: equipo que el administrador ha pulsado en la cuadrícula final (índice o null).
    // Devuelve null si todo va bien, o el código del fallo.
    select(index) {
      if (!isActive()) return 'no_presentation';
      const valid = index === null || (Number.isInteger(index) && index >= 0 && index < presentation.teams.length);
      if (!valid) return 'invalid_team';
      presentation.selected = index;
      return null;
    },
    current() {
      if (!isActive()) return { active: false };
      return { active: true, id: presentation.id, teams: presentation.teams, selected: presentation.selected, instant: presentation.instant };
    },
  };
}

module.exports = {
  ADMIN_SCOPE,
  isUsableSecret,
  requireConfiguredSecret,
  isValidAdminPassword,
  isValidAdminUsername,
  rejectMockDb,
  createLoginLimiter,
  signAdminToken,
  verifyAdminToken,
  createAdminLogin,
  createAdminRegister,
  requireAlsinextAdmin,
  pairingHttpStatus,
  createPairHandler,
  createPresentationState,
};
