// Configuración de backend-alsinext a partir de las variables de entorno (spec 007).
// Función pura: no lee el .env ni process.env; eso lo hace env.js.

// Sin estas no se arranca (RF-7). JWT_SECRET no tiene valor por defecto: es el mismo secreto
// que el backend antiguo y lo escribe el responsable en el .env (D-4).
const REQUIRED_VARS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];

function readValue(vars, name) {
  return String(vars[name] ?? '').trim();
}

// Devuelve el objeto env con la misma forma que el de backend-alsina-tools-vc (solo lo que usa
// el módulo alsinext), para que el módulo copiado funcione sin cambios.
function loadEnv(vars) {
  const missing = REQUIRED_VARS.filter((name) => readValue(vars, name) === '');
  if (missing.length > 0) {
    // Solo los nombres: nunca se muestran valores del .env
    const error = new Error(`Faltan variables en el .env: ${missing.join(', ')}`);
    error.code = 'missing_env';
    error.missing = missing;
    throw error;
  }

  return {
    port: Number.parseInt(readValue(vars, 'PORT') || '3001', 10),
    jwtSecret: readValue(vars, 'JWT_SECRET'),
    db: {
      host: readValue(vars, 'DB_HOST'),
      port: Number.parseInt(readValue(vars, 'DB_PORT') || '3306', 10),
      user: readValue(vars, 'DB_USER'),
      password: String(vars.DB_PASSWORD ?? ''),
      database: readValue(vars, 'DB_NAME'),
    },
    gemini: {
      apiKey: readValue(vars, 'GEMINI_API_KEY'),
      model: readValue(vars, 'GEMINI_MODEL') || 'gemini-3.5-flash-lite',
    },
  };
}

module.exports = { loadEnv, REQUIRED_VARS };
