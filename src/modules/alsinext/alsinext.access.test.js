// Tests de la protección de la vista de emparejamiento con el administrador de Alsinext
// (spec 006, T6). req/res falsos; el token se firma de verdad con jsonwebtoken.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
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
} = require('./alsinext.access');

const SECRET = 'secreto-de-prueba';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run(middleware, req = {}) {
  const res = fakeRes();
  let nextCalled = false;
  let nextError;
  await middleware(req, res, (error) => { nextCalled = true; nextError = error; });
  return { res, nextCalled, nextError };
}

// ---------- Secreto de las sesiones ----------

test('isUsableSecret: el secreto por defecto del código o uno corto no sirven', () => {
  assert.equal(isUsableSecret('change_this_in_production'), false);
  assert.equal(isUsableSecret('corto'), false);
  assert.equal(isUsableSecret(''), false);
  assert.equal(isUsableSecret(undefined), false);
  assert.equal(isUsableSecret('x'.repeat(32)), true);
});

test('requireConfiguredSecret: sin un secreto propio → 503 not_configured y no sigue', async () => {
  const blocked = await run(requireConfiguredSecret('change_this_in_production'));
  assert.equal(blocked.res.statusCode, 503);
  assert.equal(blocked.res.body.error, 'not_configured');
  assert.equal(blocked.nextCalled, false);
  assert.equal((await run(requireConfiguredSecret('x'.repeat(32)))).nextCalled, true);
});

// ---------- Contraseña (RF-1f) ----------

test('isValidAdminPassword: mínimo 6 caracteres, solo texto', () => {
  assert.equal(isValidAdminPassword('a'.repeat(6)), true);
  assert.equal(isValidAdminPassword('a'.repeat(5)), false);
  assert.equal(isValidAdminPassword(''), false);
  assert.equal(isValidAdminPassword(null), false);
  assert.equal(isValidAdminPassword(123456), false);
});

test('isValidAdminUsername: 3–80 caracteres de letras, números, punto, guion o guion bajo', () => {
  assert.equal(isValidAdminUsername('admin'), true);
  assert.equal(isValidAdminUsername('organizador.alsinext_2026'), true);
  assert.equal(isValidAdminUsername('ab'), false);
  assert.equal(isValidAdminUsername('a'.repeat(81)), false);
  assert.equal(isValidAdminUsername('con espacio'), false);
  assert.equal(isValidAdminUsername("x'; DROP TABLE"), false);
  assert.equal(isValidAdminUsername(undefined), false);
});

// ---------- rejectMockDb ----------

test('rejectMockDb: con la BD simulada → 503 mock_db y no sigue', async () => {
  const { res, nextCalled } = await run(rejectMockDb(() => true));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'mock_db');
  assert.equal(nextCalled, false);
});

test('rejectMockDb: con MySQL real sigue', async () => {
  assert.equal((await run(rejectMockDb(() => false))).nextCalled, true);
});

// ---------- createLoginLimiter (RF-1c) ----------

test('createLoginLimiter: 5 fallos en 15 min → bloqueado; se libera al pasar 15 min', () => {
  let now = 0;
  const limiter = createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000, now: () => now });
  for (let i = 0; i < 4; i++) limiter.fail();
  assert.equal(limiter.isBlocked(), false, '4 fallos todavía no bloquean');
  limiter.fail();
  assert.equal(limiter.isBlocked(), true, 'el 5.º fallo bloquea');
  now += 15 * 60 * 1000 - 1;
  assert.equal(limiter.isBlocked(), true);
  now += 1;
  assert.equal(limiter.isBlocked(), false, 'a los 15 min se libera');
});

test('createLoginLimiter: los fallos antiguos (más de 15 min) no cuentan', () => {
  let now = 0;
  const limiter = createLoginLimiter({ max: 5, windowMs: 1000, now: () => now });
  for (let i = 0; i < 4; i++) limiter.fail();
  now = 1500; // los 4 anteriores ya han caducado
  limiter.fail();
  assert.equal(limiter.isBlocked(), false);
});

