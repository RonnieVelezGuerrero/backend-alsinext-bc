// Tests de los participantes ficticios de la demo (spec 006, T5): el archivo de datos y las
// órdenes load / delete con base de datos y disco falsos.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { isValidName, isValidAiUsage, isValidStyle, PHOTO_STYLES } = require('./alsinext.logic');
const {
  DEMO_DOMAIN,
  demoEmail,
  isDemoEmail,
  buildDemoParticipants,
  runDemo,
} = require('./alsinext.demo');

const DATA = require('./demo/participants.json');

// ---------- Archivo de datos (RF-16) ----------

test('participants.json: 100 ficticios con nombre y apellido y respuesta válida [RF-16]', () => {
  assert.equal(DATA.length, 100);
  for (const p of DATA) {
    assert.ok(isValidName(p.name), p.name);
    assert.ok(p.name.trim().split(/\s+/).length >= 2, `${p.name}: nombre y apellido`);
    assert.ok(isValidAiUsage(p.aiUsage), `${p.name}: respuesta de 10–500 caracteres`);
  }
  assert.equal(new Set(DATA.map((p) => p.name)).size, 100, 'nombres distintos');
  assert.equal(new Set(DATA.map((p) => p.aiUsage)).size, 100, 'respuestas distintas');
});

test('participants.json: respuestas repartidas entre las 6 mesas (las 12 temáticas de champions) [RF-16]', () => {
  const byTable = {};
  for (const p of DATA) byTable[p.table] = (byTable[p.table] || 0) + 1;
  assert.deepEqual(byTable, { 1: 17, 2: 17, 3: 17, 4: 17, 5: 16, 6: 16 });
});

test('participants.json: los 20 de antes no cambian (mismo orden, nombre, mesa y respuesta) [RF-16]', () => {
  const first = DATA.slice(0, 20);
  assert.deepEqual(first.map((p) => p.name), [
    'Laura Méndez Soler', 'Marc Puig Ferrer', 'Elena Vidal Roca', 'Javier Ortega Ruiz',
    'Sonia Castro León', 'Pablo Navarro Gil', 'Nuria Serra Pons', 'Andrés Molina Paz',
    'Carla Ibáñez Mora', 'Óscar Lozano Vega', 'Irene Campos Duran', 'David Romero Sanz',
    'Lucía Herrera Gómez', 'Sergi Martí Vall', 'Marta Rubio Cano', 'Raquel Fuentes Prieto',
    'Hugo Delgado Ramos', 'Paula Esteve Bosch', 'Iván Cortés Blanco', 'Alba Medina Torres',
  ]);
  assert.deepEqual(first.map((p) => p.table), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
  assert.match(first[0].aiUsage, /^Pasaría las transcripciones de las reuniones de obra a actas/);
});

test('participants.json: cada uno con un estilo de la web, 20 de cada [RF-16b]', () => {
  const byStyle = {};
  for (const p of DATA) {
    assert.ok(isValidStyle(p.style), `${p.name}: estilo «${p.style}»`);
    byStyle[p.style] = (byStyle[p.style] || 0) + 1;
  }
  assert.deepEqual(Object.keys(byStyle).sort(), [...PHOTO_STYLES].sort());
  assert.ok(Object.values(byStyle).every((n) => n === 20), JSON.stringify(byStyle));
});

test('participants.json: sin correos, teléfonos ni nombres de champions reales', () => {
  const text = JSON.stringify(DATA);
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /\d{9}/);
  for (const champion of ['Orteu', 'Giancola', 'Crespo', 'Ugarte', 'Benavente', 'Figueira',
    'Limones', 'Gaya', 'Soteras', 'Rodríguez', 'Prades', 'Rocamora']) {
    assert.doesNotMatch(text, new RegExp(champion), champion);
  }
});

// ---------- Correos de demo ----------

test('demoEmail / isDemoEmail: demo001…demo100@demo.alsinext.test [RF-17]', () => {
  assert.equal(DEMO_DOMAIN, 'demo.alsinext.test');
  assert.equal(demoEmail(0), 'demo001@demo.alsinext.test');
  assert.equal(demoEmail(99), 'demo100@demo.alsinext.test');
  assert.equal(new Set(DATA.map((_, i) => demoEmail(i))).size, 100, 'correos distintos');
  assert.equal(isDemoEmail('demo07@demo.alsinext.test'), true);
  assert.equal(isDemoEmail('DEMO07@Demo.Alsinext.Test'), true);
  assert.equal(isDemoEmail('ana@alsina.com'), false);
  assert.equal(isDemoEmail('x@demo.alsinext.test.evil.com'), false);
});

