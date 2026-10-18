// Único sitio que lee el .env. Si falta una variable obligatoria, lanza el error de loadEnv
// y server.js no arranca (RF-7).
require('dotenv').config();

const { loadEnv } = require('./loadEnv');

const env = loadEnv(process.env);

module.exports = { env };
