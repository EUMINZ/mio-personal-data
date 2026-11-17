import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

export function nowIso() {
  return new Date().toISOString();
}

export function openCoreDatabase({ filePath = ':memory:', migrate = true, migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const db = new DatabaseSync(filePath);
  // Independent MCP processes and the operator share this file. Wait briefly
  // for another writer rather than turning ordinary contention into a denial.
  db.exec('PRAGMA busy_timeout = 3000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  if (migrate) {
    applyMigrations(db, migrationsDir);
  }
  return db;
}

export function closeCoreDatabase(db) {
  db.close();
}

export function applyMigrations(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const alreadyApplied = new Set(
    db.prepare('SELECT name FROM schema_migrations ORDER BY id ASC').all().map((row) => row.name),
  );

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const migrationName of migrationFiles) {
    if (alreadyApplied.has(migrationName)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(migrationName, nowIso());
    });
  }
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function encodeJson(value) {
  return JSON.stringify(value);
}

export function decodeJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
