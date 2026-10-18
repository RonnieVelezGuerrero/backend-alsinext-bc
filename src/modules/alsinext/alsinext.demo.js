// Alsinext: participantes ficticios para pruebas y demostración en local (spec 006, RF-16/17).
// Uso (solo en local, lo ejecuta el responsable):
//   npm run alsinext:demo -- load     → 100 compromisos @demo.alsinext.test con su foto y filtro
//   npm run alsinext:demo -- delete   → los borra, con sus equipos, sus títulos y sus fotos
// Las caras (personas que no existen) están en uploads/alsinext-demo/, fuera de git:
// faceNNN.jpg (la descargada) y, generadas con el código de la web (RF-16b), faceNNN-photo.jpg
// (reducida) y faceNNN-styled.jpg (con su estilo). Nunca se toca un registro que no sea de demo.

const path = require('path');

const DEMO_DOMAIN = 'demo.alsinext.test';

// demo001@demo.alsinext.test … demo100@demo.alsinext.test
function demoEmail(index) {
  return `demo${String(index + 1).padStart(3, '0')}@${DEMO_DOMAIN}`;
}

function isDemoEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`);
}

// Del archivo de datos a lo que se guarda: correo, nombre, respuesta, estilo y sus dos fotos
function buildDemoParticipants(data) {
  return data.map((p, i) => {
    const face = `face${String(i + 1).padStart(3, '0')}`;
    return {
      email: demoEmail(i),
      name: p.name,
      aiUsage: p.aiUsage,
      style: p.style,
      photo: `${face}-photo.jpg`,
      styled: `${face}-styled.jpg`,
    };
  });
}

const MESSAGES = {
  usage: 'Uso: npm run alsinext:demo -- load | delete',
  mock_db: 'MySQL no está disponible (el backend usaría la base de datos simulada). Arranca MySQL y vuelve a intentarlo.',
};

// Carga los ficticios que aún no existen, como una persona real: foto reducida, copia con efecto
// y estilo. Antes de escribir nada comprueba que están todas las fotos.
async function loadDemo(participants, deps) {
  const missing = participants
    .flatMap((p) => [p.photo, p.styled])
    .filter((file) => !deps.fileExists(path.join(deps.facesDir, file)));
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing_files',
      message: `Faltan fotos en uploads/alsinext-demo/: ${missing.join(', ')}. No se ha cargado nada.`,
    };
  }

  const existing = new Set((await deps.query('SELECT email FROM alsinext_compromisos WHERE email LIKE ?', [`%@${DEMO_DOMAIN}`]))
    .map((row) => row.email));
  let added = 0;
  for (const p of participants) {
    if (existing.has(p.email)) continue;
    // Como las fotos reales: nombres aleatorios que no revelan a la persona
    const photoName = deps.randomName();
    const styledName = deps.randomName();
    const targets = [path.join(deps.uploadsDir, photoName), path.join(deps.uploadsDir, styledName)];
    try {
      await deps.copyFile(path.join(deps.facesDir, p.photo), targets[0]);
      await deps.copyFile(path.join(deps.facesDir, p.styled), targets[1]);
      await deps.query(
        'INSERT INTO alsinext_compromisos (email, name, ai_usage, image_filename, styled_filename, style) VALUES (?, ?, ?, ?, ?, ?)',
        [p.email, p.name, p.aiUsage, photoName, styledName, p.style],
      );
      added += 1;
    } catch (error) {
      for (const target of targets) await deps.removeFile(target); // sin fotos huérfanas
      throw error;
    }
  }
  const skipped = participants.length - added;
  return { ok: true, message: `Demo cargada: ${added} participantes ficticios nuevos${skipped ? ` (${skipped} ya existían)` : ''}.` };
}

// Borra los equipos que tengan algún ficticio (enteros) con su título, los compromisos de demo
// y sus fotos
async function deleteDemo(deps) {
  const domain = `%@${DEMO_DOMAIN}`;
  const teamIds = (await deps.query('SELECT DISTINCT team_id FROM alsinext_equipos WHERE email LIKE ?', [domain]))
    .map((row) => row.team_id);
  const files = (await deps.query('SELECT image_filename, styled_filename FROM alsinext_compromisos WHERE email LIKE ?', [domain]))
    .flatMap((row) => [row.image_filename, row.styled_filename])
    .filter(Boolean);

  await deps.withTransaction(async (connection) => {
    if (teamIds.length > 0) {
      const ids = teamIds.map(() => '?').join(', ');
      await connection.query(`DELETE FROM alsinext_equipos WHERE team_id IN (${ids})`, teamIds);
      // Su título (RF-13f): si no, lo heredaría un equipo nuevo con el mismo número
      await connection.query(`DELETE FROM alsinext_equipos_titulos WHERE team_id IN (${ids})`, teamIds);
    }
    await connection.query('DELETE FROM alsinext_compromisos WHERE email LIKE ?', [domain]);
  });
  // Los archivos, después de confirmar el borrado en la BD
  for (const file of files) await deps.removeFile(path.join(deps.uploadsDir, file));

  return { ok: true, message: `Demo borrada: ${files.length} fotos y ${teamIds.length} equipos con ficticios.` };
}

// action: 'load' | 'delete' · data: participants.json · deps: BD y disco (inyectados para los tests)
async function runDemo(action, data, deps) {
  if (action !== 'load' && action !== 'delete') return { ok: false, code: 'usage', message: MESSAGES.usage };
  if (deps.isMockMode()) return { ok: false, code: 'mock_db', message: MESSAGES.mock_db };
  return action === 'load' ? loadDemo(buildDemoParticipants(data), deps) : deleteDemo(deps);
}

// Ejecución desde la terminal
async function main() {
  const crypto = require('crypto');
  const fs = require('fs');
  const db = require('../../config/db');
  const uploads = path.join(__dirname, '../../../uploads');

  let exitCode = 1;
  try {
    await db.pingDatabase();
    const result = await runDemo(process.argv[2], require('./demo/participants.json'), {
      facesDir: path.join(uploads, 'alsinext-demo'),
      uploadsDir: path.join(uploads, 'alsinext'),
      isMockMode: db.isMockMode,
      query: db.query,
      withTransaction: db.withTransaction,
      fileExists: (file) => fs.existsSync(file),
      copyFile: (from, to) => fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL),
      removeFile: (file) => fs.promises.rm(file, { force: true }),
      randomName: () => `${crypto.randomUUID()}.jpg`,
    });
    console.log(result.message);
    exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Error inesperado: ${error.message}`);
  } finally {
    await db.pool.end();
  }
  process.exitCode = exitCode;
}

if (require.main === module) main();

module.exports = { DEMO_DOMAIN, demoEmail, isDemoEmail, buildDemoParticipants, runDemo };