test('buildDemoParticipants: correo, nombre, respuesta, estilo, foto y copia con efecto [RF-16b]', () => {
  const list = buildDemoParticipants(DATA);
  assert.equal(list.length, 100);
  assert.deepEqual(list[0], {
    email: 'demo001@demo.alsinext.test',
    name: DATA[0].name,
    aiUsage: DATA[0].aiUsage,
    style: DATA[0].style,
    photo: 'face001-photo.jpg',
    styled: 'face001-styled.jpg',
  });
  assert.equal(list[19].photo, 'face020-photo.jpg');
  assert.equal(list[99].styled, 'face100-styled.jpg');
  assert.equal(list[99].email, 'demo100@demo.alsinext.test');
});

// ---------- runDemo con BD y disco falsos ----------

const DIRS = { facesDir: '/caras', uploadsDir: '/uploads' };

function fakeDeps({ mock = false, existing = [], faces = 100, withoutStyled = null, demoTeams = [], demoRows = [], failInsertAt = null } = {}) {
  const log = { inserts: [], copied: [], removed: [], deleted: [], transactions: 0 };
  const faceFiles = new Set();
  for (let i = 1; i <= faces; i++) {
    const n = String(i).padStart(3, '0');
    faceFiles.add(path.join('/caras', `face${n}-photo.jpg`));
    if (i !== withoutStyled) faceFiles.add(path.join('/caras', `face${n}-styled.jpg`));
  }
  let counter = 0;
  const query = async (sql, params = []) => {
    if (/select email from alsinext_compromisos/i.test(sql)) return existing.map((email) => ({ email }));
    if (/insert into alsinext_compromisos/i.test(sql)) {
      if (failInsertAt !== null && log.inserts.length === failInsertAt) throw new Error('fallo de la BD');
      log.inserts.push(params);
      return { insertId: log.inserts.length };
    }
    if (/select distinct team_id/i.test(sql)) return demoTeams.map((team_id) => ({ team_id }));
    if (/select image_filename/i.test(sql)) return demoRows;
    throw new Error(`consulta inesperada: ${sql}`);
  };
  return {
    log,
    deps: {
      ...DIRS,
      isMockMode: () => mock,
      query,
      withTransaction: async (handler) => {
        log.transactions += 1;
        return handler({ query: async (sql, params) => { log.deleted.push({ sql, params }); return [{ affectedRows: 1 }]; } });
      },
      fileExists: (file) => faceFiles.has(file),
      copyFile: async (from, to) => { log.copied.push({ from, to }); },
      removeFile: async (file) => { log.removed.push(file); },
      randomName: () => `uuid-${++counter}.jpg`,
    },
  };
}

test('runDemo load: con la BD simulada no hace nada', async () => {
  const { deps, log } = fakeDeps({ mock: true });
  const result = await runDemo('load', DATA, deps);
  assert.equal(result.code, 'mock_db');
  assert.equal(log.inserts.length + log.copied.length, 0);
});

test('runDemo load: si falta alguna foto no copia ni inserta nada [RF-16b]', async () => {
  const { deps, log } = fakeDeps({ faces: 99 });
  const result = await runDemo('load', DATA, deps);
  assert.equal(result.code, 'missing_files');
  assert.match(result.message, /face100-photo\.jpg/);
  assert.equal(log.inserts.length + log.copied.length, 0);
});

test('runDemo load: si falta una copia con efecto tampoco carga nada [RF-16b]', async () => {
  const { deps, log } = fakeDeps({ withoutStyled: 37 });
  const result = await runDemo('load', DATA, deps);
  assert.equal(result.code, 'missing_files');
  assert.match(result.message, /face037-styled\.jpg/);
  assert.equal(log.inserts.length + log.copied.length, 0);
});

test('runDemo load: si falla la BD al insertar, borra las dos fotos que acababa de copiar', async () => {
  const { deps, log } = fakeDeps({ failInsertAt: 0 });
  await assert.rejects(() => runDemo('load', DATA, deps), /fallo de la BD/);
  assert.deepEqual(log.removed.sort(), [path.join('/uploads', 'uuid-1.jpg'), path.join('/uploads', 'uuid-2.jpg')]);
});

