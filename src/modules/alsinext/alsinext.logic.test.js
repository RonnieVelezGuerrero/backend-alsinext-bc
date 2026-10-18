// Tests de la lógica de Alsinext en el servidor. Ejecutar con:
//   node --test src/modules/alsinext/
// Los casos de correo son LOS MISMOS que en el frontend (apps/alsinext/src/models/email.test.js),
// para que navegador y servidor nunca discrepen.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  isValidEmail,
  toPublicPhotos,
  championPhotoUrl,
  toPublicTeams,
  isValidStyle,
  PHOTO_STYLES,
  normalizeName,
  isValidName,
  normalizeAiUsage,
  isValidAiUsage,
} = require('./alsinext.logic');

// ---------- normalizeEmail (T18) ----------

test('normalizeEmail: quita espacios al principio y al final', () => {
  assert.equal(normalizeEmail('  ana@alsina.com  '), 'ana@alsina.com');
});

test('normalizeEmail: pasa a minúsculas (B6: Ana@Alsina.com = ana@alsina.com)', () => {
  assert.equal(normalizeEmail('Ana@Alsina.COM'), 'ana@alsina.com');
  assert.equal(normalizeEmail(' Ana@Alsina.com'), normalizeEmail('ana@alsina.com '));
});

test('normalizeEmail: valores que no son texto → texto vacío (no rompe)', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});

// ---------- isValidEmail (T18) ----------

test('isValidEmail: correos válidos', () => {
  assert.equal(isValidEmail('ana@alsina.com'), true);
  assert.equal(isValidEmail('ana.garcia+ia@alsina.es'), true);
  assert.equal(isValidEmail('a@b.co'), true);
});

test('isValidEmail: "a@b" no es válido (el navegador lo acepta, el servidor no)', () => {
  assert.equal(isValidEmail('a@b'), false);
});

test('isValidEmail: sin arroba, con dos arrobas o con partes vacías → no válido', () => {
  assert.equal(isValidEmail('ana.alsina.com'), false);
  assert.equal(isValidEmail('ana@@alsina.com'), false);
  assert.equal(isValidEmail('@alsina.com'), false);
  assert.equal(isValidEmail('ana@'), false);
  assert.equal(isValidEmail(''), false);
});

test('isValidEmail: espacios dentro del correo → no válido', () => {
  assert.equal(isValidEmail('ana garcia@alsina.com'), false);
});

test('isValidEmail: espacios alrededor y mayúsculas sí valen (se normaliza antes, como el servidor)', () => {
  assert.equal(isValidEmail('  Ana@Alsina.COM  '), true);
});

test('isValidEmail: 255 caracteres es el máximo; con 256 no es válido', () => {
  const domain = '@alsina.com'; // 11 caracteres
  const max = 'a'.repeat(255 - domain.length) + domain;
  assert.equal(max.length, 255);
  assert.equal(isValidEmail(max), true);
  assert.equal(isValidEmail('a' + max), false);
});

test('isValidEmail: la longitud se cuenta tras quitar espacios, como el servidor', () => {
  const domain = '@alsina.com';
  const max = 'a'.repeat(255 - domain.length) + domain;
  assert.equal(isValidEmail(`   ${max}   `), true);
});

test('isValidEmail: valores que no son texto → no válido', () => {
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(42), false);
});

// ---------- toPublicPhotos (T19) ----------

const PREFIX = '/api/alsinext/photos/';

test('toPublicPhotos: filas con email → solo id e imageUrl (los correos no salen del servidor)', () => {
  const rows = [
    { id: 1, email: 'ana@alsina.com', name: null, image_filename: 'a.jpg', created_at: '2026-10-12' },
    { id: 2, email: 'luis@alsina.com', name: 'Luis', image_filename: 'b.jpg', created_at: '2026-10-12' },
  ];
  const photos = toPublicPhotos(rows, PREFIX);

  assert.deepEqual(photos, [
    { id: 1, imageUrl: '/api/alsinext/photos/a.jpg' },
    { id: 2, imageUrl: '/api/alsinext/photos/b.jpg' },
  ]);
  assert.ok(photos.every((photo) => Object.keys(photo).join(',') === 'id,imageUrl'));
  assert.ok(!JSON.stringify(photos).includes('@'));
});

