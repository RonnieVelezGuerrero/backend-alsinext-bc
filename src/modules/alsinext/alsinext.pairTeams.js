// Alsinext: orden de servidor que hace el emparejamiento con los AI Champions (spec 006).
// Uso (solo el responsable, en el servidor): npm run alsinext:pair
// No hay botón ni ruta en la web (RF-1). Se hace una sola vez (RF-8); si algo falla no se
// guarda nada (RF-9, RF-10). Los mensajes nunca muestran correos.

const { TEAM_SIZE, assignTeams, assignNewcomers } = require('./alsinext.pairing');

// Mensajes para quien ejecuta la orden
const MESSAGES = {
  mock_db: 'MySQL no está disponible (el backend usaría la base de datos simulada). Arranca MySQL y vuelve a intentarlo.',
  already_paired: 'El emparejamiento ya se hizo: alsinext_equipos ya tiene equipos. Solo se puede hacer una vez.',
  missing_key: 'Falta la clave de Gemini: añade GEMINI_API_KEY al archivo .env del backend.',
  not_enough_participants: 'Hacen falta al menos 3 participantes con respuesta sobre la IA para emparejar.',
  no_champions: 'No hay champions en alsinext_champions.',
  not_paired_yet: 'Aún no se ha emparejado: usa «Emparejar».',
  no_newcomers: 'Todos los participantes ya tienen equipo.',
  waiting_for_another: 'No quedan equipos de 3 para todas las personas sin equipo: hacen falta más personas (3) para formar un equipo nuevo.',
  pairing_changed: 'Los equipos o las personas sin equipo han cambiado mientras se calculaba. No se ha guardado nada; vuelve a intentarlo.',
  no_missing_titles: 'Todos los equipos ya tienen título.',
};

function failure(code, detail) {
  const message = detail ? `${MESSAGES[code] || 'No se ha podido emparejar.'} (${detail})` : MESSAGES[code];
  return { ok: false, code, message };
}

// Lógica de la orden con sus dependencias inyectadas (así se prueba sin BD ni Gemini).
// deps: { isMockMode, query, withTransaction, requestScores, apiKey, model }
async function runPairing({ isMockMode, query, withTransaction, requestScores, requestTitles, apiKey, model, sleep }) {
  // 1. Nunca contra la BD simulada: "emparejaría" datos falsos
  if (isMockMode()) return failure('mock_db');

  // 2. Solo una vez (RF-8)
  const [{ n: existing }] = await query('SELECT COUNT(*) AS n FROM alsinext_equipos');
  if (existing > 0) return failure('already_paired');

  // 3. Clave de Gemini
  if (!apiKey) return failure('missing_key');

  // 4. Participantes = compromisos con respuesta sobre la IA (spec 005)
  const rows = await query('SELECT email, ai_usage FROM alsinext_compromisos ORDER BY id');
  const participants = rows.filter((row) => typeof row.ai_usage === 'string' && row.ai_usage.trim() !== '');
  if (participants.length < TEAM_SIZE) return failure('not_enough_participants'); // RF-10

  const champions = await query('SELECT id, name, description_es, description_en FROM alsinext_champions ORDER BY id');
  if (champions.length === 0) return failure('no_champions');

  // 5. Afinidades con Gemini: solo las respuestas, sin correos (RNF privacidad)
  let scoreList;
  try {
    scoreList = await requestScores({
      apiKey,
      model,
      answers: participants.map((p) => p.ai_usage.trim()),
      champions,
    });
  } catch (error) {
    return { ok: false, code: 'gemini_failed', message: `Gemini no ha respondido bien (${error.message}). No se ha guardado nada; puedes volver a intentarlo.` };
  }
  const scores = Object.fromEntries(participants.map((p, i) => [p.email, scoreList[i]]));

  // 6. Reparto (rondas, equipos de 2 y uno de 3 si N es impar)
  const teams = assignTeams(participants.map((p) => ({ email: p.email })), champions, scores);

  // 7. Guardado en una sola transacción; se vuelve a comprobar que nadie lo hizo antes
  const values = teams.flatMap((team) => team.emails.map((email) => [team.teamId, team.championId, email]));
  const saved = await withTransaction(async (connection) => {
    const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM alsinext_equipos');
    if (n > 0) return false;
    // Sin equipos, ningún título vale: se descartan los que hayan quedado (p. ej. de equipos
    // borrados a mano) para que los equipos nuevos, con los mismos números, no los hereden
    await connection.query('DELETE FROM alsinext_equipos_titulos');
    await connection.query(
      `INSERT INTO alsinext_equipos (team_id, champion_id, email) VALUES ${values.map(() => '(?, ?, ?)').join(', ')}`,
      values.flat(),
    );
    return true;
  });
  if (!saved) return failure('already_paired');

  // Resumen sin correos: equipo, champion y nº de personas
  const nameOf = new Map(champions.map((c) => [c.id, c.name]));
  const lines = teams.map((t) => `  Equipo ${t.teamId}: ${nameOf.get(t.championId)} · ${t.emails.length} personas`);
  const titles = await titlesAfterPairing({ isMockMode, query, requestTitles, apiKey, model, sleep });
  return {
    ok: true,
    teams: teams.length,
    participants: participants.length,
    ...titles.summary,
    message: [`Emparejamiento guardado: ${teams.length} equipos (${participants.length} participantes).`, ...lines, titles.message].filter(Boolean).join('\n'),
  };
}

