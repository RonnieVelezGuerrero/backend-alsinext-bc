// Tests del reparto en equipos (spec 006, T2; equipos de 3 desde T32). Ejecutar con:
// node --test "src/modules/alsinext/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { assignTeams, assignNewcomers } = require('./alsinext.pairing');

// 12 champions con id 1..12, como en alsinext_champions
const CHAMPIONS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));

function makeParticipants(n) {
  return Array.from({ length: n }, (_, i) => ({ email: `p${String(i + 1).padStart(2, '0')}@demo.test` }));
}

// Afinidades "de relleno" variadas pero fijas (sin azar): 0–99
function fillerScores(participants, champions = CHAMPIONS) {
  const scores = {};
  participants.forEach((p, i) => {
    scores[p.email] = {};
    champions.forEach((c) => { scores[p.email][c.id] = (i * 37 + c.id * 11) % 100; });
  });
  return scores;
}

// Cada participante prefiere claramente un champion (100) y el resto vale 10
function preferenceScores(participants, preferredOf) {
  const scores = {};
  participants.forEach((p, i) => {
    scores[p.email] = {};
    CHAMPIONS.forEach((c) => { scores[p.email][c.id] = c.id === preferredOf(i) ? 100 : 10; });
  });
  return scores;
}

// Propiedades comunes (RF-2, RF-4, RF-5, RF-6 · equipos de 3)
function checkProperties(teams, participants, champions = CHAMPIONS) {
  const n = participants.length;
  const all = teams.flatMap((t) => t.emails);
  assert.equal(all.length, n, 'cada participante aparece una vez');
  assert.deepEqual([...all].sort(), participants.map((p) => p.email).sort());
  assert.equal(teams.length, Math.floor(n / 3), '⌊N/3⌋ equipos');

  const sizes = teams.map((t) => t.emails.length);
  assert.ok(sizes.every((s) => s >= 3), 'nunca equipos de 2');
  if (teams.length > 1) {
    assert.equal(sizes.filter((s) => s === 4).length, n % 3, 'los que sobran, en equipos de 4 distintos');
    assert.ok(sizes.every((s) => s === 3 || s === 4));
  }

  assert.deepEqual(teams.map((t) => t.teamId), teams.map((_, i) => i + 1), 'ids 1..T en orden');

  const perChampion = champions.map((c) => teams.filter((t) => t.championId === c.id).length);
  assert.ok(Math.max(...perChampion) - Math.min(...perChampion) <= 1, 'rondas: diferencia ≤ 1');
}

test('assignTeams: con 0, 1 o 2 participantes no se empareja [RF-10]', () => {
  for (const n of [0, 1, 2]) {
    const ps = makeParticipants(n);
    assert.throws(() => assignTeams(ps, CHAMPIONS, fillerScores(ps)), { message: 'not_enough_participants' }, String(n));
  }
});

test('assignTeams: sin champions lanza error', () => {
  const three = makeParticipants(3);
  assert.throws(() => assignTeams(three, [], {}), { message: 'no_champions' });
});

test('assignTeams: 3 participantes → 1 equipo de 3 con el champion que prefieren [RF-4, RF-5]', () => {
  const ps = makeParticipants(3);
  const teams = assignTeams(ps, CHAMPIONS, preferenceScores(ps, () => 7));
  checkProperties(teams, ps);
  assert.equal(teams[0].championId, 7);
  assert.equal(teams[0].emails.length, 3);
});

test('assignTeams: 4 → un equipo de 4; 5 → un equipo de 5 (un solo equipo) [RF-6]', () => {
  for (const n of [4, 5]) {
    const ps = makeParticipants(n);
    const teams = assignTeams(ps, CHAMPIONS, fillerScores(ps));
    checkProperties(teams, ps);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].emails.length, n);
  }
});

test('assignTeams: 36 participantes → 12 equipos de 3, uno por champion (ronda 1 completa) [RF-4, RF-5]', () => {
  const ps = makeParticipants(36);
  const teams = assignTeams(ps, CHAMPIONS, fillerScores(ps));
  checkProperties(teams, ps);
  assert.equal(new Set(teams.map((t) => t.championId)).size, 12);
  assert.ok(teams.every((t) => t.emails.length === 3));
});

test('assignTeams: 37 → 12 equipos, uno de 4; 38 → 12 equipos, dos de 4 [RF-6]', () => {
  for (const [n, fours] of [[37, 1], [38, 2]]) {
    const ps = makeParticipants(n);
    const teams = assignTeams(ps, CHAMPIONS, fillerScores(ps));
    checkProperties(teams, ps);
    assert.equal(teams.length, 12);
    assert.equal(teams.filter((t) => t.emails.length === 4).length, fours);
  }
});

