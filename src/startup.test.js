// Spec 007, T2: salud de la base de datos y errores al arrancar (RF-6, RF-7, RF-9)
const test = require('node:test');
const assert = require('node:assert/strict');

const { healthStatus, startupErrorMessage } = require('./startup');

test('healthStatus: base de datos que contesta → 200 { ok: true } [RF-6]', () => {
  assert.deepEqual(healthStatus(true), { status: 200, body: { ok: true } });
});

test('healthStatus: base de datos que no contesta → 503 { ok: false } [RF-6]', () => {
  assert.deepEqual(healthStatus(false), { status: 503, body: { ok: false } });
});

test('startupErrorMessage: puerto ocupado → dice el puerto y que puede estar encendido el antiguo [RF-9]', () => {
  const error = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  const message = startupErrorMessage(error, 3001);
  assert.match(message, /3001/);
  assert.match(message, /ocupado/);
  assert.match(message, /backend-alsina-tools-vc/);
});

test('startupErrorMessage: falta una variable del .env → el mensaje de loadEnv, sin valores [RF-7]', () => {
  const error = Object.assign(new Error('Faltan variables en el .env: JWT_SECRET'), { code: 'missing_env', missing: ['JWT_SECRET'] });
  const message = startupErrorMessage(error, 3001);
  assert.match(message, /JWT_SECRET/);
  assert.match(message, /\.env\.example/, 'dice de dónde copiarlo');
});

test('startupErrorMessage: cualquier otro error → mensaje general con su texto', () => {
  const message = startupErrorMessage(new Error('algo raro'), 3001);
  assert.match(message, /No se ha podido arrancar backend-alsinext/);
  assert.match(message, /algo raro/);
});
