// Aplicación Express de backend-alsinext (spec 007). CORS y JSON igual que en
// backend-alsina-tools-vc, para que la API responda igual (RF-3).
const cors = require('cors');
const express = require('express');

const { pingDatabase, isMockMode } = require('./config/db');
const { errorHandler } = require('./middlewares/errorHandler');
const { notFound } = require('./middlewares/notFound');
const { asyncHandler } = require('./utils/asyncHandler');
const { healthStatus } = require('./startup');

const app = express();

const allowedOrigins = ['http://localhost:5173', 'http://localhost:4002', 'http://localhost:4026', '*'];

app.use(cors({
    origin(origin, callback) {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || /^http:\/\/localhost:\d+$/.test(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-portal-token'],
}));

app.use(express.json({ limit: '50mb' }));

// RF-6: ¿contesta la base de datos de verdad? (no vale el modo simulado)
app.get('/api/alsinext/health', asyncHandler(async (_req, res) => {
    await pingDatabase();
    const { status, body } = healthStatus(!isMockMode());
    res.status(status).json(body);
}));

// RF-2, RF-3: el módulo copiado tal cual, en la misma ruta que en el backend antiguo
app.use('/api/alsinext', require('./modules/alsinext/alsinext.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