test('assignTeams: 39 participantes → 13 equipos; un champion acompaña a 2 [RF-5]', () => {
  const ps = makeParticipants(39);
  const teams = assignTeams(ps, CHAMPIONS, fillerScores(ps));
  checkProperties(teams, ps);
  const counts = CHAMPIONS.map((c) => teams.filter((t) => t.championId === c.id).length);
  assert.equal(counts.filter((x) => x === 2).length, 1);
  assert.equal(new Set(teams.slice(0, 12).map((t) => t.championId)).size, 12, 'la ronda 1 va primero');
});

test('assignTeams: 101 participantes (la demo + 1) → 33 equipos: 31 de 3 y 2 de 4 [RF-4, RF-6]', () => {
  const ps = makeParticipants(101);
  const teams = assignTeams(ps, CHAMPIONS, fillerScores(ps));
  checkProperties(teams, ps);
  assert.equal(teams.length, 33);
  assert.equal(teams.filter((t) => t.emails.length === 3).length, 31);
  assert.equal(teams.filter((t) => t.emails.length === 4).length, 2);
});

test('assignTeams: cada persona va a su champion preferido mientras tenga plaza [RF-5]', () => {
  // 36 personas: 3 prefieren a cada champion → todas lo consiguen
  const ps = makeParticipants(36);
  const preferred = (i) => Math.floor(i / 3) + 1;
  const teams = assignTeams(ps, CHAMPIONS, preferenceScores(ps, preferred));
  checkProperties(teams, ps);
  ps.forEach((p, i) => {
    const team = teams.find((t) => t.emails.includes(p.email));
    assert.equal(team.championId, preferred(i), `${p.email} con su champion`);
  });
});

test('assignTeams: si su preferido está lleno, va al siguiente con más afinidad que tenga sitio [RF-5]', () => {
  // 36 personas: p01..p05 prefieren al champion 1 (solo 3 plazas en la ronda);
  // p04 y p05 tienen como segunda opción al champion 2, que nadie más pide
  const ps = makeParticipants(36);
  const scores = {};
  ps.forEach((p) => {
    scores[p.email] = {};
    CHAMPIONS.forEach((c) => { scores[p.email][c.id] = 0; });
  });
  scores['p01@demo.test'][1] = 100;
  scores['p02@demo.test'][1] = 99;
  scores['p03@demo.test'][1] = 98;
  scores['p04@demo.test'][1] = 97; scores['p04@demo.test'][2] = 90;
  scores['p05@demo.test'][1] = 96; scores['p05@demo.test'][2] = 89;
  const teams = assignTeams(ps, CHAMPIONS, scores);
  checkProperties(teams, ps);
  const championOf = (email) => teams.find((t) => t.emails.includes(email)).championId;
  for (const email of ['p01@demo.test', 'p02@demo.test', 'p03@demo.test']) assert.equal(championOf(email), 1);
  assert.equal(championOf('p04@demo.test'), 2);
  assert.equal(championOf('p05@demo.test'), 2);
});

test('assignTeams: quien sobra se une al equipo del champion con más afinidad con él [RF-6]', () => {
  // 37 personas: 36 con preferencias repartidas y p37 que prefiere claramente al champion 9
  const ps = makeParticipants(37);
  const scores = preferenceScores(ps.slice(0, 36), (i) => Math.floor(i / 3) + 1);
  scores['p37@demo.test'] = {};
  CHAMPIONS.forEach((c) => { scores['p37@demo.test'][c.id] = c.id === 9 ? 95 : 5; });
  const teams = assignTeams(ps, CHAMPIONS, scores);
  checkProperties(teams, ps);
  const four = teams.find((t) => t.emails.length === 4);
  assert.equal(four.championId, 9);
  assert.ok(four.emails.includes('p37@demo.test'));
});

test('assignTeams: los dos que sobran nunca van al mismo equipo (el segundo, a su siguiente champion) [RF-6]', () => {
  const ps = makeParticipants(38);
  const scores = preferenceScores(ps.slice(0, 36), (i) => Math.floor(i / 3) + 1);
  for (const [email, second] of [['p37@demo.test', 4], ['p38@demo.test', 5]]) {
    scores[email] = {};
    CHAMPIONS.forEach((c) => { scores[email][c.id] = c.id === 9 ? 95 : c.id === second ? 60 : 5; });
  }
  const teams = assignTeams(ps, CHAMPIONS, scores);
  checkProperties(teams, ps);
  const championOf = (email) => teams.find((t) => t.emails.includes(email)).championId;
  assert.equal(championOf('p37@demo.test'), 9);
  assert.equal(championOf('p38@demo.test'), 5, 'el equipo del 9 ya es de 4: va a su segunda opción');
});

