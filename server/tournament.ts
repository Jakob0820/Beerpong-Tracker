import { db } from './db.ts';
import { nextPowerOfTwo, roundRobin, seedOrder, shuffle } from './bracket.ts';
import type {
  GroupTable,
  MatchStage,
  MatchView,
  Phase,
  PlayerStat,
  Settings,
  StandingRow,
  State,
  TeamView,
  ThrowType,
  TickerItem,
} from '../shared/types.ts';

/** Fehler, der dem Benutzer als Meldung angezeigt wird (HTTP 400). */
export class AppError extends Error {}

interface TeamRow {
  id: number;
  name: string;
  player1_id: number;
  player2_id: number;
  grp: string | null;
}
interface MatchRow {
  id: number;
  phase: 'group' | 'ko';
  round: number;
  slot: number;
  grp: string | null;
  team_a_id: number | null;
  team_b_id: number | null;
  table_no: number | null;
  status: 'pending' | 'live' | 'done';
  winner_team_id: number | null;
  next_match_id: number | null;
  next_slot: 'a' | 'b' | null;
  is_bye: number;
  stage: MatchStage;
}
interface ThrowRow {
  id: number;
  match_id: number;
  player_id: number;
  team_id: number;
  type: ThrowType;
  cups: number;
  /** Verbindet die beiden Einträge einer Bombe. */
  pair_id: number | null;
}

const all = <T>(sql: string, ...params: (string | number | null)[]) =>
  db.prepare(sql).all(...params) as unknown as T[];
const get = <T>(sql: string, ...params: (string | number | null)[]) =>
  db.prepare(sql).get(...params) as unknown as T | undefined;
const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);

const MATCH_ORDER = `ORDER BY CASE phase WHEN 'group' THEN 0 ELSE 1 END, round, slot, id`;

// ---------- Einstellungen ----------

const DEFAULTS: Settings = {
  cupsToWin: 10,
  tables: 2,
  advancePerGroup: 2,
  autoAssign: true,
  cupsBounce: 2,
};

function readSetting(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}
function writeSetting(key: string, value: string) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export function getSettings(): Settings {
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const raw = readSetting(key);
    if (raw === undefined) continue;
    if (key === 'autoAssign') s.autoAssign = raw === '1';
    else s[key] = Number(raw);
  }
  return s;
}

export function getPhase(): Phase {
  return (readSetting('phase') as Phase | undefined) ?? 'setup';
}
function setPhase(phase: Phase) {
  writeSetting('phase', phase);
}

export function updateSettings(patch: Partial<Settings>) {
  const limits: Record<Exclude<keyof Settings, 'autoAssign'>, [number, number]> = {
    cupsToWin: [1, 30],
    tables: [1, 20],
    advancePerGroup: [1, 8],
    cupsBounce: [1, 5],
  };
  if (patch.cupsToWin !== undefined && patch.cupsToWin !== getSettings().cupsToWin && getPhase() !== 'setup') {
    throw new AppError('Die Becheranzahl kann nur vor Turnierstart geändert werden.');
  }
  for (const [key, [min, max]] of Object.entries(limits) as [keyof typeof limits, [number, number]][]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new AppError(`Ungültiger Wert für ${key} (erlaubt: ${min}–${max}).`);
    }
    writeSetting(key, String(value));
  }
  if (patch.autoAssign !== undefined) writeSetting('autoAssign', patch.autoAssign ? '1' : '0');
  assignTables();
}

// ---------- Teams ----------

export function addTeam(name: string, player1: string, player2: string) {
  if (getPhase() !== 'setup') throw new AppError('Teams können nur vor Turnierstart angelegt werden.');
  const [n, p1, p2] = [name, player1, player2].map((v) => String(v ?? '').trim());
  if (!n || !p1 || !p2) throw new AppError('Teamname und beide Spielernamen werden benötigt.');
  const id1 = Number(run('INSERT INTO players(name) VALUES(?)', p1).lastInsertRowid);
  const id2 = Number(run('INSERT INTO players(name) VALUES(?)', p2).lastInsertRowid);
  run('INSERT INTO teams(name, player1_id, player2_id) VALUES(?, ?, ?)', n, id1, id2);
}