test('createLoginLimiter: un acierto reinicia el contador', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: 1000, now: () => 0 });
  for (let i = 0; i < 4; i++) limiter.fail();
  limiter.reset();
  for (let i = 0; i < 4; i++) limiter.fail();
  assert.equal(limiter.isBlocked(), false);
});

// ---------- Token (sesión de 8 h solo para Alsinext) ----------

test('signAdminToken / verifyAdminToken: token válido con scope alsinext_admin', () => {
  const token = signAdminToken(7, SECRET);
  const payload = verifyAdminToken(token, SECRET);
  assert.equal(payload.sub, '7');
  assert.equal(payload.scope, ADMIN_SCOPE);
  assert.equal(jwt.decode(token).exp - jwt.decode(token).iat, 8 * 60 * 60, 'caduca a las 8 h');
});

test('verifyAdminToken: caducado, mal firmado o de otro scope (p. ej. del portal) → null', () => {
  const expired = jwt.sign({ sub: '7', scope: ADMIN_SCOPE }, SECRET, { expiresIn: -10 });
  assert.equal(verifyAdminToken(expired, SECRET), null);
  assert.equal(verifyAdminToken(signAdminToken(7, 'otro-secreto'), SECRET), null);
  const portal = jwt.sign({ id: 83, email: 'x@alsina.com' }, SECRET, { expiresIn: '8h' });
  assert.equal(verifyAdminToken(portal, SECRET), null);
  assert.equal(verifyAdminToken('basura', SECRET), null);
  assert.equal(verifyAdminToken('', SECRET), null);
});

// ---------- createAdminLogin (RF-1b, RF-1c) ----------

function loginDeps({ admin = { id: 7, password_hash: 'HASH-BUENO', is_admin: 1 }, blocked = false } = {}) {
  const log = { compared: [], fails: 0, resets: 0 };
  return {
    log,
    deps: {
      findAdminByUsername: async (username) => (admin && username === 'admin' ? admin : null),
      comparePassword: async (password, hash) => {
        log.compared.push(hash);
        return hash === 'HASH-BUENO' && password === 'contraseña-correcta';
      },
      dummyHash: 'HASH-FICTICIO',
      limiter: {
        isBlocked: () => blocked,
        fail: () => { log.fails += 1; },
        reset: () => { log.resets += 1; },
      },
      secret: SECRET,
    },
  };
}

test('createAdminLogin: usuario y contraseña correctos → 200 con token de administrador', async () => {
  const { deps, log } = loginDeps();
  const { res } = await run(createAdminLogin(deps), { body: { username: 'admin', password: 'contraseña-correcta' } });
  assert.equal(res.statusCode, 200);
  assert.equal(verifyAdminToken(res.body.token, SECRET).sub, '7');
  assert.equal(log.resets, 1, 'el acierto reinicia el contador');
  assert.equal(log.fails, 0);
});

test('createAdminLogin: contraseña mala → 401 wrong_credentials y cuenta el fallo', async () => {
  const { deps, log } = loginDeps();
  const { res } = await run(createAdminLogin(deps), { body: { username: 'admin', password: 'mala' } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'wrong_credentials' });
  assert.equal(log.fails, 1);
});

test('createAdminLogin: usuario inexistente → la misma respuesta y también compara (mismo tiempo)', async () => {
  const { deps, log } = loginDeps();
  const { res } = await run(createAdminLogin(deps), { body: { username: 'nadie', password: 'contraseña-correcta' } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'wrong_credentials' });
  assert.deepEqual(log.compared, ['HASH-FICTICIO']);
  assert.equal(log.fails, 1);
});