test('assignTeams: determinista, aunque cambie el orden de entrada', () => {
  const ps = makeParticipants(38);
  const scores = fillerScores(ps);
  const a = assignTeams(ps, CHAMPIONS, scores);
  const b = assignTeams([...ps].reverse(), [...CHAMPIONS].reverse(), scores);
  assert.deepEqual(a, b);
});

test('assignTeams: una afinidad que falta cuenta como 0 (no rompe)', () => {
  const ps = makeParticipants(7);
  const teams = assignTeams(ps, CHAMPIONS, { 'p01@demo.test': { 3: 80 } });
  checkProperties(teams, ps);
});

test('assignTeams: sin teamCounts el reparto no cambia; con teamCounts empieza por los que tienen menos', () => {
  const people = makeParticipants(6);
  const scores = fillerScores(people);
  assert.deepEqual(assignTeams(people, CHAMPIONS, scores, { teamCounts: {} }), assignTeams(people, CHAMPIONS, scores));
  const counts = Object.fromEntries(CHAMPIONS.map((c) => [c.id, c.id <= 10 ? 1 : 0]));
  const ids = assignTeams(people, CHAMPIONS, scores, { teamCounts: counts }).map((t) => t.championId).sort((a, b) => a - b);
  assert.deepEqual(ids, [11, 12]);
});

// ---------- Los que llegan tarde (RF-15 · equipos de 3) ----------

// Emparejamiento ya hecho con 30: equipos 1..10, champions 1..10, de 3 personas
const EXISTING = Array.from({ length: 10 }, (_, i) => ({
  teamId: i + 1,
  championId: i + 1,
  emails: [1, 2, 3].map((k) => `old${3 * i + k}@demo.test`),
}));
const ALL_FOUR = EXISTING.map((t) => ({ ...t, emails: [...t.emails, `extra${t.teamId}@demo.test`] }));
const copy = (teams) => JSON.parse(JSON.stringify(teams));
const onlyPrefers = (email, ranking) => ({ [email]: Object.fromEntries(ranking.map((id, i) => [id, 100 - i * 10])) });

test('assignNewcomers: sin pendientes no hace nada [RF-15]', () => {
  assert.deepEqual(assignNewcomers([], EXISTING, CHAMPIONS, {}), { joins: [], newTeams: [], waiting: false });
});

test('assignNewcomers: 1 persona se une al equipo de 3 cuyo champion tiene más afinidad [RF-15]', () => {
  const [late] = makeParticipants(1);
  const scores = { [late.email]: { 4: 90, 7: 60, 11: 100 } }; // el 11 no tiene equipo: no cuenta
  const result = assignNewcomers([late], EXISTING, CHAMPIONS, scores);
  assert.deepEqual(result, { joins: [{ teamId: 4, championId: 4, email: late.email }], newTeams: [], waiting: false });
});

test('assignNewcomers: 1 persona, empate → champion id menor y luego equipo menor [RF-15]', () => {
  const [late] = makeParticipants(1);
  const teams = [...EXISTING, { teamId: 11, championId: 3, emails: ['x@demo.test', 'y@demo.test', 'z@demo.test'] }];
  const scores = { [late.email]: { 3: 80, 5: 80 } };
  assert.equal(assignNewcomers([late], teams, CHAMPIONS, scores).joins[0].teamId, 3);
});

test('assignNewcomers: 2 personas → cada una a un equipo de 3 distinto, aunque prefieran el mismo [RF-15]', () => {
  const late = makeParticipants(2);
  const scores = { ...onlyPrefers(late[0].email, [4, 7]), ...onlyPrefers(late[1].email, [4, 6]) };
  const result = assignNewcomers(late, EXISTING, CHAMPIONS, scores);
  assert.equal(result.waiting, false);
  assert.deepEqual(result.newTeams, []);
  assert.deepEqual(result.joins, [
    { teamId: 4, championId: 4, email: late[0].email },
    { teamId: 6, championId: 6, email: late[1].email },
  ]);
});

