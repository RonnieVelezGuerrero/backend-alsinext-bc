// Tests de la orden de emparejamiento (spec 006, T4) con base de datos y Gemini falsos:
// cada comprobación termina con su mensaje sin escribir nada; el guardado va en una transacción.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPairing, runPairNewcomers, getPendingStatus, generateMissingTitles } = require('./alsinext.pairTeams');

const CHAMPIONS = [
  { id: 1, name: 'Lluis Orteu', description_es: 'Reuniones', description_en: 'Meetings' },
  { id: 2, name: 'Raúl Limones', description_es: 'Web', description_en: 'Web' },
];

function participants(n) {
  return Array.from({ length: n }, (_, i) => ({
    email: `demo${String(i + 1).padStart(2, '0')}@demo.alsinext.test`,
    ai_usage: `Respuesta ${i + 1}`,
  }));
}

// BD falsa: responde según la consulta y apunta todo lo que pasa
function fakeDeps({
  mock = false,
  existingTeams = 0,
  existingTeamsInTransaction = existingTeams,
  rows = participants(4),
  champions = CHAMPIONS,
  apiKey = 'clave',
  scores = null,
  geminiError = null,
} = {}) {
  const log = { queries: [], transactions: 0, inserts: [], geminiCalls: [] };
  const fakeQuery = (inTransaction) => async (sql, params) => {
    log.queries.push(sql);
    if (/count\(\*\)/i.test(sql) && /alsinext_equipos/.test(sql)) {
      const n = inTransaction ? existingTeamsInTransaction : existingTeams;
      return inTransaction ? [[{ n }]] : [{ n }];
    }
    if (/from alsinext_compromisos/i.test(sql)) return rows;
    if (/from alsinext_champions/i.test(sql)) return champions;
    if (/delete from alsinext_equipos_titulos/i.test(sql)) {
      log.titleDeletes = (log.titleDeletes || 0) + 1;
      return inTransaction ? [{ affectedRows: 0 }] : { affectedRows: 0 };
    }
    if (/insert into alsinext_equipos/i.test(sql)) {
      log.inserts.push(params);
      return [{ affectedRows: params.length / 3 }];
    }
    throw new Error(`consulta inesperada: ${sql}`);
  };
  return {
    log,
    deps: {
      isMockMode: () => mock,
      query: fakeQuery(false),
      withTransaction: async (handler) => {
        log.transactions += 1;
        return handler({ query: fakeQuery(true) }); // como una conexión de mysql2: [rows, fields]
      },
      apiKey,
      model: 'modelo-x',
      requestScores: async ({ answers, champions: list }) => {
        log.geminiCalls.push(answers);
        if (geminiError) throw new Error(geminiError);
        return scores || answers.map((_, i) => Object.fromEntries(list.map((c) => [c.id, (i * 13 + c.id * 7) % 100])));
      },
    },
  };
}

test('runPairing: con la BD simulada no hace nada (mock_db) [RF-1]', async () => {
  const { deps, log } = fakeDeps({ mock: true });
  const result = await runPairing(deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'mock_db');
  assert.equal(log.queries.length, 0);
  assert.equal(log.geminiCalls.length, 0);
  assert.equal(log.transactions, 0);
});

test('runPairing: si ya hay equipos, se rechaza sin llamar a Gemini (already_paired) [RF-8]', async () => {
  const { deps, log } = fakeDeps({ existingTeams: 10 });
  const result = await runPairing(deps);
  assert.equal(result.code, 'already_paired');
  assert.equal(log.geminiCalls.length, 0);
  assert.equal(log.transactions, 0);
});

test('runPairing: sin clave de Gemini → missing_key, sin escribir nada', async () => {
  const { deps, log } = fakeDeps({ apiKey: '' });
  const result = await runPairing(deps);
  assert.equal(result.code, 'missing_key');
  assert.equal(log.geminiCalls.length, 0);
  assert.equal(log.transactions, 0);
});

test('runPairing: con menos de 3 participantes con respuesta → not_enough_participants [RF-10]', async () => {
  // Dos con respuesta y otro sin ella (vacía): solo cuentan los dos primeros
  const rows = [
    { email: 'a@demo.alsinext.test', ai_usage: 'Resumir actas' },
    { email: 'b@demo.alsinext.test', ai_usage: 'Informes de ventas' },
    { email: 'c@demo.alsinext.test', ai_usage: '   ' },
  ];
  const { deps, log } = fakeDeps({ rows });
  const result = await runPairing(deps);
  assert.equal(result.code, 'not_enough_participants');
  assert.equal(log.geminiCalls.length, 0);
  assert.equal(log.transactions, 0);
});