// ---------- Los que llegan tarde (RF-15) ----------

const SAVED_TEAMS_SQL = 'SELECT team_id, champion_id, email FROM alsinext_equipos ORDER BY team_id, id';
// Compromisos sin fila en alsinext_equipos (registrados después del emparejamiento)
const PENDING_SQL = `SELECT c.email, c.ai_usage FROM alsinext_compromisos c
  LEFT JOIN alsinext_equipos e ON e.email = c.email
  WHERE e.email IS NULL ORDER BY c.id`;

const hasAnswer = (row) => typeof row.ai_usage === 'string' && row.ai_usage.trim() !== '';

// Filas guardadas → [{ teamId, championId, emails }]
function groupTeams(rows) {
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.team_id)) teams.set(row.team_id, { teamId: row.team_id, championId: row.champion_id, emails: [] });
    teams.get(row.team_id).emails.push(row.email);
  }
  return [...teams.values()];
}

// ¿Se puede repartir ya? 3 o más, o 1–2 y quedan equipos de 3 para todos (sin emparejar: no, es «Emparejar»)
function canPairNewcomers(pendingCount, teams) {
  if (teams.length === 0 || pendingCount === 0) return false;
  // RF-15 (equipos de 3): 3 o más forman equipos nuevos; 1–2 se unen a equipos de 3 distintos
  return pendingCount >= TEAM_SIZE || teams.filter((team) => team.emails.length === TEAM_SIZE).length >= pendingCount;
}

// GET /pairing/pending: solo números, nunca correos
async function getPendingStatus({ query }) {
  const teams = groupTeams(await query(SAVED_TEAMS_SQL));
  const pending = (await query(PENDING_SQL)).filter(hasAnswer).length;
  // RF-13f: equipos que aún no tienen título del proyecto
  const titled = new Set((await query('SELECT team_id FROM alsinext_equipos_titulos')).map((row) => row.team_id));
  const missingTitles = teams.filter((team) => !titled.has(team.teamId)).length;
  return { pending, canPair: canPairNewcomers(pending, teams), missingTitles };
}

// «Emparejar nuevos»: reparte solo a los que no tienen equipo, sin tocar los equipos guardados.
// Mismas dependencias que runPairing. Si algo falla, no se guarda nada.
async function runPairNewcomers({ isMockMode, query, withTransaction, requestScores, requestTitles, apiKey, model, sleep }) {
  if (isMockMode()) return failure('mock_db');

  const savedRows = await query(SAVED_TEAMS_SQL);
  const teams = groupTeams(savedRows);
  if (teams.length === 0) return failure('not_paired_yet');

  const pending = (await query(PENDING_SQL)).filter(hasAnswer);
  if (pending.length === 0) return failure('no_newcomers');
  if (!canPairNewcomers(pending.length, teams)) return failure('waiting_for_another');
  if (!apiKey) return failure('missing_key');

  const champions = await query('SELECT id, name, description_es, description_en FROM alsinext_champions ORDER BY id');
  if (champions.length === 0) return failure('no_champions');

  // Afinidades solo de los nuevos: sus respuestas, sin correos (RNF privacidad)
  let scoreList;
  try {
    scoreList = await requestScores({ apiKey, model, answers: pending.map((p) => p.ai_usage.trim()), champions });
  } catch (error) {
    return { ok: false, code: 'gemini_failed', message: `Gemini no ha respondido bien (${error.message}). No se ha guardado nada; puedes volver a intentarlo.` };
  }
  const scores = Object.fromEntries(pending.map((p, i) => [p.email, scoreList[i]]));
  const { joins, newTeams } = assignNewcomers(pending.map((p) => ({ email: p.email })), teams, champions, scores);

  // Solo filas nuevas; antes se comprueba que nada ha cambiado mientras se calculaba
  const values = [
    ...joins.map((join) => [join.teamId, join.championId, join.email]),
    ...newTeams.flatMap((team) => team.emails.map((email) => [team.teamId, team.championId, email])),
  ];
  const sameEmails = (a, b) => a.map((r) => r.email).sort().join('|') === b.map((r) => r.email).sort().join('|');
  const saved = await withTransaction(async (connection) => {
    const [nowSaved] = await connection.query(SAVED_TEAMS_SQL);
    const [nowPending] = await connection.query(PENDING_SQL);
    if (nowSaved.length !== savedRows.length || !sameEmails(nowPending.filter(hasAnswer), pending)) return false;
    await connection.query(
      `INSERT INTO alsinext_equipos (team_id, champion_id, email) VALUES ${values.map(() => '(?, ?, ?)').join(', ')}`,
      values.flat(),
    );
    return true;
  });
  if (!saved) return failure('pairing_changed');

  const titles = await titlesAfterPairing({ isMockMode, query, requestTitles, apiKey, model, sleep });
  return {
    ok: true,
    joined: joins.length,
    newTeams: newTeams.length,
    participants: pending.length,
    ...titles.summary,
    message: [`Emparejados ${pending.length} nuevos: ${joins.length} se unen a un equipo y ${newTeams.length} equipos nuevos.`, titles.message].filter(Boolean).join('\n'),
  };
}