test('assignNewcomers: si no hay equipos de 3 para todos, no se une nadie y se espera (todo o nada) [RF-15]', () => {
  const [late] = makeParticipants(1);
  assert.deepEqual(assignNewcomers([late], ALL_FOUR, CHAMPIONS, {}), { joins: [], newTeams: [], waiting: true });
  const two = makeParticipants(2);
  const oneLeft = ALL_FOUR.map((t) => (t.teamId === 2 ? EXISTING[1] : t)); // solo el equipo 2 es de 3
  assert.deepEqual(assignNewcomers(two, oneLeft, CHAMPIONS, fillerScores(two)), { joins: [], newTeams: [], waiting: true });
});

test('assignNewcomers: 3 personas → 1 equipo nuevo de 3 con el id siguiente, champion sin equipo [RF-15]', () => {
  const late = makeParticipants(3);
  const result = assignNewcomers(late, EXISTING, CHAMPIONS, fillerScores(late));
  assert.deepEqual(result.joins, []);
  assert.equal(result.newTeams.length, 1);
  assert.equal(result.newTeams[0].teamId, 11);
  assert.ok([11, 12].includes(result.newTeams[0].championId), 'van los champions con menos equipos');
  assert.deepEqual([...result.newTeams[0].emails].sort(), late.map((p) => p.email).sort());
});

test('assignNewcomers: 5 personas → 1 equipo nuevo de 3 y las 2 que sobran a equipos de 3 distintos [RF-15]', () => {
  const late = makeParticipants(5);
  const result = assignNewcomers(late, EXISTING, CHAMPIONS, fillerScores(late));
  assert.equal(result.newTeams.length, 1);
  assert.equal(result.newTeams[0].teamId, 11);
  const placed = [...result.newTeams[0].emails, ...result.joins.map((j) => j.email)].sort();
  assert.deepEqual(placed, late.map((p) => p.email).sort());
  const targets = [...result.joins.map((j) => j.teamId), ...(result.newTeams[0].emails.length > 3 ? [11, 11].slice(0, result.newTeams[0].emails.length - 3) : [])];
  assert.equal(new Set(targets).size, targets.length, 'nunca dos al mismo equipo');
  assert.ok(result.newTeams[0].emails.length <= 4);
});

test('assignNewcomers: 7 personas → 2 equipos nuevos (ids 11 y 12) y la que sobra a un equipo de 3 [RF-15]', () => {
  const late = makeParticipants(7);
  const result = assignNewcomers(late, EXISTING, CHAMPIONS, fillerScores(late));
  assert.deepEqual(result.newTeams.map((t) => t.teamId), [11, 12]);
  const placed = [...result.newTeams.flatMap((t) => t.emails), ...result.joins.map((j) => j.email)];
  assert.equal(placed.length, 7);
  assert.equal(result.joins.length + result.newTeams.filter((t) => t.emails.length === 4).length, 1);
});

test('assignNewcomers: 5 personas sin equipos de 3 existentes → las que sobran van al equipo nuevo [RF-15, RF-6]', () => {
  const late = makeParticipants(5);
  const result = assignNewcomers(late, ALL_FOUR, CHAMPIONS, fillerScores(late));
  assert.equal(result.waiting, false);
  assert.deepEqual(result.joins, []);
  assert.equal(result.newTeams.length, 1);
  assert.equal(result.newTeams[0].emails.length, 5, 'un solo equipo nuevo: queda de 5');
});

test('assignNewcomers: siguen las rondas contando los equipos que ya existen [RF-15, RF-5]', () => {
  const late = makeParticipants(12); // 4 equipos: 2 a los champions sin equipo y 2 de la ronda 2
  const { newTeams, joins } = assignNewcomers(late, EXISTING, CHAMPIONS, fillerScores(late));
  assert.deepEqual(joins, []);
  const all = [...EXISTING, ...newTeams];
  const perChampion = CHAMPIONS.map((c) => all.filter((t) => t.championId === c.id).length);
  assert.ok(Math.max(...perChampion) - Math.min(...perChampion) <= 1, 'diferencia ≤ 1');
  assert.ok(newTeams.some((t) => t.championId === 11) && newTeams.some((t) => t.championId === 12));
  assert.deepEqual(newTeams.map((t) => t.teamId), [11, 12, 13, 14]);
});

test('assignNewcomers: nunca cambia los equipos existentes [RF-15]', () => {
  const before = copy(EXISTING);
  for (const n of [1, 2, 3, 5, 7]) {
    const late = makeParticipants(n);
    assignNewcomers(late, EXISTING, CHAMPIONS, fillerScores(late));
  }
  assert.deepEqual(EXISTING, before);
});