test('runPairing: si falla Gemini no se guarda nada y se informa del motivo [RF-9]', async () => {
  const { deps, log } = fakeDeps({ geminiError: 'gemini_http_429' });
  const result = await runPairing(deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'gemini_failed');
  assert.match(result.message, /gemini_http_429/);
  assert.equal(log.transactions, 0);
});

test('runPairing: a Gemini solo le llegan las respuestas, sin correos [RNF privacidad]', async () => {
  const { deps, log } = fakeDeps();
  await runPairing(deps);
  assert.deepEqual(log.geminiCalls[0], ['Respuesta 1', 'Respuesta 2', 'Respuesta 3', 'Respuesta 4']);
});

test('runPairing: guarda todos los equipos en una sola transacción [RF-2, RF-7]', async () => {
  const { deps, log } = fakeDeps({ rows: participants(7) });
  const result = await runPairing(deps);
  assert.equal(result.ok, true);
  assert.equal(log.transactions, 1);
  assert.equal(log.inserts.length, 1, 'un único INSERT con todas las filas');

  // Filas [team_id, champion_id, email]: los 7 participantes, cada uno una vez
  const params = log.inserts[0];
  const rows = [];
  for (let i = 0; i < params.length; i += 3) rows.push(params.slice(i, i + 3));
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r[2]).sort(), participants(7).map((p) => p.email).sort());
  assert.deepEqual([...new Set(rows.map((r) => r[0]))].sort(), [1, 2], '2 equipos (uno de 4)');
  const sizes = [1, 2].map((id) => rows.filter((r) => r[0] === id).length).sort();
  assert.deepEqual(sizes, [3, 4], 'equipos de 3 y el que sobra a uno de 4 [RF-4, RF-6]');
  assert.ok(rows.every((r) => [1, 2].includes(r[1])));
});

test('runPairing: el mensaje final resume los equipos sin correos [RF-7, RNF privacidad]', async () => {
  const { deps } = fakeDeps({ rows: participants(6) });
  const result = await runPairing(deps);
  assert.equal(result.teams, 2);
  assert.equal(result.participants, 6);
  assert.doesNotMatch(result.message, /@/);
  assert.match(result.message, /2 equipos/);
});

test('runPairing: si otro emparejamiento se guardó mientras tanto, la transacción no inserta [RF-8]', async () => {
  const { deps, log } = fakeDeps({ existingTeams: 0, existingTeamsInTransaction: 3 });
  const result = await runPairing(deps);
  assert.equal(result.code, 'already_paired');
  assert.equal(log.inserts.length, 0);
});

// ---------- «Emparejar nuevos» (RF-15, T18) ----------

// Equipos guardados: filas { team_id, champion_id, email } (equipos 1 y 2 de 3, champions 1 y 2)
const SAVED = [
  { team_id: 1, champion_id: 1, email: 'a@demo.alsinext.test' },
  { team_id: 1, champion_id: 1, email: 'b@demo.alsinext.test' },
  { team_id: 1, champion_id: 1, email: 'g@demo.alsinext.test' },
  { team_id: 2, champion_id: 2, email: 'c@demo.alsinext.test' },
  { team_id: 2, champion_id: 2, email: 'd@demo.alsinext.test' },
  { team_id: 2, champion_id: 2, email: 'h@demo.alsinext.test' },
];
const late = (n) => Array.from({ length: n }, (_, i) => ({ email: 'late' + (i + 1) + '@demo.alsinext.test', ai_usage: 'Tarde ' + (i + 1) }));

