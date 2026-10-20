import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Versioned, additive migrations. Authentication schema is migrated by Better Auth separately.
const migrations = [
  `CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, birth_date TEXT, updated_at TEXT NOT NULL);
   CREATE TABLE orders (
     id TEXT PRIMARY KEY, user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
     amount INTEGER NOT NULL CHECK(amount > 0), currency TEXT NOT NULL DEFAULT 'RUB',
     status TEXT NOT NULL CHECK(status IN ('pending','paid','canceled')),
     payment_id TEXT UNIQUE, payment_url TEXT, mode TEXT NOT NULL,
     idempotency_key TEXT NOT NULL UNIQUE, params TEXT,
     period_start TEXT NOT NULL, period_end TEXT NOT NULL,
     created_at TEXT NOT NULL, paid_at TEXT, creation_error TEXT, terms_version TEXT NOT NULL,
     request_key TEXT NOT NULL, UNIQUE(user_id, request_key));
   CREATE UNIQUE INDEX one_active_order ON orders(user_id, period_start, params) WHERE status IN ('pending','paid');
   CREATE TABLE forecasts (
     id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK(status IN ('pending','generating','completed','failed')),
     content TEXT, mode TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     started_at TEXT, completed_at TEXT);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, visitor_id TEXT,
     user_id TEXT REFERENCES user(id) ON DELETE SET NULL, order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
     utm TEXT, created_at TEXT NOT NULL);
   CREATE INDEX events_name_time ON events(name,created_at);
   CREATE UNIQUE INDEX unique_order_event ON events(name,order_id) WHERE order_id IS NOT NULL;
   CREATE TABLE payment_events (payment_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(payment_id,status));
   CREATE INDEX orders_user ON orders(user_id,created_at);`,
  `DROP INDEX one_active_order;
   CREATE UNIQUE INDEX one_active_order ON orders(user_id, mode, period_start, params) WHERE status IN ('pending','paid');`,
];

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  return db;
}
export function migrateApp(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const [index, sql] of migrations.entries()) {
    const version = index + 1;
    if (
      db
        .prepare("SELECT version FROM schema_migrations WHERE version=?")
        .get(version)
    )
      continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