test('toPublicPhotos: sin filas o con un resultado que no es lista → lista vacía', () => {
  assert.deepEqual(toPublicPhotos([], PREFIX), []);
  assert.deepEqual(toPublicPhotos(undefined, PREFIX), []);
  assert.deepEqual(toPublicPhotos({ insertId: 1 }, PREFIX), []);
});

// ---------- Estilos de foto (T35, spec 003) ----------

test('PHOTO_STYLES: los mismos 5 estilos que el frontend', () => {
  assert.deepEqual(PHOTO_STYLES, ['retrofuturista', 'holograma', 'vhs', 'popart', 'setenta']);
});

test('isValidStyle: acepta solo los 5 estilos [003 RF-6]', () => {
  for (const style of PHOTO_STYLES) assert.equal(isValidStyle(style), true);
  assert.equal(isValidStyle('acuarela'), false);
  assert.equal(isValidStyle('VHS'), false);
  assert.equal(isValidStyle(''), false);
  assert.equal(isValidStyle(undefined), false);
});

test('toPublicPhotos: con copia con efecto muestra la copia [003 RF-3]', () => {
  const rows = [{ id: 1, email: 'ana@alsina.com', image_filename: 'a.jpg', styled_filename: 'a-estilo.jpg', style: 'vhs' }];
  assert.deepEqual(toPublicPhotos(rows, PREFIX), [{ id: 1, imageUrl: '/api/alsinext/photos/a-estilo.jpg' }]);
});

test('toPublicPhotos: sin copia (registros antiguos) muestra la original [003 RF-3]', () => {
  const rows = [{ id: 2, email: 'luis@alsina.com', image_filename: 'b.jpg', styled_filename: null, style: null }];
  assert.deepEqual(toPublicPhotos(rows, PREFIX), [{ id: 2, imageUrl: '/api/alsinext/photos/b.jpg' }]);
});

// ---------- Nombre y respuesta sobre la IA (T52, spec 005) ----------
// LOS MISMOS casos que el frontend (apps/alsinext/src/models/commitmentForm.test.js).

test('normalizeName: quita espacios al principio y al final', () => {
  assert.equal(normalizeName('  Ana García  '), 'Ana García');
});

test('normalizeName: valores que no son texto → texto vacío (no rompe)', () => {
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(undefined), '');
  assert.equal(normalizeName(42), '');
});

test('isValidName: 1 carácter es el mínimo; vacío no vale', () => {
  assert.equal(isValidName('A'), true);
  assert.equal(isValidName(''), false);
});

test('isValidName: 160 caracteres es el máximo; con 161 no vale', () => {
  assert.equal(isValidName('a'.repeat(160)), true);
  assert.equal(isValidName('a'.repeat(161)), false);
});

test('isValidName: solo espacios no vale (se cuenta tras quitarlos)', () => {
  assert.equal(isValidName('     '), false);
  assert.equal(isValidName(`  ${'a'.repeat(160)}  `), true);
});

test('isValidName: valores que no son texto no valen', () => {
  assert.equal(isValidName(null), false);
  assert.equal(isValidName(undefined), false);
  assert.equal(isValidName(42), false);
});

test('normalizeAiUsage: quita espacios al principio y al final', () => {
  assert.equal(normalizeAiUsage('  Resumir informes  '), 'Resumir informes');
});

test('normalizeAiUsage: valores que no son texto → texto vacío (no rompe)', () => {
  assert.equal(normalizeAiUsage(null), '');
  assert.equal(normalizeAiUsage({}), '');
});