// BD falsa para los rezagados: equipos guardados y personas sin equipo (antes y dentro de la transacción)
function newcomerDeps({ mock = false, saved = SAVED, pending = late(1), pendingInTransaction = pending, savedInTransaction = saved, apiKey = 'clave', scores = null, geminiError = null, titled = [...new Set(saved.map((r) => r.team_id))] } = {}) {
  const log = { inserts: [], transactions: 0, geminiCalls: [] };
  const fakeQuery = (inTransaction) => async (sql, params) => {
    const wrap = (rows) => (inTransaction ? [rows] : rows);
    if (/from alsinext_equipos_titulos/i.test(sql)) return wrap(titled.map((team_id) => ({ team_id })));
    if (/left join alsinext_equipos /i.test(sql) || /left join alsinext_equipos e /i.test(sql)) return wrap(inTransaction ? pendingInTransaction : pending);
    if (/from alsinext_equipos/i.test(sql)) return wrap(inTransaction ? savedInTransaction : saved);
    if (/from alsinext_champions/i.test(sql)) return wrap(CHAMPIONS);
    if (/insert into alsinext_equipos/i.test(sql)) { log.inserts.push(params); return wrap({ affectedRows: params.length / 3 }); }
    throw new Error('consulta inesperada: ' + sql);
  };
  return {
    log,
    deps: {
      isMockMode: () => mock,
      query: fakeQuery(false),
      withTransaction: async (handler) => { log.transactions += 1; return handler({ query: fakeQuery(true) }); },
      apiKey,
      model: 'm',
      requestScores: async ({ answers, champions }) => {
        log.geminiCalls.push(answers);
        if (geminiError) throw new Error(geminiError);
        return scores || answers.map(() => Object.fromEntries(champions.map((c) => [c.id, c.id === 2 ? 90 : 10])));
      },
    },
  };
}
const insertedRows = (params) => {
  const rows = [];
  for (let i = 0; i < params.length; i += 3) rows.push(params.slice(i, i + 3));
  return rows;
};

test('runPairNewcomers: con la BD simulada no hace nada (mock_db)', async () => {
  const { deps, log } = newcomerDeps({ mock: true });
  assert.equal((await runPairNewcomers(deps)).code, 'mock_db');
  assert.equal(log.geminiCalls.length + log.transactions, 0);
});

test('runPairNewcomers: sin emparejamiento previo → not_paired_yet (para eso está «Emparejar») [RF-15]', async () => {
  const { deps, log } = newcomerDeps({ saved: [] });
  assert.equal((await runPairNewcomers(deps)).code, 'not_paired_yet');
  assert.equal(log.geminiCalls.length, 0);
});

test('runPairNewcomers: sin personas sin equipo → no_newcomers [RF-15]', async () => {
  const { deps, log } = newcomerDeps({ pending: [] });
  assert.equal((await runPairNewcomers(deps)).code, 'no_newcomers');
  assert.equal(log.geminiCalls.length, 0);
});

test('runPairNewcomers: sin clave de Gemini → missing_key', async () => {
  const { deps } = newcomerDeps({ apiKey: '' });
  assert.equal((await runPairNewcomers(deps)).code, 'missing_key');
});

test('runPairNewcomers: 1 persona y ningún equipo de 3 → waiting_for_another, sin llamar a Gemini [RF-15]', async () => {
  const full = [...SAVED, { team_id: 1, champion_id: 1, email: 'e@demo.alsinext.test' }, { team_id: 2, champion_id: 2, email: 'f@demo.alsinext.test' }];
  const { deps, log } = newcomerDeps({ saved: full });
  assert.equal((await runPairNewcomers(deps)).code, 'waiting_for_another');
  assert.equal(log.geminiCalls.length + log.transactions, 0);
});

test('runPairNewcomers: 1 persona se une al equipo de su champion más afín; solo inserta su fila [RF-15]', async () => {
  const { deps, log } = newcomerDeps();
  const result = await runPairNewcomers(deps);
  assert.equal(result.ok, true);
  assert.deepEqual(log.geminiCalls, [['Tarde 1']], 'a Gemini solo las respuestas de los nuevos, sin correos');
  assert.equal(log.transactions, 1);
  assert.deepEqual(insertedRows(log.inserts[0]), [[2, 2, 'late1@demo.alsinext.test']]);
  assert.equal(result.joined, 1);
  assert.equal(result.newTeams, 0);
  assert.doesNotMatch(result.message, /@/);
});

test('runPairNewcomers: 3 personas → un equipo nuevo de 3 con el id siguiente [RF-15]', async () => {
  const { deps, log } = newcomerDeps({ pending: late(3) });
  const result = await runPairNewcomers(deps);
  const rows = insertedRows(log.inserts[0]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r[0] === 3), 'equipo 3');
  assert.deepEqual(rows.map((r) => r[2]).sort(), late(3).map((x) => x.email).sort());
  assert.equal(result.newTeams, 1);
  assert.equal(result.participants, 3);
});

test('runPairNewcomers: si falla Gemini no se guarda nada [RF-9]', async () => {
  const { deps, log } = newcomerDeps({ geminiError: 'timeout' });
  const result = await runPairNewcomers(deps);
  assert.equal(result.code, 'gemini_failed');
  assert.equal(log.transactions, 0);
});

