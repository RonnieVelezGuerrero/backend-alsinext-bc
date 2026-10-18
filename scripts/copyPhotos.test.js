// Spec 007, T4: copia única de las fotos del backend antiguo (RF-10)
const test = require('node:test');
const assert = require('node:assert/strict');

const { planCopy, PHOTO_FOLDERS } = require('./copyPhotos');

test('PHOTO_FOLDERS: las 4 carpetas de fotos de Alsinext [RF-10]', () => {
  assert.deepEqual(PHOTO_FOLDERS, ['alsinext', 'alsinext-champions', 'alsinext-demo', 'alsinext-papelera']);
});

test('planCopy: destino vacío → se copian todas [RF-10]', () => {
  const source = ['alsinext/a.jpg', 'alsinext/b.jpg', 'alsinext-champions/c.jpg'];
  assert.deepEqual(planCopy(source, []), source);
});

test('planCopy: solo las que faltan; nunca sobrescribe una que ya está [RF-10]', () => {
  const source = ['alsinext/a.jpg', 'alsinext/b.jpg', 'alsinext/c.jpg'];
  const target = ['alsinext/b.jpg'];
  assert.deepEqual(planCopy(source, target), ['alsinext/a.jpg', 'alsinext/c.jpg']);
});

test('planCopy: repetir la copia después → no hay nada que copiar [RF-10]', () => {
  const source = ['alsinext/a.jpg', 'alsinext-demo/face001-photo.jpg'];
  assert.deepEqual(planCopy(source, [...source]), []);
});

test('planCopy: nunca propone borrar; lo que solo está en el destino se queda [RF-10]', () => {
  const plan = planCopy(['alsinext/a.jpg'], ['alsinext/a.jpg', 'alsinext/nueva-del-nuevo.jpg']);
  assert.deepEqual(plan, []);
});

test('planCopy: subcarpetas (papelera por fecha) con el mismo nombre se respetan [RF-10]', () => {
  const source = ['alsinext-papelera/2026-10-14/x.jpg', 'alsinext/x.jpg'];
  assert.deepEqual(planCopy(source, ['alsinext/x.jpg']), ['alsinext-papelera/2026-10-14/x.jpg']);
});
