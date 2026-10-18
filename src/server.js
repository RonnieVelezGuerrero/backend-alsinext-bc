// Arranque de backend-alsinext (spec 007): comprueba el .env, prueba la base de datos y escucha.
const { startupErrorMessage } = require('./startup');

function fail(error, port) {
    console.error(startupErrorMessage(error, port));
    process.exit(1);
}

async function startServer() {
    let port = 3001;
    try {
        // env.js lanza missing_env si falta una variable obligatoria (RF-7)
        const { env } = require('./config/env');
        port = env.port;
        const app = require('./app');
        const { pingDatabase } = require('./config/db');

        await pingDatabase();

        const server = app.listen(env.port, () => {
            console.log(`backend-alsinext listening on http://localhost:${env.port}`);
        });
        // RF-9: puerto ocupado (p. ej. backend-alsina-tools-vc encendido)
        server.on('error', (error) => fail(error, env.port));
    } catch (error) {
        fail(error, port);
    }
}

startServer();