export function deleteTeam(id: number) {
  if (getPhase() !== 'setup') throw new AppError('Teams können nur vor Turnierstart gelöscht werden.');
  const team = get<TeamRow>('SELECT * FROM teams WHERE id = ?', id);
  if (!team) throw new AppError('Team nicht gefunden.');
  run('DELETE FROM teams WHERE id = ?', id);
  run('DELETE FROM players WHERE id IN (?, ?)', team.player1_id, team.player2_id);
}

export function seedDemo() {
  if (getPhase() !== 'setup') throw new AppError('Demo-Daten gibt es nur vor Turnierstart.');
  const demo: [string, string, string][] = [
    ['Die Becherflüsterer', 'Max', 'Lena'],
    ['Hopfenhelden', 'Jonas', 'Mia'],
    ['Pongzilla', 'Tim', 'Sarah'],
    ['Team Promille', 'Felix', 'Anna'],
    ['Wurfgeschoss', 'Lukas', 'Julia'],
    ['Die Trichter', 'Paul', 'Laura'],
    ['Schaumschläger', 'Ben', 'Nina'],
    ['Letzter Becher', 'Noah', 'Emma'],
  ];
  for (const [team, p1, p2] of demo) addTeam(team, p1, p2);
}

// ---------- Turnierablauf ----------

export function drawGroups(groupCount: number) {
  if (getPhase() !== 'setup') throw new AppError('Die Gruppen können nur vor Turnierstart ausgelost werden.');
  const teams = all<TeamRow>('SELECT * FROM teams');
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > 8) {
    throw new AppError('Die Gruppenanzahl muss zwischen 1 und 8 liegen.');
  }
  if (teams.length < groupCount * 2) {
    throw new AppError(`Für ${groupCount} Gruppe(n) werden mindestens ${groupCount * 2} Teams benötigt.`);
  }
  shuffle(teams).forEach((team, i) => {
    run('UPDATE teams SET grp = ? WHERE id = ?', String.fromCharCode(65 + (i % groupCount)), team.id);
  });
}

export function startGroups() {
  if (getPhase() !== 'setup') throw new AppError('Das Turnier läuft bereits.');
  const teams = all<TeamRow>('SELECT * FROM teams ORDER BY id');
  if (teams.length < 2) throw new AppError('Es werden mindestens 2 Teams benötigt.');
  if (teams.some((t) => !t.grp)) throw new AppError('Bitte zuerst die Gruppen auslosen.');

  const groups = [...new Set(teams.map((t) => t.grp!))].sort();
  const schedules = groups.map((g) => ({ g, rounds: roundRobin(teams.filter((t) => t.grp === g)) }));
  const maxRounds = Math.max(...schedules.map((s) => s.rounds.length));
  let slot = 0;
  for (let r = 0; r < maxRounds; r++) {
    for (const { g, rounds } of schedules) {
      for (const [a, b] of rounds[r] ?? []) {
        run(
          `INSERT INTO matches(phase, round, slot, grp, team_a_id, team_b_id) VALUES('group', ?, ?, ?, ?, ?)`,
          r + 1, slot++, g, a.id, b.id,
        );
      }
    }
  }
  setPhase('group');
  assignTables();
}

