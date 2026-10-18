// Spec 007, T1: configuración del backend leída solo del .env (RF-5, RF-7, RF-9, RF-11)
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadEnv, REQUIRED_VARS } = require('./loadEnv');

// Valores inventados solo para los tests
const COMPLETE = {
  DB_HOST: 'db.test',
  DB_USER: 'usuario_test',
  DB_NAME: 'alsina_portal',
  JWT_SECRET: 'secreto-de-prueba',
};

test('loadEnv: con las obligatorias, devuelve env con la forma del backend antiguo [RF-5]', () => {
  const env = loadEnv({ ...COMPLETE, DB_PASSWORD: 'clave-test', GEMINI_API_KEY: ' clave-gemini ' });
  assert.deepEqual(env, {
    port: 3001,
    jwtSecret: 'secreto-de-prueba',
    db: { host: 'db.test', port: 3306, user: 'usuario_test', password: 'clave-test', database: 'alsina_portal' },
    gemini: { apiKey: 'clave-gemini', model: 'gemini-3.5-flash-lite' },
  });
});

test('loadEnv: valores por defecto de puerto, contraseña y Gemini [RF-9]', () => {
  const env = loadEnv(COMPLETE);
  assert.equal(env.port, 3001, 'mismo puerto que el antiguo (D-1)');
  assert.equal(env.db.port, 3306);
  assert.equal(env.db.password, '', 'MySQL local sin contraseña');
  assert.equal(env.gemini.apiKey, '', 'sin clave arranca; generar títulos dará gemini_missing_key');
  assert.equal(env.gemini.model, 'gemini-3.5-flash-lite');
});

test('loadEnv: PORT, DB_PORT y GEMINI_MODEL se pueden cambiar', () => {
  const env = loadEnv({ ...COMPLETE, PORT: '4100', DB_PORT: '3307', GEMINI_MODEL: 'otro-modelo' });
  assert.equal(env.port, 4100);
  assert.equal(env.db.port, 3307);
  assert.equal(env.gemini.model, 'otro-modelo');
});

test('loadEnv: las obligatorias son las de la base de datos y el secreto del token', () => {
  assert.deepEqual(REQUIRED_VARS, ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET']);
});

test('loadEnv: si falta una obligatoria, error con su nombre y sin valores [RF-7]', () => {
  const { DB_USER, ...withoutUser } = COMPLETE;
  assert.throws(() => loadEnv({ ...withoutUser, DB_PASSWORD: 'no-mostrar' }), (error) => {
    assert.equal(error.code, 'missing_env');
    assert.deepEqual(error.missing, ['DB_USER']);
    assert.match(error.message, /DB_USER/);
    assert.doesNotMatch(error.message, /db\.test|secreto-de-prueba|no-mostrar|alsina_portal/);
    return true;
  });
});

test('loadEnv: vacías o con solo espacios cuentan como que faltan; las nombra todas [RF-7]', () => {
  assert.throws(() => loadEnv({ DB_HOST: '  ', DB_NAME: 'alsina_portal' }), (error) => {
    assert.deepEqual(error.missing, ['DB_HOST', 'DB_USER', 'JWT_SECRET']);
    return true;
  });
});

test('loadEnv: JWT_SECRET no tiene valor por defecto (lo escribe el responsable, D-4) [RF-11]', () => {
  const { JWT_SECRET, ...withoutSecret } = COMPLETE;
  assert.throws(() => loadEnv(withoutSecret), (error) => error.missing.includes('JWT_SECRET'));
});
