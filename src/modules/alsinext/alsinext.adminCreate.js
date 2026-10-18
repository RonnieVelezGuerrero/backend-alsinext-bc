// Alsinext: crea o cambia la cuenta del administrador de la vista de emparejamiento
// (spec 006, RF-1f). Uso (en el servidor, lo ejecuta el responsable):
//   npm run alsinext:admin -- <usuario>
// Pide la contraseña dos veces sin mostrarla (mínimo 6 caracteres) y guarda solo su hash
// bcrypt. Si el usuario ya existe, cambia su contraseña.

const readline = require('readline');
const bcrypt = require('bcryptjs');
const { isValidAdminPassword, isValidAdminUsername } = require('./alsinext.access');

const BCRYPT_COST = 12;

// Pregunta por la terminal sin mostrar lo que se escribe
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {}; // no repite en pantalla lo que se escribe
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const username = (process.argv[2] || '').trim();
  if (!isValidAdminUsername(username)) {
    console.error('Uso: npm run alsinext:admin -- <usuario>  (3–80 letras, números, punto, guion o guion bajo)');
    process.exitCode = 1;
    return;
  }

  const password = await askHidden(`Contraseña para «${username}» (mínimo 6 caracteres): `);
  if (!isValidAdminPassword(password)) {
    console.error('La contraseña debe tener al menos 6 caracteres. No se ha guardado nada.');
    process.exitCode = 1;
    return;
  }
  if ((await askHidden('Repite la contraseña: ')) !== password) {
    console.error('Las contraseñas no coinciden. No se ha guardado nada.');
    process.exitCode = 1;
    return;
  }

  const db = require('../../config/db');
  try {
    await db.pingDatabase();
    if (db.isMockMode()) {
      console.error('MySQL no está disponible. Arranca MySQL y vuelve a intentarlo. No se ha guardado nada.');
      process.exitCode = 1;
      return;
    }
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    await db.query(
      `INSERT INTO alsinext_admin (username, password_hash) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = CURRENT_TIMESTAMP`,
      [username, hash],
    );
    console.log(`Administrador «${username}» guardado. Ya puede entrar en la vista #emparejamiento.`);
  } catch (error) {
    console.error(`Error: ${error.message}. No se ha guardado nada.`);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