export function startKo() {
  if (getPhase() !== 'group') throw new AppError('Die K.O.-Runde kann nur aus der Gruppenphase gestartet werden.');
  const open = get<{ n: number }>(`SELECT COUNT(*) n FROM matches WHERE phase = 'group' AND status != 'done'`)!.n;
  if (open > 0) throw new AppError(`Es sind noch ${open} Gruppenspiele offen.`);

  const { advancePerGroup } = getSettings();
  const tables = groupTables();
  // Setzliste: erst alle Gruppensieger, dann alle Zweiten usw.
  // So treffen Teams derselben Gruppe möglichst spät aufeinander.
  const seeds: number[] = [];
  for (let rank = 0; rank < advancePerGroup; rank++) {
    for (const table of tables) {
      const row = table.rows[rank];
      if (row) seeds.push(row.teamId);
    }
  }
  if (seeds.length < 2) throw new AppError('Für die K.O.-Runde werden mindestens 2 Teams benötigt.');

  const size = nextPowerOfTwo(seeds.length);
  const rounds = Math.log2(size);
  const order = seedOrder(size);

  // Vom Finale rückwärts anlegen, damit die Folgespiele schon existieren.
  let nextIds: number[] = [];
  for (let round = rounds; round >= 1; round--) {
    const count = size / 2 ** round;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const next = round === rounds ? null : nextIds[Math.floor(i / 2)];
      const res = run(
        `INSERT INTO matches(phase, round, slot, next_match_id, next_slot) VALUES('ko', ?, ?, ?, ?)`,
        round, i, next, next === null ? null : i % 2 === 0 ? 'a' : 'b',
      );
      ids.push(Number(res.lastInsertRowid));
    }
    nextIds = ids;
  }

  // nextIds enthält jetzt die Spiele der ersten Runde.
  nextIds.forEach((matchId, i) => {
    const a = seeds[order[2 * i] - 1] ?? null;
    const b = seeds[order[2 * i + 1] - 1] ?? null;
    run('UPDATE matches SET team_a_id = ?, team_b_id = ? WHERE id = ?', a, b, matchId);
    if (a === null || b === null) {
      // Freilos: das gesetzte Team kommt kampflos weiter.
      run('UPDATE matches SET is_bye = 1 WHERE id = ?', matchId);
      finishMatch(get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId)!, (a ?? b)!);
    }
  });

  setPhase('ko');
  assignTables();
}

/** Turnier ohne K.O.-Runde beenden: der Tabellenerste ist Sieger. */
export function finishTournament() {
  if (getPhase() !== 'group') throw new AppError('Das Turnier kann nur aus der Vorrunde heraus beendet werden.');
  const open = get<{ n: number }>(`SELECT COUNT(*) n FROM matches WHERE status != 'done'`)!.n;
  if (open > 0) throw new AppError(`Es sind noch ${open} Spiele offen.`);
  setPhase('done');
}

export function resetTournament(deleteTeams: boolean) {
  run('DELETE FROM throws');
  run('DELETE FROM matches');
  if (deleteTeams) {
    run('DELETE FROM teams');
    run('DELETE FROM players');
  } else {
    run('UPDATE teams SET grp = NULL');
  }
  setPhase('setup');
}

// ---------- Spiele ----------

function teamScore(matchId: number, teamId: number): number {
  return get<{ c: number }>(
    'SELECT COALESCE(SUM(cups), 0) c FROM throws WHERE match_id = ? AND team_id = ?', matchId, teamId,
  )!.c;
}

function liveMatchOnTable(tableNo: number, matchId: number): MatchRow {
  const match = get<MatchRow>(`SELECT * FROM matches WHERE table_no = ? AND status = 'live'`, tableNo);
  if (!match || match.id !== matchId) {
    throw new AppError('Dieses Spiel läuft nicht mehr an diesem Tisch. Bitte Seite prüfen.');
  }
  return match;
}

/**
 * Startet den nächsten Schwung Spiele, sobald alle Tische frei sind: so viele wartende Spiele,
 * wie es Tische gibt, in Spielplan-Reihenfolge und auf zufällig gewählten Tischen. Solange noch
 * irgendwo gespielt wird, passiert nichts. Ein Team spielt nie an zwei Tischen gleichzeitig;
 * ein Spiel, dessen Team in diesem Schwung schon dran ist, wartet auf den nächsten.
 */
export function assignTables() {
  const { tables, autoAssign } = getSettings();
  if (!autoAssign) return;
  if (get(`SELECT id FROM matches WHERE status = 'live' LIMIT 1`)) return;
  const waiting = all<MatchRow>(
    `SELECT * FROM matches WHERE status = 'pending' AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL ${MATCH_ORDER}`,
  );
  const freeTables = shuffle(Array.from({ length: tables }, (_, i) => i + 1));
  const busy = new Set<number | null>();
  for (const match of waiting) {
    if (freeTables.length === 0) break;
    if (busy.has(match.team_a_id) || busy.has(match.team_b_id)) continue;
    busy.add(match.team_a_id).add(match.team_b_id);
    run(`UPDATE matches SET status = 'live', table_no = ? WHERE id = ?`, freeTables.pop()!, match.id);
  }
}

