import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
const source = resolve(process.env.DATABASE_PATH || "./data/chisla.sqlite");
const destination = resolve(
  process.argv[2] ||
    `./backups/chisla-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
if (source === destination)
  throw new Error("Путь копии должен отличаться от исходной базы");
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = check.prepare("PRAGMA integrity_check").get();
    if (result.integrity_check !== "ok")
      throw new Error("Копия не прошла integrity_check");
  } finally {
    check.close();
  }
  console.log(`Проверенная резервная копия: ${destination}`);
} finally {
  db.close();
}