test('runPairNewcomers: si mientras tanto cambian los equipos o los pendientes, no guarda (pairing_changed)', async () => {
  const other = newcomerDeps({ pendingInTransaction: [] });
  assert.equal((await runPairNewcomers(other.deps)).code, 'pairing_changed');
  assert.equal(other.log.inserts.length, 0);
  const grown = newcomerDeps({ savedInTransaction: [...SAVED, { team_id: 2, champion_id: 2, email: 'z@demo.alsinext.test' }] });
  assert.equal((await runPairNewcomers(grown.deps)).code, 'pairing_changed');
  assert.equal(grown.log.inserts.length, 0);
});

test('getPendingStatus: cuántos faltan y si se puede emparejar ya, sin correos [RF-15]', async () => {
  assert.deepEqual(await getPendingStatus(newcomerDeps({ pending: [] }).deps), { pending: 0, canPair: false, missingTitles: 0 });
  assert.deepEqual(await getPendingStatus(newcomerDeps().deps), { pending: 1, canPair: true, missingTitles: 0 });
  assert.deepEqual(await getPendingStatus(newcomerDeps({ pending: late(2) }).deps), { pending: 2, canPair: true, missingTitles: 0 });
  const full = SAVED.concat([{ team_id: 1, champion_id: 1, email: 'e@x' }, { team_id: 2, champion_id: 2, email: 'f@x' }]);
  assert.deepEqual(await getPendingStatus(newcomerDeps({ saved: full }).deps), { pending: 1, canPair: false, missingTitles: 0 });
  assert.deepEqual(await getPendingStatus(newcomerDeps({ saved: [] }).deps), { pending: 1, canPair: false, missingTitles: 0 }, 'sin emparejar aún: para eso está «Emparejar»');
  assert.equal((await getPendingStatus(newcomerDeps({ saved: full, pending: late(3) }).deps)).canPair, true, 'con 3 se forma un equipo nuevo');
  const oneOf3 = full.filter((r) => r.email !== 'f@x'); // solo el equipo 2 sigue de 3
  assert.equal((await getPendingStatus(newcomerDeps({ saved: oneOf3, pending: late(2) }).deps)).canPair, false, '2 personas y 1 equipo de 3: esperan');
  const blank = newcomerDeps({ pending: [{ email: 'q@x', ai_usage: '  ' }] });
  assert.deepEqual(await getPendingStatus(blank.deps), { pending: 0, canPair: false, missingTitles: 0 }, 'sin respuesta no cuenta');
});

// ---------- Títulos de los proyectos (RF-13f, T23) ----------

// Equipos sin título con las respuestas de sus personas (lo que lee generateMissingTitles)
const UNTITLED = [
  { team_id: 1, ai_usage: 'Resumir actas' },
  { team_id: 1, ai_usage: 'Correos' },
  { team_id: 3, ai_usage: 'Hacer webs' },
  { team_id: 3, ai_usage: '  ' }, // sin respuesta: no se envía
];

function titleDeps({ mock = false, rows = UNTITLED, apiKey = 'clave', titlesError = null } = {}) {
  const log = { inserts: [], calls: [] };
  return {
    log,
    deps: {
      isMockMode: () => mock,
      query: async (sql, params) => {
        if (/insert ignore into alsinext_equipos_titulos/i.test(sql)) { log.inserts.push(params); return { affectedRows: params.length / 3 }; }
        if (/alsinext_equipos_titulos/i.test(sql)) return rows;
        throw new Error('consulta inesperada: ' + sql);
      },
      apiKey,
      model: 'm',
      requestTitles: async ({ teams }) => {
        log.calls.push(teams);
        if (titlesError) throw new Error(titlesError);
        return teams.map((_, i) => ({ es: 'Proyecto T' + (i + 1), en: 'Project T' + (i + 1) }));
      },
    },
  };
}

test('generateMissingTitles: pide títulos solo de los equipos sin título, con sus respuestas (sin correos) [RF-13f]', async () => {
  const { deps, log } = titleDeps();
  const result = await generateMissingTitles(deps);
  assert.equal(result.ok, true);
  assert.equal(result.titled, 2);
  assert.deepEqual(log.calls, [[['Resumir actas', 'Correos'], ['Hacer webs']]]);
  assert.doesNotMatch(JSON.stringify(log.calls), /@/);
  assert.deepEqual(log.inserts, [[1, 'Proyecto T1', 'Project T1', 3, 'Proyecto T2', 'Project T2']], 'un INSERT IGNORE (nunca cambia uno que ya existe)');
});