// ---------- Títulos de los proyectos (RF-13f) ----------

// Equipos sin título con las respuestas de sus personas
const MISSING_TITLES_SQL = `SELECT e.team_id, c.ai_usage FROM alsinext_equipos e
  LEFT JOIN alsinext_equipos_titulos t ON t.team_id = e.team_id
  LEFT JOIN alsinext_compromisos c ON c.email = e.email
  WHERE t.team_id IS NULL ORDER BY e.team_id, e.id`;

// Pide a Gemini el título de los equipos que no tienen y los guarda. Nunca cambia un título
// que ya existe (INSERT IGNORE). A Gemini solo le llegan las respuestas, sin correos.
async function generateMissingTitles({ isMockMode, query, requestTitles, apiKey, model }) {
  if (isMockMode()) return failure('mock_db');
  if (!apiKey) return failure('missing_key');

  const answersByTeam = new Map();
  for (const row of await query(MISSING_TITLES_SQL)) {
    if (!answersByTeam.has(row.team_id)) answersByTeam.set(row.team_id, []);
    if (hasAnswer(row)) answersByTeam.get(row.team_id).push(row.ai_usage.trim());
  }
  if (answersByTeam.size === 0) return failure('no_missing_titles');

  const teamIds = [...answersByTeam.keys()];
  let titles;
  try {
    titles = await requestTitles({ apiKey, model, teams: teamIds.map((id) => answersByTeam.get(id)) });
  } catch (error) {
    return { ok: false, code: 'gemini_failed', message: `Gemini no ha dado los títulos (${error.message}). No se ha guardado ninguno; puedes volver a intentarlo.` };
  }
  // Cada título por separado (T35): se guardan los que valen; los que faltan se reintentan
  const values = teamIds.flatMap((id, i) => (titles[i] ? [[id, titles[i].es, titles[i].en]] : []));
  if (values.length === 0) {
    return { ok: false, code: 'gemini_failed', message: 'Gemini no ha dado ningún título válido. No se ha guardado ninguno; puedes volver a intentarlo.' };
  }
  await query(
    `INSERT IGNORE INTO alsinext_equipos_titulos (team_id, title_es, title_en) VALUES ${values.map(() => '(?, ?, ?)').join(', ')}`,
    values.flat(),
  );
  const missing = teamIds.length - values.length;
  return {
    ok: true,
    titled: values.length,
    missing,
    message: `Títulos generados: ${values.length} equipos${missing ? ` (faltan ${missing})` : ''}.`,
  };
}

// Después de emparejar: genera los títulos que falten. Un fallo no deshace el emparejamiento;
// se avisa con titlesFailed y la vista ofrece «Generar títulos».
// Si falta alguno (fallo de Gemini, p. ej. por muchas llamadas seguidas, o un título que no
// vale), lo reintenta una vez tras una pausa (T35): el reintento solo pide los que faltan.
const TITLE_RETRY_MS = 3000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function titlesAfterPairing(deps) {
  if (!deps.requestTitles) return { summary: {}, message: '' };
  const sleep = deps.sleep || wait;
  let titled = 0;
  let result = await generateMissingTitles(deps);
  if (result.ok) titled += result.titled;
  if (!result.ok ? result.code === 'gemini_failed' : result.missing > 0) {
    await sleep(TITLE_RETRY_MS);
    result = await generateMissingTitles(deps);
    if (result.ok) titled += result.titled;
  }
  const failed = result.ok ? result.missing > 0 : result.code !== 'no_missing_titles';
  if (!failed) return { summary: { titled }, message: titled ? `Títulos generados: ${titled} equipos.` : '' };
  return { summary: { titled, titlesFailed: true }, message: `Faltan títulos: ${result.message}` };
}

// Ejecución desde la terminal: conecta con la BD real y con Gemini
async function main() {
  const db = require('../../config/db');
  const { env } = require('../../config/env');
  const { requestAffinityScores, requestProjectTitles } = require('./alsinext.gemini');

  let exitCode = 1;
  try {
    await db.pingDatabase(); // decide si MySQL está disponible (si no, isMockMode() = true)
    const result = await runPairing({
      isMockMode: db.isMockMode,
      query: db.query,
      withTransaction: db.withTransaction,
      requestScores: requestAffinityScores,
      requestTitles: requestProjectTitles,
      apiKey: env.gemini.apiKey,
      model: env.gemini.model,
    });
    console.log(result.message);
    exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Error inesperado: ${error.message}. No se ha guardado nada.`);
  } finally {
    await db.pool.end();
  }
  process.exitCode = exitCode;
}

if (require.main === module) main();

module.exports = { runPairing, runPairNewcomers, getPendingStatus, generateMissingTitles };