export function startMatch(matchId: number, tableNo: number) {
  const match = get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId);
  if (!match || match.status !== 'pending') throw new AppError('Das Spiel kann nicht gestartet werden.');
  if (match.team_a_id === null || match.team_b_id === null) throw new AppError('Die Teams stehen noch nicht fest.');
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > getSettings().tables) {
    throw new AppError('Diesen Tisch gibt es nicht.');
  }
  const live = all<MatchRow>(`SELECT * FROM matches WHERE status = 'live'`);
  if (live.some((m) => m.table_no === tableNo)) throw new AppError(`Tisch ${tableNo} ist belegt.`);
  const busy = new Set(live.flatMap((m) => [m.team_a_id, m.team_b_id]));
  if (busy.has(match.team_a_id) || busy.has(match.team_b_id)) {
    throw new AppError('Eines der Teams spielt gerade an einem anderen Tisch.');
  }
  run(`UPDATE matches SET status = 'live', table_no = ? WHERE id = ?`, tableNo, matchId);
}

/**
 * Spielabschnitt aus dem Spielstand ableiten (nach dem Zurücknehmen eines Treffers oder dem
 * Wiederöffnen): haben beide Teams alle Becher, läuft das Sudden Death; hat nur eines alle,
 * wirft der Gegner seine Redemption.
 */
function stageFromScores(match: MatchRow): MatchStage {
  const { cupsToWin } = getSettings();
  const scores = [match.team_a_id, match.team_b_id].map((id) => (id === null ? 0 : teamScore(match.id, id)));
  const full = scores.filter((score) => score >= cupsToWin).length;
  if (full === 2) return scores[0] === scores[1] ? 'sudden' : 'confirm';
  return full === 1 ? 'redemption' : 'normal';
}

/**
 * Das Team, das gerade vorne liegt und alle Becher getroffen hat: in 'decide' und 'redemption'
 * das Team, das zuerst fertig war, in 'confirm' das Team mit dem Treffer im Sudden Death.
 */
function finisherOf(match: MatchRow): number {
  const a = teamScore(match.id, match.team_a_id!);
  const b = teamScore(match.id, match.team_b_id!);
  if (a === b || Math.max(a, b) < getSettings().cupsToWin) throw new AppError('Noch steht kein Sieger fest.');
  return a > b ? match.team_a_id! : match.team_b_id!;
}

function finishMatch(match: MatchRow, winnerId: number) {
  run(`UPDATE matches SET status = 'done', stage = 'normal', winner_team_id = ? WHERE id = ?`, winnerId, match.id);
  if (match.next_match_id !== null) {
    const column = match.next_slot === 'a' ? 'team_a_id' : 'team_b_id';
    run(`UPDATE matches SET ${column} = ? WHERE id = ?`, winnerId, match.next_match_id);
  } else if (match.phase === 'ko') {
    setPhase('done');
  }
}

/** Mehr Becher können bei einer Bombe nicht weggehen. */
const MAX_BOMB_CUPS = 7;

/**
 * Treffer eintragen. Bei einer Bombe (beide Spieler treffen denselben Becher) ist playerId
 * der Spieler, der als Zweites getroffen hat, und bombCups die Zahl der Becher, die weggehen.
 * Die Becher werden hälftig gutgeschrieben; bei ungerader Zahl bekommt der Zweite einen mehr.
 *
 * Der letzte Becher beendet das Spiel nicht sofort: erst wird am Tisch entschieden, ob der Gegner
 * eine Redemption bekommt (siehe decideRedemption). Gleicht er dabei aus, folgt das Sudden Death,
 * in dem jedes Team genau einen Becher hat und der nächste Treffer gewinnt.
 */