test('createAdminLogin: bloqueado → 429 too_many_attempts sin comprobar la contraseña [RF-1c]', async () => {
  const { deps, log } = loginDeps({ blocked: true });
  const { res } = await run(createAdminLogin(deps), { body: { username: 'admin', password: 'contraseña-correcta' } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'too_many_attempts');
  assert.equal(log.compared.length, 0);
});

test('createAdminLogin: cuenta sin permiso (is_admin = 0) → 403 not_admin, sin token ni fallo [RF-1f]', async () => {
  const { deps, log } = loginDeps({ admin: { id: 8, password_hash: 'HASH-BUENO', is_admin: 0 } });
  const { res } = await run(createAdminLogin(deps), { body: { username: 'admin', password: 'contraseña-correcta' } });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'not_admin' });
  assert.equal(log.fails, 0, 'la contraseña era correcta: no cuenta como fallo');
});

test('createAdminLogin: cuenta sin permiso con contraseña mala → 401 (no revela que existe)', async () => {
  const { deps } = loginDeps({ admin: { id: 8, password_hash: 'HASH-BUENO', is_admin: 0 } });
  const { res } = await run(createAdminLogin(deps), { body: { username: 'admin', password: 'mala' } });
  assert.equal(res.statusCode, 401);
});

test('createAdminLogin: sin usuario o contraseña (o no son texto) → 401 y cuenta el fallo', async () => {
  for (const body of [{}, { username: 'admin' }, { username: ['admin'], password: 'x' }, undefined]) {
    const { deps, log } = loginDeps();
    const { res } = await run(createAdminLogin(deps), { body });
    assert.equal(res.statusCode, 401, JSON.stringify(body));
    assert.equal(log.fails, 1);
  }
});

// ---------- createAdminRegister (RF-1f, RF-1g) ----------

function registerDeps({ blocked = false, insertError = null } = {}) {
  const log = { inserts: [], counted: 0 };
  return {
    log,
    deps: {
      hashPassword: async (password) => `HASH(${password})`,
      insertAccount: async (username, hash) => {
        if (insertError) throw insertError;
        log.inserts.push([username, hash]);
      },
      limiter: { isBlocked: () => blocked, fail: () => { log.counted += 1; }, reset: () => {} },
    },
  };
}

