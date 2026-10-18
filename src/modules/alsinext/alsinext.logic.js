// Alsinext: lógica pura (sin Express, sin base de datos), probada con `node --test`.
// Las reglas de correo son las mismas que en el frontend (apps/alsinext/src/models/email.js).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;

// Forma única del correo: sin espacios alrededor y en minúsculas (decisión B6).
function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

// ¿Es un correo válido? Se normaliza antes de comprobar.
function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(normalized);
}

// Estilos de foto (spec 003): los mismos que en el frontend (apps/alsinext/src/models/photoStyles.js).
const PHOTO_STYLES = ['retrofuturista', 'holograma', 'vhs', 'popart', 'setenta'];

function isValidStyle(style) {
  return PHOTO_STYLES.includes(style);
}

// Convierte las filas de la base de datos en la lista pública de fotos.
// Solo id e imageUrl: los correos (y el resto de columnas) nunca salen del servidor.
// Se muestra la copia con efecto; los registros antiguos sin copia, con la original (003 RF-3).
function toPublicPhotos(rows, urlPrefix) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    id: row.id,
    imageUrl: `${urlPrefix}${row.styled_filename || row.image_filename}`,
  }));
}

// Foto de un champion (columna `photo`, spec 006 RF-14): una URL http(s) completa se usa tal
// cual; un nombre de archivo seguro se sirve desde las fotos de champions; si no hay foto o el
// valor no es seguro → null (la vista muestra la burbuja sepia).
function championPhotoUrl(photo, prefix) {
  const value = typeof photo === 'string' ? photo.trim() : '';
  if (!value) return null;
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  return /^[a-zA-Z0-9._-]+$/.test(value) && !value.startsWith('.') ? `${prefix}${value}` : null;
}

// Filas de la consulta de equipos (una por participante) → equipos para la vista (RF-13).
// Solo nombres y fotos: nunca correos ni respuestas (RNF privacidad). Un participante cuyo
// compromiso ya no existe (sin foto) no aparece.
function toPublicTeams(rows, { photoPrefix, championPhotoPrefix }) {
  if (!Array.isArray(rows)) return [];
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.team_id)) {
      teams.set(row.team_id, {
        id: row.team_id,
        champion: { name: row.champion_name, photoUrl: championPhotoUrl(row.champion_photo, championPhotoPrefix) },
        members: [],
        // RF-13f: título del proyecto (null si aún no lo tiene)
        title: row.title_es && row.title_en ? { es: row.title_es, en: row.title_en } : null,
      });
    }
    const photo = row.styled_filename || row.image_filename;
    if (photo) {
      teams.get(row.team_id).members.push({
        name: row.member_name || '',
        photoUrl: `${photoPrefix}${photo}`,
        // RF-13h: la original, para revelarla en el centro (si no hay copia con filtro, es la misma)
        originalUrl: row.styled_filename && row.image_filename ? `${photoPrefix}${row.image_filename}` : null,
      });
    }
  }
  return [...teams.values()].sort((a, b) => a.id - b.id);
}

// Nombre y respuesta sobre la IA (spec 005): mismas reglas que el frontend
// (apps/alsinext/src/models/commitmentForm.js).
const NAME_MAX = 160; // columna `name` VARCHAR(160)
const AI_USAGE_MIN = 10;
const AI_USAGE_MAX = 500; // columna `ai_usage` VARCHAR(500)

// Quita espacios al principio y al final; si no es texto, devuelve ''.
function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeName(value) {
  return normalizeText(value);
}

// 005 RF-5: nombre obligatorio, de 1 a 160 caracteres tras quitar espacios.
function isValidName(value) {
  const name = normalizeName(value);
  return name.length >= 1 && name.length <= NAME_MAX;
}

function normalizeAiUsage(value) {
  return normalizeText(value);
}

// 005 RF-7: respuesta obligatoria, de 10 a 500 caracteres tras quitar espacios.
function isValidAiUsage(value) {
  const answer = normalizeAiUsage(value);
  return answer.length >= AI_USAGE_MIN && answer.length <= AI_USAGE_MAX;
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  PHOTO_STYLES,
  isValidStyle,
  toPublicPhotos,
  championPhotoUrl,
  toPublicTeams,
  normalizeName,
  isValidName,
  normalizeAiUsage,
  isValidAiUsage,
};