export function addThrow(tableNo: number, matchId: number, playerId: number, type: ThrowType, bombCups?: number) {
  const match = liveMatchOnTable(tableNo, matchId);
  const settings = getSettings();
  if (type !== 'hit' && type !== 'bounce' && type !== 'bomb') throw new AppError('Unbekannte Trefferart.');

  const team = get<TeamRow>(
    'SELECT * FROM teams WHERE id IN (?, ?) AND (player1_id = ? OR player2_id = ?)',
    match.team_a_id, match.team_b_id, playerId, playerId,
  );
  if (!team) throw new AppError('Dieser Spieler spielt nicht in diesem Spiel.');
  if (match.stage === 'decide') throw new AppError('Bitte erst entscheiden, ob es eine Redemption gibt.');
  if (match.stage === 'confirm') throw new AppError('Bitte erst den Sieg bestätigen oder den Treffer zurücknehmen.');

  const remaining = match.stage === 'sudden' ? 1 : settings.cupsToWin - teamScore(match.id, team.id);
  if (remaining <= 0) throw new AppError('Dieses Team hat schon alle Becher getroffen.');
  const now = new Date().toISOString();
  const insert = (player: number, cups: number, pairId: number | null) =>
    Number(
      run(
        'INSERT INTO throws(match_id, player_id, team_id, type, cups, created_at, pair_id) VALUES(?, ?, ?, ?, ?, ?, ?)',
        match.id, player, team.id, type, cups, now, pairId,
      ).lastInsertRowid,
    );

  let total: number;
  if (type === 'bomb') {
    total = Number(bombCups);
    const maxCups = Math.min(MAX_BOMB_CUPS, remaining);
    if (!Number.isInteger(total) || total < 1 || total > maxCups) {
      throw new AppError(`Bei dieser Bombe können 1 bis ${maxCups} Becher weggehen.`);
    }
    const firstPlayer = team.player1_id === playerId ? team.player2_id : team.player1_id;
    const firstCups = Math.floor(total / 2);
    const firstId = insert(firstPlayer, firstCups, null);
    run('UPDATE throws SET pair_id = ? WHERE id = ?', firstId, firstId);
    insert(playerId, total - firstCups, firstId);
  } else {
    total = Math.min(type === 'bounce' ? settings.cupsBounce : 1, remaining);
    insert(playerId, total, null);
  }
  if (total === remaining) {
    if (match.stage === 'normal') {
      run(`UPDATE matches SET stage = 'decide' WHERE id = ?`, match.id);
    } else if (match.stage === 'redemption') {
      run(`UPDATE matches SET stage = 'sudden' WHERE id = ?`, match.id);
    } else {
      // Treffer im Sudden Death: der Sieg wird am Tisch noch bestätigt (oder der Treffer zurückgenommen).
      run(`UPDATE matches SET stage = 'confirm' WHERE id = ?`, match.id);
    }
  }
}

/**
 * Nach dem letzten Becher: grant = true gibt dem Gegner die Redemption, grant = false beendet das
 * Spiel für das Team, das zuerst fertig war. Während der Redemption meldet grant = false den
 * Fehlwurf des Gegners, womit das Spiel ebenfalls endet. Nach einem Treffer im Sudden Death
 * bestätigt grant = false den Sieg.
 */
export function decideRedemption(tableNo: number, matchId: number, grant: boolean) {
  const match = liveMatchOnTable(tableNo, matchId);
  if (match.stage === 'decide' && grant) {
    run(`UPDATE matches SET stage = 'redemption' WHERE id = ?`, match.id);
  } else if ((match.stage === 'decide' || match.stage === 'redemption' || match.stage === 'confirm') && !grant) {
    finishMatch(match, finisherOf(match));
    assignTables();
  } else {
    throw new AppError('Hier steht gerade keine Entscheidung an.');
  }
}

/** Löscht einen Treffer; bei einer Bombe beide zusammengehörigen Einträge. */
function deleteThrow(row: ThrowRow) {
  if (row.pair_id !== null) run('DELETE FROM throws WHERE pair_id = ?', row.pair_id);
  else run('DELETE FROM throws WHERE id = ?', row.id);
}

