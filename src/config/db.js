// Conexión a la base de datos alsina_portal (spec 007, RF-4). Mismas funciones que en
// backend-alsina-tools-vc, sin los simuladores de las otras herramientas.
const mysql = require('mysql2/promise');

const { env } = require('./env');

const pool = mysql.createPool({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    namedPlaceholders: true,
    decimalNumbers: true,
});

// Si MySQL no contesta se pasa a modo simulado, como en el backend antiguo: el módulo alsinext
// lo comprueba con isMockMode() para responder igual que allí (RF-3).
let isFallback = false;

function mockQuery(sql) {
    const cleanSql = String(sql).trim().toLowerCase();
    if (cleanSql.startsWith('insert') || cleanSql.startsWith('update') || cleanSql.startsWith('delete')) {
        return { insertId: 1, affectedRows: 1 };
    }
    return [];
}

async function pingDatabase() {
    try {
        const connection = await pool.getConnection();
        try {
            await connection.ping();
            console.log(isFallback ? '[DB] Reconnected to MySQL database.' : '[DB] Connected to MySQL database.');
            isFallback = false;
        } finally {
            connection.release();
        }
    } catch (err) {
        isFallback = true;
        console.warn(`[DB] MySQL non-available (${err.message}). Local mock database fallback activated.`);
    }
}

async function query(sql, params = []) {
    try {
        const [rows] = await pool.query(sql, params);
        if (isFallback) {
            console.log('[DB] MySQL query succeeded, deactivating fallback mode.');
            isFallback = false;
        }
        return rows;
    } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ER_BAD_DB_ERROR') {
            if (!isFallback) {
                isFallback = true;
                console.warn(`[DB] MySQL error (${err.message}). Switching to local mock database fallback.`);
            }
            return mockQuery(sql, params);
        }
        throw err;
    }
}

async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
}

async function withTransaction(handler) {
    if (isFallback) {
        return handler({ query, queryOne });
    }
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const result = await handler(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

function isMockMode() {
    return isFallback;
}

module.exports = {
    pool,
    pingDatabase,
    query,
    queryOne,
    withTransaction,
    isMockMode,
};
