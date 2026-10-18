// Copia las fotos de Alsinext del backend antiguo a uploads/ de este (spec 007, RF-10).
// Uso: npm run copy-photos -- ../backend-alsina-tools-vc
// Solo copia lo que falta: nunca sobrescribe ni borra, así que se puede repetir.
const fs = require('fs');
const path = require('path');

// Carpetas dentro de uploads/ que usa el módulo alsinext
const PHOTO_FOLDERS = ['alsinext', 'alsinext-champions', 'alsinext-demo', 'alsinext-papelera'];

// Rutas relativas (con «/») que están en el origen y no en el destino, en el orden del origen
function planCopy(sourceFiles, targetFiles) {
  const existing = new Set(targetFiles);
  return sourceFiles.filter((file) => !existing.has(file));
}

// Archivos de una carpeta y sus subcarpetas, como rutas relativas a baseDir con «/»
function listFiles(baseDir, folder) {
  const start = path.join(baseDir, folder);
  if (!fs.existsSync(start)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(baseDir, full).split(path.sep).join('/'));
    }
  };
  walk(start);
  return files;
}

function main(oldBackendDir) {
  if (!oldBackendDir) {
    console.error('Falta la ruta del backend antiguo. Uso: npm run copy-photos -- ../backend-alsina-tools-vc');
    process.exit(1);
  }
  const sourceDir = path.resolve(oldBackendDir, 'uploads');
  const targetDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(sourceDir)) {
    console.error(`No existe ${sourceDir}. ¿Es la ruta de backend-alsina-tools-vc?`);
    process.exit(1);
  }

  let copied = 0;
  for (const folder of PHOTO_FOLDERS) {
    const toCopy = planCopy(listFiles(sourceDir, folder), listFiles(targetDir, folder));
    for (const file of toCopy) {
      const target = path.join(targetDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // COPYFILE_EXCL: si el archivo ya existe, falla en vez de sobrescribirlo
      fs.copyFileSync(path.join(sourceDir, file), target, fs.constants.COPYFILE_EXCL);
    }
    copied += toCopy.length;
    console.log(`${folder}: ${toCopy.length} copiadas, ${listFiles(targetDir, folder).length} en total`);
  }
  console.log(`Hecho: ${copied} fotos copiadas. No se ha borrado ni sobrescrito nada.`);
}

if (require.main === module) main(process.argv[2]);

module.exports = { planCopy, PHOTO_FOLDERS, listFiles };