export function undoThrow(tableNo: number, matchId: number) {
  const match = liveMatchOnTable(tableNo, matchId);
  const last = get<ThrowRow>('SELECT * FROM throws WHERE match_id = ? ORDER BY id DESC LIMIT 1', match.id);
  if (!last) throw new AppError('Es gibt keinen Treffer zum Zurücknehmen.');
  deleteThrow(last);
  run('UPDATE matches SET stage = ? WHERE id = ?', stageFromScores(match), match.id);
}

/** Spiel vorzeitig beenden (z.B. Zeitlimit): das Team mit mehr Bechern gewinnt. */
export function finishMatchEarly(tableNo: number, matchId: number) {
  const match = liveMatchOnTable(tableNo, matchId);
  const a = teamScore(match.id, match.team_a_id!);
  const b = teamScore(match.id, match.team_b_id!);
  if (a === b) throw new AppError('Bei Gleichstand kann das Spiel nicht beendet werden.');
  finishMatch(match, a > b ? match.team_a_id! : match.team_b_id!);
  assignTables();
}

/** Admin: ein beendetes Spiel wieder öffnen (z.B. nach einem Fehltipp beim letzten Becher). */
export function reopenMatch(matchId: number) {
  const match = get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId);
  if (!match || match.status !== 'done' || match.is_bye) throw new AppError('Dieses Spiel kann nicht wieder geöffnet werden.');
  if (match.phase === 'group') {
    if (get(`SELECT id FROM matches WHERE phase = 'ko' LIMIT 1`)) {
      throw new AppError('Die K.O.-Runde läuft bereits, die Vorrunde ist abgeschlossen.');
    }
    setPhase('group');
  }
  if (match.next_match_id !== null) {
    const next = get<MatchRow>('SELECT * FROM matches WHERE id = ?', match.next_match_id)!;
    if (next.status !== 'pending') throw new AppError('Das Folgespiel wurde schon gestartet.');
    const column = match.next_slot === 'a' ? 'team_a_id' : 'team_b_id';
    run(`UPDATE matches SET ${column} = NULL WHERE id = ?`, next.id);
  } else if (match.phase === 'ko') {
    setPhase('ko');
  }
  // Hat der Sieger alle Becher getroffen, wird sein letzter Treffer entfernt,
  // damit das Spiel weitergehen kann. Nach einem Sudden Death steht es danach wieder
  // unentschieden, das Spiel geht also im Sudden Death weiter.
  const winner = match.winner_team_id!;
  if (teamScore(match.id, winner) >= getSettings().cupsToWin) {
    const last = get<ThrowRow>(
      'SELECT * FROM throws WHERE match_id = ? AND team_id = ? ORDER BY id DESC LIMIT 1', match.id, winner,
    );
    if (last) deleteThrow(last);
  }
  // Das Spiel läuft an seinem alten Tisch weiter, wenn der noch frei ist und keines der Teams
  // inzwischen woanders spielt. Sonst wartet es auf den nächsten Schwung oder den Admin.
  const live = all<MatchRow>(`SELECT * FROM matches WHERE status = 'live'`);
  const canResume =
    match.table_no !== null &&
    match.table_no <= getSettings().tables &&
    !live.some((m) => m.table_no === match.table_no || [m.team_a_id, m.team_b_id].some((id) => id === match.team_a_id || id === match.team_b_id));
  run(
    `UPDATE matches SET status = ?, stage = ?, winner_team_id = NULL, table_no = ? WHERE id = ?`,
    canResume ? 'live' : 'pending', stageFromScores(match), canResume ? match.table_no : null, match.id,
  );
  assignTables();
}

// ---------- Auswertung ----------

type ScoreMap = Map<string, number>;

function loadScores(): ScoreMap {
  const map: ScoreMap = new Map();
  for (const r of all<{ match_id: number; team_id: number; c: number }>(
    'SELECT match_id, team_id, SUM(cups) c FROM throws GROUP BY match_id, team_id',
  )) {
    map.set(`${r.match_id}:${r.team_id}`, r.c);
  }
  return map;
}

