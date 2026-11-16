import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(root, 'data', 'tournament.db');
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    player1_id INTEGER NOT NULL REFERENCES players(id),
    player2_id INTEGER NOT NULL REFERENCES players(id),
    grp TEXT
  );
  CREATE TABLE IF NOT EXISTS matches(
    id INTEGER PRIMARY KEY,
    phase TEXT NOT NULL,
    round INTEGER NOT NULL,
    slot INTEGER NOT NULL DEFAULT 0,
    grp TEXT,
    team_a_id INTEGER,
    team_b_id INTEGER,
    table_no INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    winner_team_id INTEGER,
    next_match_id INTEGER,
    next_slot TEXT,
    is_bye INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS throws(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    cups INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/** Führt fn in einer Transaktion aus; bei einem Fehler wird alles zurückgerollt. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Migration: ältere Datenbanken kennen die Spalte für Bomben-Paare noch nicht.
const throwColumns = db.prepare('PRAGMA table_info(throws)').all() as unknown as { name: string }[];
if (!throwColumns.some((c) => c.name === 'pair_id')) db.exec('ALTER TABLE throws ADD COLUMN pair_id INTEGER');

// Migration: Spielabschnitt für Redemption und Sudden Death.
const matchColumns = db.prepare('PRAGMA table_info(matches)').all() as unknown as { name: string }[];
if (!matchColumns.some((c) => c.name === 'stage')) db.exec(`ALTER TABLE matches ADD COLUMN stage TEXT NOT NULL DEFAULT 'normal'`);
