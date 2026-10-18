// Funciones puras del arranque y de la salud de backend-alsinext (spec 007).

// GET /api/alsinext/health (RF-6): 200 si la base de datos contesta, 503 si no.
function healthStatus(isDbUp) {
  return isDbUp ? { status: 200, body: { ok: true } } : { status: 503, body: { ok: false } };
}

// Mensaje que se muestra si el servidor no puede arrancar (RF-7, RF-9). Nunca incluye valores del .env.
function startupErrorMessage(error, port) {
  if (error.code === 'EADDRINUSE') {
    return `El puerto ${port} está ocupado. ¿Está encendido backend-alsina-tools-vc? Páralo antes de arrancar backend-alsinext.`;
  }
  if (error.code === 'missing_env') {
    return `${error.message}. Cópialas de .env.example al .env y rellénalas.`;
  }
  return `No se ha podido arrancar backend-alsinext: ${error.message}`;
}

module.exports = { healthStatus, startupErrorMessage };