test('createAdminRegister: crea la cuenta sin permiso, guardando solo el hash → 201', async () => {
  const { deps, log } = registerDeps();
  const { res } = await run(createAdminRegister(deps), { body: { username: ' admin ', password: 'contraseña-larga-1' } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(log.inserts, [['admin', 'HASH(contraseña-larga-1)']], 'usuario sin espacios; nunca la contraseña tal cual');
  assert.equal(log.counted, 1, 'cuenta para el límite de cuentas nuevas');
});

test('createAdminRegister: usuario o contraseña no válidos → 400 sin guardar nada', async () => {
  for (const [body, code] of [
    [{ username: 'ab', password: 'contraseña-larga-1' }, 'invalid_username'],
    [{ username: 'con espacio', password: 'contraseña-larga-1' }, 'invalid_username'],
    [{ username: 'admin', password: 'corta' }, 'invalid_password'],
    [{}, 'invalid_username'],
  ]) {
    const { deps, log } = registerDeps();
    const { res } = await run(createAdminRegister(deps), { body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.body.error, code);
    assert.equal(log.inserts.length, 0);
  }
});

test('createAdminRegister: usuario repetido → 409 username_taken [RF-1g]', async () => {
  const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
  const { deps } = registerDeps({ insertError: duplicate });
  const { res } = await run(createAdminRegister(deps), { body: { username: 'admin', password: 'contraseña-larga-1' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'username_taken');
});

test('createAdminRegister: con el límite alcanzado → 429 sin guardar nada [RF-1g]', async () => {
  const { deps, log } = registerDeps({ blocked: true });
  const { res } = await run(createAdminRegister(deps), { body: { username: 'admin', password: 'contraseña-larga-1' } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'too_many_attempts');
  assert.equal(log.inserts.length, 0);
});

test('createAdminRegister: otros errores de la BD pasan a next(error)', async () => {
  const boom = new Error('boom');
  const { deps } = registerDeps({ insertError: boom });
  const { nextError } = await run(createAdminRegister(deps), { body: { username: 'admin', password: 'contraseña-larga-1' } });
  assert.equal(nextError, boom);
});

// ---------- requireAlsinextAdmin (RF-1) ----------

function guard(findAdminById = async (id) => (id === 7 ? { id: 7 } : null)) {
  return requireAlsinextAdmin({ secret: SECRET, findAdminById });
}

test('requireAlsinextAdmin: token válido en Authorization: Bearer → sigue y deja req.alsinextAdmin', async () => {
  const req = { headers: { authorization: `Bearer ${signAdminToken(7, SECRET)}` } };
  const { nextCalled } = await run(guard(), req);
  assert.equal(nextCalled, true);
  assert.deepEqual(req.alsinextAdmin, { id: 7 });
});

test('requireAlsinextAdmin: sin token, token del portal o caducado → 401 unauthorized', async () => {
  const portal = jwt.sign({ id: 83 }, SECRET, { expiresIn: '8h' });
  const expired = jwt.sign({ sub: '7', scope: ADMIN_SCOPE }, SECRET, { expiresIn: -10 });
  for (const headers of [{}, { authorization: 'Bearer ' }, { authorization: `Bearer ${portal}` }, { authorization: `Bearer ${expired}` }]) {
    const { res, nextCalled } = await run(guard(), { headers });
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(nextCalled, false);
  }
});

test('requireAlsinextAdmin: el token no se acepta en la URL (?token=)', async () => {
  const { res } = await run(guard(), { headers: {}, query: { token: signAdminToken(7, SECRET) } });
  assert.equal(res.statusCode, 401);
});

test('requireAlsinextAdmin: administrador borrado después de entrar → 401', async () => {
  const req = { headers: { authorization: `Bearer ${signAdminToken(9, SECRET)}` } };
  const { res } = await run(guard(), req);
  assert.equal(res.statusCode, 401);
});

test('requireAlsinextAdmin: un error de la BD pasa a next(error)', async () => {
  const boom = new Error('boom');
  const req = { headers: { authorization: `Bearer ${signAdminToken(7, SECRET)}` } };
  const { nextError } = await run(guard(async () => { throw boom; }), req);
  assert.equal(nextError, boom);
});

// ---------- pairingHttpStatus y createPairHandler ----------

test('pairingHttpStatus: traduce el resultado de runPairing a código HTTP [RF-8…RF-10]', () => {
  assert.equal(pairingHttpStatus({ ok: true }), 200);
  assert.equal(pairingHttpStatus({ ok: false, code: 'already_paired' }), 409);
  assert.equal(pairingHttpStatus({ ok: false, code: 'not_enough_participants' }), 400);
  assert.equal(pairingHttpStatus({ ok: false, code: 'no_champions' }), 400);
  assert.equal(pairingHttpStatus({ ok: false, code: 'missing_key' }), 503);
  assert.equal(pairingHttpStatus({ ok: false, code: 'mock_db' }), 503);
  assert.equal(pairingHttpStatus({ ok: false, code: 'gemini_failed' }), 502);
  assert.equal(pairingHttpStatus({ ok: false, code: 'otro' }), 500);
});

test('createPairHandler: devuelve el resultado con su código HTTP', async () => {
  const handler = createPairHandler(async () => ({ ok: true, teams: 10, participants: 20, message: 'ok' }));
  const { res } = await run(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, teams: 10, participants: 20, message: 'ok' });
});

test('createPairHandler: los errores llevan code y message, sin más datos', async () => {
  const handler = createPairHandler(async () => ({ ok: false, code: 'gemini_failed', message: 'Gemini no ha respondido bien' }));
  const { res } = await run(handler);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { ok: false, code: 'gemini_failed', message: 'Gemini no ha respondido bien' });
});

test('createPairHandler: solo un emparejamiento a la vez → el segundo recibe 409 pairing_in_progress', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let runs = 0;
  const handler = createPairHandler(async () => { runs += 1; await pending; return { ok: true, teams: 1, participants: 2, message: 'ok' }; });
  const first = run(handler);
  const second = await run(handler);
  assert.equal(second.res.statusCode, 409);
  assert.equal(second.res.body.code, 'pairing_in_progress');
  finish();
  assert.equal((await first).res.statusCode, 200);
  assert.equal(runs, 1);
  assert.equal((await run(handler)).res.statusCode, 200, 'terminado el primero, se puede volver a intentar');
});

test('createPairHandler: si runPairing lanza un error, se libera el bloqueo y pasa a next(error)', async () => {
  let fail = true;
  const handler = createPairHandler(async () => {
    if (fail) throw new Error('fallo inesperado');
    return { ok: true, teams: 1, participants: 2, message: 'ok' };
  });
  assert.equal((await run(handler)).nextError.message, 'fallo inesperado');
  fail = false;
  assert.equal((await run(handler)).res.statusCode, 200);
});

test('pairingHttpStatus: «Emparejar nuevos» sin nada que hacer o con cambios → 409 [RF-15]', () => {
  for (const code of ['not_paired_yet', 'no_newcomers', 'waiting_for_another', 'pairing_changed']) {
    assert.equal(pairingHttpStatus({ ok: false, code }), 409, code);
  }
});

test('createPairHandler: devuelve también el resumen de «Emparejar nuevos» (sin correos) [RF-15]', async () => {
  const handler = createPairHandler(async () => ({ ok: true, joined: 1, newTeams: 0, participants: 1, message: 'm' }));
  const { res } = await run(handler);
  assert.deepEqual(res.body, { ok: true, joined: 1, newTeams: 0, participants: 1, message: 'm' });
});

test('createPairHandler: «Emparejar» y «Emparejar nuevos» comparten el candado (uno a la vez) [RF-15]', async () => {
  const lock = { inProgress: false };
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const pair = createPairHandler(async () => { await pending; return { ok: true, teams: 1, participants: 2, message: 'ok' }; }, lock);
  const newcomers = createPairHandler(async () => ({ ok: true, joined: 1, newTeams: 0, participants: 1, message: 'ok' }), lock);
  const first = run(pair);
  const second = await run(newcomers);
  assert.equal(second.res.statusCode, 409);
  assert.equal(second.res.body.code, 'pairing_in_progress');
  finish();
  assert.equal((await first).res.statusCode, 200);
  assert.equal((await run(newcomers)).res.statusCode, 200, 'al terminar se libera');
});

// ---------- Presentación activa para la vista Burbujas (RF-19, RF-20, T19) ----------

const TEAMS_SNAPSHOT = [{ id: 1, champion: { name: 'Lluis Orteu', photoUrl: null }, members: [{ name: 'Laura', photoUrl: '/a.jpg' }] }];

test('createPresentationState: sin presentar → inactiva y sin equipos [RF-20]', () => {
  const state = createPresentationState({ now: () => 1000 });
  assert.deepEqual(state.current(), { active: false });
});

test('createPresentationState: al presentar queda activa 10 min con los equipos fijados [RF-19]', () => {
  let clock = 1_000_000;
  const state = createPresentationState({ now: () => clock });
  const id = state.start(TEAMS_SNAPSHOT);
  assert.deepEqual(state.current(), { active: true, id, teams: TEAMS_SNAPSHOT, selected: null, instant: false });
  clock += 10 * 60 * 1000 - 1;
  assert.equal(state.current().active, true, 'justo antes de los 10 min sigue activa');
  clock += 1;
  assert.deepEqual(state.current(), { active: false }, 'a los 10 min deja de entregar los equipos [RF-20]');
});

test('createPresentationState: volver a presentar da un id nuevo (las pantallas la repiten) [RF-19]', () => {
  let clock = 5000;
  const state = createPresentationState({ now: () => clock });
  const first = state.start(TEAMS_SNAPSHOT);
  const second = state.start(TEAMS_SNAPSHOT); // en el mismo milisegundo
  assert.notEqual(first, second);
  clock += 1;
  assert.notEqual(state.start([]), second);
  assert.deepEqual(state.current().teams, []);
});

test('createPresentationState: los equipos fijados no cambian si se modifica la lista original', () => {
  const teams = JSON.parse(JSON.stringify(TEAMS_SNAPSHOT));
  const state = createPresentationState({ now: () => 1 });
  state.start(teams);
  teams[0].members.push({ name: 'Otra', photoUrl: '/b.jpg' });
  assert.equal(state.current().teams[0].members.length, 1);
});

test('pairingHttpStatus: «Generar títulos» sin equipos sin título → 409 [RF-13f]', () => {
  assert.equal(pairingHttpStatus({ ok: false, code: 'no_missing_titles' }), 409);
});

// ---------- Seleccionar un equipo al final (RF-13i, T38) ----------

const THREE_TEAMS = [0, 1, 2].map((i) => ({ id: i + 1, champion: { name: 'C' + i, photoUrl: null }, members: [] }));

test('createPresentationState.select: guarda el equipo seleccionado (o ninguno) y lo entrega [RF-13i]', () => {
  const state = createPresentationState({ now: () => 1000 });
  state.start(THREE_TEAMS);
  assert.equal(state.current().selected, null, 'al empezar, ninguno');
  assert.equal(state.select(2), null, 'sin error');
  assert.equal(state.current().selected, 2);
  assert.equal(state.select(null), null);
  assert.equal(state.current().selected, null);
});

test('createPresentationState.select: sin presentación activa → no_presentation [RF-13i]', () => {
  let clock = 0;
  const state = createPresentationState({ now: () => clock });
  assert.equal(state.select(0), 'no_presentation');
  state.start(THREE_TEAMS);
  clock += 10 * 60 * 1000;
  assert.equal(state.select(0), 'no_presentation', 'pasados los 10 min');
});

test('createPresentationState.select: un número que no es un equipo → invalid_team [RF-13i]', () => {
  const state = createPresentationState({ now: () => 1 });
  state.start(THREE_TEAMS);
  for (const bad of [3, -1, 1.5, '1', undefined, {}]) assert.equal(state.select(bad), 'invalid_team', String(bad));
  assert.equal(state.current().selected, null, 'no cambia');
});

test('createPresentationState: al volver a presentar, no queda ninguno seleccionado [RF-13i]', () => {
  const state = createPresentationState({ now: () => 1 });
  state.start(THREE_TEAMS);
  state.select(1);
  state.start(THREE_TEAMS);
  assert.equal(state.current().selected, null);
});

// ---------- «Mostrar equipos»: presentación instantánea (cambio 2026-10-18) ----------

test('createPresentationState: sin la opción, la presentación no es instantánea [cambio 2026-10-18]', () => {
  const state = createPresentationState({ now: () => 1000 });
  state.start(TEAMS_SNAPSHOT);
  assert.equal(state.current().instant, false);
});

test('createPresentationState: start con instant → current lo entrega; una nueva sin instant vuelve a false [cambio 2026-10-18]', () => {
  const state = createPresentationState({ now: () => 1000 });
  state.start(TEAMS_SNAPSHOT, { instant: true });
  assert.equal(state.current().instant, true);
  state.start(TEAMS_SNAPSHOT);
  assert.equal(state.current().instant, false, 'la presentación siguiente ya no es instantánea');
});