test('generateMissingTitles: sin equipos sin título → no_missing_titles, sin llamar a Gemini', async () => {
  const { deps, log } = titleDeps({ rows: [] });
  assert.equal((await generateMissingTitles(deps)).code, 'no_missing_titles');
  assert.equal(log.calls.length, 0);
});

test('generateMissingTitles: BD simulada, sin clave o fallo de Gemini → no se escribe nada [RF-13f]', async () => {
  assert.equal((await generateMissingTitles(titleDeps({ mock: true }).deps)).code, 'mock_db');
  assert.equal((await generateMissingTitles(titleDeps({ apiKey: '' }).deps)).code, 'missing_key');
  const failing = titleDeps({ titlesError: 'invalid_title' });
  const result = await generateMissingTitles(failing.deps);
  assert.equal(result.code, 'gemini_failed');
  assert.equal(failing.log.inserts.length, 0);
});

test('runPairing: después de guardar los equipos genera sus títulos [RF-13f]', async () => {
  const { deps } = fakeDeps({ rows: participants(4) });
  let asked = 0;
  deps.sleep = async () => {};
  deps.requestTitles = async ({ teams }) => { asked = teams.length; return teams.map(() => ({ es: 'Proyecto X', en: 'Project X' })); };
  const realQuery = deps.query;
  const titleInserts = [];
  deps.query = async (sql, params) => {
    if (/insert ignore into alsinext_equipos_titulos/i.test(sql)) { titleInserts.push(params); return {}; }
    if (/alsinext_equipos_titulos/i.test(sql)) return [{ team_id: 1, ai_usage: 'a' }, { team_id: 2, ai_usage: 'b' }];
    return realQuery(sql, params);
  };
  const result = await runPairing(deps);
  assert.equal(result.ok, true);
  assert.equal(asked, 2);
  assert.equal(titleInserts.length, 1);
  assert.equal(result.titled, 2);
  assert.equal(result.titlesFailed, undefined);
});

test('runPairing: si fallan los títulos, los equipos quedan guardados y se avisa (titlesFailed) [RF-13f]', async () => {
  const { deps, log } = fakeDeps({ rows: participants(4) });
  deps.sleep = async () => {};
  deps.requestTitles = async () => { throw new Error('invalid_title'); };
  const realQuery = deps.query;
  deps.query = async (sql, params) => (/alsinext_equipos_titulos/i.test(sql) ? [{ team_id: 1, ai_usage: 'a' }] : realQuery(sql, params));
  const result = await runPairing(deps);
  assert.equal(result.ok, true, 'el emparejamiento no depende del título');
  assert.equal(log.inserts.length, 1, 'equipos guardados');
  assert.equal(result.titlesFailed, true);
  assert.equal(result.titled, 0);
});

test('runPairNewcomers: tras repartir genera los títulos que falten [RF-13f]', async () => {
  const { deps } = newcomerDeps({ pending: late(2) });
  let asked = null;
  deps.sleep = async () => {};
  deps.requestTitles = async ({ teams }) => { asked = teams; return teams.map(() => ({ es: 'Proyecto N', en: 'Project N' })); };
  const realQuery = deps.query;
  deps.query = async (sql, params) => {
    if (/insert ignore into alsinext_equipos_titulos/i.test(sql)) return {};
    if (/left join alsinext_equipos_titulos/i.test(sql)) return [{ team_id: 3, ai_usage: 'Tarde 1' }, { team_id: 3, ai_usage: 'Tarde 2' }];
    return realQuery(sql, params);
  };
  const result = await runPairNewcomers(deps);
  assert.equal(result.ok, true);
  assert.deepEqual(asked, [['Tarde 1', 'Tarde 2']]);
  assert.equal(result.titled, 1);
});

test('getPendingStatus: cuenta los equipos sin título [RF-13f]', async () => {
  assert.equal((await getPendingStatus(newcomerDeps({ pending: [], titled: [1] }).deps)).missingTitles, 1);
  assert.equal((await getPendingStatus(newcomerDeps({ pending: [], titled: [] }).deps)).missingTitles, 2);
  assert.equal((await getPendingStatus(newcomerDeps({ pending: [], saved: [], titled: [] }).deps)).missingTitles, 0);
});