test('isValidAiUsage: 10 caracteres es el mínimo; con 9 no vale', () => {
  assert.equal(isValidAiUsage('a'.repeat(10)), true);
  assert.equal(isValidAiUsage('a'.repeat(9)), false);
});

test('isValidAiUsage: 500 caracteres es el máximo; con 501 no vale', () => {
  assert.equal(isValidAiUsage('a'.repeat(500)), true);
  assert.equal(isValidAiUsage('a'.repeat(501)), false);
});

test('isValidAiUsage: solo espacios no vale y los espacios alrededor no cuentan', () => {
  assert.equal(isValidAiUsage(' '.repeat(20)), false);
  assert.equal(isValidAiUsage(`   ${'a'.repeat(9)}   `), false);
  assert.equal(isValidAiUsage(`   ${'a'.repeat(500)}   `), true);
});

test('isValidAiUsage: una respuesta real con saltos de línea vale', () => {
  assert.equal(isValidAiUsage('Usaría IA para:\n- resumir actas\n- preparar ofertas'), true);
});

test('isValidAiUsage: valores que no son texto no valen', () => {
  assert.equal(isValidAiUsage(null), false);
  assert.equal(isValidAiUsage(12345678901), false);
});

// ---------- Equipos para la vista de emparejamiento (spec 006, T7) ----------

const PREFIXES = { photoPrefix: '/api/alsinext/photos/', championPhotoPrefix: '/api/alsinext/champions/photos/' };

test('championPhotoUrl: URL completa tal cual; archivo → ruta de fotos de champions; vacío → null [RF-14]', () => {
  const prefix = PREFIXES.championPhotoPrefix;
  assert.equal(championPhotoUrl('https://intranet.alsina.com/f/lluis.jpg', prefix), 'https://intranet.alsina.com/f/lluis.jpg');
  assert.equal(championPhotoUrl('http://x.test/a.png', prefix), 'http://x.test/a.png');
  assert.equal(championPhotoUrl('lluis-orteu.jpg', prefix), '/api/alsinext/champions/photos/lluis-orteu.jpg');
  assert.equal(championPhotoUrl(null, prefix), null);
  assert.equal(championPhotoUrl('', prefix), null);
  assert.equal(championPhotoUrl('   ', prefix), null);
});

test('championPhotoUrl: nombres de archivo inseguros o enlaces raros → null', () => {
  const prefix = PREFIXES.championPhotoPrefix;
  assert.equal(championPhotoUrl('../../.env', prefix), null);
  assert.equal(championPhotoUrl('carpeta/foto.jpg', prefix), null);
  assert.equal(championPhotoUrl('javascript:alert(1)', prefix), null);
  assert.equal(championPhotoUrl('foto con espacio.jpg', prefix), null);
});

// Filas como las devuelve la consulta: una por participante, ordenadas por equipo
const TEAM_ROWS = [
  { team_id: 1, champion_name: 'Lluis Orteu', champion_photo: null, member_name: 'Laura Méndez Soler', image_filename: 'a.jpg', styled_filename: 'a-s.jpg', email: 'demo01@demo.alsinext.test', ai_usage: 'secreto' },
  { team_id: 1, champion_name: 'Lluis Orteu', champion_photo: null, member_name: 'Marc Puig Ferrer', image_filename: 'b.jpg', styled_filename: null, email: 'demo02@demo.alsinext.test', ai_usage: 'secreto' },
  { team_id: 2, champion_name: 'Raúl Limones', champion_photo: 'raul.jpg', member_name: 'Lucía Herrera Gómez', image_filename: 'c.jpg', styled_filename: null },
  { team_id: 2, champion_name: 'Raúl Limones', champion_photo: 'raul.jpg', member_name: 'Sergi Martí Vall', image_filename: 'd.jpg', styled_filename: null },
  { team_id: 2, champion_name: 'Raúl Limones', champion_photo: 'raul.jpg', member_name: 'Marta Rubio Cano', image_filename: 'e.jpg', styled_filename: null },
];