function standings(teamIds: number[], matches: MatchRow[], scores: ScoreMap, teamNames: Map<number, string>): StandingRow[] {
  const rows = new Map<number, StandingRow>(
    teamIds.map((id) => [id, { teamId: id, played: 0, wins: 0, losses: 0, cupsFor: 0, cupsAgainst: 0, diff: 0 }]),
  );
  const beat = new Set<string>();
  for (const m of matches) {
    if (m.status !== 'done' || m.is_bye || m.team_a_id === null || m.team_b_id === null) continue;
    const a = rows.get(m.team_a_id);
    const b = rows.get(m.team_b_id);
    if (!a || !b) continue;
    const sa = scores.get(`${m.id}:${m.team_a_id}`) ?? 0;
    const sb = scores.get(`${m.id}:${m.team_b_id}`) ?? 0;
    a.played++; b.played++;
    a.cupsFor += sa; a.cupsAgainst += sb;
    b.cupsFor += sb; b.cupsAgainst += sa;
    const [winner, loser] = m.winner_team_id === a.teamId ? [a, b] : [b, a];
    winner.wins++; loser.losses++;
    beat.add(`${winner.teamId}>${loser.teamId}`);
  }
  for (const r of rows.values()) r.diff = r.cupsFor - r.cupsAgainst;
  return [...rows.values()].sort((x, y) =>
    y.wins - x.wins ||
    y.diff - x.diff ||
    Number(beat.has(`${y.teamId}>${x.teamId}`)) - Number(beat.has(`${x.teamId}>${y.teamId}`)) ||
    y.cupsFor - x.cupsFor ||
    (teamNames.get(x.teamId) ?? '').localeCompare(teamNames.get(y.teamId) ?? '', 'de'),
  );
}

function groupTables(): GroupTable[] {
  const teams = all<TeamRow>('SELECT * FROM teams ORDER BY id');
  const matches = all<MatchRow>(`SELECT * FROM matches WHERE phase = 'group'`);
  const scores = loadScores();
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const groups = [...new Set(teams.map((t) => t.grp).filter((g): g is string => !!g))].sort();
  return groups.map((name) => ({
    name,
    rows: standings(teams.filter((t) => t.grp === name).map((t) => t.id), matches, scores, names),
  }));
}

function koLabel(round: number, koRounds: number): string {
  const matchesInRound = 2 ** (koRounds - round);
  return (
    { 1: 'Finale', 2: 'Halbfinale', 4: 'Viertelfinale', 8: 'Achtelfinale' }[matchesInRound] ?? `K.O.-Runde ${round}`
  );
}

