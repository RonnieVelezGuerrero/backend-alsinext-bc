// Alsinext: reparto de los participantes en equipos con los AI Champions (spec 006).
// Lógica pura: recibe las afinidades ya calculadas (las da Gemini) y no toca la base de datos.
// Algoritmo del plan §4 (equipos de 3 desde el cambio 2026-10-15, §6e): equipos de 3
// repartidos por rondas entre los champions; los que sobran (1–2) se unen a equipos distintos
// (de 4) y, dentro de esas reglas, cada persona va con el champion de mayor afinidad.

const TEAM_SIZE = 3; // RF-4: nunca equipos de menos

// Afinidad de una persona con un champion; si falta, cuenta como 0
function scoreOf(scores, email, championId) {
  const value = scores?.[email]?.[championId];
  return typeof value === 'number' ? value : 0;
}

// Equipos ordenados de más a menos afín para una persona (empate: champion id menor, equipo menor)
function byAffinity(teams, scores, email) {
  return [...teams].sort((a, b) => scoreOf(scores, email, b.championId) - scoreOf(scores, email, a.championId)
    || a.championId - b.championId || a.teamId - b.teamId);
}

// Forma ⌊N/3⌋ equipos de 3 (por rondas y afinidad) y devuelve también quién ha sobrado.
// teamCounts (opcional): { [championId]: equipos que ya tiene } para seguir las rondas (RF-15).
function formTeams(participants, champions, scores, teamCounts = {}) {
  // Orden fijo (correo y id) para que el resultado no dependa del orden de entrada
  const emails = participants.map((p) => p.email).sort();
  const championIds = champions.map((c) => c.id).sort((a, b) => a - b);

  // RF-4 y RF-5: T equipos repartidos por rondas. Cada equipo va al champion con menos equipos
  // (contando los que ya tenía); empate → más demanda (suma de afinidades) y luego id menor
  const totalTeams = Math.floor(emails.length / TEAM_SIZE);
  const demandOf = new Map(championIds.map((id) => [id, emails.reduce((sum, email) => sum + scoreOf(scores, email, id), 0)]));
  const teamCount = new Map(championIds.map((id) => [id, 0])); // equipos nuevos de cada champion
  const totalOf = (id) => (teamCounts[id] || 0) + teamCount.get(id);
  for (let i = 0; i < totalTeams; i++) {
    const next = [...championIds].sort((a, b) => totalOf(a) - totalOf(b) || demandOf.get(b) - demandOf.get(a) || a - b)[0];
    teamCount.set(next, teamCount.get(next) + 1);
  }
  const freeSeats = new Map(championIds.map((id) => [id, TEAM_SIZE * teamCount.get(id)]));

  // Todas las parejas (persona, champion con equipos) de mayor a menor afinidad;
  // cada persona ocupa la primera plaza libre que le toque
  const pairs = [];
  for (const email of emails) {
    for (const id of championIds) {
      if (teamCount.get(id) > 0) pairs.push({ email, id, score: scoreOf(scores, email, id) });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.id - b.id || a.email.localeCompare(b.email));

  const assigned = new Map(championIds.map((id) => [id, []])); // champion → personas
  const done = new Set();
  for (const { email, id } of pairs) {
    if (done.has(email) || freeSeats.get(id) === 0) continue;
    assigned.get(id).push(email);
    freeSeats.set(id, freeSeats.get(id) - 1);
    done.add(email);
  }

  // Equipos de 3 por champion, en orden de asignación; se numeran por rondas
  // (ronda 1 de todos los champions por id, luego ronda 2…)
  const teams = [];
  const maxRounds = Math.max(0, ...teamCount.values());
  for (let round = 0; round < maxRounds; round++) {
    for (const id of championIds) {
      if (round < teamCount.get(id)) {
        const people = assigned.get(id);
        teams.push({ teamId: teams.length + 1, championId: id, emails: people.slice(TEAM_SIZE * round, TEAM_SIZE * round + TEAM_SIZE) });
      }
    }
  }
  return { teams, leftovers: emails.filter((email) => !done.has(email)) };
}

// RF-6: cada persona que sobra va al equipo de 3 (de `candidates`) de su champion más afín;
// nunca dos al mismo. Devuelve { placed: [{ email, team }], unplaced: [email] }.
function joinTeamsOf3(people, candidates, scores) {
  const used = new Set();
  const placed = [];
  const unplaced = [];
  for (const email of [...people].sort()) {
    const team = byAffinity(candidates.filter((t) => t.emails.length === TEAM_SIZE && !used.has(t)), scores, email)[0];
    if (team) {
      used.add(team);
      placed.push({ email, team });
    } else {
      unplaced.push(email);
    }
  }
  return { placed, unplaced };
}

// participants: [{ email }] · champions: [{ id }] · scores: { [email]: { [championId]: 0–100 } }
// teamCounts (opcional): { [championId]: equipos que ya tiene } para seguir las rondas (RF-15).
// Devuelve [{ teamId, championId, emails: [..] }] con teamId 1..T en orden de presentación.
function assignTeams(participants, champions, scores, { teamCounts = {} } = {}) {
  if (!Array.isArray(champions) || champions.length === 0) throw new Error('no_champions');
  if (!Array.isArray(participants) || participants.length < TEAM_SIZE) {
    throw new Error('not_enough_participants'); // RF-10
  }
  const { teams, leftovers } = formTeams(participants, champions, scores, teamCounts);
  // RF-6: los que sobran, a equipos de 4 distintos; con un solo equipo, a ese (puede quedar de 5)
  const { placed, unplaced } = joinTeamsOf3(leftovers, teams, scores);
  for (const { email, team } of placed) team.emails.push(email);
  for (const email of unplaced) byAffinity(teams, scores, email)[0].emails.push(email);
  return teams;
}

// RF-15: reparte a los que se registraron después del emparejamiento sin tocar los equipos
// existentes. pending: [{ email }] · existingTeams: [{ teamId, championId, emails }].
// Devuelve { joins: [{ teamId, championId, email }], newTeams: [...], waiting }:
// - 1–2 personas → cada una al equipo de 3 de su champion más afín, nunca dos al mismo; si
//   alguna no cabe → waiting y no se une nadie (todo o nada: hacen falta más personas);
// - 3 o más → ⌊n/3⌋ equipos nuevos (rondas contando los existentes, ids desde el último + 1);
//   las que sobran se unen a equipos de 3 (existentes o nuevos) como en el caso anterior; si
//   no queda ninguno, al equipo nuevo más afín.
function assignNewcomers(pending, existingTeams, champions, scores) {
  const none = { joins: [], newTeams: [], waiting: false };
  if (pending.length === 0) return none;
  const emails = pending.map((p) => p.email);
  const toJoin = (placed) => placed.map(({ email, team }) => ({ teamId: team.teamId, championId: team.championId, email }));

  if (pending.length < TEAM_SIZE) {
    const { placed, unplaced } = joinTeamsOf3(emails, existingTeams, scores);
    if (unplaced.length > 0) return { ...none, waiting: true };
    return { ...none, joins: toJoin(placed) };
  }

  const teamCounts = {};
  for (const team of existingTeams) teamCounts[team.championId] = (teamCounts[team.championId] || 0) + 1;
  const lastId = existingTeams.reduce((max, team) => Math.max(max, team.teamId), 0);
  const { teams, leftovers } = formTeams(pending, champions, scores, teamCounts);
  const newTeams = teams.map((team) => ({ ...team, teamId: lastId + team.teamId }));

  const { placed, unplaced } = joinTeamsOf3(leftovers, [...existingTeams, ...newTeams], scores);
  const isNew = (team) => newTeams.includes(team);
  for (const { email, team } of placed) if (isNew(team)) team.emails.push(email);
  for (const email of unplaced) byAffinity(newTeams, scores, email)[0].emails.push(email);
  return { ...none, joins: toJoin(placed.filter(({ team }) => !isNew(team))), newTeams };
}

module.exports = { TEAM_SIZE, assignTeams, assignNewcomers };