test('toPublicTeams: agrupa por equipo con su champion y sus participantes [RF-13]', () => {
  assert.deepEqual(toPublicTeams(TEAM_ROWS, PREFIXES), [
    {
      id: 1,
      champion: { name: 'Lluis Orteu', photoUrl: null },
      members: [
        { name: 'Laura Méndez Soler', photoUrl: '/api/alsinext/photos/a-s.jpg', originalUrl: '/api/alsinext/photos/a.jpg' }, // la copia con efecto (y la original, RF-13h)
        { name: 'Marc Puig Ferrer', photoUrl: '/api/alsinext/photos/b.jpg', originalUrl: null }, // sin copia → la original (sin transición)
      ],
      title: null, // RF-13f: sin título todavía
    },
    {
      id: 2,
      champion: { name: 'Raúl Limones', photoUrl: '/api/alsinext/champions/photos/raul.jpg' },
      members: [
        { name: 'Lucía Herrera Gómez', photoUrl: '/api/alsinext/photos/c.jpg', originalUrl: null },
        { name: 'Sergi Martí Vall', photoUrl: '/api/alsinext/photos/d.jpg', originalUrl: null },
        { name: 'Marta Rubio Cano', photoUrl: '/api/alsinext/photos/e.jpg', originalUrl: null },
      ],
      title: null,
    },
  ]);
});

test('toPublicTeams: nunca devuelve correos ni respuestas [RNF privacidad]', () => {
  const text = JSON.stringify(toPublicTeams(TEAM_ROWS, PREFIXES));
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /secreto/);
  assert.doesNotMatch(text, /email|ai_usage/);
});

test('toPublicTeams: ordena por equipo aunque las filas lleguen desordenadas', () => {
  const ids = toPublicTeams([...TEAM_ROWS].reverse(), PREFIXES).map((team) => team.id);
  assert.deepEqual(ids, [1, 2]);
});

test('toPublicTeams: un participante que ya no existe (compromiso borrado) no aparece', () => {
  const rows = [
    TEAM_ROWS[0],
    { team_id: 1, champion_name: 'Lluis Orteu', champion_photo: null, member_name: null, image_filename: null, styled_filename: null },
  ];
  assert.equal(toPublicTeams(rows, PREFIXES)[0].members.length, 1);
});

test('toPublicTeams: sin filas o con algo que no es una lista → []', () => {
  assert.deepEqual(toPublicTeams([], PREFIXES), []);
  assert.deepEqual(toPublicTeams(null, PREFIXES), []);
});

test('toPublicTeams: incluye el título del proyecto si lo hay; si no, null [RF-13f, RF-20]', () => {
  const rows = TEAM_ROWS.map((row) => (row.team_id === 1 ? { ...row, title_es: 'Proyecto Actas', title_en: 'Project Minutes' } : { ...row, title_es: null, title_en: null }));
  const teams = toPublicTeams(rows, PREFIXES);
  assert.deepEqual(teams[0].title, { es: 'Proyecto Actas', en: 'Project Minutes' });
  assert.equal(teams[1].title, null);
  assert.equal(toPublicTeams(TEAM_ROWS, PREFIXES)[0].title, null, 'filas sin columnas de título');
});

test('toPublicTeams: la foto original solo cuando hay copia con filtro (si no, es la misma) [RF-13h, RF-20]', () => {
  const [team] = toPublicTeams([TEAM_ROWS[0], TEAM_ROWS[1]], PREFIXES);
  assert.equal(team.members[0].photoUrl, '/api/alsinext/photos/a-s.jpg');
  assert.equal(team.members[0].originalUrl, '/api/alsinext/photos/a.jpg');
  assert.equal(team.members[1].originalUrl, null);
  assert.doesNotMatch(JSON.stringify(team), /@|secreto/);
});