export function buildState(): State {
  const settings = getSettings();
  const teamRows = all<TeamRow>('SELECT * FROM teams ORDER BY id');
  const playerNames = new Map(all<{ id: number; name: string }>('SELECT * FROM players').map((p) => [p.id, p.name]));
  const matchRows = all<MatchRow>(`SELECT * FROM matches ${MATCH_ORDER}`);
  const throwRows = all<ThrowRow>('SELECT * FROM throws ORDER BY id');
  const scores = loadScores();
  const teamNames = new Map(teamRows.map((t) => [t.id, t.name]));

  const teams: TeamView[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    group: t.grp,
    players: [t.player1_id, t.player2_id].map((id) => ({ id, name: playerNames.get(id) ?? '?' })),
  }));

  const groupCount = new Set(teamRows.map((t) => t.grp).filter(Boolean)).size;
  const koRounds = Math.max(0, ...matchRows.filter((m) => m.phase === 'ko').map((m) => m.round));
  const matches: MatchView[] = matchRows.map((m) => ({
    id: m.id,
    phase: m.phase,
    round: m.round,
    slot: m.slot,
    group: m.grp,
    label: m.phase === 'ko' ? koLabel(m.round, koRounds) : groupCount > 1 ? `Gruppe ${m.grp}` : `Runde ${m.round}`,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    tableNo: m.table_no,
    status: m.status,
    stage: m.stage,
    winnerTeamId: m.winner_team_id,
    scoreA: m.team_a_id === null ? 0 : (scores.get(`${m.id}:${m.team_a_id}`) ?? 0),
    scoreB: m.team_b_id === null ? 0 : (scores.get(`${m.id}:${m.team_b_id}`) ?? 0),
    isBye: !!m.is_bye,
  }));

  // "Letzter Becher": der Treffer, mit dem das Siegerteam alle Becher voll gemacht hat.
  const lastCupThrows = new Set<number>();
  for (const m of matchRows) {
    if (m.status !== 'done' || m.is_bye || m.winner_team_id === null) continue;
    if ((scores.get(`${m.id}:${m.winner_team_id}`) ?? 0) < settings.cupsToWin) continue;
    const last = throwRows.findLast((t) => t.match_id === m.id && t.team_id === m.winner_team_id);
    if (last) lastCupThrows.add(last.id);
  }
  // Für die Einblendung zählt schon der Treffer, mit dem ein Team alle Becher voll macht,
  // auch wenn das Spiel wegen einer möglichen Redemption noch nicht beendet ist.
  const fullCupThrows = new Set(lastCupThrows);
  for (const m of matchRows) {
    if (m.status !== 'live') continue;
    for (const teamId of [m.team_a_id, m.team_b_id]) {
      if (teamId === null || (scores.get(`${m.id}:${teamId}`) ?? 0) < settings.cupsToWin) continue;
      const last = throwRows.findLast((t) => t.match_id === m.id && t.team_id === teamId);
      if (last) fullCupThrows.add(last.id);
    }
  }

  const stats = new Map<number, PlayerStat>();
  for (const t of teamRows) {
    for (const playerId of [t.player1_id, t.player2_id]) {
      stats.set(playerId, {
        playerId, name: playerNames.get(playerId) ?? '?', teamId: t.id, teamName: t.name,
        games: 0, wins: 0, losses: 0, hits: 0, cups: 0, bounce: 0, bomb: 0, lastCup: 0,
      });
    }
  }
  for (const t of throwRows) {
    const s = stats.get(t.player_id);
    if (!s) continue;
    s.hits++;
    s.cups += t.cups;
    if (t.type === 'bounce' || t.type === 'bomb') s[t.type]++;
    if (lastCupThrows.has(t.id)) s.lastCup++;
  }
  for (const m of matchRows) {
    if (m.status !== 'done' || m.is_bye) continue;
    for (const s of stats.values()) {
      if (s.teamId !== m.team_a_id && s.teamId !== m.team_b_id) continue;
      s.games++;
      if (s.teamId === m.winner_team_id) s.wins++;
      else s.losses++;
    }
  }
  const playerStats = [...stats.values()].sort(
    (a, b) => b.cups - a.cups || b.hits - a.hits || a.name.localeCompare(b.name, 'de'),
  );

  const ticker: TickerItem[] = throwRows.slice(-12).reverse().map((t) => ({
    id: t.id,
    matchId: t.match_id,
    playerId: t.player_id,
    playerName: playerNames.get(t.player_id) ?? '?',
    teamName: teamNames.get(t.team_id) ?? '?',
    type: t.type,
    cups: t.cups,
    total:
      t.pair_id === null
        ? t.cups
        : throwRows.filter((o) => o.pair_id === t.pair_id).reduce((sum, o) => sum + o.cups, 0),
    lastCup: fullCupThrows.has(t.id),
  }));

  const phase = getPhase();
  const leaderboard = standings(teamRows.map((t) => t.id), matchRows, scores, teamNames);
  const final = matchRows.find((m) => m.phase === 'ko' && m.next_match_id === null);
  // Mit K.O.-Runde gewinnt der Finalsieger, ohne der Tabellenerste.
  let champion: number | null = null;
  if (final) champion = final.status === 'done' ? final.winner_team_id : null;
  else if (phase === 'done') champion = leaderboard[0]?.teamId ?? null;

  return {
    phase,
    settings,
    teams,
    matches,
    groups: groupTables(),
    leaderboard,
    playerStats,
    ticker,
    koRounds,
    champion,
  };
}