test('runDemo load: copia foto y copia con efecto con nombre aleatorio e inserta los 100 con su estilo [RF-16, RF-16b]', async () => {
  const { deps, log } = fakeDeps();
  const result = await runDemo('load', DATA, deps);
  assert.equal(result.ok, true);
  assert.equal(log.copied.length, 200);
  assert.deepEqual(log.copied[0], { from: path.join('/caras', 'face001-photo.jpg'), to: path.join('/uploads', 'uuid-1.jpg') });
  assert.deepEqual(log.copied[1], { from: path.join('/caras', 'face001-styled.jpg'), to: path.join('/uploads', 'uuid-2.jpg') });
  assert.equal(log.inserts.length, 100);
  // [email, name, ai_usage, image_filename, styled_filename, style]
  assert.deepEqual(log.inserts[0], ['demo001@demo.alsinext.test', DATA[0].name, DATA[0].aiUsage, 'uuid-1.jpg', 'uuid-2.jpg', DATA[0].style]);
  assert.match(result.message, /100/);
  assert.doesNotMatch(result.message, /@/);
});

test('runDemo load: salta los ficticios que ya existen (se puede repetir)', async () => {
  const { deps, log } = fakeDeps({ existing: ['demo001@demo.alsinext.test', 'demo002@demo.alsinext.test'] });
  const result = await runDemo('load', DATA, deps);
  assert.equal(result.ok, true);
  assert.equal(log.inserts.length, 98);
  assert.equal(log.copied.length, 196);
});

test('runDemo delete: borra equipos enteros con ficticios, sus compromisos y sus fotos [RF-17]', async () => {
  const demoRows = [
    { image_filename: 'a.jpg', styled_filename: null },
    { image_filename: 'b.jpg', styled_filename: 'b-copia.jpg' },
  ];
  const { deps, log } = fakeDeps({ demoTeams: [3, 5], demoRows });
  const result = await runDemo('delete', DATA, deps);
  assert.equal(result.ok, true);
  assert.equal(log.transactions, 1);
  const sqls = log.deleted.map((d) => d.sql);
  assert.ok(sqls.some((s) => /delete from alsinext_equipos where team_id in/i.test(s)), 'equipos enteros');
  assert.deepEqual(log.deleted.find((d) => /alsinext_equipos/.test(d.sql)).params, [3, 5]);
  // Los compromisos se borran SOLO por el dominio de demo
  const commitments = log.deleted.find((d) => /delete from alsinext_compromisos/i.test(d.sql));
  assert.match(commitments.sql, /email like \?/i);
  assert.deepEqual(commitments.params, ['%@demo.alsinext.test']);
  assert.deepEqual(log.removed.sort(), [path.join('/uploads', 'a.jpg'), path.join('/uploads', 'b-copia.jpg'), path.join('/uploads', 'b.jpg')].sort());
});

test('runDemo delete: sin equipos de demo no toca alsinext_equipos', async () => {
  const { deps, log } = fakeDeps({ demoTeams: [], demoRows: [] });
  await runDemo('delete', DATA, deps);
  assert.ok(!log.deleted.some((d) => /alsinext_equipos/.test(d.sql)));
});

test('runDemo: acción desconocida → usage', async () => {
  const { deps } = fakeDeps();
  const result = await runDemo('borrar-todo', DATA, deps);
  assert.equal(result.code, 'usage');
});

test('runDemo delete: borra también el título de los equipos que borra (no quedan huérfanos) [RF-17, RF-13f]', async () => {
  const { deps, log } = fakeDeps({ demoTeams: [2, 5], demoRows: [] });
  await runDemo('delete', [], deps);
  const titles = log.deleted.find((d) => /delete from alsinext_equipos_titulos/i.test(d.sql));
  assert.ok(titles, 'borra los títulos');
  assert.deepEqual(titles.params, [2, 5], 'solo los de esos equipos');
});

test('runDemo delete: sin equipos de la demo no borra ningún título', async () => {
  const { deps, log } = fakeDeps({ demoTeams: [], demoRows: [] });
  await runDemo('delete', [], deps);
  assert.ok(!log.deleted.some((d) => /alsinext_equipos_titulos/i.test(d.sql)));
});