test('runPairing: sin equipos guardados, descarta títulos sobrantes antes de guardar (no se heredan) [RF-13f]', async () => {
  const { deps, log } = fakeDeps({ rows: participants(4) });
  const result = await runPairing(deps);
  assert.equal(result.ok, true);
  assert.equal(log.titleDeletes, 1, 'en la misma transacción que los equipos nuevos');
});

test('runPairing: si ya había equipos (rechazado), no toca los títulos [RF-8]', async () => {
  const { deps, log } = fakeDeps({ existingTeams: 0, existingTeamsInTransaction: 3 });
  assert.equal((await runPairing(deps)).code, 'already_paired');
  assert.equal(log.titleDeletes, undefined);
});

// ---------- Títulos por separado y un reintento (RF-13f, T35) ----------

test('generateMissingTitles: guarda los títulos que valen aunque falte alguno, y dice cuántos faltan [RF-13f]', async () => {
  const { deps, log } = titleDeps();
  deps.requestTitles = async ({ teams }) => teams.map((_, i) => (i === 0 ? null : { es: 'Proyecto B', en: 'Project B' }));
  const result = await generateMissingTitles(deps);
  assert.equal(result.ok, true);
  assert.equal(result.titled, 1);
  assert.equal(result.missing, 1);
  assert.deepEqual(log.inserts, [[3, 'Proyecto B', 'Project B']]);
});

test('generateMissingTitles: si no vale ninguno, no escribe nada (gemini_failed) [RF-13f]', async () => {
  const { deps, log } = titleDeps();
  deps.requestTitles = async ({ teams }) => teams.map(() => null);
  assert.equal((await generateMissingTitles(deps)).code, 'gemini_failed');
  assert.equal(log.inserts.length, 0);
});

// BD falsa de emparejar + títulos: las filas sin título se van quitando al guardarlos
function pairingWithTitles(attempts) {
  const { deps, log } = fakeDeps({ rows: participants(6) });
  const realQuery = deps.query;
  let untitled = [{ team_id: 1, ai_usage: 'a' }, { team_id: 2, ai_usage: 'b' }];
  deps.query = async (sql, params) => {
    if (/insert ignore into alsinext_equipos_titulos/i.test(sql)) {
      const saved = new Set(params.filter((_, i) => i % 3 === 0));
      untitled = untitled.filter((r) => !saved.has(r.team_id));
      return {};
    }
    if (/alsinext_equipos_titulos/i.test(sql)) return untitled;
    return realQuery(sql, params);
  };
  let call = 0;
  deps.requestTitles = async ({ teams }) => attempts[call++]({ teams });
  const pauses = [];
  deps.sleep = async (ms) => { pauses.push(ms); };
  return { deps, log, pauses, calls: () => call };
}

test('runPairing: si fallan los títulos, reintenta una vez tras una pausa y los guarda [RF-13f]', async () => {
  const { deps, pauses, calls } = pairingWithTitles([
    async () => { throw new Error('gemini_http_429'); },
    async ({ teams }) => teams.map(() => ({ es: 'Proyecto R', en: 'Project R' })),
  ]);
  const result = await runPairing(deps);
  assert.equal(result.ok, true);
  assert.equal(calls(), 2);
  assert.equal(pauses.length, 1);
  assert.ok(pauses[0] >= 1000, 'unos segundos de pausa');
  assert.equal(result.titled, 2);
  assert.equal(result.titlesFailed, undefined);
});

test('runPairing: si en el primer intento falta un título, el reintento pide solo ese [RF-13f]', async () => {
  let second = null;
  const { deps } = pairingWithTitles([
    async ({ teams }) => teams.map((_, i) => (i === 0 ? { es: 'Proyecto A', en: 'Project A' } : null)),
    async ({ teams }) => { second = teams; return teams.map(() => ({ es: 'Proyecto B', en: 'Project B' })); },
  ]);
  const result = await runPairing(deps);
  assert.deepEqual(second, [['b']], 'solo el equipo que faltaba');
  assert.equal(result.titled, 2);
  assert.equal(result.titlesFailed, undefined);
});

test('runPairing: si el reintento también falla, avisa (titlesFailed) y los equipos quedan guardados [RF-13f]', async () => {
  const { deps, log, calls } = pairingWithTitles([
    async () => { throw new Error('gemini_http_429'); },
    async () => { throw new Error('gemini_http_429'); },
  ]);
  const result = await runPairing(deps);
  assert.equal(result.ok, true);
  assert.equal(calls(), 2, 'solo un reintento');
  assert.equal(log.inserts.length, 1);
  assert.equal(result.titlesFailed, true);
});
